/**
 * My Home Group – Secure ID Card Generator
 * script.js
 *
 * Modules:
 *   1. Constants & State
 *   2. DOM References
 *   3. Webcam Module
 *   4. Form Validation
 *   5. QR Code Module
 *   6. Canvas Rendering Engine
 *   7. Download
 *   8. Print
 *   9. Event Bindings & Init
 */

'use strict';

/* ============================================================
   1. CONSTANTS & STATE
   ============================================================ */

// 300 DPI equivalent canvas dimensions for CR80 (85.6 × 54 mm)
// 85.6mm / 25.4 × 300 = 1011   |   54mm / 25.4 × 300 = 638 ≈ 639
const CANVAS_W = 1011;
const CANVAS_H = 639;

// Photo region inside card (left zone)
const PHOTO_X = 38;
const PHOTO_Y = 60;
const PHOTO_W = 220;
const PHOTO_H = 293;   // 3:4 ratio
const PHOTO_RADIUS = 10;

// Text region (right of photo)
const TEXT_X = 290;
const TEXT_Y_START = 95;

// QR placement (bottom-right)
const QR_SIZE = 220;
const QR_X = CANVAS_W - QR_SIZE - 38;
const QR_Y = CANVAS_H - QR_SIZE - 30;

// Brand colours (matching CSS variables)
const COLOR_NAVY = '#1a3c6e';
const COLOR_DARK = '#0d2240';
const COLOR_GOLD = '#c8a45a';
const COLOR_TEXT1 = '#111827';
const COLOR_TEXT2 = '#374151';
const COLOR_TEXT3 = '#4b5563';
const COLOR_MUTED = '#6b7280';

// Watermark
const WM_ALPHA = 0.07;
const WM_ANGLE_DEG = 35;
const WM_TILE_W = 280;
const WM_TILE_H = 160;

// Fonts (at 300-DPI canvas scale)
const FONT_NAME = 'bold 52px Inter, Arial, sans-serif';
const FONT_DESIG = '600 36px Inter, Arial, sans-serif';
const FONT_LABEL = '500 24px Inter, Arial, sans-serif';
const FONT_VALUE = '400 26px Inter, Arial, sans-serif';
const FONT_EMPID = 'bold 30px Inter, Arial, sans-serif';
const FONT_VALIDITY = '400 24px Inter, Arial, sans-serif';
const FONT_COMPANY = 'bold 24px Inter, Arial, sans-serif';
const FONT_TAGLINE = '400 18px Inter, Arial, sans-serif';

// In-session uniqueness tracker for Employee ID
const usedEmpIds = new Set();

// State
let capturedPhotoDataURL = null;
let logoImage = null;
let stream = null;
let currentStep = 1;
let isGenerating = false;

/* ============================================================
   2. DOM REFERENCES
   ============================================================ */
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
const previewActions = document.getElementById('previewActions');
const btnNext = document.getElementById('btnNext');
const btnBack = document.getElementById('btnBack');

const carouselTrack = document.getElementById('carouselTrack');
const step1Indicator = document.getElementById('stepIndicator1');
const step2Indicator = document.getElementById('stepIndicator2');
const step1El = document.getElementById('step1');
const step2El = document.getElementById('step2');

const idCard = document.getElementById('idCard');
const canvasEmpty = document.getElementById('canvasEmpty');
const printImg = document.getElementById('printImg');

/* ============================================================
   3. WEBCAM MODULE
   ============================================================ */

function setCameraError(msg) {
    cameraError.textContent = msg;
    cameraError.style.display = msg ? 'block' : 'none';
}

async function startCamera() {
    setCameraError('');
    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setCameraError('Your browser does not support camera access. Use Chrome or Edge over HTTPS.');
            btnCapture.disabled = true;
            return;
        }
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
        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
            setCameraError('Camera access denied. Please allow camera permissions in your browser settings, then try again.');
        } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
            setCameraError('No camera detected on this device. Please connect a webcam and try again.');
        } else {
            setCameraError('Could not access your camera: ' + err.message);
        }
        btnCapture.disabled = true;
    }
}

