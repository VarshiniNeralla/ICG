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

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir);
}

app.use('/uploads', express.static(uploadsDir));

const mongoURI = "mongodb://localhost:27017/idCardDB";
mongoose.connect(mongoURI)
    .then(() => console.log('Connected to MongoDB via Compass'))
    .catch(err => console.error('Connection error:', err));

const EmployeeSchema = new mongoose.Schema({
    fullName: String,
    empId: { type: String, unique: true },
    designation: String,
    bloodGroup: String,
    contact: String,
    validity: String,
    photoPath: String,
    createdAt: { type: Date, default: Date.now }
});

const Employee = mongoose.model('Employee', EmployeeSchema);

app.post('/api/save-employee', async (req, res) => {
    try {
        const { photoPath, empId, ...otherData } = req.body;
        let finalPhotoPath = "";

        if (photoPath && photoPath.startsWith('data:image')) {
            const base64Data = photoPath.replace(/^data:image\/\w+;base64,/, "");
            const buffer = Buffer.from(base64Data, 'base64');
            const filename = `emp_${empId.replace(/[^a-zA-Z0-9]/g, '_')}.png`;
            const filepath = path.join(uploadsDir, filename);

            fs.writeFileSync(filepath, buffer);
            finalPhotoPath = `/uploads/${filename}`;
        }

        const newEmployee = new Employee({
            ...otherData,
            empId,
            photoPath: finalPhotoPath
        });

        await newEmployee.save();
        res.status(201).json({ message: 'Employee saved successfully!' });
    } catch (err) {
        res.status(400).json({ error: err.message });
    }
});

const PORT = 5000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
