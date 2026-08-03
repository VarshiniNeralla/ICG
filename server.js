const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;
const https = require('https');
// Inline security headers (replaces helmet — avoids npm install issues on restricted networks)
function inlineHelmet(options = {}) {
    return (req, res, next) => {
        if (!options.contentSecurityPolicy) {
            // skip CSP — handled by dedicated middleware below
        }
        res.setHeader('X-Content-Type-Options', 'nosniff');
        res.setHeader('X-Frame-Options', 'SAMEORIGIN');
        res.setHeader('X-XSS-Protection', '0');
        res.setHeader('Strict-Transport-Security', 'max-age=15552000; includeSubDomains');
        res.setHeader('X-Download-Options', 'noopen');
        res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
        res.setHeader('Referrer-Policy', 'no-referrer');
        res.removeHeader('X-Powered-By');
        next();
    };
}

// Inline rate limiter (replaces express-rate-limit)
function inlineRateLimit({ windowMs = 900000, max = 300, message = { error: 'Too many requests' } } = {}) {
    const hits = new Map();
    setInterval(() => hits.clear(), windowMs);
    return (req, res, next) => {
        const key = req.ip;
        const current = hits.get(key) || 0;
        if (current >= max) return res.status(429).json(message);
        hits.set(key, current + 1);
        next();
    };
}

const app = express();
const isProduction = process.env.NODE_ENV === 'production';
if (!isProduction && fs.existsSync(path.join(__dirname, '.env'))) {
    require('dotenv').config();
    console.log('[Startup] Loaded environment variables from local .env');
} else if (!isProduction) {
    console.warn('[Startup] .env not found locally. Using current process environment variables only.');
}

const PORT = process.env.PORT || 10000;
const HOST = process.env.HOST || undefined;
const REQUIRED_ENV_VARS = [
    'MONGO_URI',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET'
];
const missingEnvVars = REQUIRED_ENV_VARS.filter((name) => !process.env[name] || !String(process.env[name]).trim());
if (missingEnvVars.length > 0) {
    console.error(`[Startup] Missing required environment variables: ${missingEnvVars.join(', ')}`);
    process.exit(1);
}
const DB_URI = process.env.MONGO_URI;

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

cloudinary.api.ping()
    .then(() => {
        console.log('Successfully connected to Cloudinary');
    })
    .catch((err) => {
        console.error('WARNING: Could not connect to Cloudinary:', err.message);
    });

// ── Security Middleware ──────────────────────────────────────────────────────
app.set('trust proxy', 1);
app.use(inlineHelmet({ contentSecurityPolicy: false }));

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

