from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
from typing import Optional, Dict, Any
from contextlib import asynccontextmanager
import random
from fastapi.middleware.cors import CORSMiddleware
import road_detector

@asynccontextmanager
async def lifespan(app: FastAPI):
    session, _ = road_detector.get_onnx_session()
    if session:
        print("[SafeRoad AI] Deep Learning CV Engine & MobileNetV2 loaded successfully.")
    else:
        print("[SafeRoad AI] Standard CV Engine loaded.")
    yield

app = FastAPI(title="SafeRoad AI Engine", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

class RiskRequest(BaseModel):
    lat: float
    lng: float
    damage_type: str
    severity: str
    image_url: Optional[str] = None
    image_metrics: Optional[Dict[str, Any]] = None

class RiskResponse(BaseModel):
    risk_score: int
    risk_category: str
    image_analysis: dict

class ImageValidationRequest(BaseModel):
    image: Optional[str] = None
    image_url: Optional[str] = None

class ImageValidationResponse(BaseModel):
    is_road_damage: bool
    damage_type: str
    severity: str
    confidence: float
    rejection_reason: str
    analysis_details: str
    metrics: Dict[str, Any] = {}

@app.post("/validate-road-damage", response_model=ImageValidationResponse)
def validate_road_damage(request: ImageValidationRequest):
    """
    Strict validation endpoint: Checks if the uploaded photo is an authentic road damage photo.
    Rejects non-road photos (indoor scenes, objects, animals, people) and undamaged road surfaces.
    """
    img_data = request.image or request.image_url
    if not img_data:
        return ImageValidationResponse(
            is_road_damage=False,
            damage_type="None",
            severity="None",
            confidence=0.0,
            rejection_reason="No image data provided for validation.",
            analysis_details="Missing image payload.",
            metrics={}
        )

    result = road_detector.validate_and_classify_road_damage(img_data)
    return ImageValidationResponse(**result)

@app.post("/analyze-image", response_model=ImageValidationResponse)
def analyze_image(request: dict):
    """
    Analyzes an uploaded image and performs AI Vision classification on road hazards.
    """
    img_data = request.get("image") or request.get("image_url")
    if not img_data:
        return ImageValidationResponse(
            is_road_damage=False,
            damage_type="None",
            severity="None",
            confidence=0.0,
            rejection_reason="No image provided.",
            analysis_details="No image payload provided.",
            metrics={}
        )

    result = road_detector.validate_and_classify_road_damage(img_data)
    return ImageValidationResponse(**result)

@app.post("/predict", response_model=RiskResponse)
def predict_risk(request: RiskRequest):
    # Base score calibrated so different severities produce different zones
    base_score = 0
    if request.severity == 'High':
        base_score = 65
    elif request.severity == 'Medium':
        base_score = 40
    else:
        base_score = 18
        
    # Hazard type weighting
    type_weight = 0
    if request.damage_type == 'Pothole':
        type_weight = 8
    elif request.damage_type == 'Cracked Road':
        type_weight = 5
    elif request.damage_type == 'Broken Sign':
        type_weight = 6
    elif request.damage_type == 'Faded Lane Markings':
        type_weight = 3

    # Geo factor (proximity/historical simulation) — smaller range for less randomness
    geo_factor = random.randint(0, 10)
    
    total_score = min(base_score + type_weight + geo_factor, 100)
    
    if total_score > 70:
        category = 'Red'
    elif total_score > 40:
        category = 'Yellow'
    else:
        category = 'Green'
        
    # Estimate size from metrics if provided, or default
    size_estimate = 35.0
    if request.image_metrics and "estimated_size_cm" in request.image_metrics:
        size_estimate = float(request.image_metrics["estimated_size_cm"])
    elif request.damage_type == 'Pothole':
        size_estimate = 45.0 if request.severity == 'High' else (25.0 if request.severity == 'Medium' else 12.0)
    elif request.damage_type == 'Cracked Road':
        size_estimate = 120.0 if request.severity == 'High' else (60.0 if request.severity == 'Medium' else 25.0)
    elif request.damage_type == 'Faded Lane Markings':
        size_estimate = 150.0 if request.severity == 'High' else 80.0
        
    return RiskResponse(
        risk_score=total_score,
        risk_category=category,
        image_analysis={
            "estimated_size_cm": round(size_estimate, 1),
            "hazard_type": request.damage_type,
            "severity": request.severity
        }
    )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
