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

app.get('/favicon.ico', (req, res) => res.status(204).end());

// Only start the server after a successful DB connection
mongoose.connect(DB_URI)
    .then(() => {
        console.log('Successfully connected to MongoDB Atlas');
        app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
    })
    .catch(err => {
        console.error('CRITICAL ERROR: Could not connect to MongoDB Atlas:', err.message);
        process.exit(1);
    });

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
    try {
        const { fullName, photoPath, ...otherData } = req.body;
        console.log(`[Backend ${reqID}] START save: ${fullName}`);
        let finalPhotoPath = "";

        if (photoPath && photoPath.startsWith('data:image')) {
            try {
                // Upload Base64 directly to Cloudinary with compression
                const result = await cloudinary.uploader.upload(photoPath, {
                    folder: 'id_cards',
                    public_id: `emp_${fullName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}`,
                    quality: 'auto:good',
                    fetch_format: 'auto'
                });
                finalPhotoPath = result.secure_url;
            } catch (cloudErr) {
                console.error('CRITICAL: Cloudinary upload failed:', cloudErr.message);
                return res.status(500).json({ error: 'Failed to upload photo to cloud storage.' });
            }
        }

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

        await newEmployee.save();
        console.log(`[Backend ${reqID}] SUCCESS save: ${fullName}`);
        res.status(201).json({ message: 'Employee saved successfully!' });
    } catch (err) {
        console.error(`[Backend ${reqID}] ERROR:`, err.message);
        res.status(400).json({ error: err.message });
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

// app.listen is now inside the mongoose connection block above

