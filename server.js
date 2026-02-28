const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
app.use(cors());
app.use(bodyParser.json({ limit: '10mb' }));

// 1. CSP Header for Development
app.use((req, res, next) => {
    res.setHeader(
        "Content-Security-Policy",
        "default-src 'self' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; connect-src 'self' ws: localhost:*;"
    );
    next();
});

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

// 2. Serve Static Files
app.use(express.static(__dirname));
app.use('/uploads', express.static(uploadsDir));

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Avoid 404 for favicon
app.get('/favicon.ico', (req, res) => res.status(204).end());

const mongoURI = "mongodb://localhost:27017/idCardDB";
mongoose.connect(mongoURI)
    .then(() => console.log('Connected to MongoDB via Compass'))
    .catch(err => console.error('Connection error:', err));

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
    try {
        console.log('Incoming save-employee body:', req.body); // LOG BODY
        const { photoPath, fullName, ...otherData } = req.body;
        let finalPhotoPath = "";

        if (photoPath && photoPath.startsWith('data:image')) {
            const base64Data = photoPath.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            const filename = `emp_${fullName.replace(/[^a-zA-Z0-9]/g, '_')}_${Date.now()}.png`;
            const filepath = path.join(uploadsDir, filename);

            fs.writeFileSync(filepath, buffer);
            finalPhotoPath = `/uploads/${filename}`;
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
        res.status(201).json({ message: 'Employee saved successfully!' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

// ---- ADMIN API ----

// GET all employees (with optional date filter)
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

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));