function capturePhoto() {
    if (!video.srcObject) return;

    // Draw current video frame
    const vw = video.videoWidth;
    const vh = video.videoHeight;
    snapCanvas.width = vw;
    snapCanvas.height = vh;
    const sCtx = snapCanvas.getContext('2d');
    sCtx.drawImage(video, 0, 0, vw, vh);

    // Center-crop to 3:4 portrait
    let cropW, cropH, cropX, cropY;
    const targetRatio = 3 / 4;
    const srcRatio = vw / vh;

    if (srcRatio > targetRatio) {
        cropH = vh;
        cropW = Math.round(vh * targetRatio);
        cropX = Math.round((vw - cropW) / 2);
        cropY = 0;
    } else {
        cropW = vw;
        cropH = Math.round(vw / targetRatio);
        cropX = 0;
        cropY = Math.round((vh - cropH) / 2);
    }

    // Output at 600×800 (displayed proportionally in preview)
    const OUT_W = 600, OUT_H = 800;
    croppedPhoto.width = OUT_W;
    croppedPhoto.height = OUT_H;
    const cCtx = croppedPhoto.getContext('2d');
    cCtx.drawImage(snapCanvas, cropX, cropY, cropW, cropH, 0, 0, OUT_W, OUT_H);

    capturedPhotoDataURL = croppedPhoto.toDataURL('image/png');

    // Show captured thumbnail
    croppedPhoto.style.display = 'block';
    video.style.display = 'none';
    btnCapture.disabled = true;
    btnRetake.style.display = 'inline-flex';

    // Stop stream to release camera
    if (stream) {
        stream.getTracks().forEach(t => t.stop());
        stream = null;
    }
    btnStart.disabled = false;
}

function retakePhoto() {
    capturedPhotoDataURL = null;
    croppedPhoto.style.display = 'none';
    btnRetake.style.display = 'none';
    btnCapture.disabled = false;
    photoPlaceholder.style.display = 'none';
    // Re-start camera
    startCamera();
}

/* ============================================================
   4. FORM VALIDATION
   ============================================================ */

function sanitize(str) {
    // Strip HTML tags and trim whitespace
    return str.replace(/<[^>]*>/g, '').trim();
}

function setFieldError(fieldId, msg) {
    const input = document.getElementById(fieldId);
    const errEl = document.getElementById('err-' + fieldId);
    if (msg) {
        input.classList.add('invalid');
        if (errEl) errEl.textContent = msg;
    } else {
        input.classList.remove('invalid');
        if (errEl) errEl.textContent = '';
    }
}

function clearAllErrors() {
    ['fullName', 'designation'].forEach(id => setFieldError(id, ''));
    renderError.style.display = 'none';
}

function getFormData() {
    return {
        fullName: sanitize(document.getElementById('fullName').value),
        empId: sanitize(document.getElementById('empId').value),
        designation: document.getElementById('designation').value,
        bloodGroup: document.getElementById('bloodGroup').value,
        contact: sanitize(document.getElementById('contact').value),
        validity: document.getElementById('validity').value
    };
}

function validateForm(data) {
    clearAllErrors();
    let firstErrorId = null;

    const required = [
        { key: 'fullName', id: 'fullName', label: 'Full Name' },
        { key: 'designation', id: 'designation', label: 'Designation' }
    ];

    required.forEach(({ key, id, label }) => {
        if (!data[key]) {
            setFieldError(id, label + ' is required.');
            if (!firstErrorId) firstErrorId = id;
        }
    });

    if (firstErrorId) {
        const el = document.getElementById(firstErrorId);
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.focus();
        return false;
    }
    return true;
}

function generateRandomEmpId() {
    const year = new Date().getFullYear();
    const rand = Math.floor(1000 + Math.random() * 9000); // 4 digit random
    return `MHC-${year}-${rand}`;
}

/* ============================================================
   5. CAROUSEL NAVIGATION
   ============================================================ */

