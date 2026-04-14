const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
const cloudinary = require('cloudinary').v2;
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

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

const hasCloudinaryCreds = Boolean(
    process.env.CLOUDINARY_CLOUD_NAME &&
    process.env.CLOUDINARY_API_KEY &&
    process.env.CLOUDINARY_API_SECRET
);

if (!hasCloudinaryCreds) {
    console.warn('WARNING: Cloudinary credentials are missing. Uploads may fail.');
} else {
    cloudinary.api.ping()
        .then(() => {
            console.log('Successfully connected to Cloudinary');
        })
        .catch((err) => {
            console.error('WARNING: Could not connect to Cloudinary:', err.message);
        });
}

// ── Security Middleware ──────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(helmet({ contentSecurityPolicy: false }));

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '').split(',').filter(Boolean);
app.use(cors({
    origin: (origin, cb) => {
        // Allow same-origin (no origin header) and localhost for dev
        if (!origin || ALLOWED_ORIGINS.includes(origin)
            || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)
            || /\.onrender\.com$/.test(origin)) {
            cb(null, true);
        } else {
            cb(new Error('Not allowed by CORS'));
        }
    }
}));

app.use(bodyParser.json({ limit: '5mb' }));

// Rate limiting — 300 requests per 15 min per IP
app.use('/api/', rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
}));

// Content Security Policy — TensorFlow.js (portrait / body-segmentation from CDN) uses eval/new Function internally
app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https:; connect-src 'self' https: ws://localhost:*;"
    );
    next();
});

// ── Authentication System ───────────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL_OPERATOR = 24 * 60 * 60 * 1000; // 24 hours
const SESSION_TTL_ADMIN = 8 * 60 * 60 * 1000;     // 8 hours

// Clean expired sessions every hour
setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) {
        if (now > session.expiresAt) sessions.delete(token);
    }
}, 60 * 60 * 1000);

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin@123';

const VALID_OPERATORS = [
    'CSO-Akrida', 'CSO-Apas', 'CSO-Avali',
    'CSO-Grava Commercial', 'CSO-Grava Residences',
    'CSO-Sayuk', 'CSO-Udyan', 'CSO-Vipina',
    'CSO-Vyoma', 'CSO-99'
];

function getOperatorPassword(username) {
    const site = username.replace('CSO-', '');
    if (site === 'Grava Residences') return 'gravar@mhc26';
    if (site === 'Grava Commercial') return 'gravac@mhc26';
    return `${site.split(' ')[0].toLowerCase()}@mhc26`;
}

function requireAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const session = sessions.get(token);
    if (!session || Date.now() > session.expiresAt) {
        if (session) sessions.delete(token);
        return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    req.userSession = session;
    next();
}

function requireAdmin(req, res, next) {
    requireAuth(req, res, () => {
        if (req.userSession.role !== 'admin') {
            return res.status(403).json({ error: 'Admin access required' });
        }
        next();
    });
}

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
    // Process is in undefined state after uncaught exception — exit and let process manager restart
    process.exit(1);
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
const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

// ── Graceful Shutdown ───────────────────────────────────────────────────────
const shutdown = (signal) => {
    console.log(`\n[${signal}] Shutting down gracefully...`);
    server.close(() => {
        mongoose.connection.close(false).then(() => {
            console.log('Server and DB connections closed cleanly.');
            process.exit(0);
        }).catch(() => process.exit(0));
    });
    // Force exit if graceful shutdown takes too long
    setTimeout(() => { console.error('Forced shutdown (timeout).'); process.exit(1); }, 10000);
};
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

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
});

// Unique sparse indexes — prevent duplicate Aadhar/contact at DB level
EmployeeSchema.index({ aadhar: 1 }, { unique: true, sparse: true });
EmployeeSchema.index({ contact: 1 }, { unique: true, sparse: true });

const Employee = mongoose.model('Employee', EmployeeSchema);

