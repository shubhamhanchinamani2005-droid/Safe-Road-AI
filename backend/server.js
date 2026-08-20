const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const dotenv = require('dotenv');

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

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
        
        const payload = {
            lat: lat || 0,
            lng: lng || 0,
            damage_type: damage_type || 'Unknown',
            severity: severity || 'Low'
        };

        let risk_score = 0;
        let risk_category = 'Green';

        try {
            const aiResponse = await fetch('http://127.0.0.1:8000/predict', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            });
            if (!aiResponse.ok) throw new Error("AI Engine non-200 response");
            const aiData = await aiResponse.json();
            risk_score = aiData.risk_score;
            risk_category = aiData.risk_category;
        } catch (aiErr) {
            console.error("AI engine unavailable, using fallback mock score:", aiErr.message);
            risk_score = Math.floor(Math.random() * 100);
            risk_category = risk_score > 70 ? 'Red' : (risk_score > 40 ? 'Yellow' : 'Green');
        }

        const reportData = {
            location: {
                type: 'Point',
                coordinates: [lng, lat]
            },
            image_url: image_url || '',
            damage_type: damage_type || 'Unknown',
            severity: severity || 'Low',
            risk_score,
            risk_category,
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
                if (dist <= duplicateThreshold && oldReport.damage_type === damage_type && oldReport.status === 'Pending') {
                    reportData.is_duplicate = true;
                }
            });
            inMemoryReports.push(reportData);
            if (risk_category === 'Red') {
                console.log(`[ALERT] Mock SMS sent to nearby citizens: High hazard reported at ${lat}, ${lng} (${damage_type})`);
            }
            return res.status(201).json({ success: true, report: reportData });
        }

        const existingReports = await Report.find({ status: { $nin: ['Outdated', 'Repaired'] } });
        for (const oldReport of existingReports) {
            const [oldLng, oldLat] = oldReport.location.coordinates;
            const dist = getDistanceFromLatLonInKm(lat, lng, oldLat, oldLng);
            
            // Duplicate Check
            if (dist <= duplicateThreshold && oldReport.damage_type === damage_type && oldReport.status === 'Pending') {
                reportData.is_duplicate = true;
            }
        }

        const report = new Report(reportData);
        await report.save();
        
        if (risk_category === 'Red') {
            console.log(`[ALERT] Mock SMS sent to nearby citizens: High hazard reported at ${lat}, ${lng} (${damage_type})`);
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
