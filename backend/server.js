const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));

const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/saferoad';
let useInMemory = false;
const inMemoryReports = [];

mongoose.connect(MONGO_URI).then(() => {
    console.log("Connected to MongoDB.");
}).catch(err => {
    console.warn("MongoDB connection failed, falling back to In-Memory storage. Error:", err.message);
    useInMemory = true;
});

const Report = require('./models/Report');

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

app.post('/api/reports', async (req, res) => {
    try {
        const { lat, lng, image_url, damage_type, severity } = req.body;
        
        if (!image_url) {
            return res.status(400).json({ 
                success: false, 
                error: "MISSING_IMAGE", 
                message: "A photo of the road hazard is required." 
            });
        }

        // --- STRICT AI ROAD DAMAGE VALIDATION ---
        let aiValData = null;
        let aiEngineReachable = false;
        try {
            const valResponse = await fetch('http://127.0.0.1:8000/validate-road-damage', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image: image_url }),
                signal: AbortSignal.timeout(30000) // 30s timeout
            });
            if (valResponse.ok) {
                aiValData = await valResponse.json();
                aiEngineReachable = true;
            }
        } catch (valErr) {
            console.warn("AI Engine validation endpoint unreachable:", valErr.message);
        }

        // If AI Engine is offline, block submission — cannot verify photo is road damage
        if (!aiEngineReachable) {
            return res.status(503).json({
                success: false,
                error: "AI_ENGINE_OFFLINE",
                message: "The AI verification engine is currently offline. Road damage photos cannot be validated. Please ensure the AI Engine is running and try again."
            });
        }

        // If AI Engine explicitly rejected the photo as non-road or undamaged, REJECT the report!
        if (aiValData && aiValData.is_road_damage === false) {
            return res.status(400).json({
                success: false,
                error: "REJECTED_NON_ROAD_IMAGE",
                message: aiValData.rejection_reason || "Uploaded photo does not show valid road damage. Please take a clear photo of road damage (pothole, cracks, or hazard)."
            });
        }

        // Citizen's Visual Severity determines the danger zone
        const userSeverity = severity || 'Medium';
        const resolvedDamageType = damage_type || (aiValData && aiValData.is_road_damage && aiValData.damage_type !== 'None' ? aiValData.damage_type : 'Pothole');

        const payload = {
            lat: lat || 0,
            lng: lng || 0,
            damage_type: resolvedDamageType,
            severity: userSeverity,
            image_metrics: aiValData ? aiValData.metrics : null
        };

        // Danger zone is strictly based on citizen's Visual Severity:
        // High -> Red (Danger Zone), Medium -> Yellow (Moderate Risk), Low -> Green (Low Risk)
        let risk_category = userSeverity === 'High' ? 'Red' : (userSeverity === 'Medium' ? 'Yellow' : 'Green');
        let risk_score = userSeverity === 'High' ? 80 : (userSeverity === 'Medium' ? 50 : 25);

        try {
            const aiResponse = await fetch('http://127.0.0.1:8000/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (aiResponse.ok) {
                const aiData = await aiResponse.json();
                risk_score = aiData.risk_score;
                // Danger zone category strictly determined by citizen's Visual Severity
                risk_category = userSeverity === 'High' ? 'Red' : (userSeverity === 'Medium' ? 'Yellow' : 'Green');
            }
        } catch (aiErr) {
            console.error("AI engine prediction unavailable, using fallback score:", aiErr.message);
        }

        const reportData = {
            location: {
                type: 'Point',
                coordinates: [lng, lat]
            },
            image_url: image_url || '',
            damage_type: resolvedDamageType,
            severity: userSeverity,
            risk_score,
            risk_category,
            ai_confidence: aiValData ? aiValData.confidence : 0.90,
            ai_metrics: aiValData ? aiValData.metrics : {},
            is_duplicate: false,
            status: 'Pending',
            createdAt: new Date(),
            _id: new mongoose.Types.ObjectId().toString()
        };

        const duplicateThreshold = 0.02; // 20m for duplicates

        if (useInMemory) {
            inMemoryReports.forEach(oldReport => {
                const [oldLng, oldLat] = oldReport.location.coordinates;
                const dist = getDistanceFromLatLonInKm(lat, lng, oldLat, oldLng);
                
                // Duplicate Check
                if (dist <= duplicateThreshold && oldReport.damage_type === resolvedDamageType && oldReport.status === 'Pending') {
                    reportData.is_duplicate = true;
                }
            });
            inMemoryReports.push(reportData);
            if (risk_category === 'Red') {
                console.log(`[ALERT] Mock SMS sent to nearby citizens: High hazard reported at ${lat}, ${lng} (${resolvedDamageType})`);
            }
            return res.status(201).json({ success: true, report: reportData });
        }

        const existingReports = await Report.find({ status: { $nin: ['Outdated', 'Repaired'] } });
        for (const oldReport of existingReports) {
            const [oldLng, oldLat] = oldReport.location.coordinates;
            const dist = getDistanceFromLatLonInKm(lat, lng, oldLat, oldLng);
            
            // Duplicate Check
            if (dist <= duplicateThreshold && oldReport.damage_type === resolvedDamageType && oldReport.status === 'Pending') {
                reportData.is_duplicate = true;
            }
        }

        const report = new Report(reportData);
        await report.save();
        
        if (risk_category === 'Red') {
            console.log(`[ALERT] Mock SMS sent to nearby citizens: High hazard reported at ${lat}, ${lng} (${resolvedDamageType})`);
        }

        res.status(201).json({ success: true, report });
    } catch (error) {
        console.error("Error in POST /api/reports:", error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/reports', async (req, res) => {
    try {
        if (useInMemory) {
            return res.status(200).json([...inMemoryReports].sort((a,b) => b.createdAt - a.createdAt));
        }
        const reports = await Report.find().sort({ createdAt: -1 });
        res.status(200).json(reports);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/reports/:id', async (req, res) => {
    try {
        const id = req.params.id;
        if (useInMemory) {
            const index = inMemoryReports.findIndex(r => r._id === id);
            if (index !== -1) {
                inMemoryReports.splice(index, 1);
                return res.status(200).json({ success: true, message: "Deleted from memory" });
            } else {
                return res.status(404).json({ error: "Not found" });
            }
        }

        const deleted = await Report.findByIdAndDelete(id);
        if (deleted) {
            res.status(200).json({ success: true, message: "Deleted" });
        } else {
            res.status(404).json({ error: "Not found" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/reports/:id/repair', async (req, res) => {
    try {
        const id = req.params.id;
        if (useInMemory) {
            const report = inMemoryReports.find(r => r._id === id);
            if (report) {
                report.status = 'Repaired';
                report.risk_category = 'Black';
                return res.status(200).json({ success: true, report });
            } else {
                return res.status(404).json({ error: "Not found" });
            }
        }

        const report = await Report.findByIdAndUpdate(
            id,
            { status: 'Repaired', risk_category: 'Black' },
            { new: true }
        );
        if (report) {
            res.status(200).json({ success: true, report });
        } else {
            res.status(404).json({ error: "Not found" });
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/analytics', async (req, res) => {
    try {
        if (useInMemory) {
            return res.status(200).json({
                total: inMemoryReports.length,
                red: inMemoryReports.filter(r => r.risk_category === 'Red').length,
                yellow: inMemoryReports.filter(r => r.risk_category === 'Yellow').length,
                green: inMemoryReports.filter(r => r.risk_category === 'Green').length,
            });
        }

        const total = await Report.countDocuments();
        const red = await Report.countDocuments({ risk_category: 'Red' });
        const yellow = await Report.countDocuments({ risk_category: 'Yellow' });
        const green = await Report.countDocuments({ risk_category: 'Green' });
        res.status(200).json({ total, red, yellow, green });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

let municipalPassword = process.env.MUNICIPAL_PASSWORD || 'admin123';

app.post('/api/auth/login', (req, res) => {
    const { password } = req.body;
    const input = (password || '').trim();
    if (input === municipalPassword.trim()) {
        return res.status(200).json({ success: true, message: "Authenticated" });
    }
    return res.status(401).json({ success: false, error: "Incorrect password. Please try again." });
});

app.post('/api/auth/change-password', (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if ((currentPassword || '').trim() !== municipalPassword.trim()) {
        return res.status(401).json({ success: false, error: "Incorrect current password." });
    }
    if (!(newPassword || '').trim()) {
        return res.status(400).json({ success: false, error: "New password cannot be empty." });
    }
    municipalPassword = newPassword.trim();
    return res.status(200).json({ success: true, message: "Password updated successfully across all devices." });
});

app.post('/api/ai/analyze', async (req, res) => {
    try {
        const aiResponse = await fetch('http://127.0.0.1:8000/analyze-image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(req.body)
        });
        const data = await aiResponse.json();
        res.status(200).json(data);
    } catch (error) {
        console.error("AI analysis failed:", error);
        res.status(500).json({ error: "AI Engine unavailable" });
    }
});

const PORT = process.env.PORT || 5000;
const server = app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
});

server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
        console.error(`Port ${PORT} is already in use. Please close the other process or change the PORT.`);
        process.exit(1);
    } else {
        console.error("Server error:", err);
    }
});

// Global Error Handlers for robust operation
process.on('uncaughtException', (err) => {
    console.error('CRITICAL: Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('CRITICAL: Unhandled Rejection at:', promise, 'reason:', reason);
});