function goToStep(step) {
    currentStep = step;

    // Update track position (subtracting based on currentStep)
    carouselTrack.style.transform = `translateX(-${(step - 1) * 50}%)`;

    // Handle indicators & step active states
    if (step === 1) {
        step1El.classList.add('active');
        step2El.classList.remove('active');
        step1Indicator.classList.add('active');
        step1Indicator.classList.remove('completed');
        step2Indicator.classList.remove('active');
    } else {
        step1El.classList.remove('active');
        step2El.classList.add('active');
        step1Indicator.classList.remove('active');
        step1Indicator.classList.add('completed');
        step2Indicator.classList.add('active');
    }
}

/* ============================================================
   5. [QR REMOVED]
   ============================================================ */

/* ============================================================
   6. CANVAS RENDERING ENGINE
   ============================================================ */

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed to load image: ' + src));
        img.src = src;
    });
}

function roundedRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.lineTo(x + w - r, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + r);
    ctx.lineTo(x + w, y + h - r);
    ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
    ctx.lineTo(x + r, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - r);
    ctx.lineTo(x, y + r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.closePath();
}

function drawWatermark(ctx, logoImg) {
    if (!logoImg) return;   // null-safe guard
    ctx.save();
    ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
    ctx.rotate(WM_ANGLE_DEG * Math.PI / 180);
    ctx.globalAlpha = WM_ALPHA;

    // Scale logo to tile width, maintain aspect ratio
    const ratio = logoImg.naturalWidth / logoImg.naturalHeight;
    const tileW = WM_TILE_W;
    const tileH = Math.round(WM_TILE_W / ratio);
    const spacing = 20;

    for (let x = -CANVAS_W * 1.5; x < CANVAS_W * 1.5; x += tileW + spacing) {
        for (let y = -CANVAS_H * 1.5; y < CANVAS_H * 1.5; y += tileH + spacing) {
            ctx.drawImage(logoImg, x, y, tileW, tileH);
        }
    }
    ctx.restore();
}

function drawPhotoZone(ctx, photoImg) {
    ctx.save();
    roundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, PHOTO_RADIUS);
    ctx.clip();
    ctx.drawImage(photoImg, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H);
    ctx.restore();

    // Photo border
    ctx.save();
    roundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, PHOTO_RADIUS);
    ctx.strokeStyle = 'rgba(26,60,110,0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function wrapText(ctx, text, x, y, maxWidth, lineHeight) {
    const words = text.split(' ');
    let line = '';
    let lineY = y;
    words.forEach(word => {
        const test = line + (line ? ' ' : '') + word;
        if (ctx.measureText(test).width > maxWidth && line) {
            ctx.fillText(line, x, lineY);
            line = word;
            lineY += lineHeight;
        } else {
            line = test;
        }
    });
    if (line) ctx.fillText(line, x, lineY);
    return lineY;
}

