'use strict';

/**
 * ENTRY PASS – SECURE GENERATOR v2.0
 * 3-Step Carousel Logic (Personal → Employment → Photo)
 */

// 1. CONFIG & STATE
const CR80_W = 638;
const CR80_H = 1011;
// Dynamically find the backend on port 5000 even if frontend is on 3000
const API_BASE = window.location.protocol + '//' + window.location.hostname + ':5000';

const SITE_CONFIG = {
    'Grava': { tint: 'rgba(128,128,128,0.12)', code: 'GRAVA' },
    'Apas': { tint: 'rgba(0,123,255,0.12)', code: 'APAS' },
    'Vipina': { tint: 'rgba(220,53,69,0.12)', code: 'VIPINA' }
};

// Help sync lists from admin manage panel
const STORAGE_KEYS = { sites: 'ep_sites', contractors: 'ep_contractors', roles: 'ep_roles' };
const getStoredList = (key) => {
    const data = localStorage.getItem(STORAGE_KEYS[key]);
    return data ? JSON.parse(data) : [];
};
const seedDefaults = () => {
    if (getStoredList('sites').length === 0) localStorage.setItem(STORAGE_KEYS.sites, JSON.stringify(['Grava', 'Apas', 'Vipina']));
    if (getStoredList('contractors').length === 0) localStorage.setItem(STORAGE_KEYS.contractors, JSON.stringify(['KLC PVT LTD', 'Sri Infra Works', 'Reddy Constructions']));
    if (getStoredList('roles').length === 0) localStorage.setItem(STORAGE_KEYS.roles, JSON.stringify(['Worker', 'IT Engineer', 'MEP', 'Safety', 'Quality', 'Others']));
};
seedDefaults();

function populateDropdowns() {
    const sites = getStoredList('sites');
    const contractors = getStoredList('contractors');
    const roles = getStoredList('roles');

    const sSel = document.getElementById('siteSelect');
    const cSel = document.getElementById('contractor');
    const dSel = document.getElementById('designation');

    if (sSel) { sSel.innerHTML = '<option value="">Select Site</option>' + sites.map(s => `<option value="${s}">${s}</option>`).join(''); }
    if (cSel) { cSel.innerHTML = '<option value="">Select Contractor</option>' + contractors.map(c => `<option value="${c}">${c}</option>`).join(''); }
    if (dSel) { dSel.innerHTML = '<option value="">Select</option>' + roles.map(r => `<option value="${r}">${r}</option>`).join(''); }
}

window.addEventListener('storage', (e) => {
    if (Object.values(STORAGE_KEYS).includes(e.key)) {
        populateDropdowns();
    }
});

let operator = { name: '', site: '' };
let capturedPhotoDataURL = null;
let currentStep = 1;
let batchQueue = [];
let stream = null;
let isSaved = false; // Prevents duplicate saves for the same entry

// DOM
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

// 2. SESSION & LOGIN
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
        // Issue date is a text input, so we can format it immediately
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

// 3. UTILS
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
    const date = new Date(d);
    if (isNaN(date.getTime())) return d; // Return raw if invalid
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

// Validation
function validateStep(step) {
    const data = getFormData();
    if (step === 1) {
        if (!data.fullName || data.fullName.length < 3) return "Valid full name required.";
        if (data.aadhar.length !== 12 || isNaN(data.aadhar)) return "Aadhar must be 12 numeric digits.";
        if (!data.dob) return "Date of Birth required.";
        if (parseInt(data.age) < 18) return "Age must be >= 18.";
        if (!data.gender || !data.bloodGroup) return "Select gender and blood group.";
    }
    if (step === 2) {
        if (!data.contractor || !data.laborCamp || !data.designation) return "Select all employer fields.";
        if (data.contact.length !== 10 || isNaN(data.contact)) return "Contact must be 10 numeric digits.";
        if (!data.doi || !data.validity) return "DOI and Validity required.";
        if (new Date(data.validity) <= new Date(data.issueDate)) return "Validity must be in future.";
    }
    return true;
}

// 4. NAVIGATION
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

// 5. CAMERA
async function startCamera() {
    try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 800, height: 1000 } });
        video.srcObject = stream;
        video.style.display = 'block';
        photoPlaceholder.style.display = 'none';
        btnStart.disabled = true;
        btnCapture.disabled = false;
        btnRetake.style.display = 'none';
    } catch (err) { cameraError.textContent = 'Camera failed: ' + err.message; }
}

