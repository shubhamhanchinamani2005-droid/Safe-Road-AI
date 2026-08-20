const mongoose = require('mongoose');

const ReportSchema = new mongoose.Schema({
    location: {
        type: {
            type: String,
            enum: ['Point'],
            required: true
        },
        coordinates: {
            type: [Number], // [longitude, latitude]
            required: true
        }
    },
    image_url: { type: String, required: false },
    damage_type: { type: String, required: true },
    severity: { type: String, enum: ['Low', 'Medium', 'High'], required: true },
    risk_score: { type: Number, required: true },
    risk_category: { type: String, enum: ['Green', 'Yellow', 'Red', 'Black'], required: true },
    status: { type: String, enum: ['Pending', 'Reviewed', 'Repaired'], default: 'Pending' }
}, { timestamps: true });

ReportSchema.index({ location: '2dsphere' });

module.exports = mongoose.model('Report', ReportSchema);