// Rate limiting — 300 requests per 15 min per IP.
// /api/imgproxy gets its own, higher-volume bucket: exporting records "with photos"
// makes one imgproxy call per record, which can be hundreds in a single legitimate export
// and would otherwise exhaust the shared budget for every other admin action.
app.use('/api/imgproxy', inlineRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 2000,
    message: { error: 'Too many image requests, please try again later.' }
}));
app.use('/api/', inlineRateLimit({
    windowMs: 15 * 60 * 1000,
    max: 300,
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

// Site-restricted admins — each can only see their own site's records
const SITE_ADMINS = {
    'admin@udyan.mhc.in':    { password: 'admin@udyan',    site: 'Udyan' },
    'admin@vyoma.mhc.in':    { password: 'admin@vyoma',    site: 'Vyoma' },
    'admin@nishada.mhc.in':  { password: 'admin@nishada',  site: 'Nishada' },
    'admin@vipina.mhc.in':   { password: 'admin@vipina',   site: 'Vipina' },
    'admin@ttpl.mhc.in':     { password: 'admin@ttpl',     site: 'TTPL' },
    'admin@apas.mhc.in':     { password: 'admin@apas',     site: 'Apas' },
};

const VALID_OPERATORS = [
    'CSO-Udyan', 'CSO-Vyoma', 'CSO-Nishada', 'CSO-Vipina', 'CSO-TTPL', 'CSO-Apas'
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
app.get('/health', (req, res) => res.status(200).send('OK'));

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
    .then(async () => {
        console.log('Successfully connected to MongoDB Atlas');
        // Drop legacy single-field unique index on MasterData.type if it exists,
        // so the new compound {type,site} index can be created cleanly.
        try {
            await mongoose.connection.collection('masterdatas').dropIndex('type_1');
            console.log('[Migration] Dropped legacy MasterData type_1 index');
        } catch (_) { /* index didn't exist — that's fine */ }
    })
    .catch(err => {
        console.error('ERROR: Could not connect to MongoDB Atlas:', err.message);
        process.exit(1);
    });

// Start server independently of DB connection
const server = app.listen(PORT, ...(HOST ? [HOST] : []), () => {
    console.log(`[Startup] Server listening on ${HOST || '::'}:${PORT}`);
    console.log(`[Startup] NODE_ENV=${process.env.NODE_ENV || 'development'}`);
});

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
    state: String,
    district: String,
    address: String,
    contractor: String,
    laborCamp: String,
    subContractor: String,
    subContractorContact: String,
    designation: String,
    contact: String,
    doi: String,
    validity: String,
    issueDate: String,
    site: String,
    operator: String,
    aadharVerified: { type: String, default: 'No' },
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
    const username = (req.body.username || '').trim();
    const password = (req.body.password || '').trim();
    if (!username || !password) return res.status(400).json({ error: 'Username and password required' });

    // Super admin — full access
    if (username === ADMIN_USER && password === ADMIN_PASS) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { role: 'admin', username, site: null, expiresAt: Date.now() + SESSION_TTL_ADMIN });
        return res.json({ token, site: null });
    }

    // Site-restricted admin
    const siteAdmin = SITE_ADMINS[username.toLowerCase()];
    if (siteAdmin && password === siteAdmin.password) {
        const token = crypto.randomBytes(32).toString('hex');
        sessions.set(token, { role: 'admin', username, site: siteAdmin.site, expiresAt: Date.now() + SESSION_TTL_ADMIN });
        return res.json({ token, site: siteAdmin.site });
    }

    return res.status(401).json({ error: 'Invalid credentials' });
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
                state: otherData.state || '',
                district: otherData.district || '',
                address: otherData.address || '',
                contractor: otherData.contractor || '',
                laborCamp: otherData.laborCamp || '',
                subContractor: otherData.subContractor || '',
                subContractorContact: otherData.subContractorContact || '',
                designation: otherData.designation || '',
                contact: otherData.contact || '',
                doi: otherData.doi || '',
                validity: otherData.validity || '',
                issueDate: otherData.issueDate || '',
                site: otherData.site || '',
                operator: otherData.operator || '',
                aadharVerified: otherData.aadharVerified || 'No',
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
            if (Object.keys(filter.createdAt).length === 0) delete filter.createdAt;
        }

        // Site-restricted admin: always lock to their site, ignore any site param from client
        if (req.userSession.site) {
            filter.site = req.userSession.site;
        } else if (site) {
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
        const filter = { _id: req.params.id };
        if (req.userSession.site) filter.site = req.userSession.site;
        const deleted = await Employee.findOneAndDelete(filter);
        if (!deleted) return res.status(404).json({ error: 'Record not found' });

        // Audit trail
        console.log(`[AUDIT] Record deleted | ID: ${req.params.id} | Name: ${deleted.fullName} | Aadhar: ${deleted.aadhar} | By: ${req.userSession.username} | At: ${new Date().toISOString()}`);
        res.json({ message: 'Deleted successfully' });
    } catch (err) {
        console.error(err.message); res.status(500).json({ error: 'Internal server error' });
    }
});

