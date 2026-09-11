import React, { useState, useEffect } from 'react';
import LiveRiskMap from '../components/LiveRiskMap';
import exifr from 'exifr';
import { validateRoadDamageLocally } from '../services/clientAiEngine';
import { saveOfflineReport } from '../services/offlineStorage';

// Haversine formula to compute distance in km
function getDistanceFromLatLonInKm(lat1, lon1, lat2, lon2) {
  const R = 6371; 
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

const ReportHazard = ({ userLocation, reports }) => {
    const [lat, setLat] = useState(null);
    const [lng, setLng] = useState(null);
    const [image, setImage] = useState(null);
    const [imagePreview, setImagePreview] = useState(null);
    const [damageType, setDamageType] = useState('Pothole');
    const [severity, setSeverity] = useState('Medium');
    const [loading, setLoading] = useState(false);
    const [isLocating, setIsLocating] = useState(false);
    const [message, setMessage] = useState('');
    const [locationMode, setLocationMode] = useState('Live Tracking');
    const [imageExifLoc, setImageExifLoc] = useState(null);

    // AI Road Damage Inspection States
    const [isAiScanning, setIsAiScanning] = useState(false);
    const [aiVerification, setAiVerification] = useState(null);
    // null = not scanned, { is_road_damage: bool, ... } = scanned, 'error' = scan failed
    const [aiScanError, setAiScanError] = useState(false);

    // New state for danger‑zone alert
    const [inDangerZone, setInDangerZone] = useState(false);

  useEffect(() => {
  if (!navigator.geolocation) {
    alert("Geolocation is not supported by this browser.");
    return;
  }
  const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
  const watchId = navigator.geolocation.watchPosition(
    (position) => {
      setLat(Number(position.coords.latitude));
      setLng(Number(position.coords.longitude));
      setLocationMode('Live Tracking');
    },
    (err) => {
      console.warn('Geolocation watch error:', err);
    },
    options
  );
  return () => {
    navigator.geolocation.clearWatch(watchId);
  };
}, []);


  // ---------- Danger‑zone detection ----------
  // Runs whenever lat/lng updates or the list of reports changes
  useEffect(() => {
    if (!lat || !lng || !reports) {
      setInDangerZone(false);
      return;
    }
    const DANGER_RADIUS_KM = 0.05; // 50 m radius around a reported hazard
    const isInside = reports.some((rep) => {
      // Only consider active/high‑risk reports (Red or Yellow)
      if (!rep.risk_category) return false;
      if (!['Red', 'Yellow'].includes(rep.risk_category)) return false;
      const [repLng, repLat] = rep.location.coordinates;
      const dist = getDistanceFromLatLonInKm(lat, lng, repLat, repLng);
      return dist <= DANGER_RADIUS_KM;
    });
    setInDangerZone(isInside);
  }, [lat, lng, reports]);

  

    const handleImageChange = async (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImage(file);
            setImagePreview(URL.createObjectURL(file));
            setAiVerification(null);
            setAiScanError(false);
            setMessage('');
            
            // 1. Extract GPS coordinates from image EXIF metadata
            try {
                const gps = await exifr.gps(file);
                if (gps && typeof gps.latitude === 'number' && typeof gps.longitude === 'number') {
                    console.log("EXIF GPS Metadata extracted:", gps);
                    setLat(gps.latitude);
                    setLng(gps.longitude);
                    setImageExifLoc({ 
                        status: 'Verified', 
                        lat: gps.latitude.toFixed(6), 
                        lng: gps.longitude.toFixed(6) 
                    });
                    setLocationMode('Photo Metadata');
                } else {
                    console.log("No GPS coordinates found in image EXIF.");
                    setImageExifLoc({ status: 'None' });
                }
            } catch (err) {
                console.error("Error reading GPS from image EXIF:", err);
                setImageExifLoc({ status: 'None' });
            }

            // 2. Perform Instant AI Road Damage Verification
            setIsAiScanning(true);
            try {
                const imgElement = document.createElement("img");
                imgElement.src = URL.createObjectURL(file);
                
                imgElement.onload = async () => {
                    const canvas = document.createElement("canvas");
                    const MAX_WIDTH = 800;
                    const scaleSize = Math.min(1, MAX_WIDTH / imgElement.width);
                    canvas.width = imgElement.width * scaleSize;
                    canvas.height = imgElement.height * scaleSize;

                    const ctx = canvas.getContext("2d");
                    ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);
                    const base64Data = canvas.toDataURL("image/jpeg", 0.75);

                    try {
                        const aiRes = await fetch(`http://${window.location.hostname}:5000/api/ai/analyze`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ image: base64Data }),
                            signal: AbortSignal.timeout(4000) // Fast 4s timeout for server check
                        });

                        if (aiRes.ok) {
                            const valData = await aiRes.json();
                            setAiVerification(valData);
                            setAiScanError(false);

                            if (valData.is_road_damage) {
                                if (valData.damage_type && valData.damage_type !== 'None') {
                                    setDamageType(valData.damage_type);
                                }
                                if (valData.severity && valData.severity !== 'None') {
                                    setSeverity(valData.severity);
                                }
                            }
                        } else {
                            throw new Error("Server returned non-200");
                        }
                    } catch (netErr) {
                        console.warn("Backend server unreachable, running on-device AI validation:", netErr);
                        try {
                            const localVal = await validateRoadDamageLocally(base64Data);
                            setAiVerification(localVal);
                            setAiScanError(false);
                            if (localVal.is_road_damage) {
                                if (localVal.damage_type && localVal.damage_type !== 'None') {
                                    setDamageType(localVal.damage_type);
                                }
                                if (localVal.severity && localVal.severity !== 'None') {
                                    setSeverity(localVal.severity);
                                }
                            }
                        } catch (localErr) {
                            console.error("On-device AI analysis failed:", localErr);
                            setAiScanError(true);
                        }
                    } finally {
                        setIsAiScanning(false);
                        URL.revokeObjectURL(imgElement.src);
                    }
                };
            } catch (scanErr) {
                console.error("AI scanning error:", scanErr);
                setIsAiScanning(false);
            }
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!lat || !lng) {
            alert("Please capture or verify your GPS location first.");
            return;
        }
        if (!image) {
            alert("Please take or upload a photo of the road hazard.");
            return;
        }

        // --- STRICT MODE VALIDATIONS ---
        
        // 1. Metadata Requirement (GPS on photo)
        if (imageExifLoc?.status !== 'Verified') {
            alert("❌ STRICT MODE REJECTION: The uploaded photo does not contain valid GPS Metadata. For security, only original photos taken on-site with location turned on are accepted.");
            return;
        }

        // 2. Proximity Requirement (within 500m)
        if (userLocation && userLocation.lat && userLocation.lng) {
            const dist = getDistanceFromLatLonInKm(userLocation.lat, userLocation.lng, lat, lng);
            if (dist > 0.5) {
                alert(`❌ STRICT MODE REJECTION: You are ${dist.toFixed(2)}km away from the hazard. Reports must be filed within 500m of the actual location.`);
                return;
            }
        } else {
            alert("❌ STRICT MODE REJECTION: Live GPS location is required for verification.");
            return;
        }

        // 3. STRICT AI ROAD DAMAGE VERIFICATION
        if (!aiVerification && !aiScanError) {
            alert("⏳ Please wait — AI is still scanning your photo for road damage.");
            return;
        }
        if (aiScanError) {
            alert("❌ AI Scan Failed: Could not verify photo. Ensure the AI Engine is running, then re-upload your photo.");
            return;
        }
        if (aiVerification && aiVerification.is_road_damage === false) {
            alert(`❌ STRICT ROAD DAMAGE POLICY REJECTION:\n\n${aiVerification.rejection_reason || "This photo does not show valid road damage. SafeRoad AI strictly requires photos of actual road defects (potholes, cracks, markings, hazards)."}`);
            return;
        }

        setLoading(true);
        try {
            const imgElement = document.createElement("img");
            imgElement.src = URL.createObjectURL(image);
            
            imgElement.onload = async () => {
                const canvas = document.createElement("canvas");
                const MAX_WIDTH = 800;
                const scaleSize = Math.min(1, MAX_WIDTH / imgElement.width);
                canvas.width = imgElement.width * scaleSize;
                canvas.height = imgElement.height * scaleSize;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);

                const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);

                const payload = {
                    lat,
                    lng,
                    image_url: compressedBase64,
                    damage_type: damageType,
                    severity
                };

                try {
                    const response = await fetch(`http://${window.location.hostname}:5000/api/reports`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify(payload),
                        signal: AbortSignal.timeout(4000)
                    });

                    const data = await response.json();
                    if (response.ok && data.success) {
                        setMessage(`✅ Report submitted successfully! Risk Category: ${data.report.risk_category} (Score: ${data.report.risk_score})`);
                        setImage(null);
                        setImagePreview(null);
                        setAiVerification(null);
                        setImageExifLoc(null);
                        setLocationMode('Live Tracking');
                    } else {
                        setMessage(`❌ REJECTED: ${data.message || 'Submission failed validation'}`);
                    }
                } catch (submitErr) {
                    console.warn("Server unavailable, saving report locally on device:", submitErr);
                    // Standalone on-device offline save
                    const saved = saveOfflineReport({
                        ...payload,
                        risk_score: aiVerification?.risk_score || (severity === 'High' ? 85 : 55),
                        risk_category: aiVerification?.risk_category || severity,
                        confidence: aiVerification?.confidence || 0.95
                    });
                    setMessage(`✅ Report saved offline on device! Risk Category: ${saved.risk_category} (Score: ${saved.risk_score})`);
                    setImage(null);
                    setImagePreview(null);
                    setAiVerification(null);
                    setImageExifLoc(null);
                    setLocationMode('Live Tracking');
                }
                setLoading(false);
                URL.revokeObjectURL(imgElement.src);
            };
        } catch (error) {
            console.error(error);
            setMessage("Error processing report submission.");
            setLoading(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto mt-10 p-4 md:p-6">
            <h2 className="text-3xl md:text-4xl font-black mb-2 text-black text-center tracking-tight">Citizen Reporting Hub</h2>
            <p className="text-center text-sm text-gray-600 mb-8 max-w-xl mx-auto">
                Report road damage with live on-site camera capture. SafeRoad AI uses computer vision to verify authentic road defects.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left: Form */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 h-fit">
                    <h3 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">Submit Hazard</h3>
                    
                    {message && (
                        <div className={`mb-4 p-3 rounded text-sm font-semibold ${
                            message.includes('✅') ? 'bg-green-100 text-green-800 border border-green-200' : 'bg-red-100 text-red-800 border border-red-200'
                        }`}>
                            {message}
                        </div>
                    )}

                    <form onSubmit={handleSubmit} className="space-y-4 text-left">
                        
                        {/* GPS Capture */}
                        <div>
                            {inDangerZone && (
                              <div className="mb-4 p-3 rounded text-sm font-semibold bg-rose-100 text-rose-800 border border-rose-200">
                                ⚠️ You are within <strong>50 m</strong> of a reported high‑risk hazard! Stay cautious.
                              </div>
                            )}

                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {locationMode === 'Live Tracking' ? '📍 Live Tracking Active' : 
                                 locationMode === 'Photo Metadata' ? '📷 Extracted from Photo' : 
                                 '📌 Location Pinned'}
                            </label>
                    <div className="flex items-center gap-2">
  <p className="text-sm text-gray-700">
    Live location tracking enabled. Pointer follows your device.
  </p>
</div>
                                    
                                
                        </div>

                        {/* Camera / Photo Upload */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Road Damage Photo <span className="text-red-500 font-bold">*</span> (Location ON)
                            </label>
                            <input 
                                type="file" 
                                accept="image/*" 
                                capture="environment"
                                onChange={handleImageChange}
                                className="w-full text-sm text-gray-500 file:mr-4 file:cursor-pointer file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                            />
                            
                            {/* EXIF Metadata Badge */}
                            {imageExifLoc && (
                                <div className={`mt-2 mr-2 text-[11px] font-bold uppercase tracking-wider px-2.5 py-1 rounded inline-block ${
                                    imageExifLoc.status === 'Verified' ? 'bg-green-100 text-green-700 border border-green-200' : 'bg-amber-100 text-amber-700 border border-amber-200'
                                }`}>
                                    {imageExifLoc.status === 'Verified' 
                                        ? `✓ GPS Authenticated (${imageExifLoc.lat}, ${imageExifLoc.lng})` 
                                        : '⚠ No GPS Metadata Found'}
                                </div>
                            )}

                            {/* AI Vision Status Indicator */}
                            {isAiScanning && (
                                <div className="mt-2 text-xs font-semibold text-blue-600 flex items-center gap-1.5 animate-pulse">
                                    <div className="w-2.5 h-2.5 bg-blue-600 rounded-full animate-ping"></div>
                                    <span>🔍 AI Vision is inspecting photo for road damage...</span>
                                </div>
                            )}

                            {/* AI Scan Error */}
                            {aiScanError && !isAiScanning && (
                                <div className="mt-2 p-2.5 rounded-lg border border-orange-300 bg-orange-50 text-xs text-orange-800 font-semibold">
                                    ⚠️ AI Engine unreachable — cannot verify photo. Ensure the AI Engine (port 8000) is running and re-upload your photo.
                                </div>
                            )}

                            {/* AI Verification Result Card */}
                            {aiVerification && !isAiScanning && (
                                <div className={`mt-3 p-3.5 rounded-lg border text-sm transition-all ${
                                    aiVerification.is_road_damage 
                                        ? 'bg-emerald-50 border-emerald-300 text-emerald-900' 
                                        : 'bg-rose-50 border-rose-300 text-rose-900'
                                }`}>
                                    <div className="flex items-start gap-2">
                                        <span className="text-xl">
                                            {aiVerification.is_road_damage ? '✅' : '❌'}
                                        </span>
                                        <div className="flex-1">
                                            <p className="font-bold">
                                                {aiVerification.is_road_damage 
                                                    ? `Road Damage Verified (${Math.round(aiVerification.confidence * 100)}% confidence)`
                                                    : 'Photo Rejected by AI Engine'
                                                }
                                            </p>
                                            <p className="text-xs mt-1 text-gray-700">
                                                {aiVerification.is_road_damage 
                                                    ? aiVerification.analysis_details 
                                                    : aiVerification.rejection_reason
                                                }
                                            </p>

                                            {aiVerification.is_road_damage && aiVerification.metrics && (
                                                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-semibold text-emerald-800">
                                                    <span className="bg-emerald-100 px-2 py-0.5 rounded">
                                                        Asphalt: {Math.round((aiVerification.metrics.asphalt_ratio || 0) * 100)}%
                                                    </span>
                                                    {aiVerification.metrics.estimated_size_cm && (
                                                        <span className="bg-emerald-100 px-2 py-0.5 rounded">
                                                            Est. Size: ~{aiVerification.metrics.estimated_size_cm} cm
                                                        </span>
                                                    )}
                                                    <span className="bg-emerald-100 px-2 py-0.5 rounded uppercase">
                                                        Auto-Selected: {aiVerification.damage_type}
                                                    </span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Image Preview */}
                        {imagePreview && (
                            <div className="relative rounded-lg overflow-hidden border border-gray-200 max-h-48 bg-gray-100 flex items-center justify-center">
                                <img src={imagePreview} alt="Hazard Preview" className="h-44 object-contain" />
                            </div>
                        )}

                        {/* Damage Type */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Damage Type {aiVerification?.is_road_damage && <span className="text-xs text-green-600 font-bold">(AI Auto-detected)</span>}
                            </label>
                            <select 
                                value={damageType}
                                onChange={(e) => setDamageType(e.target.value)}
                                className="w-full border border-gray-300 rounded p-2 text-sm text-black focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                <option value="Pothole">Pothole</option>
                                <option value="Cracked Road">Cracked Road</option>
                                <option value="Faded Lane Markings">Faded Lane Markings</option>
                                <option value="Broken Sign">Broken Sign</option>
                            </select>
                        </div>

                        {/* Severity */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                Visual Severity <span className="text-xs text-blue-600 font-bold">(Sets Danger Zone: High=Red, Medium=Yellow, Low=Green)</span>
                            </label>
                            <select 
                                value={severity}
                                onChange={(e) => setSeverity(e.target.value)}
                                className="w-full border border-gray-300 rounded p-2 text-sm text-black focus:ring-2 focus:ring-blue-500 outline-none"
                            >
                                <option value="Low">Low — Green Zone (Minor Hazard)</option>
                                <option value="Medium">Medium — Yellow Zone (Caution Zone)</option>
                                <option value="High">High — Red Zone (Critical Danger Zone)</option>
                            </select>
                        </div>

                        <button 
                            type="submit" 
                            disabled={loading || isAiScanning || aiScanError || (aiVerification && !aiVerification.is_road_damage)}
                            className={`w-full mt-4 py-2.5 rounded-lg font-bold text-white transition-all shadow cursor-pointer ${
                                (aiVerification && !aiVerification.is_road_damage) || aiScanError
                                    ? 'bg-gray-400 cursor-not-allowed opacity-60' 
                                    : 'bg-red-600 hover:bg-red-700 disabled:opacity-50'
                            }`}
                        >
                            {loading ? 'Submitting Report...' : 
                             isAiScanning ? 'Scanning Photo...' : 
                             aiScanError ? 'AI Engine Offline — Cannot Submit' :
                             (aiVerification && !aiVerification.is_road_damage ? 'Upload Valid Road Damage Photo' : 'Submit Hazard Report')}
                        </button>
                    </form>
                </div>
                
                {/* Right: Map */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xl font-bold text-gray-800">Live Risk Map</h3>
                        <span className="bg-green-100 text-green-800 text-xs font-bold px-3 py-1 rounded-full uppercase tracking-wide">Live</span>
                    </div>
                    <p className="text-sm text-gray-500 mb-2">
                        View active hazard zones in real-time. Capture your location to see your proximity.
                    </p>
                    <div className="flex-1 mt-auto">
                        <LiveRiskMap 
                            userLocation={userLocation} 
                            hazardLocation={lat && lng ? { lat, lng } : null}
                            reports={reports}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ReportHazard;
