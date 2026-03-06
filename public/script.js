'use strict';

const CR80_W = 1100;
const CR80_H = 1500;
const PRINT_SCALE = 2; // Internal resolution multiplier for print quality (2x = ~430 DPI)
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000'
    : window.location.origin;

const SITE_CONFIG = {
    'Grava': { tint: 'rgba(128,128,128,0.07)', code: 'GRAVA' },
    'Apas': { tint: 'rgba(0,123,255,0.07)', code: 'APAS' },
    'Vipina': { tint: 'rgba(220,53,69,0.07)', code: 'VIPINA' }
};

// Internal utility to generate a unique code for new sites
function getSiteCode(siteName) {
    if (SITE_CONFIG[siteName]) return SITE_CONFIG[siteName].code;
    return siteName.toUpperCase().replace(/[^A-Z0-9]/g, '').substring(0, 8);
}

function getSiteSegments(code) {
    const mid = Math.ceil(code.length / 2);
    return [code.substring(0, mid), code.substring(mid)];
}

async function fetchList(endpoint) {
    try {
        const res = await fetch(`${API_BASE}${endpoint}`);
        if (!res.ok) return [];
        return await res.json();
    } catch (e) {
        console.error('Failed to fetch', endpoint, e);
        return [];
    }
}

async function populateDropdowns() {
    const [sites, contractors, roles] = await Promise.all([
        fetchList('/api/sites'),
        fetchList('/api/contractors'),
        fetchList('/api/roles')
    ]);

    const sSel = document.getElementById('siteSelect');
    const cSel = document.getElementById('contractor');
    const dSel = document.getElementById('designation');

    // Preserve currently selected values to avoid overriding active selections
    const curSite = sSel ? sSel.value : '';
    const curContractor = cSel ? cSel.value : '';
    const curRole = dSel ? dSel.value : '';

    if (sSel) {
        sSel.innerHTML = '<option value="">Select Site</option>' + sites.map(s => `<option value="${s}">${s}</option>`).join('');
        if (sites.includes(curSite)) sSel.value = curSite;
    }
    if (cSel) {
        cSel.innerHTML = '<option value="">Select Contractor</option>' + contractors.map(c => `<option value="${c}">${c}</option>`).join('');
        if (contractors.includes(curContractor)) cSel.value = curContractor;
    }
    if (dSel) {
        dSel.innerHTML = '<option value="">Select</option>' + roles.map(r => `<option value="${r}">${r}</option>`).join('');
        if (roles.includes(curRole)) dSel.value = curRole;
    }
}

// Implement auto-refresh logic
setInterval(populateDropdowns, 30000); // refresh every 30 secs
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        populateDropdowns();
    }
});

// ── Tab Closure Safeguard ────────────────────────────────────────────────────
window.addEventListener('beforeunload', (e) => {
    if (batchQueue && batchQueue.length > 0) {
        e.preventDefault();
        e.returnValue = ''; // Triggers standard browser "Leave site?" dialog
    }
});

let operator = { name: '', site: '' };
let capturedPhotoDataURL = null;
let currentStep = 1;
let batchQueue = []; // Tiny proxies for preview + localStorage
let batchPrintQueue = []; // Full-resolution images for actual printing (in-memory only)
let stream = null;
let isSaved = false;
let isInBatch = false;
let isSaving = false; // Submission lock to prevent duplicates
let capturedCloudDataURL = null; // Compressed version for cloud upload

const loginScreen = document.getElementById('loginScreen');
const mainApp = document.getElementById('mainApp');
const loginForm = document.getElementById('loginForm');
const operatorInfo = document.getElementById('operatorInfo');
const btnLogout = document.getElementById('btnLogout');

const passForm = document.getElementById('passForm');
const dobInput = document.getElementById('dob');
const ageInput = document.getElementById('age');
const issueDateInput = document.getElementById('issueDate');
const validityInput = document.getElementById('validity');
const doiInput = document.getElementById('doi');

const video = document.getElementById('videoFeed');
const croppedPhoto = document.getElementById('croppedPhoto');
const snapCanvas = document.getElementById('snapCanvas');
const photoPlaceholder = document.getElementById('photoPlaceholder');
const cameraError = document.getElementById('cameraError');
const btnStart = document.getElementById('btnStartCamera');
const btnCapture = document.getElementById('btnCapture');
const btnRetake = document.getElementById('btnRetake');

