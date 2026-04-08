'use strict';

const CR80_W = 1100;
const CR80_H = 1500;
const PRINT_SCALE = 2;
const API_BASE = (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    ? 'http://localhost:5000'
    : window.location.origin;

const SITE_CONFIG = {
    'Grava': { tint: 'rgba(128,128,128,0.07)', code: 'GRAVA' },
    'Apas': { tint: 'rgba(0,123,255,0.07)', code: 'APAS' },
    'Vipina': { tint: 'rgba(220,53,69,0.07)', code: 'VIPINA' }
};

// HTML escape helper to prevent XSS
function esc(str) { const d = document.createElement('div'); d.textContent = str || ''; return d.innerHTML; }

// Auth header helper
function authHeaders(extra = {}) {
    const headers = { ...extra };
    if (operator.token) headers['Authorization'] = `Bearer ${operator.token}`;
    return headers;
}

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

setInterval(populateDropdowns, 30000);
document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
        populateDropdowns();
    }
});

window.addEventListener('beforeunload', (e) => {
    if (batchQueue && batchQueue.length > 0) {
        e.preventDefault();
        e.returnValue = '';
    }
});

let operator = { name: '', site: '' };
let capturedPhotoDataURL = null;
let currentStep = 1;
let batchQueue = [];       // Each item: { preview: jpegDataURL, print: pngDataURL }
let stream = null;
let isSaved = false;
let isInBatch = false;
let isSaving = false;
let capturedCloudDataURL = null;

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

const usernameInput = document.getElementById('username');
const passwordInput = document.getElementById('password');
const loginSiteDisplay = document.getElementById('loginSiteDisplay');

const getSiteFromUser = (user) => {
    if (!user || !user.startsWith('CSO-')) return null;
    return user.replace('CSO-', '');
};

if (usernameInput) {
    usernameInput.onchange = () => {
        const site = getSiteFromUser(usernameInput.value);
        if (site) {
            loginSiteDisplay.textContent = `Selected site is : ${site}`;
        } else {
            loginSiteDisplay.textContent = '';
        }
    };
}

const btnTogglePassword = document.getElementById('togglePassword');
const eyeIcon = document.getElementById('eyeIcon');
if (btnTogglePassword) {
    btnTogglePassword.onclick = () => {
        const type = passwordInput.getAttribute('type') === 'password' ? 'text' : 'password';
        passwordInput.setAttribute('type', type);

        if (type === 'text') {
            eyeIcon.style.color = 'var(--primary)';
        } else {
            eyeIcon.style.color = 'var(--text-light)';
        }
    };
}

function initSession() {
    const savedOp = localStorage.getItem('ep_operator');
    if (savedOp) {
        try {
            operator = JSON.parse(savedOp);
            operatorInfo.innerHTML = `Site: <strong>${esc(operator.site)}</strong> | Op: <strong>${esc(operator.name)}</strong>`;
            loginScreen.style.display = 'none';
            mainApp.style.display = 'block';
            setDefaultDates();
        } catch {
            console.warn('Corrupted operator session data, clearing.');
            localStorage.removeItem('ep_operator');
        }
    }
    const savedBatch = localStorage.getItem('ep_batch');
    if (savedBatch) {
        try {
            batchQueue = JSON.parse(savedBatch);
            updateBatchUI();
        } catch {
            console.warn('Corrupted batch data, clearing.');
            localStorage.removeItem('ep_batch');
        }
    }
    populateDropdowns();
}