async function renderCard(data, photoImg) {
    const ctx = idCard.getContext('2d');
    idCard.width = CANVAS_W;
    idCard.height = CANVAS_H;

    /* ── 1. White base ── */
    ctx.fillStyle = '#FAFBFD';
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    /* ── 2. Watermark ── */
    drawWatermark(ctx, logoImage);

    /* ── 3. Left accent stripe ── */
    const stripeW = PHOTO_X + PHOTO_W + 30;
    const grad = ctx.createLinearGradient(0, 0, 0, CANVAS_H);
    grad.addColorStop(0, COLOR_DARK);
    grad.addColorStop(1, COLOR_NAVY);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, stripeW, CANVAS_H);

    /* ── 4. Top header bar (right section) ── */
    ctx.fillStyle = COLOR_NAVY;
    ctx.fillRect(stripeW, 0, CANVAS_W - stripeW, 80);

    /* ── 5. Gold accent line ── */
    ctx.fillStyle = COLOR_GOLD;
    ctx.fillRect(stripeW, 80, CANVAS_W - stripeW, 4);

    /* ── 6. Company logo (top-right header) ── */
    const logoMaxW = 200;
    const logoMaxH = 54;
    const logoRatio = logoImage.naturalWidth / logoImage.naturalHeight;
    let logoW = logoMaxW;
    let logoH = logoMaxW / logoRatio;
    if (logoH > logoMaxH) { logoH = logoMaxH; logoW = logoMaxH * logoRatio; }
    const logoX = stripeW + 24;
    const logoY = (80 - logoH) / 2;
    ctx.drawImage(logoImage, logoX, logoY, logoW, logoH);

    /* ── 7. "IDENTITY CARD" label (top right) ── */
    ctx.font = '600 20px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    ctx.textAlign = 'right';
    ctx.fillText('IDENTITY CARD', CANVAS_W - 30, 45);
    ctx.textAlign = 'left';

    /* ── 8. Employee photo ── */
    if (photoImg) {
        drawPhotoZone(ctx, photoImg);
    } else {
        ctx.fillStyle = 'rgba(255,255,255,0.1)';
        roundedRect(ctx, PHOTO_X, PHOTO_Y, PHOTO_W, PHOTO_H, PHOTO_RADIUS);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.4)';
        ctx.font = '24px Inter, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('No Photo', PHOTO_X + PHOTO_W / 2, PHOTO_Y + PHOTO_H / 2);
        ctx.textAlign = 'left';
    }

    /* ── 9. Employee name label on stripe ── */
    ctx.font = '600 20px Inter, Arial, sans-serif';
    ctx.fillStyle = 'rgba(200,164,90,0.9)';
    ctx.textBaseline = 'alphabetic';
    ctx.textAlign = 'center';
    ctx.fillText('EMPLOYEE', PHOTO_X + PHOTO_W / 2, PHOTO_Y - 20);
    ctx.textAlign = 'left';

    /* ── 10. Text fields (right zone) ── */
    const textX = stripeW + 40;
    const textMaxW = CANVAS_W - textX - 40;
    let ty = 140;
    const lineH = 1.3;

    // Full Name
    ctx.font = FONT_NAME;
    ctx.fillStyle = COLOR_TEXT1;
    ctx.textBaseline = 'alphabetic';
    let nameSize = 52;
    ctx.font = `bold ${nameSize}px Inter, Arial, sans-serif`;
    while (ctx.measureText(data.fullName).width > textMaxW && nameSize > 32) {
        nameSize -= 2;
        ctx.font = `bold ${nameSize}px Inter, Arial, sans-serif`;
    }
    ctx.fillText(data.fullName, textX, ty);
    ty += Math.round(nameSize * lineH) + 10;

    // Designation
    ctx.font = FONT_DESIG;
    ctx.fillStyle = COLOR_NAVY;
    ctx.fillText(data.designation, textX, ty);
    ty += 50;

    // Separator
    ctx.strokeStyle = 'rgba(26,60,110,0.15)';
    ctx.beginPath();
    ctx.moveTo(textX, ty);
    ctx.lineTo(textX + 200, ty);
    ctx.stroke();
    ty += 45;

    // Emp ID
    ctx.font = FONT_LABEL;
    ctx.fillStyle = COLOR_MUTED;
    ctx.fillText('Employee ID', textX, ty);
    ty += 34;
    ctx.font = FONT_EMPID;
    ctx.fillStyle = COLOR_NAVY;
    ctx.fillText(data.empId, textX, ty);
    ty += 55;

    // Blood Group & Contact
    const labelSpacing = 180;
    if (data.bloodGroup) {
        ctx.font = FONT_LABEL;
        ctx.fillStyle = COLOR_MUTED;
        ctx.fillText('Blood Group', textX, ty);
        ctx.font = FONT_VALUE;
        ctx.fillStyle = COLOR_TEXT2;
        ctx.fillText(data.bloodGroup, textX, ty + 34);
    }
    if (data.contact) {
        ctx.font = FONT_LABEL;
        ctx.fillStyle = COLOR_MUTED;
        ctx.fillText('Contact', textX + labelSpacing, ty);
        ctx.font = FONT_VALUE;
        ctx.fillStyle = COLOR_TEXT2;
        ctx.fillText(data.contact, textX + labelSpacing, ty + 34);
    }
    ty += 75;

    // Validity
    if (data.validity) {
        ctx.font = FONT_LABEL;
        ctx.fillStyle = COLOR_MUTED;
        ctx.fillText('Valid Until', textX, ty);
        ctx.font = FONT_VALIDITY;
        ctx.fillStyle = COLOR_TEXT3;
        ctx.fillText(formatDate(data.validity), textX, ty + 34);
    }

    /* ── 11. Card border ── */
    ctx.strokeStyle = 'rgba(26,60,110,0.2)';
    ctx.lineWidth = 4;
    roundedRect(ctx, 2, 2, CANVAS_W - 4, CANVAS_H - 4, 12);
    ctx.stroke();
}