const idCard = document.getElementById('idCard');
const canvasEmpty = document.getElementById('canvasEmpty');
const previewActions = document.getElementById('previewActions');

const btnToStep2 = document.getElementById('btnToStep2');
const btnToStep3 = document.getElementById('btnToStep3');
const btnBackTo1 = document.getElementById('btnBackTo1');
const btnBackTo2 = document.getElementById('btnBackTo2');
const btnGenerate = document.getElementById('btnGenerate');

const btnDownload = document.getElementById('btnDownload');
const btnPrint = document.getElementById('btnPrint');
const btnAddToBatch = document.getElementById('btnAddToBatch');
const btnNextEntry = document.getElementById('btnNextEntry');

const batchList = document.getElementById('batchList');
const btnClearBatch = document.getElementById('btnClearBatch');
const btnPrintBatch = document.getElementById('btnPrintBatch');
const batchPrintArea = document.getElementById('batchPrintArea');

function initSession() {
    const savedOp = localStorage.getItem('ep_operator');
    if (savedOp) {
        operator = JSON.parse(savedOp);
        operatorInfo.innerHTML = `Site: <strong>${operator.site}</strong> | Op: <strong>${operator.name}</strong>`;
        loginScreen.style.display = 'none';
        mainApp.style.display = 'block';
        setDefaultDates();
    }
    const savedBatch = localStorage.getItem('ep_batch');
    if (savedBatch) {
        batchQueue = JSON.parse(savedBatch);
        updateBatchUI();
    }
    populateDropdowns();
}

loginForm.onsubmit = (e) => {
    e.preventDefault();
    const name = document.getElementById('operatorName').value.trim();
    const site = document.getElementById('siteSelect').value;

    if (!name || !site) return;

    operator = { name, site };
    localStorage.setItem('ep_operator', JSON.stringify(operator)); // Persist
    operatorInfo.innerHTML = `Site: <strong>${site}</strong> | Op: <strong>${name}</strong>`;
    loginScreen.style.display = 'none';
    mainApp.style.display = 'block';

    setDefaultDates();
};

function setDefaultDates() {
    const today = new Date();
    const nextYear = new Date(new Date().setFullYear(today.getFullYear() + 1));
    const todayStr = today.toISOString().split('T')[0];
    const nextYearStr = nextYear.toISOString().split('T')[0];

    if (issueDateInput) {
        issueDateInput.value = formatDate(today.toISOString());
    }
    if (validityInput) validityInput.value = nextYearStr;
    if (doiInput) doiInput.value = todayStr;
}

btnLogout.onclick = () => {
    localStorage.removeItem('ep_operator');
    localStorage.removeItem('ep_batch');
    window.location.reload();
};

const getFormData = () => ({
    fullName: document.getElementById('fullName').value.trim(),
    aadhar: document.getElementById('aadhar').value.trim(),
    dob: document.getElementById('dob').value,
    age: document.getElementById('age').value,
    gender: document.getElementById('gender').value,
    bloodGroup: document.getElementById('bloodGroup').value,
    contractor: document.getElementById('contractor').value,
    laborCamp: document.getElementById('laborCamp').value,
    doi: document.getElementById('doi').value,
    designation: document.getElementById('designation').value,
    validity: document.getElementById('validity').value,
    issueDate: document.getElementById('issueDate').value,
    contact: document.getElementById('contact').value.trim()
});

const loadImage = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });
const formatDate = (d) => {
    if (!d) return '---';
    // If already in dd-mm-yyyy format, return as is to prevent double-formatting/inversion
    if (typeof d === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(d)) return d;

    const date = new Date(d);
    if (isNaN(date.getTime())) return d; // Return raw (like already formatted)
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
};