loginForm.onsubmit = async (e) => {
    e.preventDefault();
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const site = getSiteFromUser(username);

    if (!site) {
        showAlert('Invalid Username format. Please select from the dropdown.');
        return;
    }

    try {
        const resp = await fetch(`${API_BASE}/api/auth/operator`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const result = await resp.json();
        if (!resp.ok) {
            showAlert(result.error || 'Invalid credentials.');
            return;
        }

        operator = { name: username, site: site, token: result.token };
        localStorage.setItem('ep_operator', JSON.stringify(operator));
        operatorInfo.innerHTML = `Site: <strong>${esc(site)}</strong> | Op: <strong>${esc(username)}</strong>`;
        loginScreen.style.display = 'none';
        mainApp.style.display = 'block';
        setDefaultDates();
    } catch (err) {
        showAlert('Login failed. Please check your connection and try again.');
    }
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
    if (typeof d === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(d)) return d;

    const date = new Date(d);
    if (isNaN(date.getTime())) return d;
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
        // Stop any existing stream before requesting a new one
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
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
    const fullQualityDataURL = croppedPhoto.toDataURL('image/jpeg', 0.95);
    const cloudDataURL = croppedPhoto.toDataURL('image/jpeg', 0.5);
    capturedPhotoDataURL = fullQualityDataURL;
    capturedCloudDataURL = cloudDataURL;

    video.style.display = 'none';
    croppedPhoto.style.display = 'block';
    btnCapture.style.display = 'none';
    btnRetake.style.display = 'inline-flex';
    btnGenerate.style.display = 'inline-flex';
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    btnStart.style.display = 'none';
}

function drawWatermark(ctx) {
    const siteName = operator.site || "UNKNOWN";
    const firstLetter = siteName.charAt(0).toUpperCase();
    const lastLetter = siteName.charAt(siteName.length - 1).toUpperCase();
    const watermarkText = `⟁ ${firstLetter} ✦ ${lastLetter} ⟁`;

    const tint = 'rgba(13, 34, 64, 0.22)';

    ctx.save();
    const code = getSiteCode(siteName);
    const dynamicRotation = -25 - (code.length % 10);
    ctx.rotate(dynamicRotation * Math.PI / 180);

    ctx.font = 'bold 46px Inter';
    ctx.fillStyle = tint;
    const stepX = 360;
    const stepY = 160;

    for (let y = -CR80_H * 2; y < CR80_H * 3; y += stepY) {
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

    idCard.width = CR80_W * PRINT_SCALE;
    idCard.height = CR80_H * PRINT_SCALE;
    ctx.scale(PRINT_SCALE, PRINT_SCALE);

    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, CR80_W, CR80_H);
    drawWatermark(ctx);

    ctx.strokeStyle = '#000000'; ctx.lineWidth = 14;
    ctx.strokeRect(15, 15, CR80_W - 30, CR80_H - 30);

    ctx.fillStyle = '#f0f4f8';
    ctx.fillRect(15, 15, CR80_W - 30, 110);
    ctx.beginPath();
    ctx.moveTo(15, 125);
    ctx.lineTo(CR80_W - 15, 125);
    ctx.stroke();

    ctx.textAlign = 'center'; ctx.font = '800 66px Inter'; ctx.fillStyle = '#1a3c6e';
    ctx.fillText(data.contractor.toUpperCase(), CR80_W / 2, 90, 720);

    ctx.textAlign = 'right'; ctx.font = 'bold 46px Inter';
    if (data.laborCamp === 'LC') {
        ctx.fillStyle = '#000000';
        ctx.fillRect(CR80_W - 165, 15, 150, 110);
        ctx.fillStyle = '#FFFFFF';
        ctx.fillText('LC', CR80_W - 65, 90);
    }

    const phY = 160, phW = 435, phH = 575, phX = (CR80_W - phW) / 2;
    if (capturedPhotoDataURL) {
        try {
            const ph = await loadImage(capturedPhotoDataURL);
            ctx.save();
            ctx.beginPath(); ctx.roundRect(phX, phY, phW, phH, 15); ctx.clip();
            ctx.drawImage(ph, phX, phY, phW, phH);
            ctx.restore();

            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 4;
            ctx.strokeRect(phX, phY, phW, phH);
        } catch {
            console.warn('Photo load failed, rendering card without photo.');
        }
    }

    ctx.textAlign = 'center'; ctx.fillStyle = '#0d2240';
    ctx.font = 'bold 58px Inter'; ctx.fillText(data.fullName.toUpperCase(), CR80_W / 2, phY + phH + 85);

    ctx.font = '800 44px Inter'; ctx.fillStyle = '#000000';
    ctx.fillText(data.designation.toUpperCase(), CR80_W / 2, phY + phH + 150);

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
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify(data)
        });
        if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
        const result = await resp.json();

        isSaved = true;

        if (result.warnings && result.warnings.length > 0) {
            console.warn('Backend warnings:', result.warnings);
            showToast('⚠ Warning: ' + result.warnings[0], 'warning');
        } else {
            showToast('Record saved successfully!', 'success');
        }
    } catch (err) {
        console.error('Backend save failed:', err.message);
        showToast('⚠ Record not saved to cloud, but card generated locally.', 'warning');
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
        img.src = item.preview;
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
        // Only persist preview data to localStorage (print data is too large)
        const storable = batchQueue.map(item => ({ preview: item.preview }));
        localStorage.setItem('ep_batch', JSON.stringify(storable));
    } catch (e) {
        console.warn('Batch too large for localStorage, keeping in memory only.');
    }
    document.querySelector('.batch-card .section-title').textContent = `Batch Queue (${batchQueue.length}/9)`;
    btnPrintBatch.disabled = batchQueue.length === 0;

    const mainMain = document.querySelector('.app-main');
    if (batchQueue.length > 0 && mainMain.classList.contains('layout-initial')) {
        mainMain.classList.remove('layout-initial');
        mainMain.classList.add('layout-batch');
    } else if (batchQueue.length === 0 && mainMain.classList.contains('layout-batch')) {
        mainMain.classList.remove('layout-batch');
        mainMain.classList.add('layout-initial');
    }

    updatePrintArea();
}