// ── Auth Endpoints ──────────────────────────────────────────────────────────
app.post('/api/auth/operator', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (!VALID_OPERATORS.includes(username)) return res.status(401).json({ error: 'Invalid credentials' });
    if (password !== getOperatorPassword(username)) return res.status(401).json({ error: 'Invalid credentials' });

    const token = crypto.randomBytes(32).toString('hex');
    const site = username.replace('CSO-', '');
    sessions.set(token, { role: 'operator', username, site, expiresAt: Date.now() + SESSION_TTL_OPERATOR });
    res.json({ token, operator: { name: username, site } });
});

app.post('/api/auth/admin', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });
    if (username !== ADMIN_USER || password !== ADMIN_PASS) return res.status(401).json({ error: 'Invalid credentials' });

    const token = crypto.randomBytes(32).toString('hex');
    sessions.set(token, { role: 'admin', username, expiresAt: Date.now() + SESSION_TTL_ADMIN });
    res.json({ token });
});

app.post('/api/auth/verify', (req, res) => {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (!token) return res.status(401).json({ valid: false });
    const session = sessions.get(token);
    if (!session || Date.now() > session.expiresAt) return res.status(401).json({ valid: false });
    res.json({ valid: true, role: session.role });
});

// ── Duplicate Check Endpoint ─────────────────────────────────────────────────
app.post('/api/check-duplicate', requireAuth, async (req, res) => {
    try {
        const { aadhar, contact } = req.body;
        if (!aadhar && !contact) return res.json({ duplicate: false });

        // Build $or query for whichever fields are provided
        const conditions = [];
        if (aadhar) conditions.push({ aadhar });
        if (contact) conditions.push({ contact });

        const existing = await Employee.findOne({ $or: conditions }).sort({ createdAt: -1 });

        if (!existing) return res.json({ duplicate: false });

        // Determine which field(s) matched
        const aadharMatch = aadhar && existing.aadhar === aadhar;
        const contactMatch = contact && existing.contact === contact;
        let matchedOn = 'unknown';
        if (aadharMatch && contactMatch) matchedOn = 'both';
        else if (aadharMatch) matchedOn = 'aadhar';
        else if (contactMatch) matchedOn = 'contact';

        res.json({
            duplicate: true,
            matchedOn,
            existing: {
                fullName: existing.fullName,
                site: existing.site || 'N/A',
                operator: existing.operator || 'N/A',
                createdAt: existing.createdAt,
                aadhar: existing.aadhar,
                contact: existing.contact
            }
        });
    } catch (err) {
        // If check fails, let the operator proceed — never block
        console.error('Duplicate check failed:', err.message);
        res.json({ duplicate: false });
    }
});