/* ============================================================
   7. DOWNLOAD
   ============================================================ */

function downloadCard(empId) {
    const safeName = empId.replace(/[^a-zA-Z0-9_-]/g, '_').toUpperCase();
    idCard.toBlob(blob => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `MYHOME_EMP_${safeName}.png`;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 2000);
    }, 'image/png');
}

/* ============================================================
   8. PRINT
   ============================================================ */

function printCard() {
    const dataURL = idCard.toDataURL('image/png');
    printImg.onload = () => {
        window.print();
    };
    printImg.src = dataURL;
}

/* ============================================================
   9. GENERATE ORCHESTRATOR
   ============================================================ */

async function generate() {
    if (isGenerating) return;

    const data = getFormData();
    if (!validateForm(data)) return;

    isGenerating = true;
    btnGenerate.disabled = true;
    btnGenerate.textContent = 'Generating…';
    renderError.style.display = 'none';

    try {
        // Load photo image
        let photoImg = null;
        if (capturedPhotoDataURL) {
            photoImg = await loadImage(capturedPhotoDataURL);
        }

        // Render card
        await renderCard(data, photoImg);

        // Show canvas, hide empty state
        canvasEmpty.style.display = 'none';
        idCard.style.display = 'block';
        previewActions.style.display = 'flex';

        // Bind download with correct empId
        btnDownload.onclick = () => downloadCard(data.empId);

    } catch (err) {
        renderError.textContent = '⚠ ' + err.message;
        renderError.style.display = 'block';
        console.error('[ID Generator]', err);
    } finally {
        isGenerating = false;
        btnGenerate.disabled = false;
        btnGenerate.innerHTML = `
      <svg width="20" height="20" fill="currentColor" viewBox="0 0 24 24">
        <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-7 3c1.93 0 3.5 1.57 3.5 3.5S13.93 13 12 13s-3.5-1.57-3.5-3.5S10.07 6 12 6zm7 13H5v-.23c0-.62.28-1.2.76-1.58C7.47 15.82 9.64 15 12 15s4.53.82 6.24 2.19c.48.38.76.97.76 1.58V19z"/>
      </svg>
      Generate ID Card`;
    }
}

/* ============================================================
   10. LOGO PRELOAD & EVENT BINDINGS
   ============================================================ */

async function init() {
    // Generate initial random Emp ID
    const empIdEl = document.getElementById('empId');
    empIdEl.value = generateRandomEmpId();

    // Preload company logo
    try {
        logoImage = await loadImage('assets/My_Home_Constructions_logo.webp');
    } catch {
        console.warn('[ID Generator] assets/My_Home_Constructions_logo.webp could not be loaded. Watermark disabled.');
        logoImage = null;
    }

    // Carousel Navigation
    btnNext.addEventListener('click', () => {
        const data = getFormData();
        if (validateForm(data)) goToStep(2);
    });
    btnBack.addEventListener('click', () => goToStep(1));

    // Camera controls
    btnStart.addEventListener('click', startCamera);
    btnCapture.addEventListener('click', capturePhoto);
    btnRetake.addEventListener('click', retakePhoto);

    // Generate
    if (btnGenerate) {
        btnGenerate.addEventListener('click', generate);
    }

    // Print
    btnPrint.addEventListener('click', printCard);

    // Clear invalid styles on change
    ['fullName', 'designation'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => setFieldError(id, ''));
    });
}

// Kick off
document.addEventListener('DOMContentLoaded', init);