async function removeFromBatch(idx) {
    if (await showConfirm('Are you sure you want to remove this card from the batch?')) {
        batchQueue.splice(idx, 1);
        updateBatchUI();
    }
}

function showEnlargedPreview(idx) {
    const item = batchQueue[idx];
    if (!item) return;
    const src = item.print || item.preview;
    document.getElementById('enlargedImg').src = src;
    document.getElementById('previewModal').style.display = 'flex';
    document.getElementById('btnDownloadEnlarged').onclick = () => {
        const link = document.createElement('a');
        link.download = `Batch_Pass_${idx + 1}.png`;
        link.href = src;
        link.click();
    };
}

function updatePrintArea() {
    batchPrintArea.innerHTML = '';
    batchQueue.forEach(item => {
        const img = new Image();
        img.src = item.print || item.preview;
        batchPrintArea.appendChild(img);
    });
}

function printBatch() {
    popupPrint(batchQueue.map(i => i.print || i.preview), 'Batch Print');
}

function popupPrint(images, title = 'Print') {
    if (!images || images.length === 0) return;
    const cells = images.map(img => `<div class="cell"><img src="${img}" /></div>`).join('');
    const win = window.open('', '_blank', 'width=900,height=1100');
    if (!win) { showAlert('Pop-up blocked by browser. Please allow pop-ups to print.'); return; }
    win.document.write(`<!DOCTYPE html>
<html>
<head>
<title>${title}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  @page { size: A4 portrait; margin: 0; }
  html, body { width: 210mm; height: 297mm; background: white; }
  .grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    grid-template-rows: repeat(3, 1fr);
    gap: 2mm;
    padding: 4mm;
    width: 210mm;
    height: 297mm;
    box-sizing: border-box;
  }
  .cell { display: flex; align-items: center; justify-content: center; overflow: hidden; }
  .cell img { width: 100%; height: 100%; object-fit: contain; display: block; }
</style>
</head>
<body><div class="grid">${cells}</div></body>
</html>`);
    win.document.close();
    let printed = false;
    const doPrint = () => {
        if (printed) return;
        printed = true;
        win.focus();
        win.print();
        win.onafterprint = () => { try { win.close(); } catch (e) { } };
        setTimeout(() => { try { win.close(); } catch (e) { } }, 10000);
    };
    win.onload = () => setTimeout(doPrint, 300);
    // Fallback if onload doesn't fire (slow rendering / some browsers)
    setTimeout(doPrint, 3000);
}