function capturePhoto() {
    if (!video.srcObject) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    // Set both to match camera exactly
    croppedPhoto.width = vw;
    croppedPhoto.height = vh;
    croppedPhoto.getContext('2d').drawImage(video, 0, 0, vw, vh);
    capturedPhotoDataURL = croppedPhoto.toDataURL('image/png');

    video.style.display = 'none';
    croppedPhoto.style.display = 'block';
    btnCapture.disabled = true;
    btnRetake.style.display = 'inline-flex';
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    btnStart.disabled = false;
}

// 6. RENDER
function drawWatermark(ctx) {
    const text = `${operator.site.toUpperCase()} – ENTRY PASS – ${new Date().getFullYear()}`;
    const tint = SITE_CONFIG[operator.site]?.tint || 'rgba(0,0,0,0.06)';
    ctx.save();
    ctx.rotate(-35 * Math.PI / 180);
    ctx.font = 'bold 24px Inter'; ctx.fillStyle = tint;
    for (let y = -CR80_H; y < CR80_H * 2; y += 100) {
        for (let x = -CR80_W; x < CR80_W * 2; x += 400) ctx.fillText(text, x, y);
    }
    ctx.restore();
}

async function renderCard() {
    const data = getFormData();
    const ctx = idCard.getContext('2d');
    idCard.width = CR80_W; idCard.height = CR80_H;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, CR80_W, CR80_H);
    drawWatermark(ctx);

    ctx.strokeStyle = '#0d2240'; ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, CR80_W - 4, CR80_H - 4);

    // Contractor Name (Bigger)
    ctx.textAlign = 'center'; ctx.font = 'bold 36px Inter'; ctx.fillStyle = '#1a3c6e';
    ctx.fillText(data.contractor.toUpperCase(), CR80_W / 2, 60);

    ctx.textAlign = 'right'; ctx.font = 'bold 22px Inter';
    if (data.laborCamp === 'LC') ctx.fillText('LC', CR80_W - 40, 50);

    const phY = 100, phW = 320, phH = 427, phX = (CR80_W - phW) / 2;
    if (capturedPhotoDataURL) {
        const ph = await loadImage(capturedPhotoDataURL);
        ctx.save();
        ctx.beginPath(); ctx.roundRect(phX, phY, phW, phH, 15); ctx.clip();
        // Draw the full captured photo into the frame, stretching if needed to fit the ID area
        ctx.drawImage(ph, phX, phY, phW, phH);
        ctx.restore();
    }

    // Name (Medium) and Designation (Small)
    ctx.textAlign = 'center'; ctx.fillStyle = '#0d2240';
    ctx.font = 'bold 38px Inter'; ctx.fillText(data.fullName.toUpperCase(), CR80_W / 2, phY + phH + 75);
    ctx.font = 'bold 24px Inter'; ctx.fillStyle = '#c8a45a';
    ctx.fillText(data.designation.toUpperCase(), CR80_W / 2, phY + phH + 115);

    const ty = phY + phH + 200;
    const items = [
        { l: 'AADHAR', v: data.aadhar, x: 50 }, { l: 'GENDER', v: data.gender, x: 350 },
        { l: 'DOB/AGE', v: `${formatDate(data.dob)} / ${data.age}`, x: 50 }, { l: 'BLOOD GRP', v: data.bloodGroup, x: 350 },
        { l: 'IND. DATE', v: formatDate(data.doi), x: 50 }, { l: 'VALIDITY', v: formatDate(data.validity), x: 350 },
        { l: 'ISSUE DATE', v: formatDate(data.issueDate), x: 50 }, { l: 'CONTACT', v: data.contact, x: 350 }
    ];

    ctx.textAlign = 'left';
    items.forEach((item, i) => {
        const row = Math.floor(i / 2);
        const yCoord = ty + (row * 68);
        ctx.font = '700 16px Inter'; ctx.fillStyle = '#64748b'; ctx.fillText(item.l, item.x, yCoord);
        ctx.font = '800 20px Inter'; ctx.fillStyle = '#111827'; ctx.fillText(item.v, item.x, yCoord + 28);
    });
}

