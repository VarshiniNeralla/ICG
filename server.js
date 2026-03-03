const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const cloudinary = require('cloudinary').v2;

const app = express();
require('dotenv').config();

const PORT = process.env.PORT || 5000;
const DB_URI = process.env.MONGO_URI;

if (!DB_URI) {
    console.error("CRITICAL ERROR: MONGO_URI is not defined in the environment variables.");
    process.exit(1);
}

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; connect-src 'self' ws: localhost:*;"
    );
    next();
});

app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Explicit route for Admin Panel to prevent 404s on cloud platforms like Render
app.get('/admin', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/favicon.ico', (req, res) => res.status(204).end());

// ── Global Process Crash Guards ──────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH GUARD] Unhandled Promise Rejection:', reason);
});
process.on('uncaughtException', (err) => {
    console.error('[CRASH GUARD] Uncaught Exception:', err.message);
});

// Connect to MongoDB but do NOT crash if it fails — allow server to start
mongoose.connect(DB_URI)
    .then(() => {
        console.log('Successfully connected to MongoDB Atlas');
    })
    .catch(err => {
        console.error('WARNING: Could not connect to MongoDB Atlas:', err.message);
        console.error('Server will continue running. Database operations will fail gracefully.');
    });

// Start server independently of DB connection
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

const EmployeeSchema = new mongoose.Schema({
    fullName: String,
    aadhar: String,
    dob: String,
    age: String,
    gender: String,
    bloodGroup: String,
    contractor: String,
    laborCamp: String,
    designation: String,
    contact: String,
    doi: String,
    validity: String,
    issueDate: String,
    site: String,
    operator: String,
    photoPath: String,
    createdAt: { type: Date, default: Date.now }
}, { strict: false });

const Employee = mongoose.model('Employee', EmployeeSchema);