function validateStep(step) {
    const data = getFormData();
    if (step === 1) {
        if (!data.fullName || data.fullName.length < 3) return "Valid full name required.";
        if (!/^[A-Za-z.\s]+$/.test(data.fullName)) return "Name must contain only letters, spaces, and dots.";
        if (data.aadhar.length !== 12 || isNaN(data.aadhar)) return "Aadhar must be 12 numeric digits.";
        if (!data.dob) return "Date of Birth required.";
        const age = parseInt(data.age);
        if (age < 18) return "Age must be at least 18 years.";
        if (age > 100) return "Age cannot exceed 100 years.";
        if (!data.gender || !data.bloodGroup) return "Select gender and blood group.";
    }
    if (step === 2) {
        if (!data.contractor || !data.laborCamp || !data.designation) return "Select all employer fields.";
        if (data.contact.length !== 10 || isNaN(data.contact)) return "Contact must be 10 numeric digits.";
        if (!/^[6-9]/.test(data.contact)) return "Phone number must start with 6, 7, 8, or 9.";
        if (!data.doi || !data.validity) return "DOI and Validity required.";
        if (new Date(data.validity) <= new Date(data.issueDate)) return "Validity must be in future.";
    }
    return true;
}

function goToStep(step) {
    currentStep = step;
    const track = document.getElementById('carouselTrack');
    const width = 100 / 3;
    track.style.transform = `translateX(-${(step - 1) * width}%)`;

    document.querySelectorAll('.step-item').forEach((item, idx) => {
        item.classList.toggle('active', idx + 1 === step);
        item.classList.toggle('completed', idx + 1 < step);
    });
}

async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 800, height: 1000 } });
        video.srcObject = stream;
        video.style.display = 'block';
        photoPlaceholder.style.display = 'none';
        btnStart.style.display = 'none';
        btnCapture.style.display = 'inline-flex';
        btnRetake.style.display = 'none';
        btnGenerate.style.display = 'none';
    } catch (err) { cameraError.textContent = 'Camera failed: ' + err.message; }
}

function capturePhoto() {
    if (!video.srcObject) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    croppedPhoto.width = vw;
    croppedPhoto.height = vh;
    croppedPhoto.getContext('2d').drawImage(video, 0, 0, vw, vh);
    // Keep FULL quality for canvas rendering (print clarity)
    const fullQualityDataURL = croppedPhoto.toDataURL('image/jpeg', 0.95);
    // Compressed version for cloud upload (saves bandwidth/storage)
    const cloudDataURL = croppedPhoto.toDataURL('image/jpeg', 0.5);
    capturedPhotoDataURL = fullQualityDataURL;
    capturedCloudDataURL = cloudDataURL;

    video.style.display = 'none';
    croppedPhoto.style.display = 'block';
    btnCapture.style.display = 'none';
    btnRetake.style.display = 'inline-flex';
    btnGenerate.style.display = 'inline-flex';
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    btnStart.style.display = 'none'; // Hide Turn On Camera after capture
}

function drawWatermark(ctx) {
    const siteName = operator.site || "UNKNOWN";
    const firstLetter = siteName.charAt(0).toUpperCase();
    const lastLetter = siteName.charAt(siteName.length - 1).toUpperCase();
    const watermarkText = `⟁ ${firstLetter} ✦ ${lastLetter} ⟁`;

    // Dark navy blue watermark, lighter, recognizable but not overpowering opacity
    const tint = 'rgba(13, 34, 64, 0.22)';

    ctx.save();

    // Unique dynamic rotation based on site code length for a "Site-Specific" tilt
    const code = getSiteCode(siteName);
    const dynamicRotation = -25 - (code.length % 10); // Subtle variation between 25-35 degrees
    ctx.rotate(dynamicRotation * Math.PI / 180);

    ctx.font = 'bold 46px Inter'; // Larger watermark
    ctx.fillStyle = tint;

    // STAGGERED DIAMOND GRID: More unique and secure 
    const stepX = 360;
    const stepY = 160;

    for (let y = -CR80_H * 2; y < CR80_H * 3; y += stepY) {
        // Offset every second row for a diamond-flow pattern
        const xOffset = (Math.abs(y / stepY) % 2 === 0) ? 0 : stepX / 2;

        for (let x = -CR80_W * 2; x < CR80_W * 3; x += stepX) {
            ctx.fillText(watermarkText, x + xOffset, y);
        }
    }
    ctx.restore();
}

