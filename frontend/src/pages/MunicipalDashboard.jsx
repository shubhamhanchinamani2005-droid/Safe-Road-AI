import React, { useEffect, useState } from 'react';
import LiveRiskMap from '../components/LiveRiskMap';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { updateOfflineReportStatus, deleteOfflineReport } from '../services/offlineStorage';

const MunicipalDashboard = ({ userLocation = null, reports = [], setReports }) => {
    const [selectedImage, setSelectedImage] = useState(null);
    const [focusedHazardLocation, setFocusedHazardLocation] = useState(null);
    const [activeProximityAlerts, setActiveProximityAlerts] = useState([]);

    // Calculate proximity to danger zones for municipal workers
    useEffect(() => {
        if (userLocation && userLocation.lat && userLocation.lng) {
            const nearby = reports.filter(r => {
                if (!r.location || !r.location.coordinates) return false;
                if (r.status === 'Repaired' || r.status === 'Outdated') return false;
                const [lng, lat] = [Number(r.location.coordinates[0]), Number(r.location.coordinates[1])];
                const dist = getDistKm(userLocation.lat, userLocation.lng, lat, lng);
                return dist <= 0.5; // Within 500m danger zone
            });
            setActiveProximityAlerts(nearby);
        }
    }, [userLocation, reports]);

    function getDistKm(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * (Math.PI / 180);
        const dLon = (lon2 - lon1) * (Math.PI / 180);
        const a = Math.sin(dLat / 2) ** 2 +
            Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
            Math.sin(dLon / 2) ** 2;
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    // Internal fetch removed; reports are passed as props from App.jsx

    const handleDelete = async (id) => {
        if (!window.confirm("Are you sure you want to delete this reported hazard?")) return;
        try {
            const res = await fetch(`http://${window.location.hostname}:5000/api/reports/${id}`, { 
                method: 'DELETE',
                signal: AbortSignal.timeout(3000)
            });
            if (res.ok) {
                setReports(prev => prev.filter(r => r._id !== id));
                deleteOfflineReport(id);
                return;
            }
        } catch (err) {
            console.warn("Backend unavailable, deleting from local device storage:", err);
        }
        deleteOfflineReport(id);
        setReports(prev => prev.filter(r => r._id !== id));
    };

    const handleRepair = async (id) => {
        if (!window.confirm("Are you sure you want to mark this hazard as repaired?")) return;
        try {
            const res = await fetch(`http://${window.location.hostname}:5000/api/reports/${id}/repair`, {
                method: 'PATCH',
                signal: AbortSignal.timeout(3000)
            });
            if (res.ok) {
                const data = await res.json();
                if (data.success && data.report) {
                    setReports(prev => prev.map(r => r._id === id ? data.report : r));
                    updateOfflineReportStatus(id, 'Repaired');
                    return;
                }
            }
        } catch (err) {
            console.warn("Backend unavailable, marking repaired in local device storage:", err);
        }
        updateOfflineReportStatus(id, 'Repaired');
        setReports(prev => prev.map(r => r._id === id ? { ...r, status: 'Repaired' } : r));
    };

    // Dynamically calculate trend data from real reports
    const getTrendData = () => {
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const now = new Date();
        const data = [];

        // Last 6 months
        for (let i = 5; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const m = d.getMonth();
            const y = d.getFullYear();
            
            const count = reports.filter(r => {
                const dateValue = r.createdAt || r.timestamp;
                if (!dateValue) return false;
                const rDate = new Date(dateValue);
                return rDate.getMonth() === m && rDate.getFullYear() === y;
            }).length;

            data.push({ name: `${months[m]} '${y.toString().slice(-2)}`, reports: count });
        }
        return data;
    };

    const trendData = getTrendData();

    const redHazards = reports.filter(r => r.risk_category === 'Red');
    const yellowHazards = reports.filter(r => r.risk_category === 'Yellow');

    return (
        <div className="max-w-6xl mx-auto p-4 md:p-8">
            <h1 className="text-3xl md:text-5xl font-black text-black mb-8 tracking-tight">Municipal Command Center</h1>
            
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8 mt-4">
                <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-red-500 hover:shadow-md transition-shadow">
                    <h3 className="text-gray-500 text-sm font-semibold uppercase tracking-wider">Critical Hazards</h3>
                    <p className="text-4xl font-black text-red-600 mt-2">{redHazards.length}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-yellow-400 hover:shadow-md transition-shadow">
                    <h3 className="text-gray-500 text-sm font-semibold uppercase tracking-wider">Medium Risk</h3>
                    <p className="text-4xl font-black text-yellow-500 mt-2">{yellowHazards.length}</p>
                </div>
                <div className="bg-white p-6 rounded-xl shadow-sm border-l-4 border-blue-500 hover:shadow-md transition-shadow">
                    <h3 className="text-gray-500 text-sm font-semibold uppercase tracking-wider">Total Reports Active</h3>
                    <p className="text-4xl font-black text-gray-800 mt-2">{reports.length}</p>
                </div>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100 mb-8 h-[350px]">
                <h2 className="text-xl font-bold text-slate-900 mb-4">Report Trends (Last 6 Months)</h2>
                <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={trendData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f0f0f0" />
                        <XAxis 
                            dataKey="name" 
                            stroke="#6b7280" 
                            fontSize={12} 
                            tickLine={false} 
                            axisLine={false}
                            dy={10}
                        />
                        <YAxis 
                            stroke="#6b7280" 
                            fontSize={12} 
                            tickLine={false} 
                            axisLine={false}
                            allowDecimals={false}
                        />
                        <Tooltip 
                            contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                            cursor={{ fill: '#f3f4f6', radius: 4 }}
                        />
                        <Bar dataKey="reports" radius={[6, 6, 0, 0]} barSize={40}>
                            {trendData.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.reports > 0 ? '#3b82f6' : '#e5e7eb'} />
                            ))}
                        </Bar>
                    </BarChart>
                </ResponsiveContainer>
            </div>

            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100 mb-8">
                {/* Proximity Alert Banner */}
                {activeProximityAlerts.length > 0 && (
                    <div className="mb-4 p-4 rounded-xl border border-red-300 bg-red-50 text-red-900 flex items-start gap-3 shadow-sm animate-pulse">
                        <span className="text-2xl">⚠️</span>
                        <div>
                            <p className="font-bold text-sm">PROXIMITY WARNING: Within Danger Zone</p>
                            <p className="text-xs mt-0.5 text-red-700">
                                Your device is currently within <strong>500m</strong> of {activeProximityAlerts.length} active hazard zone(s) ({activeProximityAlerts.map(a => a.damage_type).join(', ')}). Proceed with caution.
                            </p>
                        </div>
                    </div>
                )}

                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
                    <div>
                        <h2 className="text-2xl font-bold text-slate-900">Live Risk & Danger Zone Map</h2>
                        <p className="text-xs text-gray-500 mt-1">Real-time GPS tracking of municipal inspection device & active hazard perimeters.</p>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                        {userLocation ? (
                            <span className="inline-flex items-center gap-1.5 bg-emerald-50 border border-emerald-300 text-emerald-800 text-xs font-bold px-3 py-1.5 rounded-full shadow-sm">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping"></span>
                                📍 Live GPS: {userLocation.lat.toFixed(4)}, {userLocation.lng.toFixed(4)}
                            </span>
                        ) : (
                            <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-300 text-amber-800 text-xs font-semibold px-3 py-1.5 rounded-full shadow-sm">
                                <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                                Waiting for Device GPS...
                            </span>
                        )}
                        <span className="bg-blue-100 text-blue-800 text-xs font-bold px-3 py-1.5 rounded-full uppercase tracking-wide">Live Feed</span>
                    </div>
                </div>

                {/* Map Legend */}
                <div className="flex flex-wrap items-center gap-4 text-xs font-semibold text-gray-600 bg-gray-50 p-2.5 rounded-lg border border-gray-200 mb-2">
                    <span className="text-gray-400 font-bold uppercase text-[10px] tracking-wider">Perimeters:</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-blue-600"></span> Your Live Position</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-red-500"></span> Red Danger Zone (High Visual Severity)</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-yellow-400"></span> Yellow Zone (Medium Visual Severity)</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-green-500"></span> Green Zone (Low Visual Severity)</span>
                    <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-full bg-black"></span> Repaired (Resolved)</span>
                </div>

                <LiveRiskMap 
                    defaultCenter={[28.6139, 77.2090]} 
                    userLocation={userLocation} 
                    hazardLocation={focusedHazardLocation} 
                    reports={reports} 
                />
            </div>

            <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-100">
                <h2 className="text-2xl font-bold text-slate-900 mb-6">Priority Repair List (Top 10 High-Risk Zones)</h2>
                <div className="overflow-x-auto rounded-lg border border-gray-200">
                    <table className="min-w-full text-left text-sm whitespace-nowrap">
                        <thead className="uppercase tracking-wider border-b-2 border-gray-200 bg-gray-50">
                            <tr>
                                <th className="px-6 py-4 font-semibold text-gray-600">Damage Type</th>
                                <th className="px-6 py-4 font-semibold text-gray-600">Location (Lat, Lng)</th>
                                <th className="px-6 py-4 font-semibold text-gray-600">Visual Severity</th>
                                <th className="px-6 py-4 font-semibold text-gray-600">Status</th>
                                <th className="px-6 py-4 font-semibold text-gray-600">Risk Score</th>
                                <th className="px-6 py-4 font-semibold text-gray-600">Danger Zone</th>
                                <th className="px-6 py-4 font-semibold text-gray-600">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200 bg-white">
                            {reports.sort((a,b) => b.risk_score - a.risk_score).slice(0, 10).map((r, i) => (
                                <tr key={r._id || i} className="hover:bg-indigo-50 transition-colors">
                                    <td className="px-6 py-4 font-medium text-gray-900">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-gray-900">{r.damage_type}</span>
                                            {r.ai_confidence ? (
                                                <span className="text-[10px] text-emerald-700 font-semibold flex items-center gap-1">
                                                    ✓ AI Verified ({Math.round(r.ai_confidence * 100)}%)
                                                    {r.ai_metrics?.estimated_size_cm && ` • ~${r.ai_metrics.estimated_size_cm}cm`}
                                                </span>
                                            ) : (
                                                <span className="text-[10px] text-gray-500">Standard Report</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-gray-600">{r.location?.coordinates[1]?.toFixed(4)}, {r.location?.coordinates[0]?.toFixed(4)}</td>
                                    <td className="px-6 py-4 font-semibold text-gray-800">{r.severity}</td>
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col gap-1">
                                            <span className="font-bold text-gray-900">{r.status}</span>
                                            {r.is_duplicate && <span className="bg-orange-100 text-orange-700 text-[10px] px-1.5 py-0.5 rounded-full font-black uppercase w-fit">Duplicate Found</span>}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 font-extrabold text-gray-900">{r.risk_score}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-3 py-1 inline-flex text-xs leading-5 font-bold rounded-full shadow-sm
                                            ${r.risk_category === 'Black' ? 'bg-gray-800 text-white border border-gray-900' :
                                              r.risk_category === 'Red' ? 'bg-red-100 text-red-800 border border-red-200' : 
                                              r.risk_category === 'Yellow' ? 'bg-yellow-100 text-yellow-800 border border-yellow-200' : 
                                              'bg-green-100 text-green-800 border border-green-200'}`}>
                                            {r.risk_category === 'Red' ? '🔴 Red Zone' : (r.risk_category === 'Yellow' ? '🟡 Yellow Zone' : (r.risk_category === 'Black' ? '⚫ Repaired' : '🟢 Green Zone'))}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        <div className="flex gap-2">
                                            {r.location?.coordinates && (
                                                <button 
                                                    type="button"
                                                    onClick={() => {
                                                        const lat = Number(r.location.coordinates[1]);
                                                        const lng = Number(r.location.coordinates[0]);
                                                        setFocusedHazardLocation({ lat, lng });
                                                        window.scrollTo({ top: 400, behavior: 'smooth' });
                                                    }}
                                                    className="text-purple-700 hover:text-purple-900 font-semibold text-xs uppercase tracking-wide cursor-pointer bg-purple-50 hover:bg-purple-100 border border-purple-200 px-3 py-1.5 rounded-md transition-colors shadow-sm"
                                                >
                                                    Locate
                                                </button>
                                            )}
                                            <button 
                                                onClick={() => setSelectedImage(r.image_url)}
                                                className="text-blue-600 hover:text-blue-900 font-semibold text-xs uppercase tracking-wide cursor-pointer bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-md transition-colors shadow-sm"
                                            >
                                                View
                                            </button>
                                            {r.status !== 'Repaired' && (
                                                <button 
                                                    onClick={() => handleRepair(r._id)}
                                                    className="text-green-600 hover:text-green-900 font-semibold text-xs uppercase tracking-wide cursor-pointer bg-green-50 hover:bg-green-100 border border-green-200 px-3 py-1.5 rounded-md transition-colors shadow-sm"
                                                >
                                                    Mark Repaired
                                                </button>
                                            )}
                                            <button 
                                                onClick={() => handleDelete(r._id)}
                                                className="text-red-600 hover:text-red-900 font-semibold text-xs uppercase tracking-wide cursor-pointer bg-red-50 hover:bg-red-100 border border-red-200 px-3 py-1.5 rounded-md transition-colors shadow-sm"
                                            >
                                                Delete
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                            {reports.length === 0 && (
                                <tr>
                                    <td colSpan="7" className="px-6 py-12 text-center text-gray-500 font-medium">No hazard reports found in the system.</td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Image Viewer Modal */}
            {selectedImage && (
                <div className="fixed inset-0 bg-black/80 backdrop-blur-sm z-[9999] flex items-center justify-center p-4">
                    <div className="bg-white rounded-2xl overflow-hidden shadow-2xl max-w-2xl w-full relative animate-in fade-in zoom-in duration-200">
                        <button 
                            onClick={() => setSelectedImage(null)}
                            className="absolute top-4 right-4 bg-black/50 hover:bg-black/70 text-white p-2 rounded-full cursor-pointer z-10 transition-colors"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                        <div className="p-2">
                            <img 
                                src={selectedImage} 
                                alt="Hazard" 
                                className="w-full h-auto max-h-[70vh] object-contain rounded-xl"
                            />
                        </div>
                        <div className="p-6 bg-gray-50 flex justify-between items-center">
                            <span className="text-sm font-bold text-gray-500 uppercase tracking-widest">Evidence Photo</span>
                            <button 
                                onClick={() => setSelectedImage(null)}
                                className="px-6 py-2 bg-gray-900 text-white rounded-lg font-bold hover:bg-gray-800 transition-colors cursor-pointer"
                            >
                                Close Preview
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MunicipalDashboard;
