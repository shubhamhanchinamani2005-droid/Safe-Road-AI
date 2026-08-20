import React, { useState } from 'react';
import LiveRiskMap from '../components/LiveRiskMap';
import exifr from 'exifr';

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
    const [damageType, setDamageType] = useState('Pothole');
    const [severity, setSeverity] = useState('Medium');
    const [loading, setLoading] = useState(false);
    const [isLocating, setIsLocating] = useState(false);
    const [message, setMessage] = useState('');
    const [locationMode, setLocationMode] = useState('Live Tracking');



    const getLocation = () => {
        // Capture the current live coordinates or fetch new ones
        if (userLocation && userLocation.lat && userLocation.lng) {
            setLat(Number(userLocation.lat));
            setLng(Number(userLocation.lng));
            setIsLocating(false);
            setLocationMode('Manual (Pinned)');
            return;
        }

        if (navigator.geolocation) {
            setIsLocating(true);
            const options = { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 };
            
            const success = (position) => {
                setLat(Number(position.coords.latitude));
                setLng(Number(position.coords.longitude));
                setIsLocating(false);
                setLocationMode('Manual (Pinned)');
            };

            const error = (err) => {
                console.warn("High accuracy failed, trying low accuracy...", err);
                navigator.geolocation.getCurrentPosition(
                    (pos) => {
                        setLat(Number(pos.coords.latitude));
                        setLng(Number(pos.coords.longitude));
                        setIsLocating(false);
                        setLocationMode('Manual (Pinned)');
                    },
                    (e) => {
                        console.error("Geolocation error:", e);
                        alert(`Could not get location: ${e.message}.`);
                        setIsLocating(false);
                    },
                    { enableHighAccuracy: false, timeout: 20000 }
                );
            };

            navigator.geolocation.getCurrentPosition(success, error, options);
        } else {
            alert("Geolocation is not supported by this browser.");
        }
    };

    const [imageExifLoc, setImageExifLoc] = useState(null);

    const handleImageChange = async (e) => {
        if (e.target.files && e.target.files[0]) {
            const file = e.target.files[0];
            setImage(file);
            
            // Extract GPS coordinates from image EXIF metadata using exifr
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
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!lat || !lng) {
            alert("Please capture your GPS location first.");
            return;
        }
        if (!image) {
            alert("Please take a photo of the hazard.");
            return;
        }

        // --- STRICT MODE VALIDATION ---
        
        // 1. Metadata Requirement
        if (imageExifLoc?.status !== 'Verified') {
            alert("❌ STRICT MODE REJECTION: The uploaded photo does not contain valid GPS Metadata. For security, only original photos taken on-site are accepted.");
            setLoading(false);
            return;
        }

        // 2. Proximity Requirement
        if (userLocation && userLocation.lat && userLocation.lng) {
            const dist = getDistanceFromLatLonInKm(userLocation.lat, userLocation.lng, lat, lng);
            if (dist > 0.5) { // Strict 500m threshold
                alert(`❌ STRICT MODE REJECTION: You are ${dist.toFixed(2)}km away from the hazard. Reports must be filed within 500m of the actual location.`);
                setLoading(false);
                return;
            }
        } else {
            alert("❌ STRICT MODE REJECTION: Live GPS location is required for verification.");
            setLoading(false);
            return;
        }

        setLoading(true);
        try {
            // Optimize image: Resize and Compress before Base64 encoding for speed
            const imgElement = document.createElement("img");
            imgElement.src = URL.createObjectURL(image);
            
            imgElement.onload = async () => {
                const canvas = document.createElement("canvas");
                const MAX_WIDTH = 800;
                const scaleSize = MAX_WIDTH / imgElement.width;
                canvas.width = MAX_WIDTH;
                canvas.height = imgElement.height * scaleSize;

                const ctx = canvas.getContext("2d");
                ctx.drawImage(imgElement, 0, 0, canvas.width, canvas.height);

                // Convert to compressed JPEG (quality 0.7)
                const compressedBase64 = canvas.toDataURL("image/jpeg", 0.7);

                const payload = {
                    lat,
                    lng,
                    image_url: compressedBase64,
                    damage_type: damageType,
                    severity
                };

                const response = await fetch(`http://${window.location.hostname}:5000/api/reports`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();
                if (response.ok) {
                    setMessage(`Report submitted! Risk Category: ${data.report.risk_category}`);
                    setImage(null);
                    setLat(null);
                    setLng(null);
                } else {
                    setMessage(`REJECTED: ${data.message || 'Submission failed'}`);
                }
                setLoading(false);
                URL.revokeObjectURL(imgElement.src);
            };
        } catch (error) {
            console.error(error);
            setMessage("Error connecting to server.");
            setLoading(false);
        }
    };

    return (
        <div className="max-w-6xl mx-auto mt-10 p-4 md:p-6">
            <h2 className="text-3xl md:text-4xl font-black mb-8 text-black text-center tracking-tight">Citizen Reporting Hub</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Left: Form */}
                <div className="bg-white rounded-xl shadow-lg border border-gray-100 p-6 h-fit">
                    <h3 className="text-xl font-bold mb-4 text-gray-800 border-b pb-2">Submit Hazard</h3>
                    {message && <div className="mb-4 p-3 bg-blue-100 text-blue-700 rounded text-sm">{message}</div>}

                    <form onSubmit={handleSubmit} className="space-y-4 text-left">
                        
                        {/* GPS Capture */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">
                                {locationMode === 'Live Tracking' ? '📍 Live Tracking Active' : 
                                 locationMode === 'Photo Metadata' ? '📷 Extracted from Photo' : 
                                 '📌 Location Pinned'}
                            </label>
                            <div className="flex items-center gap-2">
                                <button 
                                    type="button" 
                                    onClick={getLocation}
                                    disabled={isLocating}
                                    className={`px-4 py-2 text-white rounded cursor-pointer text-sm font-medium transition-all w-full sm:w-auto ${
                                        locationMode === 'Live Tracking' ? 'bg-blue-600 hover:bg-blue-700' : 'bg-green-600 hover:bg-green-700'
                                    } ${isLocating ? 'opacity-70 cursor-wait' : ''}`}
                                >
                                    {isLocating ? 'Capturing...' : (locationMode === 'Live Tracking' ? 'Capture Location' : '✓ Location Locked')}
                                </button>
                                {locationMode !== 'Live Tracking' && (
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            setLocationMode('Live Tracking');
                                            setLat(null);
                                            setLng(null);
                                        }}
                                        className="text-xs text-blue-600 hover:text-blue-800 font-bold underline"
                                    >
                                        Reset to Live
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* Camera Upload */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Take Photo (Live Only)</label>
                            <input 
                                type="file" 
                                accept="image/*" 
                                capture="environment"
                                onChange={handleImageChange}
                                className="w-full text-sm text-gray-500 file:mr-4 file:cursor-pointer file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                            />
                            {imageExifLoc && (
                                <div className={`mt-2 text-[10px] font-bold uppercase tracking-widest px-2 py-1 rounded w-fit inline-block ${
                                    imageExifLoc.status === 'Verified' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                                }`}>
                                    {imageExifLoc.status === 'Verified' 
                                        ? `✓ Authenticity Verified (GPS: ${imageExifLoc.lat}, ${imageExifLoc.lng})` 
                                        : '⚠ No GPS Metadata Found'}
                                </div>
                            )}
                        </div>

                        {/* Damage Type */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Damage Type</label>
                            <select 
                                value={damageType}
                                onChange={(e) => setDamageType(e.target.value)}
                                className="w-full border border-gray-300 rounded p-2 text-sm text-black"
                            >
                                <option value="Pothole">Pothole</option>
                                <option value="Cracked Road">Cracked Road</option>
                                <option value="Faded Lane Markings">Faded Lane Markings</option>
                                <option value="Broken Sign">Broken Sign</option>
                            </select>
                        </div>

                        {/* Severity */}
                        <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Visual Severity</label>
                            <select 
                                value={severity}
                                onChange={(e) => setSeverity(e.target.value)}
                                className="w-full border border-gray-300 rounded p-2 text-sm text-black"
                            >
                                <option value="Low">Low</option>
                                <option value="Medium">Medium</option>
                                <option value="High">High</option>
                            </select>
                        </div>

                        <button 
                            type="submit" 
                            disabled={loading}
                            className="w-full mt-4 bg-red-600 cursor-pointer text-white py-2 rounded font-semibold hover:bg-red-700 transition-colors disabled:opacity-50"
                        >
                            {loading ? 'Submitting...' : 'Submit Hazard Report'}
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