async function renderCard() {
    const data = getFormData();
    const ctx = idCard.getContext('2d');

    // Set canvas to 2x pixel resolution for high-DPI print quality
    idCard.width = CR80_W * PRINT_SCALE;
    idCard.height = CR80_H * PRINT_SCALE;
    ctx.scale(PRINT_SCALE, PRINT_SCALE); // All coordinates stay the same, just rendered at 2x pixels

    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, CR80_W, CR80_H);
    drawWatermark(ctx);

    ctx.strokeStyle = '#000000'; ctx.lineWidth = 14;
    // Draw the border inset by 15px on all sides to prevent edge clipping during print
    ctx.strokeRect(15, 15, CR80_W - 30, CR80_H - 30);

    // Header Background Box Setup (Aesthetic ID card structure)
    ctx.fillStyle = '#f0f4f8';
    ctx.fillRect(15, 15, CR80_W - 30, 110);
    ctx.beginPath();
    ctx.moveTo(15, 125);
    ctx.lineTo(CR80_W - 15, 125);
    ctx.stroke();

    ctx.textAlign = 'center'; ctx.font = '800 66px Inter'; ctx.fillStyle = '#1a3c6e';
    // Constrain the contractor name max-width to 720px so it never collides with the 150px LC block on the right edge
    ctx.fillText(data.contractor.toUpperCase(), CR80_W / 2, 90, 720);

    ctx.textAlign = 'right'; ctx.font = 'bold 46px Inter';
    if (data.laborCamp === 'LC') {
        // Draw a solid black box for the LC badge in top right corner to make it very distinct
        ctx.fillStyle = '#000000';
        ctx.fillRect(CR80_W - 165, 15, 150, 110);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('LC', CR80_W - 65, 90);
    }

    const phY = 160, phW = 435, phH = 575, phX = (CR80_W - phW) / 2;
    if (capturedPhotoDataURL) {
        const ph = await loadImage(capturedPhotoDataURL);
        ctx.save();
        ctx.beginPath(); ctx.roundRect(phX, phY, phW, phH, 15); ctx.clip();
        ctx.drawImage(ph, phX, phY, phW, phH);
        ctx.restore();

        // Add border to photo itself for more structure
        ctx.strokeStyle = '#e2e8f0';
        ctx.lineWidth = 4;
        ctx.strokeRect(phX, phY, phW, phH);
    }

    ctx.textAlign = 'center'; ctx.fillStyle = '#0d2240';
    ctx.font = 'bold 58px Inter'; ctx.fillText(data.fullName.toUpperCase(), CR80_W / 2, phY + phH + 85);

    // Role styling upgrade - badge style text
    ctx.font = '800 44px Inter'; ctx.fillStyle = '#000000'; // Reverted to bold black
    ctx.fillText(data.designation.toUpperCase(), CR80_W / 2, phY + phH + 150);

    // Separator line before details
    ctx.strokeStyle = '#cbd5e1'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(65, phY + phH + 200); ctx.lineTo(CR80_W - 65, phY + phH + 200); ctx.stroke();

    const ty = phY + phH + 265;
    const items = [
        { l: 'AADHAR', v: data.aadhar, x: 65 }, { l: 'GENDER', v: data.gender, x: 620 },
        { l: 'D.O.B-AGE', v: `${formatDate(data.dob)}-${data.age}y`, x: 65 }, { l: 'BLOOD GROUP', v: data.bloodGroup, x: 620 },
        { l: 'D.O.I', v: formatDate(data.doi), x: 65 }, { l: 'VALIDITY', v: formatDate(data.validity), x: 620 },
        { l: 'ISSUE DATE', v: formatDate(data.issueDate), x: 65 }, { l: 'CONTACT', v: data.contact, x: 620 }
    ];

    ctx.textAlign = 'left';
    items.forEach((item, i) => {
        const row = Math.floor(i / 2);
        const yCoord = ty + (row * 130);

        ctx.font = 'bold 36px Inter'; ctx.fillStyle = '#334155';
        ctx.fillText(item.l, item.x, yCoord);
        ctx.font = '800 58px Inter'; ctx.fillStyle = '#000000'; ctx.fillText(item.v, item.x, yCoord + 55);

        if (i % 2 === 0 && row < 3) {
            ctx.strokeStyle = '#f1f5f9'; ctx.lineWidth = 3;
            ctx.beginPath(); ctx.moveTo(65, yCoord + 80); ctx.lineTo(CR80_W - 65, yCoord + 80); ctx.stroke();
        }
    });
}

