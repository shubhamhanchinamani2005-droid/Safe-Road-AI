"""
road_detector.py — SafeRoad AI: Calibrated Road Damage Validator & Classifier.

Accurately validates road damage photos:
  1. Accepts real outdoor damaged road surfaces:
     - Asphalt, concrete, bitumen, tar, gravel, dusty/sunlit roadways.
     - Potholes (eroded depressions with surrounding pavement context).
     - Cracks (meandering, branching, alligator, and fissure networks).
  2. Reliably rejects non-road photos:
     - Selfies and human portraits (YuNet DNN + smooth skin ellipse check).
     - Household / tech objects (MobileNetV2 blacklist).
     - Domestic animals (MobileNetV2 blacklist).
     - Pure nature scenes (foliage / sky / water — HSV color ratio).
     - Indoor surfaces with no granular pavement texture.
  3. Rejects clean, undamaged road surfaces.

Key Fixes vs Prior Versions:
  - Skin-color mask now REQUIRES low local variance (lvar < 6.0) to avoid
    falsely flagging dusty/sunlit road aggregate as human skin.
  - Road surface mask uses saturation < 120 (previously < 85) to capture
    warm beige/tan dusty roads that were previously rejected.
  - YuNet DNN face detector (cv2.FaceDetectorYN) replaces old CascadeClassifier
    (not available in opencv-python-headless 5.x).
  - Pothole cavity requires collar/rim verification: surrounding pixels MUST
    be granular pavement texture — prevents objects, shoes, mugs being classified
    as potholes.
  - Crack detection uses adaptive threshold + solidity filter on fissure contours
    rather than a single long continuous Canny contour, which was too strict for
    real fragmented crack networks.
"""

import os
import io
import base64
import numpy as np
import cv2
from PIL import Image
try:
    import onnxruntime as ort
except ImportError:
    ort = None
import json

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
MODEL_PATH = os.path.join(CURRENT_DIR, "mobilenetv2.onnx")
CLASSES_PATH = os.path.join(CURRENT_DIR, "imagenet_classes.json")
YUNET_PATH = os.path.join(CURRENT_DIR, "face_detection_yunet.onnx")

_ort_session = None
_imagenet_classes = None
_yunet_detector = None


def get_onnx_session():
    """Initialize and cache the MobileNetV2 ONNX session and ImageNet classes."""
    global _ort_session, _imagenet_classes
    if ort is not None and _ort_session is None and os.path.exists(MODEL_PATH):
        try:
            opts = ort.SessionOptions()
            opts.intra_op_num_threads = 2
            opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
            _ort_session = ort.InferenceSession(
                MODEL_PATH, sess_options=opts, providers=['CPUExecutionProvider']
            )
            if os.path.exists(CLASSES_PATH):
                with open(CLASSES_PATH, "r") as f:
                    _imagenet_classes = json.load(f)
        except Exception as e:
            print(f"[road_detector] Warning: Could not initialize MobileNetV2 ONNX: {e}")
            _ort_session = None
    return _ort_session, _imagenet_classes


def get_yunet_detector():
    """Initialize and cache the YuNet face detector (cv2.FaceDetectorYN)."""
    global _yunet_detector
    if _yunet_detector is None and os.path.exists(YUNET_PATH):
        try:
            _yunet_detector = cv2.FaceDetectorYN.create(
                YUNET_PATH, "", (320, 320), score_threshold=0.5
            )
        except Exception as e:
            print(f"[road_detector] Warning: Could not load YuNet face detector: {e}")
    return _yunet_detector


# Eagerly initialize at module load to minimize inference latency
get_onnx_session()
get_yunet_detector()


# ---------------------------------------------------------------------------
# Blacklists for Deep Learning (MobileNetV2) classifier
# ---------------------------------------------------------------------------

