import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';

// Fix for default marker icons in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;

const customIcon = (color) => {
  return new L.Icon({
    iconUrl: `https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-${color}.png`,
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/0.7.7/images/marker-shadow.png',
    iconSize: [25, 41],
    iconAnchor: [12, 41],
    popupAnchor: [1, -34],
    shadowSize: [41, 41]
  });
};

// Haversine helper for distance check
function getDistKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * (Math.PI / 180);
  const dLon = (lon2 - lon1) * (Math.PI / 180);
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * (Math.PI / 180)) * Math.cos(lat2 * (Math.PI / 180)) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

const MapUpdater = ({ userLocation, hazardLocation }) => {
  const map = useMap();
  const [hasCentered, setHasCentered] = React.useState(false);

  // If a specific hazard was clicked to locate, smoothly fly to it
  useEffect(() => {
    if (hazardLocation && hazardLocation.lat && hazardLocation.lng) {
      map.flyTo([hazardLocation.lat, hazardLocation.lng], 16, { animate: true, duration: 1.2 });
    }
  }, [hazardLocation, map]);

  useEffect(() => {
    if (!userLocation) return;

    if (!hasCentered && (!hazardLocation || !hazardLocation.lat)) {
      // First location — center immediately
      map.flyTo([userLocation.lat, userLocation.lng], 15, { animate: true, duration: 1 });
      setHasCentered(true);
    } else if (hasCentered && (!hazardLocation || !hazardLocation.lat)) {
      // Only re-center if user moved >200m from current map center
      const center = map.getCenter();
      const dist = getDistKm(center.lat, center.lng, userLocation.lat, userLocation.lng);
      if (dist > 0.2) {
        map.flyTo([userLocation.lat, userLocation.lng], map.getZoom(), { animate: true, duration: 1.5 });
      }
    }
  }, [userLocation, map, hasCentered, hazardLocation]);
  return null;
};

const LiveRiskMap = ({ defaultCenter = [40.7128, -74.0060], userLocation = null, hazardLocation = null, reports = [] }) => {
  return (
    <div className="w-full h-[500px] rounded-xl overflow-hidden shadow-2xl border border-gray-200 mt-6 z-0 relative">
      <MapContainer center={userLocation ? [userLocation.lat, userLocation.lng] : defaultCenter} zoom={13} style={{ height: '100%', width: '100%' }}>
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          maxZoom={19}
        />
        <MapUpdater userLocation={userLocation} hazardLocation={hazardLocation} />
        
        {userLocation && (
          <Marker position={[userLocation.lat, userLocation.lng]} icon={customIcon('blue')} zIndexOffset={1000}>
            <Popup className="font-sans">
              <div className="text-sm p-1 text-center">
                <strong className="text-base text-blue-800">Your Live Location</strong>
              </div>
            </Popup>
          </Marker>
        )}

        {hazardLocation && (
          <Marker position={[hazardLocation.lat, hazardLocation.lng]} icon={customIcon('violet')} zIndexOffset={1100}>
            <Popup className="font-sans">
              <div className="text-sm p-1 text-center">
                <strong className="text-base text-purple-800">Pinned Hazard Spot</strong><br/>
                <span className="text-xs text-gray-500">This is where your report will be filed.</span>
              </div>
            </Popup>
          </Marker>
        )}

        {reports.filter(r => r.status !== 'Outdated' && r.status !== 'Repaired').map((report) => {
            if (!report.location || !report.location.coordinates) return null;
            const lLng = Number(report.location.coordinates[0]);
            const lLat = Number(report.location.coordinates[1]);
            
            let color = 'green';
            if (report.risk_category === 'Yellow') color = 'gold';
            if (report.risk_category === 'Red') color = 'red';
            if (report.risk_category === 'Black') color = 'black';

            return (
              <React.Fragment key={report._id}>
                <Circle 
                  center={[lLat, lLng]} 
                  radius={500} 
                  pathOptions={{ color: color, fillColor: color, fillOpacity: 0.4, weight: 2 }} 
                />
                <Marker position={[lLat, lLng]} icon={customIcon(color)}>
                  <Popup className="font-sans">
                    <div className="text-sm p-1">
                      <strong className="text-base text-gray-800">{report.damage_type}</strong><br/>
                      <span className="text-gray-600">Severity:</span> {report.severity}<br/>
                      <span className="text-gray-600">Risk Score:</span> <span className="font-bold">{report.risk_score}</span> <span className={`text-${color}-600`}>({report.risk_category})</span><br/>
                      <span className="text-gray-600">Status:</span> {report.status}
                    </div>
                  </Popup>
                </Marker>
              </React.Fragment>
            );
        })}
      </MapContainer>
    </div>
  );
};

export default LiveRiskMap;