function showToast(msg, type = 'warning') {
    const container = document.getElementById('toastContainer');
    if (!container) return console.warn('Toast container not found');
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    toast.textContent = msg;
    container.appendChild(toast);
    requestAnimationFrame(() => toast.classList.add('toast-visible'));
    setTimeout(() => {
        toast.classList.remove('toast-visible');
        setTimeout(() => toast.remove(), 400);
    }, 5000);
}

async function saveToBackend() {
    if (isSaving || isSaved) return;
    isSaving = true;

    const data = getFormData();
    data.photoPath = capturedCloudDataURL || capturedPhotoDataURL;
    data.site = operator.site || '';
    data.operator = operator.name || '';

    console.log('--- Submission Request Start ---');
    console.log('Sending data to backend for:', data.fullName);

    try {
        const resp = await fetch(`${API_BASE}/api/save-employee`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json();

        isSaved = true;

        if (result.warnings && result.warnings.length > 0) {
            console.warn('Backend warnings:', result.warnings);
            showToast('⚠ Warning: ' + result.warnings[0], 'warning');
        } else {
            console.log('Saved to backend success:', result);
        }
    } catch (err) {
        console.error('Backend save failed:', err.message);
        showToast('⚠ Record not saved to cloud, but card generated locally.', 'warning');
        isSaved = true;
    } finally {
        isSaving = false;
        console.log('--- Submission Request End ---');
    }
}

function updateBatchUI() {
    batchList.innerHTML = '';
    batchQueue.forEach((item, idx) => {
        const wrapper = document.createElement('div');
        wrapper.className = 'batch-item-wrapper';
        wrapper.onclick = () => showEnlargedPreview(idx);

        const img = new Image();
        img.src = item.snap;
        img.className = 'batch-item';

        const removeBtn = document.createElement('button');
        removeBtn.className = 'btn-remove-batch';
        removeBtn.innerHTML = '&times;';
        removeBtn.onclick = (e) => {
            e.stopPropagation();
            removeFromBatch(idx);
        };

        wrapper.appendChild(img);
        wrapper.appendChild(removeBtn);
        batchList.appendChild(wrapper);
    });

    try {
        localStorage.setItem('ep_batch', JSON.stringify(batchQueue));
    } catch (e) {
        console.warn('Batch too large for localStorage, keeping in memory only.');
    }
    document.querySelector('.batch-card .section-title').textContent = `Batch Queue (${batchQueue.length}/9)`;
    btnPrintBatch.disabled = batchQueue.length === 0;

    // Update layout state if batch exists but we are not in preview
    const mainMain = document.querySelector('.app-main');
    if (batchQueue.length > 0 && mainMain.classList.contains('layout-initial')) {
        mainMain.classList.remove('layout-initial');
        mainMain.classList.add('layout-batch');
    } else if (batchQueue.length === 0 && mainMain.classList.contains('layout-batch')) {
        mainMain.classList.remove('layout-batch');
        mainMain.classList.add('layout-initial');
    }

    // Pre-populate print area for instant printing
    updatePrintArea();
}

function removeFromBatch(idx) {
    batchQueue.splice(idx, 1);
    batchPrintQueue.splice(idx, 1);
    updateBatchUI();
}

function showEnlargedPreview(idx) {
    const item = batchPrintQueue[idx] || batchQueue[idx];
    if (!item) return;
    document.getElementById('enlargedImg').src = item.snap;
    document.getElementById('previewModal').style.display = 'flex';
    document.getElementById('btnDownloadEnlarged').onclick = () => {
        const link = document.createElement('a');
        link.download = `Batch_Pass_${idx + 1}.png`;
        link.href = item.snap;
        link.click();
    };
}

function updatePrintArea() {
    batchPrintArea.innerHTML = '';
    const printSource = batchPrintQueue.length > 0 ? batchPrintQueue : batchQueue;
    printSource.forEach(item => {
        const img = new Image();
        img.src = item.snap;
        batchPrintArea.appendChild(img);
    });
}

function nextEntry() {
    passForm.reset();
    ageInput.value = '';

    document.getElementById('contractor').value = '';
    document.getElementById('laborCamp').value = '';
    document.getElementById('designation').value = '';
    document.getElementById('contact').value = '';
    document.getElementById('doi').value = '';
    document.getElementById('validity').value = '';
    document.getElementById('issueDate').value = '';

    capturedPhotoDataURL = null;
    capturedCloudDataURL = null;
    video.style.display = 'none';
    croppedPhoto.style.display = 'none';
    photoPlaceholder.style.display = 'flex';
    if (canvasEmpty) canvasEmpty.style.display = 'flex';
    idCard.style.display = 'none';
    previewActions.style.display = 'none';
    const bottomActions = document.getElementById('bottomActions');
    if (bottomActions) bottomActions.style.display = 'none';
    btnNextEntry.style.display = 'inline-flex';
    btnAddToBatch.style.display = 'inline-flex';

    setDefaultDates();

    isSaved = false;
    isInBatch = false;

    btnStart.style.display = 'inline-flex';
    btnStart.textContent = 'Turn On Camera';
    btnCapture.style.display = 'none';
    btnRetake.style.display = 'none';
    btnGenerate.style.display = 'none';

    const mainMain = document.querySelector('.app-main');
    mainMain.classList.remove('layout-preview');
    if (batchQueue.length > 0) {
        mainMain.classList.remove('layout-initial');
        mainMain.classList.add('layout-batch');
    } else {
        mainMain.classList.add('layout-initial');
    }

    goToStep(1);
}

// ------ SITE RECORDS FOR OPERATORS ------
async function loadSiteRecords() {
    const site = operator.site;
    if (!site) return;

    document.getElementById('siteRecordsTitle').textContent = site;
    document.getElementById('recordsModal').style.display = 'flex';
    const tbody = document.getElementById('siteRecordsBody');
    tbody.innerHTML = '<tr><td colspan="15" style="text-align:center; padding:2rem;">Loading records...</td></tr>';

    try {
        const resp = await fetch(`${API_BASE}/api/employees?site=${encodeURIComponent(site)}`);
        const records = await resp.json();
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="15" style="text-align:center; padding:2rem; color:var(--text-light);">No records found for this site.</td></tr>';
            return;
        }

        records.forEach(r => {
            const photoSrc = r.photoPath ? (r.photoPath.startsWith('http') ? r.photoPath : `${API_BASE}/${r.photoPath.replace(/\\/g, '/')}`) : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${photoSrc ? `<img src="${photoSrc}" style="width:40px; height:50px; border-radius:4px; object-fit:cover;" />` : 'N/A'}</td>
                <td>${r.fullName || '---'}</td>
                <td>${r.aadhar || '---'}</td>
                <td>${r.age || '---'}</td>
                <td>${r.gender || '---'}</td>
                <td>${formatDate(r.dob)}</td>
                <td>${r.bloodGroup || '---'}</td>
                <td>${r.contractor || '---'}</td>
                <td>${r.laborCamp || '---'}</td>
                <td>${r.designation || '---'}</td>
                <td>${r.contact || '---'}</td>
                <td>${r.operator || '---'}</td>
                <td>${formatDate(r.doi)}</td>
                <td>${formatDate(r.validity)}</td>
                <td>${formatDate(r.issueDate)}</td>`;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Failed to load site records:', err);
        tbody.innerHTML = '<tr><td colspan="15" style="text-align:center; padding:2rem; color:red;">Error loading records.</td></tr>';
    }
}

function exportSiteToExcel() {
    const table = document.getElementById('siteRecordsTable');
    const rows = table.querySelectorAll('tr');
    const SKIP_COLS = new Set([0]);
    let csv = '';

    rows.forEach(row => {
        const cells = row.querySelectorAll('th, td');
        const rowData = [];
        cells.forEach((cell, idx) => {
            if (SKIP_COLS.has(idx)) return;
            rowData.push('"' + cell.textContent.replace(/"/g, '""').trim() + '"');
        });
        csv += rowData.join(',') + '\n';
    });

    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = `SiteRecords_${operator.site.replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
    link.click();
}

document.addEventListener('DOMContentLoaded', () => {
    initSession();

    const btnViewRecords = document.getElementById('btnViewRecords');
    const btnExportSiteExcel = document.getElementById('btnExportSiteExcel');
    const closeRecords = document.getElementById('closeRecords');

    if (btnViewRecords) btnViewRecords.onclick = loadSiteRecords;
    if (btnExportSiteExcel) btnExportSiteExcel.onclick = exportSiteToExcel;
    if (closeRecords) closeRecords.onclick = () => document.getElementById('recordsModal').style.display = 'none';

    dobInput.onchange = () => {
        const b = new Date(dobInput.value), t = new Date();
        let a = t.getFullYear() - b.getFullYear();
        if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
        const finalAge = a > 0 ? a : 0;
        ageInput.value = finalAge;

        if (finalAge < 18 && dobInput.value) {
            ageInput.style.color = '#ef4444';
            ageInput.style.borderColor = '#ef4444';
        } else {
            ageInput.style.color = '';
            ageInput.style.borderColor = '';
        }
    };

    btnToStep2.onclick = () => { const v = validateStep(1); v === true ? goToStep(2) : showAlert(v); };
    btnToStep3.onclick = () => { const v = validateStep(2); v === true ? goToStep(3) : showAlert(v); };
    btnBackTo1.onclick = () => goToStep(1);
    btnBackTo2.onclick = () => goToStep(2);

    btnStart.onclick = startCamera;
    btnCapture.onclick = capturePhoto;
    btnRetake.onclick = () => {
        capturedPhotoDataURL = null;
        btnGenerate.style.display = 'none';
        startCamera();
    };

    btnGenerate.onclick = async () => {
        const v1 = validateStep(1); if (v1 !== true) return (goToStep(1), showAlert(v1));
        const v2 = validateStep(2); if (v2 !== true) return (goToStep(2), showAlert(v2));
        if (!capturedPhotoDataURL) return showAlert("Photo required.");

        btnGenerate.disabled = true;
        btnGenerate.textContent = 'Checking...';

        const data = getFormData();
        const dup = await checkDuplicate(data.aadhar, data.contact);
        if (dup) {
            const proceed = await showDuplicateConfirm(dup);
            if (!proceed) {
                btnGenerate.disabled = false;
                btnGenerate.textContent = 'Generate Pass';
                return;
            }
        }

        btnGenerate.textContent = 'Rendering...';
        await renderCard();

        // Reveal Preview and adjust layout
        const mainMain = document.querySelector('.app-main');
        mainMain.classList.remove('layout-initial', 'layout-batch');
        mainMain.classList.add('layout-preview');
        idCard.style.display = 'block';
        previewActions.style.display = 'flex';
        const bottomActions = document.getElementById('bottomActions');
        if (bottomActions) bottomActions.style.display = 'flex';

        btnGenerate.disabled = false;
        btnGenerate.textContent = 'Generate Pass';

        saveToBackend();
    };

    btnDownload.onclick = () => {
        const siteCode = (SITE_CONFIG[operator.site]?.code || operator.site.toUpperCase()).substring(0, 5);
        const d = getFormData();
        const link = document.createElement('a');
        link.download = `ENTRY_PASS_${siteCode}_${d.fullName.replace(/\s+/g, '_').toUpperCase()}.png`;
        link.href = idCard.toDataURL('image/png'); link.click();
        // Attempt save in background if not already done
        if (!isSaved) saveToBackend();
    };

    btnPrint.onclick = () => {
        document.getElementById('printImg').src = idCard.toDataURL('image/png');
        window.print();
        // Attempt save in background if not already done
        if (!isSaved) saveToBackend();
    };

    btnAddToBatch.onclick = () => {
        if (isInBatch) {
            return showAlert("This card is already added to the batch! Move to 'Next Entry'.");
        }
        if (batchQueue.length >= 9) return showAlert('Batch full.');

        // Store high-quality proxy for batch grid preview and localStorage
        const proxyCanvas = document.createElement('canvas');
        proxyCanvas.width = CR80_W;
        proxyCanvas.height = CR80_H;
        const pCtx = proxyCanvas.getContext('2d');
        pCtx.drawImage(idCard, 0, 0, proxyCanvas.width, proxyCanvas.height);
        batchQueue.push({ snap: proxyCanvas.toDataURL('image/jpeg', 0.92) });

        // Store FULL RESOLUTION PNG for actual printing (in-memory only, never touches localStorage)
        batchPrintQueue.push({ snap: idCard.toDataURL('image/png') });

        isInBatch = true;
        updateBatchUI();
        btnAddToBatch.style.display = 'none';

        // Attempt save in background if not already done
        if (!isSaved) saveToBackend();

        // Auto-prompt when batch is full (9 cards)
        if (batchQueue.length >= 9) {
            showBatchFullAlert();
        }
    };

    btnNextEntry.onclick = nextEntry;
    btnClearBatch.onclick = () => {
        if (confirm("Clear all items in batch?")) {
            batchQueue = []; batchPrintQueue = []; updateBatchUI();
        }
    };
    btnPrintBatch.onclick = () => {
        // Area is already pre-populated by updateBatchUI/updatePrintArea
        window.print();
    };

    document.getElementById('closePreview').onclick = () => {
        document.getElementById('previewModal').style.display = 'none';
    };

    // Print Batch button inside the batch-full alert modal
    const alertPrintBtn = document.getElementById('alertPrintBatch');
    if (alertPrintBtn) {
        alertPrintBtn.onclick = () => {
            document.getElementById('customAlert').style.display = 'none';
            // Trigger batch print
            btnPrintBatch.click();
            // Clear batch after a short delay so the print dialog opens first
            setTimeout(() => {
                batchQueue = [];
                batchPrintQueue = [];
                updateBatchUI();

                // Restore current card's buttons so it doesn't get lost
                isInBatch = false;
                btnAddToBatch.style.display = 'inline-flex';
            }, 1000);
        };
    }
});

function showAlert(msg) {
    document.getElementById('alertMessage').textContent = msg;
    // Hide print batch button in normal alerts
    const printBtn = document.getElementById('alertPrintBatch');
    if (printBtn) printBtn.style.display = 'none';
    document.getElementById('customAlert').style.display = 'flex';
}

function showBatchFullAlert() {
    document.getElementById('alertMessage').textContent = 'Batch is full (9/9)! Print the batch and clear it before adding more cards.';
    // Show print batch button in batch-full alert
    const printBtn = document.getElementById('alertPrintBatch');
    if (printBtn) printBtn.style.display = 'inline-flex';
    document.getElementById('customAlert').style.display = 'flex';
}

// ── Duplicate Detection Logic ────────────────────────────────────────────────
async function checkDuplicate(aadhar, contact) {
    try {
        const resp = await fetch(`${API_BASE}/api/check-duplicate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ aadhar, contact })
        });
        const result = await resp.json();
        return result.duplicate ? result : null;
    } catch (e) {
        console.error('Duplicate check error:', e);
        return null; // Fail safe
    }
}

function showDuplicateConfirm(dupData) {
    return new Promise((resolve) => {
        const modal = document.getElementById('duplicateModal');
        const msg = document.getElementById('duplicateMessage');
        const details = document.getElementById('existingRecordDetails');
        const btnCont = document.getElementById('btnContinueDuplicate');
        const btnCancel = document.getElementById('btnCancelDuplicate');

        const field = dupData.matchedOn === 'both' ? 'Aadhar & Phone Number' : (dupData.matchedOn === 'aadhar' ? 'Aadhar Number' : 'Phone Number');

        msg.innerHTML = `This <strong>${field}</strong> already exists in the system for another employee.`;

        details.innerHTML = `
            <div style="margin-bottom: 0.5rem;"><strong>Name:</strong> ${dupData.existing.fullName}</div>
            <div style="margin-bottom: 0.5rem;"><strong>Site:</strong> ${dupData.existing.site}</div>
            <div style="margin-bottom: 0.5rem;"><strong>Operator:</strong> ${dupData.existing.operator}</div>
            <div><strong>Date:</strong> ${formatDate(dupData.existing.createdAt)}</div>
        `;

        modal.style.display = 'flex';

        btnCont.onclick = () => {
            modal.style.display = 'none';
            resolve(true);
        };
        btnCancel.onclick = () => {
            modal.style.display = 'none';
            resolve(false);
        };
    });
}
