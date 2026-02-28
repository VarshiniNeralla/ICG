'use strict';

/**
 * MY HOME GROUP – SECURE ID CARD GENERATOR
 * Core Logic & Rendering Engine
 */

// 1. CONFIGURATION
const CANVAS_W = 1011;
const CANVAS_H = 639;
const PHOTO_X = 38;
const PHOTO_Y = 60;
const PHOTO_W = 220;
const PHOTO_H = 293;
const PHOTO_RADIUS = 10;
const TEXT_X = 290;
const TEXT_Y_START = 140;

const COLOR_NAVY = '#1a3c6e';
const COLOR_DARK = '#0d2240';
const COLOR_GOLD = '#c8a45a';
const COLOR_TEXT1 = '#111827';
const COLOR_MUTED = '#64748b';

const WM_ALPHA = 0.07;
const WM_TILE_W = 280;

const FONT_NAME = 'bold 52px Inter, Arial, sans-serif';
const FONT_DESIG = '600 36px Inter, Arial, sans-serif';
const FONT_LABEL = '500 24px Inter, Arial, sans-serif';
const FONT_VALUE = '400 26px Inter, Arial, sans-serif';
const FONT_EMPID = 'bold 30px Inter, Arial, sans-serif';

const STORAGE_KEY = 'mhc_id_card_session';

// STATE
let capturedPhotoDataURL = null;
let logoImage = null;
let stream = null;
let currentStep = 1;
let isGenerating = false;

// DOM
const video = document.getElementById('videoFeed');
const snapCanvas = document.getElementById('snapCanvas');
const croppedPhoto = document.getElementById('croppedPhoto');
const photoPlaceholder = document.getElementById('photoPlaceholder');
const cameraError = document.getElementById('cameraError');
const renderError = document.getElementById('renderError');
const btnStart = document.getElementById('btnStartCamera');
const btnCapture = document.getElementById('btnCapture');
const btnRetake = document.getElementById('btnRetake');
const btnGenerate = document.getElementById('btnGenerate');
const btnDownload = document.getElementById('btnDownload');
const btnPrint = document.getElementById('btnPrint');
const btnFinish = document.getElementById('btnFinish');
const previewActions = document.getElementById('previewActions');
const btnNext = document.getElementById('btnNext');
const btnBack = document.getElementById('btnBack');
const carouselTrack = document.getElementById('carouselTrack');
const step1Indicator = document.getElementById('stepIndicator1');
const step2Indicator = document.getElementById('stepIndicator2');
const idCard = document.getElementById('idCard');
const canvasEmpty = document.getElementById('canvasEmpty');
const printImg = document.getElementById('printImg');

// 2. CAMERA ENGINE
async function startCamera() {
    setCameraError('');
    try {
        stream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 960 } }
        });
        video.srcObject = stream;
        video.style.display = 'block';
        photoPlaceholder.style.display = 'none';
        croppedPhoto.style.display = 'none';
        btnStart.disabled = true;
        btnCapture.disabled = false;
        btnRetake.style.display = 'none';
    } catch (err) {
        setCameraError('Camera error: ' + err.message);
    }
}

function capturePhoto() {
    if (!video.srcObject) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    snapCanvas.width = vw; snapCanvas.height = vh;
    snapCanvas.getContext('2d').drawImage(video, 0, 0, vw, vh);

    const targetRatio = 3 / 4;
    let cropW = vw, cropH = vh, cropX = 0, cropY = 0;
    if (vw / vh > targetRatio) {
        cropW = Math.round(vh * targetRatio);
        cropX = Math.round((vw - cropW) / 2);
    } else {
        cropH = Math.round(vw / targetRatio);
        cropY = Math.round((vh - cropH) / 2);
    }

    croppedPhoto.width = 600; croppedPhoto.height = 800;
    croppedPhoto.getContext('2d').drawImage(snapCanvas, cropX, cropY, cropW, cropH, 0, 0, 600, 800);
    capturedPhotoDataURL = croppedPhoto.toDataURL('image/png');
    croppedPhoto.style.display = 'block';
    video.style.display = 'none';
    btnCapture.disabled = true;
    btnRetake.style.display = 'inline-flex';
    if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
    btnStart.disabled = false;
}