// Image proxy — fetches a Cloudinary URL server-side and returns base64 (avoids CORS on client)
app.get('/api/imgproxy', requireAuth, async (req, res) => {
    const url = req.query.url;
    if (!url || !url.startsWith('https://res.cloudinary.com/')) {
        return res.status(400).json({ error: 'Invalid URL' });
    }
    try {
        const chunks = [];
        let ct = 'image/jpeg';
        await new Promise((resolve, reject) => {
            https.get(url, (r) => {
                if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
                    return reject(new Error('Redirect not followed'));
                }
                ct = r.headers['content-type'] || 'image/jpeg';
                r.on('data', c => chunks.push(c));
                r.on('end', resolve);
                r.on('error', reject);
            }).on('error', reject);
        });
        const buf = Buffer.concat(chunks);
        const b64 = buf.toString('base64');
        res.json({ b64, ct });
    } catch (e) {
        res.status(500).json({ error: 'Fetch failed' });
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

        // Retention base filter — all counts & charts are scoped to this window
        const baseFilter = {};
        if (req.query.from || req.query.to) {
            const createdAt = {};
            if (req.query.from) { const d = new Date(req.query.from); if (!isNaN(d.getTime())) createdAt.$gte = d; }
            if (req.query.to)   { const d = new Date(req.query.to);   if (!isNaN(d.getTime())) createdAt.$lt  = d; }
            if (Object.keys(createdAt).length) baseFilter.createdAt = createdAt;
        }
        // Site-restricted admin — lock stats to their site; super admin can pass ?site= to filter
        if (req.userSession.site) {
            baseFilter.site = req.userSession.site;
        } else if (req.query.site) {
            baseFilter.site = req.query.site;
        }

        const toClamp = baseFilter.createdAt && baseFilter.createdAt.$lt ? { $lt: baseFilter.createdAt.$lt } : {};
        const [total, today, week, month] = await Promise.all([
            Employee.countDocuments(baseFilter),
            Employee.countDocuments({ ...baseFilter, createdAt: { ...(baseFilter.createdAt || {}), ...toClamp, $gte: startOfDay } }),
            Employee.countDocuments({ ...baseFilter, createdAt: { ...(baseFilter.createdAt || {}), ...toClamp, $gte: startOfWeek } }),
            Employee.countDocuments({ ...baseFilter, createdAt: { ...(baseFilter.createdAt || {}), ...toClamp, $gte: startOfMonth } })
        ]);

        const matchStage = Object.keys(baseFilter).length ? { $match: baseFilter } : null;
        const byContractorPipeline = [
            ...(matchStage ? [matchStage] : []),
            { $group: { _id: '$contractor', count: { $sum: 1 } } }
        ];
        const bySitePipeline = [
            ...(matchStage ? [matchStage] : []),
            { $group: { _id: '$site', count: { $sum: 1 } } }
        ];
        const byDesignationPipeline = [
            ...(matchStage ? [matchStage] : []),
            { $group: { _id: '$designation', count: { $sum: 1 } } }
        ];
        const byStatePipeline = [
            ...(matchStage ? [matchStage] : []),
            { $group: { _id: '$state', count: { $sum: 1 } } }
        ];
        const byDistrictPipeline = [
            ...(matchStage ? [matchStage] : []),
            { $group: { _id: '$district', count: { $sum: 1 } } }
        ];
        // Age is stored as a String — coerce to int, then bucket. Blank/non-numeric/out-of-range
        // fall into the last "default" bucket so no record is ever dropped.
        const byAgeGroupPipeline = [
            ...(matchStage ? [matchStage] : []),
            { $addFields: { _ageNum: { $convert: { input: '$age', to: 'int', onError: null, onNull: null } } } },
            { $bucket: {
                groupBy: '$_ageNum',
                boundaries: [18, 25, 35, 45, 55],
                default: 'Other',
                output: { count: { $sum: 1 } }
            } }
        ];
        // Breakdown of the "Other" bucket by raw age value (blank/non-numeric/out-of-range),
        // so the dashboard can show what's actually in it.
        const ageOtherBreakdownPipeline = [
            ...(matchStage ? [matchStage] : []),
            { $addFields: { _ageNum: { $convert: { input: '$age', to: 'int', onError: null, onNull: null } } } },
            { $match: { $or: [{ _ageNum: null }, { _ageNum: { $lt: 18 } }, { _ageNum: { $gte: 55 } }] } },
            { $group: { _id: '$age', count: { $sum: 1 } } }
        ];

        const [byContractor, bySite, byDesignation, byState, byDistrict, byAgeGroup, ageOtherBreakdown] = await Promise.all([
            Employee.aggregate(byContractorPipeline, { maxTimeMS: 5000 }),
            Employee.aggregate(bySitePipeline, { maxTimeMS: 5000 }),
            Employee.aggregate(byDesignationPipeline, { maxTimeMS: 5000 }),
            Employee.aggregate(byStatePipeline, { maxTimeMS: 5000 }),
            Employee.aggregate(byDistrictPipeline, { maxTimeMS: 5000 }),
            Employee.aggregate(byAgeGroupPipeline, { maxTimeMS: 5000 }),
            Employee.aggregate(ageOtherBreakdownPipeline, { maxTimeMS: 5000 })
        ]);

        const formatGroup = (arr) => {
            const obj = {};
            arr.forEach(item => {
                const key = item._id || 'Unspecified';
                obj[key] = (obj[key] || 0) + item.count;
            });
            return obj;
        };

        // Map age buckets to human labels; lower bound is inclusive, upper exclusive.
        const ageLabels = { '18': '18-25', '25': '25-35', '35': '35-45', '45': '45-55', 'Other': 'Other' };
        const byAgeGroupObj = {};
        byAgeGroup.forEach(b => {
            const label = ageLabels[String(b._id)] || String(b._id);
            byAgeGroupObj[label] = (byAgeGroupObj[label] || 0) + b.count;
        });

        const ageOtherBreakdownObj = formatGroup(ageOtherBreakdown);

        res.json({
            total, today, week, month,
            byContractor: formatGroup(byContractor),
            ageOtherBreakdown: ageOtherBreakdownObj,
            bySite: formatGroup(bySite),
            byDesignation: formatGroup(byDesignation),
            byState: formatGroup(byState),
            byDistrict: formatGroup(byDistrict),
            byAgeGroup: byAgeGroupObj
        });
    } catch (err) {
        console.error(err.message); res.status(500).json({ error: 'Internal server error' });
    }
});

