from fastapi import FastAPI
from pydantic import BaseModel
import random
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="SafeRoad AI Engine")

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

class RiskResponse(BaseModel):
    risk_score: int
    risk_category: str
    image_analysis: dict

@app.post("/predict", response_model=RiskResponse)
def predict_risk(request: RiskRequest):
    # Mocking ML inference logic based on severity and distance to known blackspots
    base_score = 0
    if request.severity == 'High':
        base_score = 80
    elif request.severity == 'Medium':
        base_score = 50
    else:
        base_score = 20
        
    # Simulate geographic historical risk factor
    geo_factor = random.randint(0, 20)
    
    total_score = min(base_score + geo_factor, 100)
    
    if total_score > 70:
        category = 'Red'
    elif total_score > 40:
        category = 'Yellow'
    else:
        category = 'Green'
        
    # Dummy image processing output
    size_estimate = 0
    if request.damage_type == 'Pothole':
        size_estimate = random.uniform(10.0, 50.0) # cm
    elif request.damage_type == 'Cracked Road':
        size_estimate = random.uniform(50.0, 200.0)
        
    return RiskResponse(
        risk_score=total_score,
        risk_category=category,
        image_analysis={"estimated_size_cm": round(size_estimate, 1)}
    )

class AnalysisResponse(BaseModel):
    damage_type: str
    severity: str
    confidence: float
    analysis_details: str

@app.post("/analyze-image", response_model=AnalysisResponse)
def analyze_image(request: dict):
    # Simulated Vision AI logic
    # In a real app, we would process the image bytes here
    damage_types = ["Pothole", "Cracked Road", "Faded Lane Markings", "Broken Sign"]
    severities = ["Low", "Medium", "High"]
    
    detected_type = random.choice(damage_types)
    detected_severity = random.choice(severities)
    confidence = round(random.uniform(0.85, 0.99), 2)
    
    return AnalysisResponse(
        damage_type=detected_type,
        severity=detected_severity,
        confidence=confidence,
        analysis_details=f"AI Vision detected {detected_type} with {confidence*100}% confidence. Visual indicators suggest {detected_severity} impact on traffic flow."
    )


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