function nextEntry() {
    if (isSaving) {
        showToast('Please wait — record is being saved...', 'warning');
        return;
    }
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

    document.getElementById('siteRecordsTitle').innerHTML = `${esc(site)} | Op: <strong>${esc(operator.name)}</strong>`;
    document.getElementById('recordsModal').style.display = 'flex';
    const tbody = document.getElementById('siteRecordsBody');
    tbody.innerHTML = '<tr><td colspan="14" style="text-align:center; padding:2rem;">Loading records...</td></tr>';

    try {
        const resp = await fetch(`${API_BASE}/api/employees?site=${encodeURIComponent(site)}`, {
            headers: authHeaders()
        });
        if (!resp.ok) throw new Error(`Server returned ${resp.status}`);
        const result = await resp.json();
        const records = result.data || result;
        tbody.innerHTML = '';

        if (records.length === 0) {
            tbody.innerHTML = '<tr><td colspan="14" style="text-align:center; padding:2rem; color:var(--text-light);">No records found for this site.</td></tr>';
            return;
        }

        records.forEach(r => {
            const photoSrc = r.photoPath ? (r.photoPath.startsWith('http') ? r.photoPath : `${API_BASE}/${r.photoPath.replace(/\\/g, '/')}`) : '';
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td>${photoSrc ? `<img src="${esc(photoSrc)}" style="width:40px; height:50px; border-radius:4px; object-fit:cover;" />` : 'N/A'}</td>
                <td>${esc(r.fullName) || '---'}</td>
                <td>${esc(r.aadhar) || '---'}</td>
                <td>${esc(r.age) || '---'}</td>
                <td>${esc(r.gender) || '---'}</td>
                <td>${esc(formatDate(r.dob))}</td>
                <td>${esc(r.bloodGroup) || '---'}</td>
                <td>${esc(r.contractor) || '---'}</td>
                <td>${esc(r.laborCamp) || '---'}</td>
                <td>${esc(r.designation) || '---'}</td>
                <td>${esc(r.contact) || '---'}</td>
                <td>${esc(formatDate(r.doi))}</td>
                <td>${esc(formatDate(r.validity))}</td>
                <td>${esc(formatDate(r.issueDate))}</td>`;
            tbody.appendChild(tr);
        });
    } catch (err) {
        console.error('Failed to load site records:', err);
        tbody.innerHTML = '<tr><td colspan="14" style="text-align:center; padding:2rem; color:red;">Error loading records.</td></tr>';
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
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

document.addEventListener('DOMContentLoaded', () => {
    initSession();

    const btnViewRecords = document.getElementById('btnViewRecords');
    const btnExportSiteExcel = document.getElementById('btnExportSiteExcel');
    const closeRecords = document.getElementById('closeRecords');

    if (btnViewRecords) btnViewRecords.onclick = loadSiteRecords;
    if (btnExportSiteExcel) btnExportSiteExcel.onclick = exportSiteToExcel;
    if (closeRecords) closeRecords.onclick = () => document.getElementById('recordsModal').style.display = 'none';

    const closeAlert = document.getElementById('closeAlert');
    if (closeAlert) closeAlert.onclick = () => document.getElementById('customAlert').style.display = 'none';

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
        popupPrint([idCard.toDataURL('image/png')], 'Single Pass Print');
        // Attempt save in background if not already done
        if (!isSaved) saveToBackend();
    };

    btnAddToBatch.onclick = () => {
        if (isInBatch) {
            return showAlert("This card is already added to the batch! Move to 'Next Entry'.");
        }
        if (batchQueue.length >= 9) return showAlert('Batch full.');

        // Store preview (JPEG for localStorage) and print (PNG, memory-only) together
        const proxyCanvas = document.createElement('canvas');
        proxyCanvas.width = CR80_W;
        proxyCanvas.height = CR80_H;
        const pCtx = proxyCanvas.getContext('2d');
        pCtx.drawImage(idCard, 0, 0, proxyCanvas.width, proxyCanvas.height);
        batchQueue.push({
            preview: proxyCanvas.toDataURL('image/jpeg', 0.92),
            print: idCard.toDataURL('image/png')
        });

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
    btnClearBatch.onclick = async () => {
        if (await showConfirm("Are you sure you want to clear all items in the batch?")) {
            batchQueue = []; updateBatchUI();
        }
    };
    btnPrintBatch.onclick = () => printBatch();

    // Clean up body print classes after single-card print dialog closes
    window.addEventListener('afterprint', () => {
        document.body.classList.remove('print-single');
    });

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
            headers: authHeaders({ 'Content-Type': 'application/json' }),
            body: JSON.stringify({ aadhar, contact })
        });
        if (!resp.ok) return null;
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
            <div style="margin-bottom: 0.5rem;"><strong>Name:</strong> ${esc(dupData.existing.fullName)}</div>
            <div style="margin-bottom: 0.5rem;"><strong>Site:</strong> ${esc(dupData.existing.site)}</div>
            <div style="margin-bottom: 0.5rem;"><strong>Operator:</strong> ${esc(dupData.existing.operator)}</div>
            <div><strong>Date:</strong> ${esc(formatDate(dupData.existing.createdAt))}</div>
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
let _confirmReject = null;
function showConfirm(msg) {
    // Reject any prior pending confirm to prevent race conditions
    if (_confirmReject) { _confirmReject(false); _confirmReject = null; }
    return new Promise((resolve) => {
        _confirmReject = () => { document.getElementById('confirmModal').style.display = 'none'; resolve(false); };
        document.getElementById('confirmMessage').textContent = msg;
        const modal = document.getElementById('confirmModal');
        modal.style.display = 'flex';
        document.getElementById('confirmYes').onclick = () => { _confirmReject = null; modal.style.display = 'none'; resolve(true); };
        document.getElementById('confirmNo').onclick = () => { _confirmReject = null; modal.style.display = 'none'; resolve(false); };
    });
}

// Close modals on Escape key
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const modals = ['confirmModal', 'duplicateModal', 'previewModal', 'recordsModal', 'customAlert'];
        for (const id of modals) {
            const el = document.getElementById(id);
            if (el && el.style.display === 'flex') {
                if (id === 'confirmModal') { document.getElementById('confirmNo').click(); }
                else if (id === 'duplicateModal') { document.getElementById('btnCancelDuplicate').click(); }
                else if (id === 'previewModal') { document.getElementById('closePreview').click(); }
                else if (id === 'recordsModal') { document.getElementById('closeRecords').click(); }
                else if (id === 'customAlert') { document.getElementById('closeAlert').click(); }
                break;
            }
        }
    }
});
