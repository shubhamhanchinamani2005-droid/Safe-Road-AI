import React, { useState, useEffect } from 'react';
import ReportHazard from './pages/ReportHazard';
import MunicipalDashboard from './pages/MunicipalDashboard';
import { getOfflineReports } from './services/offlineStorage';
import './index.css';

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

function App() {
  const [view, setView] = useState('citizen');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentSavedPassword, setCurrentSavedPassword] = useState(() => localStorage.getItem('municipal_password') || 'admin123');
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordInput, setPasswordInput] = useState('');
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [loginError, setLoginError] = useState('');
  const [backendOnline, setBackendOnline] = useState(false);
  const [reports, setReports] = useState([]);
  const [userLocation, setUserLocation] = useState(null);
  const [activeAlerts, setActiveAlerts] = useState([]);
  const [notifiedHazards, setNotifiedHazards] = useState(new Set());
  const [dismissedAlerts, setDismissedAlerts] = useState(new Set());

  // Request Notification Permissions on load
  useEffect(() => {
    if ('Notification' in window && Notification.permission !== 'granted') {
        Notification.requestPermission();
    }
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    const cleanInput = (passwordInput || '').trim();
    if (!cleanInput) {
        setLoginError('Please enter a password.');
        return;
    }

    try {
        const res = await fetch(`http://${window.location.hostname}:5000/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ password: cleanInput })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            setIsAuthenticated(true);
            setLoginError('');
            setPasswordInput('');
            return;
        }
    } catch (err) {
        console.warn("Backend auth unavailable, trying local fallback:", err);
    }

    // Local fallback check
    if (cleanInput === currentSavedPassword.trim() || cleanInput === 'admin123') {
        setIsAuthenticated(true);
        setLoginError('');
        setPasswordInput('');
    } else {
        setLoginError('Incorrect password. Default is admin123');
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    const cleanCurrent = (passwordInput || '').trim();
    const cleanNew = (newPasswordInput || '').trim();

    if (!cleanNew) {
        setLoginError('New password cannot be empty.');
        return;
    }

    try {
        const res = await fetch(`http://${window.location.hostname}:5000/api/auth/change-password`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentPassword: cleanCurrent, newPassword: cleanNew })
        });
        const data = await res.json();
        if (res.ok && data.success) {
            setCurrentSavedPassword(cleanNew);
            localStorage.setItem('municipal_password', cleanNew);
            setIsChangingPassword(false);
            setLoginError('');
            setPasswordInput('');
            setNewPasswordInput('');
            alert("Password changed successfully across all devices!");
            return;
        } else {
            setLoginError(data.error || 'Incorrect current password.');
            return;
        }
    } catch (err) {
        console.warn("Backend change-password unavailable, using local:", err);
    }

    if (cleanCurrent === currentSavedPassword.trim() || cleanCurrent === 'admin123') {
        setCurrentSavedPassword(cleanNew);
        localStorage.setItem('municipal_password', cleanNew);
        setIsChangingPassword(false);
        setLoginError('');
        setPasswordInput('');
        setNewPasswordInput('');
        alert("Password changed successfully! You can now login.");
    } else {
        setLoginError('Incorrect current password.');
    }
  };

  // Fetch all reports to monitor the geofence 
  useEffect(() => {
    const fetchReports = async () => {
        try {
            const res = await fetch(`http://${window.location.hostname}:5000/api/reports`);
            const data = await res.json();
            if (Array.isArray(data)) {
                setReports(data);
                setBackendOnline(true);
            }
        } catch (err) {
            setBackendOnline(false);
            // Fallback for Standalone Mobile Execution without backend
            const offlineData = getOfflineReports();
            setReports(offlineData);
        }
    };
    fetchReports();
    const interval = setInterval(fetchReports, 5000); // Polling (5s)
    return () => clearInterval(interval);
  }, []);

  // Monitor the user's live GPS location continuously across all views
  useEffect(() => {
    if (!navigator.geolocation) return;

    let primaryWatchId = null;
    let fallbackWatchId = null;

    const onSuccess = (position) => {
      setUserLocation({
        lat: Number(position.coords.latitude),
        lng: Number(position.coords.longitude)
      });
    };

    // Try high accuracy first
    primaryWatchId = navigator.geolocation.watchPosition(
      onSuccess,
      (err) => {
        console.warn("High accuracy geolocation failed, trying low accuracy:", err.message);
        if (!fallbackWatchId) {
          fallbackWatchId = navigator.geolocation.watchPosition(
            onSuccess,
            (e) => console.error("Geolocation completely unavailable:", e.message),
            { enableHighAccuracy: false, timeout: 30000, maximumAge: 5000 }
          );
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    return () => {
      if (primaryWatchId !== null) navigator.geolocation.clearWatch(primaryWatchId);
      if (fallbackWatchId !== null) navigator.geolocation.clearWatch(fallbackWatchId);
    };
  }, []);

  // Alert citizens if they are within 0.5km of any active hazard
  useEffect(() => {
    if (userLocation) {
        const nearby = reports.filter(r => {
            if (!r.location || !r.location.coordinates) return false;
            const [lng, lat] = [Number(r.location.coordinates[0]), Number(r.location.coordinates[1])];
            const dist = getDistanceFromLatLonInKm(userLocation.lat, userLocation.lng, lat, lng);
            return dist <= 0.5; // Distance condition (500m radius)
        });
        setActiveAlerts(nearby);

        // Push Notifications for newly detected nearby hazards
        const newAlerts = nearby.filter(alert => !notifiedHazards.has(alert._id));
        if (newAlerts.length > 0 && 'Notification' in window && Notification.permission === 'granted') {
            new Notification('⚠️ PROXIMITY ALERT', {
                body: `You are within 500m of ${newAlerts.length} new hazard zone(s). Stay safe!`,
                icon: '/icon-192x192.png'
            });
            
            setNotifiedHazards(prev => {
                const updated = new Set(prev);
                newAlerts.forEach(a => updated.add(a._id));
                return updated;
            });
        }
    }
  }, [userLocation, reports]);

  return (
    <div className="min-h-screen bg-gray-50 font-sans text-gray-900 selection:bg-red-200 selection:text-red-900 relative">
      
      {/* Geofencing In-App Alerts Display */}
      {view === 'citizen' && activeAlerts.filter(a => !dismissedAlerts.has(a._id)).length > 0 && (
        <div className="fixed top-20 right-4 z-[9999] max-w-sm w-full space-y-3">
            {activeAlerts.filter(a => !dismissedAlerts.has(a._id)).map(alert => {
                const isBlack = alert.risk_category === 'Black';
                const isRed = alert.risk_category === 'Red';
                const isYellow = alert.risk_category === 'Yellow';
                
                return (
                <div key={alert._id} className={`p-4 rounded-xl shadow-2xl border-l-[6px] transition-all transform hover:scale-105 duration-200 relative
                    ${isBlack ? 'bg-black border-black text-white' : 
                      isRed ? 'bg-red-50 border-red-600 shadow-red-500/20' : 
                      isYellow ? 'bg-yellow-50 border-yellow-500 shadow-yellow-500/20' : 
                      'bg-green-50 border-green-500 shadow-green-500/20'}`}>
                    
                    {/* Close Button */}
                    <button 
                        onClick={() => setDismissedAlerts(prev => new Set(prev).add(alert._id))}
                        className={`absolute top-2 right-2 cursor-pointer p-1 ${isBlack ? 'text-gray-400 hover:text-white' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                    </button>

                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-2">
                            <span className="text-lg">⚠️</span>
                            <span className={`text-sm font-black uppercase tracking-tighter ${isBlack ? 'text-white' : 'text-gray-800'}`}>Proximity Alert</span>
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-widest ${
                            alert.risk_category === 'Black' ? 'bg-gray-700 text-white' :
                            alert.risk_category === 'Red' ? 'bg-red-100 text-red-700' :
                            alert.risk_category === 'Yellow' ? 'bg-yellow-100 text-yellow-700' :
                            'bg-green-100 text-green-700'
                        }`}>
                            {alert.risk_category} Risk
                        </span>
                    </div>
                    <p className={`text-sm font-medium leading-snug ${isBlack ? 'text-gray-300' : 'text-gray-800'}`}>
                        You have entered a <strong>500m radius</strong> of a reported hazard zone.
                    </p>
                    <p className={`text-base font-semibold mt-2 ${isBlack ? 'text-white' : 'text-gray-900'}`}>
                        Hazard: {alert.damage_type}
                    </p>
                    <p className="text-xs mt-1 font-semibold text-gray-600">
                        Visual Severity: {alert.severity} • Risk Score: {alert.risk_score}
                    </p>
                </div>
                )
            })}
        </div>
      )}

      <nav className="bg-white shadow-sm border-b border-gray-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center space-x-4">
              <div className="flex items-center space-x-2 mr-4">
                <div className={`w-3 h-3 rounded-full ${backendOnline ? 'bg-green-500' : 'bg-amber-500 animate-pulse'}`}></div>
                <span className="text-xs font-bold text-gray-500 uppercase tracking-tighter">
                  {backendOnline ? 'Systems Active' : 'Connecting to Backend...'}
                </span>
              </div>
              <span className="text-2xl font-black text-red-600 sm:text-transparent bg-clip-text bg-gradient-to-r from-red-600 to-yellow-500 cursor-pointer">
                SafeRoad AI
              </span>
            </div>
            <div className="flex items-center space-x-2 md:space-x-4">
              <button 
                onClick={() => setView('citizen')}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition-all duration-200 shadow-sm cursor-pointer ${
                  view === 'citizen' ? 'bg-red-50 text-red-700 ring-1 ring-red-200' : 'text-gray-600 hover:bg-gray-100 border border-transparent hover:border-gray-200'
                }`}
              >
                Citizen Hub
              </button>
              <button 
                onClick={() => setView('municipal')}
                className={`px-4 py-2 rounded-md text-sm font-semibold transition-all duration-200 shadow-sm cursor-pointer ${
                  view === 'municipal' ? 'bg-blue-50 text-blue-700 ring-1 ring-blue-200' : 'text-gray-600 hover:bg-gray-100 border border-transparent hover:border-gray-200'
                }`}
              >
                Municipal Dash
              </button>
            </div>
          </div>
        </div>
      </nav>

      <main className="pb-16 pt-24 px-2 md:px-0 relative">
        {view === 'citizen' ? <ReportHazard userLocation={userLocation} reports={reports} /> : (
            isAuthenticated ? <MunicipalDashboard userLocation={userLocation} reports={reports} setReports={setReports} /> : (
                <div className="max-w-md mx-auto mt-12 p-8 bg-white rounded-xl shadow border border-gray-200">
                    <h2 className="text-2xl font-black text-black mb-2 text-center">
                        {isChangingPassword ? "Change Password" : "Municipal Login"}
                    </h2>
                    <p className="text-sm text-gray-500 mb-6 text-center">Authorized personnel only.</p>
                    
                    {loginError && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm font-medium">{loginError}</div>}
                    
                    {!isChangingPassword ? (
                        <form onSubmit={handleLogin} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Password</label>
                                <input 
                                    type="password" 
                                    value={passwordInput}
                                    onChange={(e) => setPasswordInput(e.target.value)}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    autoComplete="current-password"
                                    className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Enter password (default: admin123)"
                                />
                            </div>
                            <button 
                                type="submit" 
                                className="w-full bg-blue-600 cursor-pointer text-white rounded-lg p-3 font-bold hover:bg-blue-700 transition-colors shadow-sm"
                            >
                                Access Command Center
                            </button>
                            <div className="text-center pt-2">
                                <button 
                                    type="button" 
                                    onClick={() => { setIsChangingPassword(true); setLoginError(''); setPasswordInput(''); }}
                                    className="text-sm text-blue-600 hover:text-blue-800 font-medium tracking-wide cursor-pointer"
                                >
                                    Change Password
                                </button>
                            </div>
                        </form>
                    ) : (
                        <form onSubmit={handleChangePassword} className="space-y-4">
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">Current Password</label>
                                <input 
                                    type="password" 
                                    value={passwordInput}
                                    onChange={(e) => setPasswordInput(e.target.value)}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    autoComplete="current-password"
                                    className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Enter current password (default: admin123)"
                                />
                            </div>
                            <div>
                                <label className="block text-sm font-bold text-gray-700 mb-1">New Password</label>
                                <input 
                                    type="password" 
                                    value={newPasswordInput}
                                    onChange={(e) => setNewPasswordInput(e.target.value)}
                                    autoCapitalize="none"
                                    autoCorrect="off"
                                    spellCheck="false"
                                    autoComplete="new-password"
                                    className="w-full border border-gray-300 rounded-lg p-3 text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    placeholder="Enter new password"
                                />
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button 
                                    type="button" 
                                    onClick={() => { setIsChangingPassword(false); setLoginError(''); setPasswordInput(''); setNewPasswordInput(''); }}
                                    className="w-1/3 bg-gray-100 cursor-pointer text-gray-700 rounded-lg p-3 font-bold hover:bg-gray-200 transition-colors shadow-sm"
                                >
                                    Cancel
                                </button>
                                <button 
                                    type="submit" 
                                    className="w-2/3 bg-green-600 cursor-pointer text-white rounded-lg p-3 font-bold hover:bg-green-700 transition-colors shadow-sm"
                                >
                                    Save Password
                                </button>
                            </div>
                        </form>
                    )}
                </div>
            )
        )}
      </main>
    </div>
  );
}

export default App;
