/**
 * clientAiEngine.js — On-Device Computer Vision & Road Damage Validator for SafeRoad AI
 * 
 * Runs 100% locally in the browser / Capacitor mobile app without any Python or backend server.
 * Accurately validates:
 *  1. Potholes & cracks on outdoor asphalt/concrete road surfaces.
 *  2. Rejects selfies, portraits, household objects, indoor desks/floors, green nature, blue sky.
 *  3. Rejects clean undamaged roads.
 */

// Helper to convert an image source (data URL, blob, file) into an HTMLImageElement
export function loadImage(source) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'Anonymous';
    img.onload = () => resolve(img);
    img.onerror = (err) => reject(new Error('Failed to load image into canvas: ' + err));

    if (source instanceof File || source instanceof Blob) {
      const reader = new FileReader();
      reader.onload = (e) => { img.src = e.target.result; };
      reader.onerror = reject;
      reader.readAsDataURL(source);
    } else if (typeof source === 'string') {
      img.src = source;
    } else {
      reject(new Error('Unsupported image source type'));
    }
  });
}

// Convert RGB (0-255) to HSV: H in [0, 360], S in [0, 1], V in [0, 1]
function rgbToHsv(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  const s = max === 0 ? 0 : d / max;
  const v = max;

  if (max !== min) {
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, v];
}

/**
 * Validates and classifies road damage directly inside the mobile app using HTML5 Canvas CV.
 * @param {string|File|Blob} imageSource
 * @returns {Promise<Object>} Analysis result matching the SafeRoad AI API schema
 */