function retakePhoto() {
    capturedPhotoDataURL = null;
    croppedPhoto.style.display = 'none';
    btnRetake.style.display = 'none';
    btnCapture.disabled = false;
    saveSession();
    startCamera();
}

// 3. PERSISTENCE
function saveSession() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
        formData: getFormData(),
        photo: capturedPhotoDataURL,
        currentStep,
        isGenerated: idCard.style.display === 'block'
    }));
}

async function loadSession() {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return false;
    try {
        const session = JSON.parse(saved);
        Object.keys(session.formData).forEach(k => { if (document.getElementById(k)) document.getElementById(k).value = session.formData[k]; });
        if (session.photo) {
            capturedPhotoDataURL = session.photo;
            const img = await loadImage(session.photo);
            croppedPhoto.getContext('2d').drawImage(img, 0, 0, 600, 800);
            croppedPhoto.style.display = 'block'; video.style.display = 'none';
            btnCapture.disabled = true; btnRetake.style.display = 'inline-flex';
            photoPlaceholder.style.display = 'none';
        }
        goToStep(session.currentStep);
        if (session.isGenerated) {
            await renderCard(session.formData, session.photo ? await loadImage(session.photo) : null);
            canvasEmpty.style.display = 'none'; idCard.style.display = 'block'; previewActions.style.display = 'flex';
        }
        return true;
    } catch { return false; }
}

function finishSession() {
    localStorage.removeItem(STORAGE_KEY);
    capturedPhotoDataURL = null;
    document.getElementById('empForm').reset();
    document.getElementById('empId').value = generateRandomEmpId();
    idCard.style.display = 'none'; canvasEmpty.style.display = 'block'; previewActions.style.display = 'none';
    croppedPhoto.style.display = 'none'; photoPlaceholder.style.display = 'block'; video.style.display = 'none';
    btnRetake.style.display = 'none'; btnCapture.disabled = true; btnStart.disabled = false;
    goToStep(1);
}

// 4. RENDERING ENGINE
function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawWatermark(ctx, logo) {
    if (!logo) return;
    ctx.save();
    ctx.translate(CANVAS_W / 2, CANVAS_H / 2); ctx.rotate(35 * Math.PI / 180);
    ctx.globalAlpha = WM_ALPHA;
    const tw = WM_TILE_W, th = Math.round(tw / (logo.width / logo.height));
    for (let x = -CANVAS_W; x < CANVAS_W; x += tw + 20) {
        for (let y = -CANVAS_H; y < CANVAS_H; y += th + 20) ctx.drawImage(logo, x, y, tw, th);
    }
    ctx.restore();
}

async function renderCard(data, photo) {
    const ctx = idCard.getContext('2d');
    idCard.width = CANVAS_W; idCard.height = CANVAS_H;
    ctx.fillStyle = '#FFFFFF'; ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
    drawWatermark(ctx, logoImage);

    const stripeW = PHOTO_X + PHOTO_W + 30;
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, COLOR_DARK); grad.addColorStop(1, COLOR_NAVY);
    ctx.fillStyle = grad; ctx.fillRect(0, 0, stripeW, CANVAS_H);

    ctx.fillStyle = COLOR_NAVY; ctx.fillRect(stripeW, 0, CANVAS_W - stripeW, 80);
    ctx.fillStyle = COLOR_GOLD; ctx.fillRect(stripeW, 80, CANVAS_W - stripeW, 4);

    if (logoImage) {
        const r = logoImage.width / logoImage.height; let lw = 200, lh = lw / r;
        if (lh > 54) { lh = 54; lw = lh * r; }
        ctx.drawImage(logoImage, stripeW + 24, (80 - lh) / 2, lw, lh);
    }

    ctx.font = '600 20px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.textAlign = 'right';
    ctx.fillText('IDENTITY CARD', CANVAS_W - 30, 45); ctx.textAlign = 'left';

    if (photo) {
        ctx.save(); roundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, PHOTO_RADIUS); ctx.clip();
        ctx.drawImage(photo, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H); ctx.restore();
    }

    ctx.font = '600 20px Inter, Arial, sans-serif'; ctx.fillStyle = COLOR_GOLD; ctx.textAlign = 'center';
    ctx.fillText('EMPLOYEE', PHOTO_X + PHOTO_W / 2, PHOTO_Y - 20); ctx.textAlign = 'left';

    const tx = stripeW + 40; let ty = TEXT_Y_START;
    ctx.font = FONT_NAME; ctx.fillStyle = COLOR_TEXT1; ctx.fillText(data.fullName, tx, ty); ty += 70;
    ctx.font = FONT_DESIG; ctx.fillStyle = COLOR_NAVY; ctx.fillText(data.designation, tx, ty); ty += 100;

    const drawField = (lbl, val, x, y, font = FONT_VALUE) => {
        ctx.font = FONT_LABEL; ctx.fillStyle = COLOR_MUTED; ctx.fillText(lbl, x, y);
        ctx.font = font; ctx.fillStyle = COLOR_TEXT1; ctx.fillText(val, x, y + 34);
    };

    drawField('Employee ID', data.empId, tx, ty, FONT_EMPID); ty += 90;
    if (data.bloodGroup) drawField('Blood Group', data.bloodGroup, tx, ty);
    if (data.contact) drawField('Contact', data.contact, tx + 200, ty); ty += 85;
    if (data.validity) drawField('Valid Until', new Date(data.validity).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }), tx, ty);

    ctx.strokeStyle = 'rgba(26,60,110,0.1)'; ctx.lineWidth = 4;
    roundedRect(ctx, 2, 2, CANVAS_W - 4, CANVAS_H - 4, 12); ctx.stroke();
}