# Unambiguous non-road objects. We EXCLUDE pothole-like classes
# (lens cap, manhole cover, plectrum, puck) so potholes are never falsely blocked.
EXPLICIT_NON_ROAD_CLASSES = [
    # Computers & Electronics
    "laptop", "notebook computer", "computer keyboard", "typewriter keyboard",
    "cellular telephone", "dial telephone", "mouse", "television", "monitor",
    "screen", "desktop computer", "modem", "printer", "remote control",
    "ipod", "joystick", "web camera",
    # Furniture & Indoor Fixtures
    "dining table", "studio couch", "four-poster bed", "folding chair",
    "rocking chair", "desk", "bookcase", "wardrobe", "table lamp", "toilet",
    "bathtub", "shower curtain", "washbasin", "refrigerator", "microwave",
    "dishwasher",
    # Apparel & People
    "suit", "trench coat", "jersey", "jean", "sweatshirt", "cardigan",
    "t-shirt", "pajama", "apron", "necktie", "bow tie", "sunglasses",
    "wig", "academic gown", "military uniform", "kimono", "cloak",
    # Footwear & Personal Items
    "running shoe", "sneaker", "sandal", "clog", "cowboy boot", "loafer",
    "sock", "backpack", "purse", "wallet", "umbrella",
    # Food, Drink & Kitchenware
    "coffee mug", "water bottle", "wine bottle", "beer bottle", "cup",
    "plate", "bowl", "teapot", "pitcher", "pizza", "hamburger", "hotdog",
    "sandwich",
]

ANIMAL_KEYWORDS = [
    "dog", "cat", "terrier", "retriever", "bulldog", "poodle",
    "tabby", "siamese", "parrot", "rabbit", "hamster",
]

