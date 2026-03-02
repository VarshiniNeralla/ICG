'use strict';

const CR80_W = 638;
const CR80_H = 1011;
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
let isSaved = false;
let isInBatch = false;
let isSaving = false; // Submission lock to prevent duplicates

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
    const date = new Date(d);
    if (isNaN(date.getTime())) return d; // Return raw if invalid
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
};

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
        btnStart.disabled = true;
        btnCapture.disabled = false;
        btnRetake.style.display = 'none';
    } catch (err) { cameraError.textContent = 'Camera failed: ' + err.message; }
}

function capturePhoto() {
    if (!video.srcObject) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    croppedPhoto.width = vw;
    croppedPhoto.height = vh;
    croppedPhoto.getContext('2d').drawImage(video, 0, 0, vw, vh);
    // Compress to JPEG (0.7 quality) to save significant KB
    capturedPhotoDataURL = croppedPhoto.toDataURL('image/jpeg', 0.7);

    video.style.display = 'none';
    croppedPhoto.style.display = 'block';
    btnCapture.disabled = true;
    btnRetake.style.display = 'inline-flex';
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    btnStart.disabled = false;
}

function drawWatermark(ctx) {
    const siteName = operator.site || "UNKNOWN";
    const code = getSiteCode(siteName);
    const [seg1, seg2] = getSiteSegments(code);
    const watermarkText = `⟁ ${seg1} ⟡ ${seg2} ⟁`;

    // Increased visibility to 12% (0.12) as requested
    const baseColor = SITE_CONFIG[siteName]?.tint || 'rgba(0,0,0,0.12)';
    const tint = baseColor.replace(/[\d.]+\)$/g, '0.12)');

    ctx.save();

    // Unique dynamic rotation based on site code length for a "Site-Specific" tilt
    const dynamicRotation = -25 - (code.length % 10); // Subtle variation between 25-35 degrees
    ctx.rotate(dynamicRotation * Math.PI / 180);

    ctx.font = 'bold 22px Inter';
    ctx.fillStyle = tint;

    // STAGGERED DIAMOND GRID: More unique and secure 
    const stepX = 420;
    const stepY = 120;

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
    idCard.width = CR80_W; idCard.height = CR80_H;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, CR80_W, CR80_H);
    drawWatermark(ctx);

    ctx.strokeStyle = '#0d2240'; ctx.lineWidth = 4;
    ctx.strokeRect(2, 2, CR80_W - 4, CR80_H - 4);

    ctx.textAlign = 'center'; ctx.font = 'bold 36px Inter'; ctx.fillStyle = '#1a3c6e';
    ctx.fillText(data.contractor.toUpperCase(), CR80_W / 2, 60);

    ctx.textAlign = 'right'; ctx.font = 'bold 22px Inter';
    if (data.laborCamp === 'LC') ctx.fillText('LC', CR80_W - 40, 50);

    const phY = 100, phW = 320, phH = 427, phX = (CR80_W - phW) / 2;
    if (capturedPhotoDataURL) {
        const ph = await loadImage(capturedPhotoDataURL);
        ctx.save();
        ctx.beginPath(); ctx.roundRect(phX, phY, phW, phH, 15); ctx.clip();
        ctx.drawImage(ph, phX, phY, phW, phH);
        ctx.restore();
    }

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
    if (isSaving || isSaved) return; // Prevention lock
    isSaving = true;
    isSaved = true; // Mark as saved immediately to prevent other buttons from triggering it

    const data = getFormData();
    data.photoPath = capturedPhotoDataURL;
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
        if (!resp.ok) {
            isSaved = false; // Back to false on error 
            throw new Error(result.error || 'Server error');
        }
        console.log('Saved to backend success:', result);
    } catch (err) {
        isSaved = false; // Allow retry on failure
        console.error('Backend save failed:', err.message);
        showAlert("Save failed: " + err.message);
    } finally {
        isSaving = false;
        console.log('--- Submission Request End ---');
    }
}

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
    passForm.reset();
    ageInput.value = '';

    // Clear Step 2 fields manually (not in passForm)
    document.getElementById('contractor').value = '';
    document.getElementById('laborCamp').value = '';
    document.getElementById('designation').value = '';
    document.getElementById('contact').value = '';
    document.getElementById('doi').value = '';
    document.getElementById('validity').value = '';
    document.getElementById('issueDate').value = '';

    capturedPhotoDataURL = null;
    video.style.display = 'none';
    croppedPhoto.style.display = 'none';
    photoPlaceholder.style.display = 'flex';
    if (canvasEmpty) canvasEmpty.style.display = 'flex';
    idCard.style.display = 'none';
    previewActions.style.display = 'none';
    btnNextEntry.style.display = 'none';
    btnAddToBatch.style.display = 'inline-flex';

    setDefaultDates();

    isSaved = false;
    isInBatch = false;

    goToStep(1);
}

document.addEventListener('DOMContentLoaded', () => {
    initSession();

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
    btnRetake.onclick = () => { capturedPhotoDataURL = null; startCamera(); };

    btnGenerate.onclick = async () => {
        const v1 = validateStep(1); if (v1 !== true) return (goToStep(1), showAlert(v1));
        const v2 = validateStep(2); if (v2 !== true) return (goToStep(2), showAlert(v2));
        if (!capturedPhotoDataURL) return showAlert("Photo required.");

        btnGenerate.disabled = true;
        btnGenerate.textContent = 'Rendering...';

        await renderCard();

        // Show buttons immediately so the user can download/print while it saves in background
        if (canvasEmpty) canvasEmpty.style.display = 'none';
        idCard.style.display = 'block';
        previewActions.style.display = 'flex';
        btnGenerate.textContent = 'Saving to Cloud...';

        if (!isSaved) {
            await saveToBackend();
        }

        btnGenerate.disabled = false;
        btnGenerate.textContent = 'Generate Pass';
    };

    btnDownload.onclick = async () => {
        const siteCode = (SITE_CONFIG[operator.site]?.code || operator.site.toUpperCase()).substring(0, 5);
        if (!isSaved) await saveToBackend();
        if (!isSaved) return; // Don't download if save failed
        const d = getFormData();
        const link = document.createElement('a');
        link.download = `ENTRY_PASS_${siteCode}_${d.fullName.replace(/\s+/g, '_').toUpperCase()}.png`;
        link.href = idCard.toDataURL('image/png'); link.click();
    };

    btnPrint.onclick = async () => {
        if (!isSaved) await saveToBackend();
        if (!isSaved) return;
        document.getElementById('printImg').src = idCard.toDataURL('image/png');
        window.print();
    };

    btnAddToBatch.onclick = async () => {
        if (isInBatch) {
            return showAlert("This card is already added to the batch! Move to 'Next Entry'.");
        }
        if (batchQueue.length >= 9) return showAlert('Batch full.');

        if (!isSaved) {
            await saveToBackend();
        }
        if (!isSaved) return;

        batchQueue.push({ snap: idCard.toDataURL('image/png') });
        isInBatch = true;
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
            setTimeout(() => window.print(), 500);
        });
    };

    document.getElementById('closeAlert').onclick = () => {
        document.getElementById('customAlert').style.display = 'none';
    };
});

function showAlert(msg) {
    document.getElementById('alertMessage').textContent = msg;
    document.getElementById('customAlert').style.display = 'flex';
}