// 5. UTILS & HANDLERS
const getFormData = () => ({
    fullName: document.getElementById('fullName').value.trim(),
    empId: document.getElementById('empId').value.trim(),
    designation: document.getElementById('designation').value,
    bloodGroup: document.getElementById('bloodGroup').value,
    contact: document.getElementById('contact').value.trim(),
    validity: document.getElementById('validity').value
});

const generateRandomEmpId = () => `MHC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`;
const loadImage = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });
const setCameraError = (m) => { cameraError.textContent = m; cameraError.style.display = m ? 'block' : 'none'; };

function goToStep(step) {
    currentStep = step;
    carouselTrack.style.transform = `translateX(-${(step - 1) * 50}%)`;
    step1Indicator.classList.toggle('active', step === 1);
    step1Indicator.classList.toggle('completed', step === 2);
    step2Indicator.classList.toggle('active', step === 2);
    saveSession();
}

async function generate() {
    const data = getFormData();
    if (!data.fullName || !data.designation) return;
    try {
        isGenerating = true;
        btnGenerate.disabled = true;
        btnGenerate.textContent = 'Generating...';

        const photo = capturedPhotoDataURL ? await loadImage(capturedPhotoDataURL) : null;
        await renderCard(data, photo);

        // UI Updates
        canvasEmpty.style.display = 'none';
        idCard.style.display = 'block';
        previewActions.style.display = 'flex';

        btnDownload.onclick = () => {
            idCard.toBlob(b => {
                const a = document.createElement('a'); a.href = URL.createObjectURL(b);
                a.download = `MHC_${data.empId}.png`; a.click();
            }, 'image/png');
        };

        saveSession();

        // Database Sync (Background)
        fetch('http://localhost:5000/api/save-employee', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...data, photoPath: capturedPhotoDataURL })
        }).catch(err => console.error('Database sync failed:', err));

    } catch (err) {
        console.error('Generation failed:', err);
    } finally {
        isGenerating = false;
        btnGenerate.disabled = false;
        btnGenerate.textContent = 'Generate ID Card';
    }
}

async function init() {
    try { logoImage = await loadImage('assets/My_Home_Constructions_logo.webp'); } catch { logoImage = null; }
    if (!(await loadSession())) document.getElementById('empId').value = generateRandomEmpId();

    btnNext.onclick = () => { if (getFormData().fullName && getFormData().designation) goToStep(2); };
    btnBack.onclick = () => goToStep(1);
    btnStart.onclick = startCamera;
    btnCapture.onclick = () => { capturePhoto(); saveSession(); };
    btnRetake.onclick = retakePhoto;
    btnGenerate.onclick = generate;
    btnPrint.onclick = () => { printImg.src = idCard.toDataURL('image/png'); printImg.onload = () => window.print(); };
    btnFinish.onclick = finishSession;

    ['fullName', 'bloodGroup', 'designation', 'contact', 'validity'].forEach(id => {
        document.getElementById(id).onchange = saveSession;
    });
}

document.addEventListener('DOMContentLoaded', init);