# Vehicles: close-up vehicle parts often fill the frame and have no road context
VEHICLE_CLASSES = [
    "sports car", "passenger car", "pickup truck", "tow truck",
    "minibus", "school bus", "car wheel", "radiator grille", "car mirror",
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def decode_image(image_input):
    """
    Decodes base64 string, bytes, PIL Image, or numpy array into OpenCV BGR.
    """
    if isinstance(image_input, str):
        if "," in image_input:
            image_input = image_input.split(",", 1)[1]
        image_bytes = base64.b64decode(image_input)
        pil_img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    elif isinstance(image_input, bytes):
        pil_img = Image.open(io.BytesIO(image_input)).convert("RGB")
    elif isinstance(image_input, Image.Image):
        pil_img = image_input.convert("RGB")
    elif isinstance(image_input, np.ndarray):
        return image_input.copy()
    else:
        raise ValueError("Unsupported image input type")

    rgb_arr = np.array(pil_img)
    bgr_arr = cv2.cvtColor(rgb_arr, cv2.COLOR_RGB2BGR)
    return bgr_arr


def classify_with_mobilenet(bgr_img):
    """
    Runs MobileNetV2 ONNX inference and returns top-5 (class_name, probability).
    """
    session, classes = get_onnx_session()
    if session is None or classes is None:
        return []

    try:
        rgb = cv2.cvtColor(cv2.resize(bgr_img, (224, 224)), cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        mean = np.array([0.485, 0.456, 0.406], dtype=np.float32)
        std = np.array([0.229, 0.224, 0.225], dtype=np.float32)
        norm = ((rgb - mean) / std).transpose(2, 0, 1)[np.newaxis, ...]

        out = session.run(None, {'data': norm})[0][0]
        exp = np.exp(out - np.max(out))
        probs = exp / np.sum(exp)
        top_idx = np.argsort(probs)[-5:][::-1]
        return [(classes[i], float(probs[i])) for i in top_idx]
    except Exception as e:
        print(f"[road_detector] MobileNet inference error: {e}")
        return []


def detect_face_or_portrait(bgr_img):
    """
    Two-stage face/portrait detector:
      Stage 1: YuNet DNN (cv2.FaceDetectorYN) — accurate, no false alarms on roads.
      Stage 2: Smooth skin ellipse fallback (requires lvar < 6.0 to exclude dusty road
               aggregate which shares warm/orange color tones with skin).

    Returns (is_face: bool, rejection_message: str).
    """
    h_img, w_img = bgr_img.shape[:2]
    total_area = h_img * w_img

    # --- Stage 1: YuNet DNN ---
    detector = get_yunet_detector()
    if detector is not None:
        try:
            scale = 320.0 / max(h_img, w_img)
            small = cv2.resize(bgr_img, (int(w_img * scale), int(h_img * scale)))
            detector.setInputSize((small.shape[1], small.shape[0]))
            _, faces = detector.detect(small)
            if faces is not None and len(faces) > 0:
                for f in faces:
                    fw = f[2] / scale
                    fh = f[3] / scale
                    face_area = fw * fh
                    if face_area >= total_area * 0.04:
                        return True, (
                            "Human face detected by AI Face Recognition. "
                            "SafeRoad AI accepts only road hazard photos."
                        )
        except Exception:
            pass  # Fall through to Stage 2

    # --- Stage 2: Smooth skin ellipse (skin color + low local variance) ---
    gray = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2HSV)
    ycrcb = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2YCrCb)

    # Local variance map: smooth human skin has lvar < 6; rough road gravel has lvar >> 15
    blur_f = cv2.blur(gray.astype(np.float32), (5, 5))
    sq_blur_f = cv2.blur((gray.astype(np.float32)) ** 2, (5, 5))
    lvar = np.maximum(0, sq_blur_f - blur_f ** 2)

    h_ch = hsv[:, :, 0]
    s_ch = hsv[:, :, 1]
    v_ch = hsv[:, :, 2]
    cr_ch = ycrcb[:, :, 1]
    cb_ch = ycrcb[:, :, 2]

    # Skin color mask combined with low-texture constraint
    skin_mask = (
        ((h_ch <= 22) | (h_ch >= 165))
        & (s_ch >= 40) & (s_ch <= 170)
        & (v_ch >= 70)
        & (cr_ch >= 135) & (cr_ch <= 170)
        & (cb_ch >= 85) & (cb_ch <= 125)
        & (lvar < 6.0)  # KEY: Road gravel is always rough; human skin is smooth
    ).astype(np.uint8) * 255

    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15))
    clean_skin = cv2.morphologyEx(skin_mask, cv2.MORPH_CLOSE, k)

    contours, _ = cv2.findContours(clean_skin, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    for c in contours:
        c_area = cv2.contourArea(c)
        if total_area * 0.08 <= c_area <= total_area * 0.70:
            x, y, cw, ch = cv2.boundingRect(c)
            aspect_ratio = float(ch) / float(cw + 1e-5)
            if 0.9 <= aspect_ratio <= 2.2:
                face_crop = gray[y:y + ch, x:x + cw]
                if face_crop.size > 0:
                    edges = cv2.Canny(face_crop, 35, 95)
                    edge_density = float(np.count_nonzero(edges)) / float(face_crop.size)
                    # Facial features (eyes/mouth/nose) produce moderate edge density
                    if 0.015 <= edge_density <= 0.15:
                        return True, (
                            "Human portrait or selfie detected. "
                            "Please photograph only the damaged road hazard."
                        )

    return False, ""


def check_obvious_non_road_scenes(bgr_img):
    """
    Checks for full-frame non-road environments:
    - Pure green nature / forests (> 50% vivid green)
    - Clear blue sky / open water (> 45% blue)

    Returns (is_non_road: bool, rejection_message: str).
    """
    hsv = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2HSV).astype(np.float32)
    h = hsv[:, :, 0]
    s = hsv[:, :, 1]
    v = hsv[:, :, 2]

    green_ratio = float(np.mean((h >= 35) & (h <= 85) & (s >= 55) & (v >= 35)))
    if green_ratio > 0.50:
        return True, (
            "Excessive foliage, garden, or forest detected. "
            "Please point the camera at the road surface."
        )

    blue_ratio = float(np.mean((h >= 95) & (h <= 135) & (s >= 65) & (v >= 70)))
    if blue_ratio > 0.45:
        return True, (
            "Sky or open water detected. "
            "Please point the camera down toward the roadway."
        )

    return False, ""