// Master Data Management schemas & endpoints
// site: null  = global/super-admin record
// site: 'Vyoma' = scoped to that site
const MasterDataSchema = new mongoose.Schema({
    type: { type: String, required: true },
    site: { type: String, default: null },
    data: [String]
});
MasterDataSchema.index({ type: 1, site: 1 }, { unique: true });
const MasterData = mongoose.model('MasterData', MasterDataSchema);

// Resolve which site scope to use for a GET request.
// Site admins are always locked to their session site.
// Super admin (session.site = null) may pass ?site= to read a specific site.
// Unauthenticated callers (operators) use ?site= query param.
async function resolveSiteForRead(req) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token) {
        const session = sessions.get(token);
        if (session) {
            if (session.site) return session.site; // site admin — locked to their site
            // super admin — honour ?site= if provided
            return req.query.site || null;
        }
    }
    // No auth — use query param (operators)
    return req.query.site || null;
}

const setupMasterDataRoute = (type, defaultData) => {
    app.get(`/api/${type}`, async (req, res) => {
        try {
            const site = await resolveSiteForRead(req);
            if (site) {
                // Try site-specific first, fall back to global
                const siteDoc = await MasterData.findOne({ type, site });
                if (siteDoc) return res.json(siteDoc.data);
                const globalDoc = await MasterData.findOne({ type, site: null });
                return res.json(globalDoc ? globalDoc.data : defaultData);
            } else {
                // Super admin or no site — return global
                const doc = await MasterData.findOne({ type, site: null });
                return res.json(doc ? doc.data : defaultData);
            }
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
            const cleaned = data.filter(item => typeof item === 'string' && item.trim().length > 0)
                                .map(item => item.trim());
            // Scope to the admin's own site.
            // Super admin (site=null) may pass ?site= to edit a specific site's data.
            let site = req.userSession.site || null;
            if (!site && req.query.site) site = req.query.site;
            await MasterData.findOneAndUpdate(
                { type, site },
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
