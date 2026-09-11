/**
 * offlineStorage.js — On-Device Persistent Storage for Standalone Mobile Execution
 * 
 * Stores road hazard reports, status changes, and municipal admin credentials
 * directly on the phone's internal storage (localStorage / IndexedDB), enabling
 * 100% standalone execution with zero external server dependencies.
 */

const STORAGE_KEY = 'saferoad_hazard_reports';
const AUTH_KEY = 'saferoad_admin_auth';

// Initial realistic seed reports so the mobile app has an active map & dashboard upon first launch
const INITIAL_SEED_REPORTS = [
  {
    _id: 'local-rep-001',
    damage_type: 'Pothole',
    severity: 'High',
    risk_score: 86,
    risk_category: 'High',
    status: 'Pending',
    road_type: 'Asphalt Arterial',
    description: 'Deep road cavity in right traffic lane causing vehicle swerving.',
    location: {
      type: 'Point',
      coordinates: [77.5946, 12.9716] // [lng, lat]
    },
    image_url: 'https://images.unsplash.com/photo-1515162816999-a0c47dc192f7?w=500&auto=format&fit=crop&q=60',
    createdAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 2).toISOString(),
    confidence: 0.94
  },
  {
    _id: 'local-rep-002',
    damage_type: 'Cracked Road',
    severity: 'Medium',
    risk_score: 62,
    risk_category: 'Medium',
    status: 'In Progress',
    road_type: 'Concrete Connector',
    description: 'Extensive alligator fissure network extending across 4 meters of roadway.',
    location: {
      type: 'Point',
      coordinates: [77.5988, 12.9754]
    },
    image_url: 'https://images.unsplash.com/photo-1578632767115-351597cf2477?w=500&auto=format&fit=crop&q=60',
    createdAt: new Date(Date.now() - 3600000 * 5).toISOString(),
    updatedAt: new Date(Date.now() - 3600000 * 1).toISOString(),
    confidence: 0.89
  },
  {
    _id: 'local-rep-003',
    damage_type: 'Pothole',
    severity: 'Medium',
    risk_score: 55,
    risk_category: 'Medium',
    status: 'Repaired',
    road_type: 'Urban Road',
    description: 'Mid-sized depression repaired with bituminous cold mix patch.',
    location: {
      type: 'Point',
      coordinates: [77.5890, 12.9680]
    },
    image_url: 'https://images.unsplash.com/photo-1541888946425-d0fbb18086f6?w=500&auto=format&fit=crop&q=60',
    createdAt: new Date(Date.now() - 3600000 * 24).toISOString(),
    updatedAt: new Date().toISOString(),
    confidence: 0.91
  }
];

export function getOfflineReports() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(INITIAL_SEED_REPORTS));
      return INITIAL_SEED_REPORTS;
    }
    return JSON.parse(raw);
  } catch (err) {
    console.warn('[OfflineStorage] Error reading reports from localStorage:', err);
    return INITIAL_SEED_REPORTS;
  }
}

export function saveOfflineReport(reportData) {
  try {
    const reports = getOfflineReports();
    const newReport = {
      _id: 'local-rep-' + Date.now().toString(36) + '-' + Math.random().toString(36).substring(2, 6),
      damage_type: reportData.damage_type || 'Pothole',
      severity: reportData.severity || 'Medium',
      risk_score: reportData.risk_score || 50,
      risk_category: reportData.risk_category || 'Medium',
      status: 'Pending',
      road_type: reportData.road_type || 'Asphalt Road',
      description: reportData.description || 'Reported via SafeRoad AI Mobile',
      location: reportData.location || {
        type: 'Point',
        coordinates: [reportData.lng || 77.5946, reportData.lat || 12.9716]
      },
      image_url: reportData.image_url || '',
      confidence: reportData.confidence || 0.95,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    reports.unshift(newReport);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(reports));
    return newReport;
  } catch (err) {
    console.error('[OfflineStorage] Error saving report:', err);
    throw err;
  }
}

export function updateOfflineReportStatus(id, newStatus) {
  try {
    const reports = getOfflineReports();
    const updated = reports.map(r => {
      if (r._id === id) {
        return {
          ...r,
          status: newStatus,
          updatedAt: new Date().toISOString()
        };
      }
      return r;
    });
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    return updated.find(r => r._id === id);
  } catch (err) {
    console.error('[OfflineStorage] Error updating report:', err);
    throw err;
  }
}

export function deleteOfflineReport(id) {
  try {
    const reports = getOfflineReports();
    const filtered = reports.filter(r => r._id !== id);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return { success: true };
  } catch (err) {
    console.error('[OfflineStorage] Error deleting report:', err);
    throw err;
  }
}

export function offlineAdminLogin(username, password) {
  // Accepts standard admin credentials or custom saved password
  const savedPassword = localStorage.getItem(AUTH_KEY) || 'admin123';
  if (username === 'admin' && password === savedPassword) {
    return {
      success: true,
      token: 'offline-admin-jwt-token-' + Date.now(),
      message: 'Standalone offline login successful'
    };
  }
  return {
    success: false,
    message: 'Invalid credentials. Default: admin / admin123'
  };
}

export function changeOfflinePassword(currentPassword, newPassword) {
  const savedPassword = localStorage.getItem(AUTH_KEY) || 'admin123';
  if (currentPassword !== savedPassword) {
    return { success: false, message: 'Incorrect current password' };
  }
  localStorage.setItem(AUTH_KEY, newPassword);
  return { success: true, message: 'Password updated successfully on device' };
}