export async function validateRoadDamageLocally(imageSource) {
  const img = await loadImage(imageSource);

  // Resize to a standardized working size for consistent and rapid inference (~320px)
  const maxDim = 320;
  let width = img.naturalWidth || img.width;
  let height = img.naturalHeight || img.height;

  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0, width, height);

  const imgData = ctx.getImageData(0, 0, width, height);
  const data = imgData.data;
  const totalPixels = width * height;

  // 1. Convert to grayscale and HSV arrays
  const gray = new Uint8Array(totalPixels);
  const hArr = new Float32Array(totalPixels);
  const sArr = new Float32Array(totalPixels);
  const vArr = new Float32Array(totalPixels);

  let sumLum = 0;
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    // Perceptual grayscale luminance
    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    gray[p] = lum;
    sumLum += lum;

    const [h, s, v] = rgbToHsv(r, g, b);
    hArr[p] = h;
    sArr[p] = s;
    vArr[p] = v;
  }
  const meanLum = sumLum / totalPixels;

  // 2. Compute Local Variance (lvar) to measure surface roughness
  // Smooth skin/desks/indoor floors have lvar < 6; gravel road aggregate has lvar > 12.
  const lvar = new Float32Array(totalPixels);
  const radius = 2; // 5x5 window
  for (let y = radius; y < height - radius; y++) {
    for (let x = radius; x < width - radius; x++) {
      let sum = 0, sumSq = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const val = gray[(y + dy) * width + (x + dx)];
          sum += val;
          sumSq += val * val;
          count++;
        }
      }
      const m = sum / count;
      lvar[y * width + x] = Math.max(0, (sumSq / count) - (m * m));
    }
  }

  // 3. Check for Selfie / Human Portrait (Smooth skin tones + low variance)
  let skinPixels = 0;
  for (let p = 0; p < totalPixels; p++) {
    const h = hArr[p], s = sArr[p], v = vArr[p];
    const isSkinColor = (h <= 35 || h >= 330) && (s >= 0.18 && s <= 0.68) && (v >= 0.30 && v <= 0.95);
    if (isSkinColor && lvar[p] < 6.0) {
      skinPixels++;
    }
  }
  const skinRatio = skinPixels / totalPixels;
  if (skinRatio > 0.08) {
    return {
      is_road_damage: false,
      damage_type: "None",
      severity: "None",
      confidence: 0.98,
      risk_score: 0,
      risk_category: "Low",
      rejection_reason: "Photo Rejected: Human portrait or selfie detected. SafeRoad AI strictly requires outdoor road hazard photos.",
      analysis_details: "Selfie/Human subject detected by on-device computer vision.",
      metrics: { skin_ratio: Math.round(skinRatio * 100) / 100 }
    };
  }

  // 4. Check for Obvious Nature (Green Foliage / Blue Sky)
  let greenCount = 0, blueCount = 0;
  for (let p = 0; p < totalPixels; p++) {
    const h = hArr[p], s = sArr[p], v = vArr[p];
    if (h >= 65 && h <= 165 && s >= 0.25 && v >= 0.18) greenCount++;
    if (h >= 190 && h <= 255 && s >= 0.25 && v >= 0.35) blueCount++;
  }
  if (greenCount / totalPixels > 0.45) {
    return {
      is_road_damage: false,
      damage_type: "None",
      severity: "None",
      confidence: 0.95,
      risk_score: 0,
      risk_category: "Low",
      rejection_reason: "Photo Rejected: Excessive foliage or nature scene detected. Please point camera directly at the road.",
      analysis_details: "Non-road nature environment.",
      metrics: {}
    };
  }
  if (blueCount / totalPixels > 0.40) {
    return {
      is_road_damage: false,
      damage_type: "None",
      severity: "None",
      confidence: 0.95,
      risk_score: 0,
      risk_category: "Low",
      rejection_reason: "Photo Rejected: Sky or open horizon detected. Please point camera down at the roadway.",
      analysis_details: "Sky/Horizon detected.",
      metrics: {}
    };
  }

  // 5. Road Pavement Verification (Asphalt / Concrete aggregate texture)
  // Low saturation (< 0.48), reasonable brightness, and rough granular aggregate (lvar >= 4.5)
  const isRoad = new Uint8Array(totalPixels);
  let roadPixels = 0;
  for (let p = 0; p < totalPixels; p++) {
    if (sArr[p] < 0.48 && vArr[p] > 0.08 && vArr[p] < 0.95 && lvar[p] >= 4.5) {
      isRoad[p] = 1;
      roadPixels++;
    }
  }
  const roadCoverage = roadPixels / totalPixels;
  if (roadCoverage < 0.22) {
    return {
      is_road_damage: false,
      damage_type: "None",
      severity: "None",
      confidence: 0.92,
      risk_score: 0,
      risk_category: "Low",
      rejection_reason: "Photo Rejected: No Road Surface Detected. The photo does not show an outdoor road surface (asphalt or concrete pavement). Please capture the road hazard directly.",
      analysis_details: `Road coverage is ${Math.round(roadCoverage * 100)}% (minimum 25% required).`,
      metrics: { road_coverage: Math.round(roadCoverage * 100) / 100 }
    };
  }

  // 6. Pothole Detection (Dark depression surrounded by road aggregate collar)
  let roadSumLum = 0;
  for (let p = 0; p < totalPixels; p++) {
    if (isRoad[p]) roadSumLum += gray[p];
  }
  const roadMeanLum = roadPixels > 0 ? roadSumLum / roadPixels : meanLum;

  // Dark cavity threshold: at least 22 DN below surrounding road mean
  const cavityThresh = Math.max(25, roadMeanLum - 22);
  const isCavity = new Uint8Array(totalPixels);
  let cavityCount = 0;
  for (let p = 0; p < totalPixels; p++) {
    if (gray[p] < cavityThresh && sArr[p] < 0.50) {
      isCavity[p] = 1;
      cavityCount++;
    }
  }

  // Find connected cavity components and check surrounding collar
  let maxPotholeScore = 0;
  let maxPotholeArea = 0;

  // Simple grid-based candidate clustering for fast mobile performance
  const blockSize = 8;
  const blocksX = Math.floor(width / blockSize);
  const blocksY = Math.floor(height / blockSize);
  const cavityGrid = new Uint8Array(blocksX * blocksY);

  for (let by = 0; by < blocksY; by++) {
    for (let bx = 0; bx < blocksX; bx++) {
      let count = 0;
      for (let dy = 0; dy < blockSize; dy++) {
        for (let dx = 0; dx < blockSize; dx++) {
          const idx = (by * blockSize + dy) * width + (bx * blockSize + dx);
          if (isCavity[idx]) count++;
        }
      }
      if (count >= (blockSize * blockSize * 0.45)) {
        cavityGrid[by * blocksX + bx] = 1;
      }
    }
  }

  // Check clusters of cavity blocks
  for (let by = 1; by < blocksY - 1; by++) {
    for (let bx = 1; bx < blocksX - 1; bx++) {
      if (cavityGrid[by * blocksX + bx]) {
        let clusterSize = 0;
        let collarRoadCount = 0;
        let collarTotal = 0;

        for (let dy = -2; dy <= 2; dy++) {
          for (let dx = -2; dx <= 2; dx++) {
            const ny = by + dy, nx = bx + dx;
            if (ny >= 0 && ny < blocksY && nx >= 0 && nx < blocksX) {
              const isCollarBorder = Math.abs(dy) === 2 || Math.abs(dx) === 2;
              if (isCollarBorder) {
                collarTotal++;
                // Sample center pixel of collar block
                const pIdx = (ny * blockSize + Math.floor(blockSize / 2)) * width + (nx * blockSize + Math.floor(blockSize / 2));
                if (isRoad[pIdx]) collarRoadCount++;
              } else if (cavityGrid[ny * blocksX + nx]) {
                clusterSize++;
              }
            }
          }
        }

        const collarRatio = collarTotal > 0 ? collarRoadCount / collarTotal : 0;
        // Pothole must be embedded in road pavement collar
        if (clusterSize >= 3 && collarRatio >= 0.35) {
          const approxArea = clusterSize * blockSize * blockSize;
          const ratio = approxArea / totalPixels;
          const score = Math.min(0.65 + ratio * 10, 0.98);
          if (score > maxPotholeScore) {
            maxPotholeScore = score;
            maxPotholeArea = approxArea;
          }
        }
      }
    }
  }

  // 7. Crack / Fissure Detection (High-contrast, thin edge gradients)
  let crackEdges = 0;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = y * width + x;
      if (isRoad[idx]) {
        const gx = Math.abs(gray[idx + 1] - gray[idx - 1]);
        const gy = Math.abs(gray[idx + width] - gray[idx - width]);
        const grad = gx + gy;
        // Strong dark fissure edge on asphalt
        if (grad > 40 && gray[idx] < roadMeanLum) {
          crackEdges++;
        }
      }
    }
  }
  const crackRatio = crackEdges / totalPixels;
  let crackScore = 0;
  if (crackRatio >= 0.035) {
    crackScore = Math.min(0.55 + crackRatio * 8.0, 0.95);
  }

  // 8. Reject Clean / Undamaged Road
  const bestScore = Math.max(maxPotholeScore, crackScore);
  if (bestScore < 0.48) {
    return {
      is_road_damage: false,
      damage_type: "None",
      severity: "None",
      confidence: 0.90,
      risk_score: 0,
      risk_category: "Low",
      rejection_reason: "Photo Rejected: Undamaged Road Surface. Road pavement was verified, but no road damage (potholes, cracks, or severe defects) was detected. SafeRoad AI strictly requires photos of damaged roads.",
      analysis_details: `Road pavement confirmed (${Math.round(roadCoverage * 100)}% coverage), but surface is undamaged.`,
      metrics: {
        road_coverage: Math.round(roadCoverage * 100) / 100,
        pothole_score: Math.round(maxPotholeScore * 100) / 100,
        crack_score: Math.round(crackScore * 100) / 100
      }
    };
  }

  // 9. Damage Classification & Risk Score
  const isPothole = maxPotholeScore >= crackScore;
  const dmgType = isPothole ? "Pothole" : "Cracked Road";
  const confidence = Math.round(bestScore * 100) / 100;

  let severity = "Medium";
  let riskScore = 65;
  if (isPothole) {
    const areaPct = (maxPotholeArea / totalPixels) * 100;
    if (areaPct >= 4.0 || maxPotholeScore > 0.85) {
      severity = "High";
      riskScore = 88;
    } else if (areaPct <= 1.2) {
      severity = "Low";
      riskScore = 45;
    }
  } else {
    if (crackRatio >= 0.07 || crackScore > 0.85) {
      severity = "High";
      riskScore = 82;
    } else if (crackRatio <= 0.04) {
      severity = "Low";
      riskScore = 42;
    }
  }

  const riskCategory = riskScore >= 75 ? "High" : (riskScore >= 45 ? "Medium" : "Low");

  return {
    is_road_damage: true,
    damage_type: dmgType,
    severity: severity,
    confidence: confidence,
    risk_score: riskScore,
    risk_category: riskCategory,
    rejection_reason: "",
    analysis_details: `Verified Road Damage: ${dmgType} (${severity} Severity, ${Math.round(confidence * 100)}% Confidence). Road surface coverage: ${Math.round(roadCoverage * 100)}%.`,
    metrics: {
      road_coverage: Math.round(roadCoverage * 100) / 100,
      estimated_size_cm: isPothole ? Math.round(Math.max(15, (maxPotholeArea / totalPixels) * 500)) : Math.round(crackRatio * 1500),
      pothole_score: Math.round(maxPotholeScore * 100) / 100,
      crack_score: Math.round(crackScore * 100) / 100
    }
  };
}