def evaluate_road_and_damage(bgr_img):
    """
    Primary validation pipeline:

    1. Face / Portrait check (YuNet DNN + smooth skin fallback)
    2. Obvious non-road scenes (foliage / sky)
    3. Deep Learning object / animal / vehicle classification (MobileNetV2)
    4. Road pavement ground-plane verification (granular aggregate texture)
    5. Pothole detection (dark cavity with collar rim embedded in road surface)
    6. Crack / fissure detection (adaptive threshold + solidity filter)
    7. Undamaged road rejection
    8. Damage classification & severity

    Returns a dict with keys:
      is_road_damage, damage_type, severity, confidence,
      rejection_reason, analysis_details, metrics
    """
    h_img, w_img = bgr_img.shape[:2]
    total_area = h_img * w_img

    # -----------------------------------------------------------------------
    # 1. Face / Portrait Check
    # -----------------------------------------------------------------------
    is_face, face_msg = detect_face_or_portrait(bgr_img)
    if is_face:
        return {
            "is_road_damage": False,
            "damage_type": "None",
            "severity": "None",
            "confidence": 0.98,
            "rejection_reason": f"Photo Rejected: {face_msg}",
            "analysis_details": "Human subject detected.",
            "metrics": {},
        }

    # -----------------------------------------------------------------------
    # 2. Obvious Non-Road Nature / Sky
    # -----------------------------------------------------------------------
    is_non_road, non_road_reason = check_obvious_non_road_scenes(bgr_img)
    if is_non_road:
        return {
            "is_road_damage": False,
            "damage_type": "None",
            "severity": "None",
            "confidence": 0.95,
            "rejection_reason": f"Photo Rejected: {non_road_reason}",
            "analysis_details": "Non-road scene composition.",
            "metrics": {},
        }

    # -----------------------------------------------------------------------
    # 3. Deep Learning Object / Animal / Vehicle Classification (MobileNetV2)
    # Reject ONLY when an unambiguous non-road subject is recognized with
    # solid confidence. Pothole-like classes (lens cap, manhole cover) are
    # intentionally NOT in the blacklist.
    # -----------------------------------------------------------------------
    preds = classify_with_mobilenet(bgr_img)
    if preds:
        for cls_name, prob in preds[:2]:
            cls_lower = cls_name.lower()
            is_obj = any(target in cls_lower for target in EXPLICIT_NON_ROAD_CLASSES)
            is_animal = any(ak in cls_lower for ak in ANIMAL_KEYWORDS)
            is_veh = any(vk in cls_lower for vk in VEHICLE_CLASSES)

            if (is_obj or is_animal) and prob >= 0.20:
                friendly = cls_name.replace("_", " ")
                return {
                    "is_road_damage": False,
                    "damage_type": "None",
                    "severity": "None",
                    "confidence": round(float(prob), 2),
                    "rejection_reason": (
                        f"Photo Rejected: Detected '{friendly}' ({round(prob * 100)}% match). "
                        "Please photograph only the damaged road hazard, not personal items, "
                        "furniture, or pets."
                    ),
                    "analysis_details": f"Non-road subject identified: {cls_name}",
                    "metrics": {
                        "detected_object": cls_name,
                        "object_confidence": round(float(prob), 2),
                    },
                }

            if is_veh and prob >= 0.30:
                friendly = cls_name.replace("_", " ")
                return {
                    "is_road_damage": False,
                    "damage_type": "None",
                    "severity": "None",
                    "confidence": round(float(prob), 2),
                    "rejection_reason": (
                        f"Photo Rejected: Detected vehicle '{friendly}'. "
                        "Please photograph the road surface damage directly."
                    ),
                    "analysis_details": f"Vehicle detected: {cls_name}",
                    "metrics": {
                        "detected_object": cls_name,
                        "object_confidence": round(float(prob), 2),
                    },
                }

    # -----------------------------------------------------------------------
    # 4. Road Pavement Ground-Plane Verification
    # Road surface characteristics:
    #   - Granular aggregate roughness: local variance (lvar) >= 5.0
    #     (flat desk/wall/floor has lvar ~0-2; asphalt gravel has lvar >> 50)
    #   - Neutral / earthy tones: saturation < 120
    #     (allows warm dusty/sunlit roads, not vivid colored objects)
    #   - Not too dark or too bright (v in 20-248)
    # -----------------------------------------------------------------------
    gray = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2GRAY)
    hsv = cv2.cvtColor(bgr_img, cv2.COLOR_BGR2HSV).astype(np.float32)
    s_ch = hsv[:, :, 1]
    v_ch = hsv[:, :, 2]

    blur_f = cv2.blur(gray.astype(np.float32), (5, 5))
    sq_blur_f = cv2.blur((gray.astype(np.float32)) ** 2, (5, 5))
    lvar = np.maximum(0.0, sq_blur_f - blur_f ** 2)

    road_mask = (s_ch < 120) & (v_ch > 20) & (v_ch < 248) & (lvar >= 5.0)
    road_coverage = float(np.count_nonzero(road_mask)) / float(total_area)

    if road_coverage < 0.25:
        return {
            "is_road_damage": False,
            "damage_type": "None",
            "severity": "None",
            "confidence": 0.92,
            "rejection_reason": (
                "Photo Rejected: No Road Surface Detected. The photograph does not show an "
                "outdoor road surface (asphalt or concrete pavement) occupying the view. "
                "Please capture the road hazard directly."
            ),
            "analysis_details": (
                f"Road pavement coverage is {round(road_coverage * 100, 1)}% "
                "(minimum 25% required)."
            ),
            "metrics": {
                "road_coverage": round(road_coverage, 3),
                "asphalt_ratio": round(road_coverage, 3),
            },
        }

    # -----------------------------------------------------------------------
    # 5. Pothole Detection
    #
    # A pothole is a dark cavity in the road surface that:
    #   a) Is significantly darker than the surrounding road luminance
    #   b) Has an organic, non-rectangular shape (extent 0.30-0.88)
    #   c) Has reasonable convexity (>= 0.50) — not a thin line or spike
    #   d) Is SURROUNDED by granular road pavement (collar_road_ratio >= 0.40)
    #      This collar/rim check is the key guard against false positives
    #      from shoes, mugs, or any dark object on a non-road surface.
    # -----------------------------------------------------------------------
    road_pixels = gray[road_mask > 0]
    mean_lum = float(np.mean(road_pixels)) if len(road_pixels) > 0 else float(np.mean(gray))
    std_lum = float(np.std(road_pixels)) if len(road_pixels) > 0 else float(np.std(gray))

    # Pothole is darker than surrounding road mean by at least 1 std (min 10 DN)
    dark_thresh = mean_lum - max(1.0 * std_lum, 10.0)
    cavity_mask = ((gray < dark_thresh) & (s_ch < 130)).astype(np.uint8) * 255

    k_cav = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    cavity_clean = cv2.morphologyEx(cavity_mask, cv2.MORPH_OPEN, k_cav)

    contours, _ = cv2.findContours(cavity_clean, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)

    best_pothole_score = 0.0
    best_pothole_ratio = 0.0

    for cnt in contours:
        area = cv2.contourArea(cnt)
        if area < total_area * 0.003:  # Must be at least 0.3% of image
            continue

        x, y, cw, ch = cv2.boundingRect(cnt)
        extent = area / float(cw * ch + 1e-5)
        hull = cv2.convexHull(cnt)
        hull_area = cv2.contourArea(hull)
        convexity = area / float(hull_area + 1e-5)

        # Collar / Rim check: cavity must sit inside road aggregate texture
        mask_single = np.zeros((h_img, w_img), dtype=np.uint8)
        cv2.drawContours(mask_single, [cnt], -1, 255, -1)
        collar = cv2.dilate(mask_single, np.ones((21, 21), np.uint8)) - mask_single
        collar_pixels = road_mask[collar > 0]
        collar_road_ratio = (
            float(np.count_nonzero(collar_pixels)) / float(collar_pixels.size + 1e-5)
        )

        if 0.30 <= extent <= 0.88 and convexity >= 0.50 and collar_road_ratio >= 0.40:
            aspect_ratio = float(cw) / float(ch + 1e-5)
            if 0.20 <= aspect_ratio <= 5.0:
                p_ratio = area / float(total_area)
                score = min(0.62 + p_ratio * 12.0, 0.97)
                if score > best_pothole_score:
                    best_pothole_score = score
                    best_pothole_ratio = p_ratio

    # -----------------------------------------------------------------------
    # 6. Crack / Fissure Detection
    #
    # Real road cracks appear as thin, elongated, jagged, low-solidity
    # fissures in the adaptive-threshold image.
    # Unlike the old approach (requiring a single long Canny contour),
    # this accumulates fissure_score across many smaller fragments,
    # matching how real fragmented crack networks look.
    # -----------------------------------------------------------------------
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    adapt = cv2.adaptiveThreshold(
        blurred, 255,
        cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV,
        15, 7
    )
    k_crk = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
    clean_fissures = cv2.morphologyEx(adapt, cv2.MORPH_OPEN, k_crk)

    crack_cnts, _ = cv2.findContours(clean_fissures, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)

    fissure_score = 0
    fissure_count = 0
    for c in crack_cnts:
        c_area = cv2.contourArea(c)
        if c_area >= 25:
            cx, cy, cw, ch = cv2.boundingRect(c)
            span = max(cw, ch)
            if span >= 30:
                hull = cv2.convexHull(c)
                hull_a = cv2.contourArea(hull)
                solidity = c_area / float(hull_a + 1e-5)
                # Real cracks are thin & jagged (low solidity < 0.55)
                # Straight painted lane markings have higher solidity
                if solidity < 0.55:
                    fissure_score += span
                    fissure_count += 1

    fissure_ratio = fissure_score / float(h_img + w_img)
    edges = cv2.Canny(blurred, 35, 95)
    edge_density = float(np.count_nonzero(edges)) / float(total_area)

    crack_score = 0.0
    if fissure_ratio >= 0.15 or (fissure_count >= 2 and fissure_ratio >= 0.08):
        crack_score = min(0.58 + fissure_ratio * 0.70 + edge_density * 8.0, 0.96)

    # -----------------------------------------------------------------------
    # 7. Reject Undamaged Road
    # -----------------------------------------------------------------------
    best_score = max(best_pothole_score, crack_score)
    if best_score < 0.48:
        return {
            "is_road_damage": False,
            "damage_type": "None",
            "severity": "None",
            "confidence": 0.90,
            "rejection_reason": (
                "Photo Rejected: Undamaged Road Surface. Road pavement was verified, "
                "but no road damage (potholes, cracks, or severe defects) was detected. "
                "SafeRoad AI strictly requires photos of damaged roads."
            ),
            "analysis_details": (
                f"Road pavement verified ({round(road_coverage * 100)}% coverage), "
                "but surface is undamaged."
            ),
            "metrics": {
                "road_coverage": round(road_coverage, 3),
                "asphalt_ratio": round(road_coverage, 3),
                "pothole_score": round(best_pothole_score, 2),
                "crack_score": round(crack_score, 2),
            },
        }

    # -----------------------------------------------------------------------
    # 8. Classification & Severity
    # -----------------------------------------------------------------------
    if best_pothole_score >= crack_score:
        best_type = "Pothole"
        conf = round(float(min(best_pothole_score, 0.99)), 2)
        pct = best_pothole_ratio * 100
        size_cm = max(10.0, min(pct * 8.0, 120.0))
        severity = "High" if pct >= 4.0 else ("Medium" if pct >= 1.5 else "Low")
    else:
        best_type = "Cracked Road"
        conf = round(float(min(crack_score, 0.99)), 2)
        size_cm = max(15.0, min(fissure_ratio * 200.0, 250.0))
        severity = "High" if fissure_ratio >= 0.35 else ("Medium" if fissure_ratio >= 0.20 else "Low")

    return {
        "is_road_damage": True,
        "damage_type": best_type,
        "severity": severity,
        "confidence": conf,
        "rejection_reason": "",
        "analysis_details": (
            f"Verified Road Damage: {best_type} ({severity} Severity, "
            f"{round(conf * 100)}% Confidence). "
            f"Road surface coverage: {round(road_coverage * 100)}%."
        ),
        "metrics": {
            "road_coverage": round(road_coverage, 3),
            "asphalt_ratio": round(road_coverage, 3),
            "estimated_size_cm": round(size_cm, 1),
            "pothole_score": round(best_pothole_score, 2),
            "crack_score": round(crack_score, 2),
        },
    }


def validate_and_classify_road_damage(image_input):
    """
    Main entry point for road damage validation.
    Accepts base64 string, bytes, PIL Image, or numpy array.
    Returns a result dict with is_road_damage, damage_type, severity, etc.
    """
    try:
        bgr_img = decode_image(image_input)
    except Exception as e:
        return {
            "is_road_damage": False,
            "damage_type": "None",
            "severity": "None",
            "confidence": 0.0,
            "rejection_reason": f"Photo Rejected: Could not decode image ({str(e)}).",
            "analysis_details": "Image decoding failure.",
            "metrics": {},
        }

    # Resize to max 640px on longest side for consistent, fast inference
    max_dim = 640
    h, w = bgr_img.shape[:2]
    if max(h, w) > max_dim:
        scale = max_dim / float(max(h, w))
        bgr_img = cv2.resize(
            bgr_img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA
        )

    return evaluate_road_and_damage(bgr_img)