app.post('/api/save-employee', async (req, res) => {
    const reqID = Date.now();
    let cloudinarySuccess = true;
    let mongoSuccess = true;
    const warnings = [];

    try {
        const { fullName, photoPath, ...otherData } = req.body;
        console.log(`[Backend ${reqID}] START save: ${fullName}`);
        let finalPhotoPath = null;

        // ── Cloudinary Upload (non-blocking) ─────────────────────────────────
        if (photoPath && photoPath.startsWith('data:image')) {
            try {
                const result = await cloudinary.uploader.upload(photoPath, {
                    folder: 'id_cards',
                    public_id: `emp_${fullName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
                    quality: 'auto:good',
                    fetch_format: 'auto'
                });
                finalPhotoPath = result.secure_url;
            } catch (cloudErr) {
                cloudinarySuccess = false;
                console.error(`[Backend ${reqID}] Cloudinary upload FAILED:`, cloudErr.message);
                warnings.push('Photo upload failed - record saved without cloud photo.');
                // Continue execution — do NOT return error
            }
        }

        // ── MongoDB Save (non-blocking) ──────────────────────────────────────
        try {
            const newEmployee = new Employee({
                fullName: fullName || '',
                aadhar: otherData.aadhar || '',
                dob: otherData.dob || '',
                age: otherData.age || '',
                gender: otherData.gender || '',
                bloodGroup: otherData.bloodGroup || '',
                contractor: otherData.contractor || '',
                laborCamp: otherData.laborCamp || '',
                designation: otherData.designation || '',
                contact: otherData.contact || '',
                doi: otherData.doi || '',
                validity: otherData.validity || '',
                issueDate: otherData.issueDate || '',
                site: otherData.site || '',
                operator: otherData.operator || '',
                photoPath: finalPhotoPath
            });

            console.log(`[Backend ${reqID}] Final URL to be saved: ${finalPhotoPath}`);
            await newEmployee.save();
            console.log(`[Backend ${reqID}] SUCCESS save: ${fullName}`);
        } catch (dbErr) {
            mongoSuccess = false;
            console.error(`[Backend ${reqID}] MongoDB save FAILED:`, dbErr.message);
            warnings.push('Database save failed - card generated but record not persisted.');
            // Continue execution — do NOT throw
        }

        // ── Always return 200 to frontend ────────────────────────────────────
        res.status(200).json({
            message: mongoSuccess ? 'Employee saved successfully!' : 'Card generated (save had warnings).',
            saved: mongoSuccess,
            cloudinary: cloudinarySuccess,
            warnings: warnings
        });

    } catch (err) {
        // Catch-all safety net — should never reach here, but if it does, still return 200
        console.error(`[Backend ${reqID}] UNEXPECTED ERROR:`, err.message);
        res.status(200).json({
            message: 'Card generated (server encountered an issue).',
            saved: false,
            cloudinary: false,
            warnings: ['Unexpected server error - card generated locally.']
        });
    }
});

//Admin Panel 

app.get('/api/employees', async (req, res) => {
    try {
        const { from, to } = req.query;
        const filter = {};
        if (from || to) {
            filter.createdAt = {};
            if (from) filter.createdAt.$gte = new Date(from);
            if (to) filter.createdAt.$lte = new Date(to + 'T23:59:59.999Z');
        }
        const employees = await Employee.find(filter).sort({ createdAt: -1 });
        res.json(employees);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DELETE single employee
app.delete('/api/employees/:id', async (req, res) => {
    try {
        await Employee.findByIdAndDelete(req.params.id);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// DASHBOARD STATS
app.get('/api/stats', async (req, res) => {
    try {
        const now = new Date();
        const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        const startOfWeek = new Date(startOfDay);
        startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

        const [total, today, week, month] = await Promise.all([
            Employee.countDocuments(),
            Employee.countDocuments({ createdAt: { $gte: startOfDay } }),
            Employee.countDocuments({ createdAt: { $gte: startOfWeek } }),
            Employee.countDocuments({ createdAt: { $gte: startOfMonth } })
        ]);

        // Group by contractor
        const byContractor = await Employee.aggregate([
            { $group: { _id: '$contractor', count: { $sum: 1 } } }
        ]);

        const bySite = await Employee.aggregate([
            { $group: { _id: '$site', count: { $sum: 1 } } }
        ]);

        const formatGroup = (arr) => {
            const obj = {};
            arr.forEach(item => {
                if (item._id) obj[item._id] = item.count;
            });
            return obj;
        };

        res.json({
            total, today, week, month,
            byContractor: formatGroup(byContractor),
            bySite: formatGroup(bySite)
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Endpoint to provide public config to frontend if needed
app.get('/api/config', (req, res) => {
    res.json({
        adminUser: process.env.ADMIN_USER || 'admin'
    });
});

// Master Data Management schemas & endpoints
const MasterDataSchema = new mongoose.Schema({
    type: { type: String, unique: true },
    data: [String]
});
const MasterData = mongoose.model('MasterData', MasterDataSchema);

const setupMasterDataRoute = (type, defaultData) => {
    app.get(`/api/${type}`, async (req, res) => {
        try {
            const doc = await MasterData.findOne({ type });
            res.json(doc ? doc.data : defaultData);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.post(`/api/${type}`, async (req, res) => {
        try {
            await MasterData.findOneAndUpdate(
                { type },
                { data: req.body.data },
                { upsert: true, new: true }
            );
            res.json({ message: 'Saved successfully' });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });
};

setupMasterDataRoute('sites', ['Grava', 'Apas', 'Vipina']);
setupMasterDataRoute('contractors', ['KLC PVT LTD', 'Sri Infra Works', 'Reddy Constructions']);
setupMasterDataRoute('roles', ['Worker', 'IT Engineer', 'MEP', 'Safety', 'Quality', 'Others']);

// ── Express Error-Catching Middleware (must be LAST) ─────────────────────────
app.use((err, req, res, next) => {
    console.error('[EXPRESS ERROR]', err.message);
    res.status(500).json({ error: 'Internal server error' });
});