app.post('/api/save-employee', requireAuth, async (req, res) => {
    const reqID = Date.now();
    let cloudinarySuccess = true;
    let mongoSuccess = true;
    const warnings = [];

    try {
        const { fullName, photoPath, ...otherData } = req.body;

        // ── Server-side Input Validation ─────────────────────────────────────
        if (!fullName || fullName.trim().length < 3 || !/^[A-Za-z.\s]+$/.test(fullName.trim())) {
            return res.status(400).json({ error: 'Valid full name required (min 3 chars, letters/spaces/dots only).' });
        }
        if (!otherData.aadhar || !/^\d{12}$/.test(otherData.aadhar)) {
            return res.status(400).json({ error: 'Aadhar must be exactly 12 digits.' });
        }
        if (!otherData.contact || !/^[6-9]\d{9}$/.test(otherData.contact)) {
            return res.status(400).json({ error: 'Contact must be 10 digits starting with 6-9.' });
        }
        if (!otherData.gender || !['Male', 'Female', 'Other'].includes(otherData.gender)) {
            return res.status(400).json({ error: 'Valid gender required.' });
        }

        console.log(`[Backend ${reqID}] START save: ${fullName}`);
        let finalPhotoPath = null;

        // ── Cloudinary Upload (non-blocking) ─────────────────────────────────
        if (photoPath && photoPath.startsWith('data:image')) {
            try {
                const result = await cloudinary.uploader.upload(photoPath, {
                    folder: 'id_cards',
                    public_id: `emp_${crypto.randomUUID()}`,
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
            if (dbErr.code === 11000) {
                const field = Object.keys(dbErr.keyPattern || {})[0] || 'field';
                console.error(`[Backend ${reqID}] Duplicate ${field} rejected by DB`);
                warnings.push(`Duplicate ${field} — record already exists.`);
            } else {
                console.error(`[Backend ${reqID}] MongoDB save FAILED:`, dbErr.message);
                warnings.push('Database save failed - card generated but record not persisted.');
            }
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

app.get('/api/employees', requireAuth, async (req, res) => {
    try {
        const { from, to, site } = req.query;
        const filter = {};

        if (from || to) {
            filter.createdAt = {};
            if (from) {
                const fromDate = new Date(from);
                if (!isNaN(fromDate.getTime())) filter.createdAt.$gte = fromDate;
            }
            if (to) {
                const toDate = new Date(to + 'T23:59:59.999Z');
                if (!isNaN(toDate.getTime())) filter.createdAt.$lte = toDate;
            }
            // Remove empty createdAt filter if both dates were invalid
            if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
        }

        if (site) {
            filter.site = site;
        }

        const page = Math.max(1, parseInt(req.query.page) || 1);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
        const skip = (page - 1) * limit;

        const [employees, total] = await Promise.all([
            Employee.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
            Employee.countDocuments(filter)
        ]);
        res.json({ data: employees, total, page, limit, pages: Math.ceil(total / limit) });
    } catch (err) {
        console.error(err.message); res.status(500).json({ error: 'Internal server error' });
    }
});

// DELETE single employee (admin only)
app.delete('/api/employees/:id', requireAdmin, async (req, res) => {
    try {
        const deleted = await Employee.findByIdAndDelete(req.params.id);
        if (!deleted) return res.status(404).json({ error: 'Record not found' });

        // Audit trail
        console.log(`[AUDIT] Record deleted | ID: ${req.params.id} | Name: ${deleted.fullName} | Aadhar: ${deleted.aadhar} | By: ${req.userSession.username} | At: ${new Date().toISOString()}`);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        console.error(err.message); res.status(500).json({ error: 'Internal server error' });
    }
});

// DASHBOARD STATS (admin only)
app.get('/api/stats', requireAdmin, async (req, res) => {
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

        // Group by contractor (with 5s timeout to prevent hanging)
        const byContractor = await Employee.aggregate([
            { $group: { _id: '$contractor', count: { $sum: 1 } } }
        ]).option({ maxTimeMS: 5000 });

        const bySite = await Employee.aggregate([
            { $group: { _id: '$site', count: { $sum: 1 } } }
        ]).option({ maxTimeMS: 5000 });

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
        console.error(err.message); res.status(500).json({ error: 'Internal server error' });
    }
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
            console.error(err.message); res.status(500).json({ error: 'Internal server error' });
        }
    });

    app.post(`/api/${type}`, requireAdmin, async (req, res) => {
        try {
            const { data } = req.body;
            if (!Array.isArray(data) || data.length > 100) {
                return res.status(400).json({ error: 'Invalid data: must be an array with max 100 items.' });
            }
            // Filter to only non-empty trimmed strings
            const cleaned = data.filter(item => typeof item === 'string' && item.trim().length > 0)
                                .map(item => item.trim());
            await MasterData.findOneAndUpdate(
                { type },
                { data: cleaned },
                { upsert: true, new: true }
            );
            res.json({ message: 'Saved successfully' });
        } catch (err) {
            console.error(err.message); res.status(500).json({ error: 'Internal server error' });
        }
    });
};

setupMasterDataRoute('sites', ['Grava', 'Apas', 'Vipina']);
setupMasterDataRoute('contractors', ['KLC PVT LTD', 'Sri Infra Works', 'Reddy Constructions', 'Others']);
setupMasterDataRoute('roles', ['Worker', 'IT Engineer', 'MEP', 'Safety', 'Quality', 'Others']);

// ── Express Error-Catching Middleware (must be LAST) ─────────────────────────
app.use((err, req, res, next) => {
    console.error('[EXPRESS ERROR]', err.message);
    res.status(500).json({ error: 'Internal server error' });
});