async function saveToBackend() {
    const data = getFormData();
    data.photoPath = capturedPhotoDataURL;
    data.site = operator.site || '';
    data.operator = operator.name || '';

    console.log('Sending data to backend:', data);

    try {
        const resp = await fetch(`${API_BASE}/api/save-employee`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        const result = await resp.json();
        if (!resp.ok) throw new Error(result.error || 'Server error');
        console.log('Saved to backend success:', result);
    } catch (err) {
        console.error('Backend save failed:', err.message);
    }
}

// 7. BATCH
function updateBatchUI() {
    batchList.innerHTML = '';
    batchQueue.forEach(item => {
        const img = new Image(); img.src = item.snap; img.className = 'batch-item';
        batchList.appendChild(img);
    });
    localStorage.setItem('ep_batch', JSON.stringify(batchQueue)); // Persist batch
    document.querySelector('.batch-card .section-title').textContent = `Batch Queue (${batchQueue.length}/9)`;
    btnPrintBatch.disabled = batchQueue.length === 0;
}

function nextEntry() {
    passForm.reset(); ageInput.value = '';
    capturedPhotoDataURL = null; video.style.display = 'none';
    croppedPhoto.style.display = 'none'; photoPlaceholder.style.display = 'flex';
    if (canvasEmpty) canvasEmpty.style.display = 'flex';
    idCard.style.display = 'none';
    previewActions.style.display = 'none'; btnNextEntry.style.display = 'none';
    btnAddToBatch.style.display = 'inline-flex';

    setDefaultDates();

    isSaved = false;

    goToStep(1);
}

// 8. EVENTS
document.addEventListener('DOMContentLoaded', () => {
    initSession(); // Recover session on load

    dobInput.onchange = () => {
        const b = new Date(dobInput.value), t = new Date();
        let a = t.getFullYear() - b.getFullYear();
        if (t.getMonth() < b.getMonth() || (t.getMonth() === b.getMonth() && t.getDate() < b.getDate())) a--;
        const finalAge = a > 0 ? a : 0;
        ageInput.value = finalAge;

        // Visual feedback for under 18
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
    btnRetake.onclick = () => { capturedPhotoDataURL = null; startCamera(); };

    btnGenerate.onclick = async () => {
        // Final verification of all steps
        const v1 = validateStep(1); if (v1 !== true) return (goToStep(1), showAlert(v1));
        const v2 = validateStep(2); if (v2 !== true) return (goToStep(2), showAlert(v2));
        if (!capturedPhotoDataURL) return showAlert("Photo required.");

        btnGenerate.disabled = true;
        await renderCard();

        // Auto-save to database immediately on generation
        if (!isSaved) {
            await saveToBackend();
            isSaved = true;
        }

        if (canvasEmpty) canvasEmpty.style.display = 'none';
        idCard.style.display = 'block';
        previewActions.style.display = 'flex';
        btnGenerate.disabled = false;
    };

    btnDownload.onclick = async () => {
        const siteCode = (SITE_CONFIG[operator.site]?.code || operator.site.toUpperCase()).substring(0, 5);
        if (!isSaved) { await saveToBackend(); isSaved = true; }
        const d = getFormData();
        const link = document.createElement('a');
        link.download = `ENTRY_PASS_${siteCode}_${d.fullName.replace(/\s+/g, '_').toUpperCase()}.png`;
        link.href = idCard.toDataURL('image/png'); link.click();
    };

    btnPrint.onclick = async () => {
        if (!isSaved) { await saveToBackend(); isSaved = true; }
        document.getElementById('printImg').src = idCard.toDataURL('image/png');
        window.print();
    };

    btnAddToBatch.onclick = async () => {
        if (batchQueue.length >= 9) return showAlert('Batch full.');

        // Save to backend before adding to batch if not already saved
        if (!isSaved) {
            await saveToBackend();
            isSaved = true;
        }

        batchQueue.push({ snap: idCard.toDataURL('image/png') });
        updateBatchUI();
        btnAddToBatch.style.display = 'none'; btnNextEntry.style.display = 'inline-flex';
    };

    btnNextEntry.onclick = nextEntry;
    btnClearBatch.onclick = () => { batchQueue = []; updateBatchUI(); };
    btnPrintBatch.onclick = () => {
        batchPrintArea.innerHTML = '';
        const promises = batchQueue.map(item => {
            return new Promise((res) => {
                const img = new Image();
                img.onload = res;
                img.src = item.snap;
                batchPrintArea.appendChild(img);
            });
        });
        Promise.all(promises).then(() => {
            setTimeout(() => window.print(), 500); // Small buffer for rendering
        });
    };

    // Modal Controls
    document.getElementById('closeAlert').onclick = () => {
        document.getElementById('customAlert').style.display = 'none';
    };
});

function showAlert(msg) {
    document.getElementById('alertMessage').textContent = msg;
    document.getElementById('customAlert').style.display = 'flex';
}
