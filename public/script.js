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
        const contractorList = [...contractors];
        if (!contractorList.includes('Others')) contractorList.push('Others');
        cSel.innerHTML = '<option value="">Select Contractor</option>' + contractorList.map(c => `<option value="${c}">${c}</option>`).join('');
        if (contractorList.includes(curContractor)) cSel.value = curContractor;
    }
    if (dSel) {
        const roleList = [...roles];
        if (!roleList.includes('Others')) roleList.push('Others');
        dSel.innerHTML = '<option value="">Select</option>' + roleList.map(r => `<option value="${r}">${r}</option>`).join('');
        if (roleList.includes(curRole)) dSel.value = curRole;
    }
    updateOthersFieldsVisibility();
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
let photoPortraitSegmenter = null;
let photoPortraitSegmenterPromise = null;
let portraitMlLibsPromise = null;
let portraitPreviewActive = false;
let portraitPreviewVfcHandle = null;
let portraitPreviewRafId = null;
let portraitPreviewProcessing = false;
let _solidMaskCanvas = null;
let _solidFgCanvas = null;
/** Snapshot canvas: segmentPeople on live HTMLVideoElement often yields 0×0 masks under requestVideoFrameCallback. */
let _segmentSourceCanvas = null;
let _solidMaskBlurredCanvas = null;
/** 2× supersampled mask feather (downscaled) anti-aliases stair-stepped model output */
let _solidMaskHiCanvas = null;
/** Reused uint16 buffer for 3×3 mask-α smoothing (avoids per-frame alloc when size stable) */
let _studioMaskAlphaScratch = null;
/** Full-res sharp mask for gradient-modulated merge with blurred mask */
let _solidMaskFullResCanvas = null;
/** Reused buffer for |∇α| (edge-aware feathering) */
let _studioAlphaGradScratch = null;
/** Post-merge mask boundary solidify (α scratch + BFS) */
let _maskEdgeOrig = null;
let _maskEdgeA = null;
let _maskEdgeHair = null;
let _maskEdgeExempt = null;
let _maskEdgeReach = null;
let _maskEdgeQ = null;
let _maskEdgeAlphaPrev = null;
let _maskEdgeStableCnt = null;
let _maskEdgeStable = null;
let _maskEdgeLastW = 0;
let _maskEdgeLastH = 0;
let _maskEdgeTemporalReady = false;
/** Single blit to preview canvas reduces visible tearing vs painting bokeh directly on the live canvas. */
let _portraitBlurStageCanvas = null;
let portraitPreviewNextAllowed = 0;
/** Extra spacing after each ML frame (ms). 0 = as fast as VFC + segmentPeople allow (true “live” feel). */
const PORTRAIT_PREVIEW_MIN_GAP_MS = 0;
/** After camera starts, warm TF.js + segmenter in idle time so first Blur/Studio click skips multi‑second load. */
let portraitMlWarmScheduled = false;
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
const videoPreviewEffect = document.getElementById('videoPreviewEffect');
const webcamCanvasArea = document.querySelector('.webcam-canvas-area');
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

/** Server keeps sessions in RAM — restart drops them while localStorage still has the token → 401 until re-login. */
function forceOperatorReLogin(msg) {
    operator = { name: '', site: '' };
    localStorage.removeItem('ep_operator');
    loginScreen.style.display = 'flex';
    mainApp.style.display = 'none';
    if (msg) showToast(msg, 'warning');
}

async function initSession() {
    let restored = false;
    const savedOp = localStorage.getItem('ep_operator');
    if (savedOp) {
        try {
            const parsed = JSON.parse(savedOp);
            if (parsed?.token) {
                let sessionOk = false;
                try {
                    const vr = await fetch(`${API_BASE}/api/auth/verify`, {
                        method: 'POST',
                        headers: { Authorization: `Bearer ${parsed.token}` }
                    });
                    if (vr.ok) {
                        const body = await vr.json();
                        sessionOk = body.valid === true;
                    } else if (vr.status === 401) {
                        sessionOk = false;
                    } else {
                        /* 5xx etc. — do not wipe token while server is unhealthy */
                        sessionOk = true;
                    }
                } catch {
                    sessionOk = true;
                }
                if (sessionOk) {
                    operator = parsed;
                    restored = true;
                } else {
                    localStorage.removeItem('ep_operator');
                }
            } else {
                localStorage.removeItem('ep_operator');
            }
        } catch {
            console.warn('Corrupted operator session data, clearing.');
            localStorage.removeItem('ep_operator');
        }
    }
    if (restored) {
        operatorInfo.innerHTML = `Site: <strong>${esc(operator.site)}</strong> | Op: <strong>${esc(operator.name)}</strong>`;
        loginScreen.style.display = 'none';
        mainApp.style.display = 'block';
        setDefaultDates();
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
    void disposePortraitSegmenter();
    localStorage.removeItem('ep_operator');
    localStorage.removeItem('ep_batch');
    window.location.reload();
};

function resolveOthersSelect(selectId, otherInputId) {
    const sel = document.getElementById(selectId)?.value || '';
    if (sel !== 'Others') return sel;
    const custom = (document.getElementById(otherInputId)?.value || '').trim();
    return custom || 'Others';
}

function updateOthersFieldsVisibility() {
    const cWrap = document.getElementById('contractorOtherWrap');
    const dWrap = document.getElementById('designationOtherWrap');
    const cSel = document.getElementById('contractor');
    const dSel = document.getElementById('designation');
    if (cWrap && cSel) {
        const on = cSel.value === 'Others';
        cWrap.style.display = on ? 'block' : 'none';
        if (!on) {
            const inp = document.getElementById('contractorOther');
            if (inp) inp.value = '';
        }
    }
    if (dWrap && dSel) {
        const on = dSel.value === 'Others';
        dWrap.style.display = on ? 'block' : 'none';
        if (!on) {
            const inp = document.getElementById('designationOther');
            if (inp) inp.value = '';
        }
    }
}

const getFormData = () => ({
    fullName: document.getElementById('fullName').value.trim(),
    aadhar: document.getElementById('aadhar').value.trim(),
    dob: document.getElementById('dob').value,
    age: document.getElementById('age').value,
    gender: document.getElementById('gender').value,
    bloodGroup: document.getElementById('bloodGroup').value,
    contractor: resolveOthersSelect('contractor', 'contractorOther'),
    laborCamp: document.getElementById('laborCamp').value,
    doi: document.getElementById('doi').value,
    designation: resolveOthersSelect('designation', 'designationOther'),
    validity: document.getElementById('validity').value,
    issueDate: document.getElementById('issueDate').value,
    contact: document.getElementById('contact').value.trim()
});

const loadImage = (src) => new Promise((res, rej) => { const img = new Image(); img.onload = () => res(img); img.onerror = rej; img.src = src; });

/** Draw image centered in box without stretching (same idea as CSS object-fit: contain). */
function drawImageContain(ctx, img, boxX, boxY, boxW, boxH) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.min(boxW / iw, boxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const x = boxX + (boxW - dw) / 2;
    const y = boxY + (boxH - dh) / 2;
    ctx.drawImage(img, x, y, dw, dh);
}

/** Fill box uniformly, center, clip overflow (object-fit: cover) — no stretch; may crop edges. */
function drawImageCover(ctx, img, boxX, boxY, boxW, boxH) {
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;
    if (!iw || !ih) return;
    const scale = Math.max(boxW / iw, boxH / ih);
    const dw = iw * scale;
    const dh = ih * scale;
    const x = boxX + (boxW - dw) / 2;
    const y = boxY + (boxH - dh) / 2;
    ctx.drawImage(img, x, y, dw, dh);
}

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
    if (step === 3) {
        schedulePortraitMlWarmup();
    }
}

function getPhotoBgMode() {
    const el = document.querySelector('input[name="photoBgMode"]:checked');
    return el ? el.value : 'none';
}

/** UMD global name varies by bundler; normalize access to body-segmentation API. */
function bodySegApi() {
    if (typeof bodySegmentation !== 'undefined') return bodySegmentation;
    if (typeof window !== 'undefined' && window.bodySegmentation) return window.bodySegmentation;
    return null;
}

function loadScriptOnce(src) {
    return new Promise((resolve, reject) => {
        const scripts = document.getElementsByTagName('script');
        for (let i = 0; i < scripts.length; i++) {
            if (scripts[i].src === src) {
                if (scripts[i].dataset.loaded === '1') return resolve();
                scripts[i].addEventListener('load', () => resolve(), { once: true });
                scripts[i].addEventListener('error', () => reject(new Error(src)), { once: true });
                return;
            }
        }
        const s = document.createElement('script');
        s.src = src;
        s.async = true;
        s.onload = () => { s.dataset.loaded = '1'; resolve(); };
        s.onerror = () => reject(new Error('Failed to load ' + src));
        document.head.appendChild(s);
    });
}

async function ensurePortraitMlLibs() {
    if (typeof tf !== 'undefined' && typeof tf.ready === 'function' && bodySegApi()) {
        await tf.ready();
        return;
    }
    if (!portraitMlLibsPromise) {
        portraitMlLibsPromise = (async () => {
            await loadScriptOnce('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js');
            await loadScriptOnce('https://cdn.jsdelivr.net/npm/@tensorflow-models/body-segmentation@1.0.2/dist/body-segmentation.min.js');
            if (typeof tf === 'undefined' || typeof tf.ready !== 'function' || !bodySegApi()) {
                throw new Error('Portrait ML libraries missing (blocked network or CSP?)');
            }
            try {
                await tf.setBackend('webgl');
            } catch {
                await tf.setBackend('cpu');
            }
            await tf.ready();
        })();
    }
    try {
        await portraitMlLibsPromise;
    } catch (e) {
        portraitMlLibsPromise = null;
        throw e;
    }
}

async function getPortraitSegmenter() {
    if (photoPortraitSegmenter) return photoPortraitSegmenter;
    if (!photoPortraitSegmenterPromise) {
        photoPortraitSegmenterPromise = (async () => {
            await ensurePortraitMlLibs();
            const API = bodySegApi();
            if (!API) throw new Error('body-segmentation API not found after load');
            const model = API.SupportedModels.MediaPipeSelfieSegmentation;
            return API.createSegmenter(model, { runtime: 'tfjs', modelType: 'general' });
        })();
    }
    try {
        photoPortraitSegmenter = await photoPortraitSegmenterPromise;
    } catch (e) {
        photoPortraitSegmenterPromise = null;
        throw e;
    }
    return photoPortraitSegmenter;
}

async function disposePortraitSegmenter() {
    cancelPortraitPreviewLoop();
    portraitMlWarmScheduled = false;
    photoPortraitSegmenterPromise = null;
    const seg = photoPortraitSegmenter;
    photoPortraitSegmenter = null;
    if (seg && typeof seg.dispose === 'function') {
        try { await seg.dispose(); } catch (_) { /* ignore */ }
    }
}

/**
 * Starts loading TF.js + segmenter as soon as possible (no idle delay).
 * Also triggered from the photo step and camera start so work overlaps permission dialog / “Natural” preview.
 */
function schedulePortraitMlWarmup() {
    if (portraitMlWarmScheduled) return;
    portraitMlWarmScheduled = true;
    void (async () => {
        try {
            await ensurePortraitMlLibs();
            await getPortraitSegmenter();
        } catch (_) {
            /* Offline / blocked; first Blur/Studio use will retry via startPortraitPreviewLoop */
        }
    })();
}

/** Live frame on the effect canvas before ML runs — avoids empty preview while scripts/model load. */
function synchronouslyPaintRawPreviewOnEffectCanvas() {
    if (!videoPreviewEffect || !video) return false;
    let w = Math.floor(video.videoWidth);
    let h = Math.floor(video.videoHeight);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) return false;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return false;
    w -= w % 2;
    h -= h % 2;
    if (!ensureCanvasSize(videoPreviewEffect, w, h)) return false;
    const pctx = videoPreviewEffect.getContext('2d', { alpha: false });
    try {
        pctx.drawImage(video, 0, 0, w, h);
    } catch (_) {
        return false;
    }
    if (webcamCanvasArea) webcamCanvasArea.classList.add('preview-fx-active');
    video.style.opacity = '0';
    return true;
}

function parseRgbHex(hex) {
    const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(String(hex).trim());
    if (!m) return { r: 244, g: 245, b: 248 };
    return { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) };
}

/* Soft radial “key” backdrop (brighter behind subject) + edge vignette — reads like lit seamless paper */
const STUDIO_BACKDROP_CENTER = '#fcfdff';
const STUDIO_BACKDROP_MID = '#f4f6fa';
const STUDIO_BACKDROP_EDGE = '#e1e4ed';
/** De-spill target: slightly cooler mid-grey (avoids bright rim / “washed” edge toward #fff) */
const STUDIO_DEFRINGE_RGB = parseRgbHex('#eef1f6');
const STUDIO_DESPILL_MAX_DELTA = 20;

/** Kill ultra-low α speckle (semi-transparent noise) after de-spill */
function suppressStudioEdgeAlphaNoise(data) {
    for (let i = 0; i < data.length; i += 4) {
        const a = data[i + 3];
        if (a > 0 && a < 15) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 0;
        }
    }
}

/** Radial studio fill: brighter key behind upper subject, gentle falloff toward slightly cooler edges */
function fillStudioBackdropGradient(ctx, w, h) {
    const mx = w * 0.5;
    const my = h * 0.34;
    const r = Math.hypot(w, h) * 0.78;
    const g = ctx.createRadialGradient(mx, my, 0, mx, my, r);
    g.addColorStop(0, STUDIO_BACKDROP_CENTER);
    g.addColorStop(0.42, STUDIO_BACKDROP_MID);
    g.addColorStop(1, STUDIO_BACKDROP_EDGE);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
}

/** Deterministic opacity scale (≤1% total spread) for barely perceptible shadow variation */
function studioShadowAlphaScale(ix, iy, salt) {
    const u = ((ix * 1664525 + iy * 1013904223 + salt * 374761393) >>> 0) % 5;
    return 0.993 + u * 0.00175;
}

/** Elliptical grounding shadow: offset, horizontal asymmetry, deterministic opacity jitter */
function drawStudioContactShadow(ctx, w, h) {
    ctx.save();
    ctx.globalCompositeOperation = 'source-over';
    const ox = w * 0.028;
    const oy = h * 0.008 + 8;
    ctx.translate(ox, oy);
    const cx = w * 0.48;
    const cy = h * 0.918;
    const rx = w * 0.43;
    const ry = h * 0.052;
    const ix = Math.floor(cx);
    const iy = Math.floor(cy);
    const horizL = 0.94 + ((((w + 17) * (h + 31)) >>> 0) % 13) / 200;
    const horizR = 1.06 - ((((w * 3 + h * 5) >>> 0) % 11) / 220);
    const j0 = studioShadowAlphaScale(ix, iy, 1);
    const j1 = studioShadowAlphaScale(ix + 3, iy + 1, 2);
    const j2 = studioShadowAlphaScale(ix - 2, iy + 4, 3);
    const g1 = ctx.createRadialGradient(cx - w * 0.02, cy, 0, cx + w * 0.025, cy + h * 0.015, Math.max(rx, ry) * 1.05);
    g1.addColorStop(0, `rgba(16, 20, 32, ${(0.062 * j0 * horizL).toFixed(4)})`);
    g1.addColorStop(0.35, `rgba(16, 20, 32, ${(0.023 * j1 * (0.97 + 0.06 * horizL)).toFixed(4)})`);
    g1.addColorStop(0.72, `rgba(16, 20, 32, ${(0.01 * j1 * (0.98 + 0.04 * horizR)).toFixed(4)})`);
    g1.addColorStop(1, 'rgba(16, 20, 32, 0)');
    ctx.fillStyle = g1;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0.06, 0, Math.PI * 2);
    ctx.fill();
    const g2 = ctx.createRadialGradient(cx + w * 0.04, cy + h * 0.01, 0, cx, cy + h * 0.02, ry * 2.2);
    g2.addColorStop(0, `rgba(12, 16, 28, ${(0.028 * j2 * horizR).toFixed(4)})`);
    g2.addColorStop(1, 'rgba(12, 16, 28, 0)');
    ctx.fillStyle = g2;
    ctx.beginPath();
    ctx.ellipse(cx + w * 0.018, cy + 4, rx * 0.88, ry * 0.75, -0.04, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** Deterministic ±2 α jitter (single step; no accumulation across frames) */
function studioTransitionAlphaMicroNoise(x, y) {
    const u = ((x * 1664525 + y * 1013904223) >>> 0) % 5;
    return u - 2;
}

function clampStudioChannelDelta(orig, delta, maxAbs) {
    let d = delta;
    if (d > maxAbs) d = maxAbs;
    if (d < -maxAbs) d = -maxAbs;
    const v = orig + d;
    return v < 0 ? 0 : v > 255 ? 255 : v;
}

/**
 * Central-upper face lift with elliptical mask + vertical falloff (stronger forehead / upper cheek,
 * ~50% strength toward lower face). Only where subject α > 0.
 */
function applyStudioFaceRegionLighting(data, w, h) {
    const cx = w * 0.4;
    const cy = h * 0.44;
    const rx = w * 0.09;
    const ry = h * 0.11;
    const invRx = 1 / Math.max(rx, 1);
    const invRy = 1 / Math.max(ry, 1);
    const yMid = cy + ry * 0.15;
    const ySpan = Math.max(ry * 0.95, 1);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = (y * w + x) * 4;
            const a = data[i + 3];
            if (a < 12) continue;
            const nx = (x - cx) * invRx;
            const ny = (y - cy) * invRy;
            const d2 = nx * nx + ny * ny;
            if (d2 > 1.38) continue;
            let radial = (1 - d2 / 1.38) * (1 - d2 / 1.38);
            radial *= Math.min(1, a / 230);
            if (radial < 0.02) continue;
            let vert = 1;
            if (y > yMid) {
                const t = Math.min(1, (y - yMid) / ySpan);
                vert = 1 - 0.5 * t * t;
            }
            const faceW = radial * vert * 0.87;
            if (faceW < 0.015) continue;
            const r = data[i];
            const g = data[i + 1];
            const b = data[i + 2];
            const br = 1 + 0.075 * faceW;
            const cg = 1 + 0.068 * faceW;
            const cb = 1 + 0.058 * faceW;
            let nr = r * br + 4.5 * faceW;
            let ng = g * cg + 2 * faceW;
            let nb = b * cb - 2.5 * faceW;
            const cmul = 1 + 0.045 * faceW;
            nr = (nr - 128) * cmul + 128;
            ng = (ng - 128) * cmul + 128;
            nb = (nb - 128) * cmul + 128;
            const om = 1 - faceW;
            data[i] = nr * faceW + r * om;
            data[i + 1] = ng * faceW + g * om;
            data[i + 2] = nb * faceW + b * om;
            if (data[i] < 0) data[i] = 0;
            else if (data[i] > 255) data[i] = 255;
            if (data[i + 1] < 0) data[i + 1] = 0;
            else if (data[i + 1] > 255) data[i + 1] = 255;
            if (data[i + 2] < 0) data[i + 2] = 0;
            else if (data[i + 2] > 255) data[i + 2] = 255;
        }
    }
}

/** Mild lift + slight warmth on subject (source-atop) — kept subtle (~12% weaker than prior) */
function applyStudioSubjectToneAlign(fgX, w, h) {
    fgX.save();
    fgX.globalCompositeOperation = 'source-atop';
    fgX.fillStyle = 'rgba(252, 253, 255, 0.048)';
    fgX.fillRect(0, 0, w, h);
    fgX.fillStyle = 'rgba(255, 246, 236, 0.031)';
    fgX.fillRect(0, 0, w, h);
    fgX.globalCompositeOperation = 'soft-light';
    fgX.fillStyle = 'rgba(232, 238, 248, 0.044)';
    fgX.fillRect(0, 0, w, h);
    fgX.restore();
    fgX.globalCompositeOperation = 'source-over';
}

/** α < 0.3 → 0 (noise); core left graded until merge step sharpens high-α interior */
function applyStudioMaskNoiseFloor(imd) {
    const d = imd.data;
    const floor = Math.round(0.3 * 255);
    for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] < floor) {
            d[i + 3] = 0;
        }
    }
}

function readAlpha(data, w, x, y) {
    if (x < 0 || x >= w || y < 0 || y >= h) return 0;
    return data[(y * w + x) * 4 + 3];
}

/** |∇α| on sharp full-res mask (central differences) */
function computeAlphaGradientMagnitudeFromRgba(data, w, h) {
    const n = w * h;
    if (!_studioAlphaGradScratch || _studioAlphaGradScratch.length < n) {
        _studioAlphaGradScratch = new Float32Array(n);
    }
    const grad = _studioAlphaGradScratch;
    grad.fill(0);
    let maxG = 1e-5;
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            const ax = (readAlpha(data, w, x + 1, y) - readAlpha(data, w, x - 1, y)) * 0.5;
            const ay = (readAlpha(data, w, x, y + 1) - readAlpha(data, w, x, y - 1)) * 0.5;
            const g = Math.hypot(ax, ay);
            grad[p] = g;
            if (g > maxG) maxG = g;
        }
    }
    return { grad, maxG };
}

/**
 * Blend sharp vs uniformly blurred α: more sharp where |∇α| is high (jaw, frame),
 * more blurred where gradient is low (wispy hair). Noise floor already applied on sharp.
 */
function mergeStudioMaskGradientFeather(sharpData, blurData, w, h, grad, maxG) {
    const inv = 1 / maxG;
    const out = new ImageData(w, h);
    const od = out.data;
    const core = Math.round(0.85 * 255);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = y * w + x;
            const i = p * 4;
            const aS = sharpData[i + 3];
            const aB = blurData[i + 3];
            let wSharp;
            if (x === 0 || y === 0 || x === w - 1 || y === h - 1) {
                wSharp = 0.55;
            } else {
                const gn = grad[p] * inv;
                wSharp = Math.min(1, Math.pow(gn, 0.72) * 1.22);
            }
            let ao = Math.round(aS * wSharp + aB * (1 - wSharp));
            if (aS >= core) {
                ao = Math.max(ao, aS);
            }
            if (aS < 1) ao = 0;
            const taOut = ao / 255;
            if (taOut >= 0.35 && taOut <= 0.75) {
                ao += studioTransitionAlphaMicroNoise(x, y);
                if (ao < 0) ao = 0;
                else if (ao > 255) ao = 255;
            }
            od[i] = 255;
            od[i + 1] = 255;
            od[i + 2] = 255;
            od[i + 3] = ao;
        }
    }
    return out;
}

/** Clears temporal edge buffers so Retake / a new capture is not blended with the previous photo's mask. */
function resetPortraitMaskTemporalState() {
    _maskEdgeTemporalReady = false;
    if (_maskEdgeAlphaPrev && _maskEdgeAlphaPrev.length) _maskEdgeAlphaPrev.fill(0);
    if (_maskEdgeStableCnt && _maskEdgeStableCnt.length) _maskEdgeStableCnt.fill(0);
    if (_maskEdgeStable && _maskEdgeStable.length) _maskEdgeStable.fill(0);
}

/**
 * Post-merge mask: temporal blend + stable lock + leak + prev-FG floor (feather merge unchanged).
 * Hair/prot: ≤20% prev only; no stable lock / leak / speckle on them.
 */
function applyStudioMaskEdgeSolidify(maskImd, w, h, frameRgb) {
    const d = maskImd.data;
    const n = w * h;
    if (!_maskEdgeOrig || _maskEdgeOrig.length < n) {
        _maskEdgeOrig = new Uint8Array(n);
        _maskEdgeA = new Uint8Array(n);
        _maskEdgeHair = new Uint8Array(n);
        _maskEdgeExempt = new Uint8Array(n);
        _maskEdgeReach = new Uint8Array(n);
        _maskEdgeQ = new Int32Array(n);
        _maskEdgeAlphaPrev = new Uint8Array(n);
        _maskEdgeStableCnt = new Uint8Array(n);
        _maskEdgeStable = new Uint8Array(n);
    }
    const orig = _maskEdgeOrig;
    const a = _maskEdgeA;
    const hair = _maskEdgeHair;
    const prot = _maskEdgeExempt;
    const buf = _maskEdgeReach;
    const q = _maskEdgeQ;
    const prev = _maskEdgeAlphaPrev;
    const stableCnt = _maskEdgeStableCnt;
    const stable = _maskEdgeStable;
    const STRONG = Math.round(0.6 * 255);
    const NEIGH_HI = 191;
    const A50 = Math.round(0.5 * 255);
    const A60 = Math.round(0.6 * 255);
    const TLO = Math.round(0.3 * 255);
    const THI = Math.round(0.7 * 255);
    const NOISE = Math.round(0.3 * 255);
    if (_maskEdgeLastW !== w || _maskEdgeLastH !== h) {
        prev.fill(0);
        stableCnt.fill(0);
        stable.fill(0);
        _maskEdgeTemporalReady = false;
        _maskEdgeLastW = w;
        _maskEdgeLastH = h;
    }
    const readOrigA = (px, py) => {
        if (px < 0 || px >= w || py < 0 || py >= h) return 0;
        return orig[py * w + px];
    };
    const floodFromSeeds = (seedFn, passFn) => {
        buf.fill(0);
        let qt = 0;
        let qh = 0;
        for (let p = 0; p < n; p++) {
            if (seedFn(p)) {
                buf[p] = 1;
                q[qt++] = p;
            }
        }
        while (qh < qt) {
            const p = q[qh++];
            const x = p % w;
            const y = (p / w) | 0;
            const tryPush = (np) => {
                if (!buf[np] && passFn(np)) {
                    buf[np] = 1;
                    q[qt++] = np;
                }
            };
            if (x > 0) tryPush(p - 1);
            if (x + 1 < w) tryPush(p + 1);
            if (y > 0) tryPush(p - w);
            if (y + 1 < h) tryPush(p + w);
        }
    };
    hair.fill(0);
    prot.fill(0);
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        const oa = d[i + 3];
        orig[p] = oa;
        if (frameRgb) {
            const L = 0.299 * frameRgb[i] + 0.587 * frameRgb[i + 1] + 0.114 * frameRgb[i + 2];
            const ta0 = oa / 255;
            if (L < 90 && ta0 >= 0.3 && ta0 <= 0.6) {
                hair[p] = 1;
            }
        }
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const p = y * w + x;
            const i = p * 4;
            let strongN = 0;
            let sumA = 0;
            let sumR = 0;
            let sumG = 0;
            let sumB = 0;
            let cntCol = 0;
            let sumSq = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    const na = readOrigA(x + dx, y + dy);
                    sumA += na;
                    sumSq += na * na;
                    if (na > STRONG) {
                        strongN++;
                        if (frameRgb) {
                            const j = ((y + dy) * w + (x + dx)) * 4;
                            sumR += frameRgb[j];
                            sumG += frameRgb[j + 1];
                            sumB += frameRgb[j + 2];
                            cntCol++;
                        }
                    }
                }
            }
            const meanA = sumA / 9;
            const varA = sumSq / 9 - meanA * meanA;
            if (varA < 220) {
                prot[p] = 1;
            }
            if (strongN >= 3 && frameRgb && cntCol > 0) {
                const mr = sumR / cntCol;
                const mg = sumG / cntCol;
                const mb = sumB / cntCol;
                const dr = Math.abs(frameRgb[i] - mr);
                const dg = Math.abs(frameRgb[i + 1] - mg);
                const db = Math.abs(frameRgb[i + 2] - mb);
                if (dr < 40 && dg < 40 && db < 40) {
                    prot[p] = 1;
                }
            }
        }
    }
    const skip = p => hair[p] || prot[p];
    let hasStable = false;
    for (let p = 0; p < n; p++) {
        if (stable[p]) {
            hasStable = true;
            break;
        }
    }
    if (!_maskEdgeTemporalReady) {
        for (let p = 0; p < n; p++) {
            a[p] = orig[p];
        }
    } else {
        for (let p = 0; p < n; p++) {
            const pr = prev[p];
            const cur = orig[p];
            if (skip(p)) {
                a[p] = Math.round(0.8 * cur + 0.2 * pr);
            } else if (stable[p]) {
                a[p] = Math.round(0.8 * pr + 0.2 * cur);
            } else {
                const dlt = cur - pr;
                if (Math.abs(dlt) > 40) {
                    a[p] = Math.round(pr + dlt * 0.5);
                } else {
                    a[p] = Math.round(0.7 * cur + 0.3 * pr);
                }
            }
            if (a[p] < 0) a[p] = 0;
            else if (a[p] > 255) a[p] = 255;
        }
    }
    floodFromSeeds(
        p => stable[p] && a[p] > A60,
        np => a[np] > 30
    );
    const stableConn = buf;
    if (frameRgb) {
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const p = y * w + x;
                if (skip(p)) continue;
                const oa = orig[p];
                if (oa < TLO || oa > THI) continue;
                const i = p * 4;
                let sumR = 0;
                let sumG = 0;
                let sumB = 0;
                let cnt = 0;
                for (let dy = -1; dy <= 1; dy++) {
                    for (let dx = -1; dx <= 1; dx++) {
                        const na = readOrigA(x + dx, y + dy);
                        if (na <= NEIGH_HI) continue;
                        const j = ((y + dy) * w + (x + dx)) * 4;
                        sumR += frameRgb[j];
                        sumG += frameRgb[j + 1];
                        sumB += frameRgb[j + 2];
                        cnt++;
                    }
                }
                if (cnt === 0) continue;
                const mr = sumR / cnt;
                const mg = sumG / cnt;
                const mb = sumB / cnt;
                const dr = Math.abs(frameRgb[i] - mr);
                const dg = Math.abs(frameRgb[i + 1] - mg);
                const db = Math.abs(frameRgb[i + 2] - mb);
                if ((dr > 40 || dg > 40 || db > 40) && (!hasStable || !stableConn[p])) {
                    let v = Math.round(a[p] * 0.5);
                    a[p] = v < 0 ? 0 : v > 255 ? 255 : v;
                }
            }
        }
    }
    floodFromSeeds(
        p => prev[p] > A50,
        np => a[np] > 0
    );
    const prevFg = buf;
    for (let p = 0; p < n; p++) {
        if (skip(p)) continue;
        if (prevFg[p] && orig[p] > NOISE) {
            const floorV = Math.round(prev[p] * 0.8);
            if (a[p] < floorV) {
                a[p] = floorV > 255 ? 255 : floorV;
            }
        }
    }
    for (let p = 0; p < n; p++) {
        if (skip(p)) continue;
        if (a[p] < 20 && prev[p] < 2) {
            a[p] = 0;
        }
    }
    const CAP = 10;
    const CAP_SOFT = 6;
    for (let p = 0; p < n; p++) {
        let v = a[p];
        const cap = skip(p) ? CAP_SOFT : CAP;
        const dlt = v - orig[p];
        v = orig[p] + (dlt > cap ? cap : dlt < -cap ? -cap : dlt);
        a[p] = v < 0 ? 0 : v > 255 ? 255 : v;
    }
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        d[i + 3] = a[p];
    }
    for (let p = 0; p < n; p++) {
        prev[p] = a[p];
    }
    for (let p = 0; p < n; p++) {
        if (skip(p)) {
            stableCnt[p] = 0;
            stable[p] = 0;
        } else if (a[p] > A60) {
            const c = stableCnt[p] + 1;
            stableCnt[p] = c > 250 ? 250 : c;
            stable[p] = stableCnt[p] >= 3 ? 1 : 0;
        } else {
            stableCnt[p] = 0;
            stable[p] = 0;
        }
    }
    _maskEdgeTemporalReady = true;
}

function studioSpillTargetLuminance(br, bg, bb) {
    return 0.299 * br + 0.587 * bg + 0.114 * bb;
}

function studioClampRgbNotPastMidpointTowardNeutral(o, neu, v) {
    const mid = (o + neu) * 0.5;
    if (neu > o && v > mid) return mid;
    if (neu < o && v < mid) return mid;
    return v;
}

/**
 * De-spill: only α/255 < 0.65; skip if Rec.709 L already near target; taper toward 0.65.
 * Transition 0.3–0.7: no stacked sat/av boosts (base k + taper only). Hair 0.3–0.6, L<90: ~50% k,
 * skip if low sat; result stays on original side of midpoint vs neutral; never brighten (L).
 */
function defringeStudioTransitionRegion(data, br, bg, bb, strengthMul) {
    const CORE = Math.round(0.85 * 255);
    const NOISE = Math.round(0.3 * 255);
    const SPILL_HI = 0.65;
    const LT0 = studioSpillTargetLuminance(br, bg, bb);
    const lumNearTarget = 14;
    const strong = strengthMul > 0.9;
    const cap = Math.min(0.99, (0.97 * strengthMul + 0.02) * (strong ? 1.05 : 1));
    const edgeBoost = strong ? 1.12 : 1;
    const maxD = STUDIO_DESPILL_MAX_DELTA;
    const hairKMul = 0.5;
    const transBand = ta => ta >= 0.3 && ta <= 0.7;
    for (let i = 0; i < data.length; i += 4) {
        const a0 = data[i + 3];
        if (a0 <= 0) continue;
        if (a0 >= CORE) continue;
        if (a0 < NOISE) {
            data[i] = 0;
            data[i + 1] = 0;
            data[i + 2] = 0;
            data[i + 3] = 0;
            continue;
        }
        const ta = a0 / 255;
        if (ta >= SPILL_HI) {
            continue;
        }
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        const L = 0.299 * r + 0.587 * g + 0.114 * b;
        if (Math.abs(L - LT0) < lumNearTarget) {
            continue;
        }
        const hairLike = ta >= 0.3 && ta <= 0.6 && L < 90;
        const mx = r > g ? (r > b ? r : b) : (g > b ? g : b);
        const mn = r < g ? (r < b ? r : b) : (g < b ? g : b);
        const sat = mx - mn;
        if (hairLike && sat < 20) {
            continue;
        }
        const inv = (255 - a0) / 255;
        const transBoost = 1 + ((CORE - a0) / (CORE - NOISE)) * 0.42;
        let k = Math.min(cap, (inv * inv * 0.94 + inv * 0.26) * strengthMul * transBoost * edgeBoost);
        if (!transBand(ta)) {
            const av = (r + g + b) / 3;
            if (sat > 14) {
                k = Math.min(cap + 0.1 * strengthMul, k + (sat / 255) * 0.38 * inv * strengthMul * edgeBoost);
            }
            if (av > 175) {
                k = Math.min(cap + 0.12 * strengthMul, k + 0.16 * inv * strengthMul * Math.min(1, (av - 175) / 75) * edgeBoost);
            }
            if (av < 75) {
                k = Math.min(cap + 0.1 * strengthMul, k + 0.13 * inv * strengthMul * Math.min(1, (75 - av) / 75) * edgeBoost);
            }
        }
        const tEdge = (ta - 0.3) / (SPILL_HI - 0.3);
        let spillEdgeFade = 1;
        if (tEdge > 0) {
            spillEdgeFade = tEdge >= 1 ? 0 : 0.5 + 0.5 * Math.cos(Math.PI * tEdge);
        }
        k *= spillEdgeFade;
        if (hairLike) {
            k *= hairKMul;
        }
        const dr = (br - r) * k;
        const dg = (bg - g) * k;
        const db = (bb - b) * k;
        let nr = clampStudioChannelDelta(r, dr, maxD);
        let ng = clampStudioChannelDelta(g, dg, maxD);
        let nb = clampStudioChannelDelta(b, db, maxD);
        if (hairLike) {
            nr = studioClampRgbNotPastMidpointTowardNeutral(r, br, nr);
            ng = studioClampRgbNotPastMidpointTowardNeutral(g, bg, ng);
            nb = studioClampRgbNotPastMidpointTowardNeutral(b, bb, nb);
        }
        let L1 = 0.299 * nr + 0.587 * ng + 0.114 * nb;
        if (L1 > L + 0.35) {
            nr = r;
            ng = g;
            nb = b;
            L1 = L;
        }
        data[i] = nr;
        data[i + 1] = ng;
        data[i + 2] = nb;
    }
}

/** Remove tiny isolated semi-transparent blobs (post matte) */
function removeStudioIsolatedSpeckles(data, w, h) {
    const n = w * h;
    if (!_studioMaskAlphaScratch || _studioMaskAlphaScratch.length < n) {
        _studioMaskAlphaScratch = new Uint16Array(n);
    }
    const t = _studioMaskAlphaScratch;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        t[p] = data[i + 3];
    }
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const p = y * w + x;
            const a = t[p];
            if (a < 12 || a > 95) continue;
            const ta = a / 255;
            if (ta >= 0.3 && ta <= 0.7) continue;
            let s = 0;
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    s += t[p + dy * w + dx];
                }
            }
            if (s < 380) {
                const i = p * 4;
                data[i] = 0;
                data[i + 1] = 0;
                data[i + 2] = 0;
                data[i + 3] = 0;
            }
        }
    }
}

/**
 * Blend each α with its 3×3 neighbourhood (small mix) — knocks down blocky mask noise without the “mush” of a full box blur (preserves fine hair better).
 */
function smoothStudioMaskAlphaWeighted(imd, mix) {
    const w = imd.width;
    const h = imd.height;
    const n = w * h;
    if (!_studioMaskAlphaScratch || _studioMaskAlphaScratch.length < n) {
        _studioMaskAlphaScratch = new Uint16Array(n);
    }
    const tmp = _studioMaskAlphaScratch;
    const d = imd.data;
    for (let p = 0, i = 0; p < n; p++, i += 4) {
        tmp[p] = d[i + 3];
    }
    const om = 1 - mix;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let sum = 0;
            let cnt = 0;
            const p = y * w + x;
            const c = tmp[p];
            for (let dy = -1; dy <= 1; dy++) {
                const yy = y + dy;
                if (yy < 0 || yy >= h) continue;
                for (let dx = -1; dx <= 1; dx++) {
                    const xx = x + dx;
                    if (xx < 0 || xx >= w) continue;
                    sum += tmp[yy * w + xx];
                    cnt++;
                }
            }
            const mean = sum / cnt;
            const i = p * 4;
            d[i + 3] = Math.round(om * c + mix * mean);
        }
    }
}

/**
 * Model mask semantics (body-segmentation): R = part id, G/B = 0, A = foreground probability 0–255.
 * Smoothstep for graded edges; small interior coherence pull reduces patchy “holes” when the model is confident on the person.
 */
function softMaskImageDataFromModelMask(rawIm, quality) {
    const isCapture = quality === 'capture';
    const lo = isCapture ? 9 : 10;
    const hi = 254;
    const mw = rawIm.width;
    const mh = rawIm.height;
    const src = rawIm.data;
    const out = new ImageData(mw, mh);
    const od = out.data;
    const span = hi - lo;
    for (let i = 0; i < od.length; i += 4) {
        const rawA = src[i + 3];
        let a = rawA;
        if (a < lo) a = 0;
        else if (a > hi) a = 255;
        else {
            const t = (a - lo) / span;
            const s = t * t * (3 - 2 * t);
            a = Math.round(255 * s);
        }
        if (rawA > 208 && a > 0 && a < 88) {
            a = Math.min(255, Math.round((a + rawA * 0.86) * 0.5));
        }
        od[i] = 255;
        od[i + 1] = 255;
        od[i + 2] = 255;
        od[i + 3] = a;
    }
    return out;
}

/**
 * Renders one frame from video onto destCanvas.
 * @returns {Promise<boolean>} true if blur/solid portrait effect was applied; false for natural or fallback.
 */
function ensureCanvasSize(canvas, tw, th) {
    if (!canvas || tw < 2 || th < 2) return false;
    if (canvas.width !== tw || canvas.height !== th) {
        canvas.width = tw;
        canvas.height = th;
    }
    return true;
}

function copyVideoFrameToCanvas(videoEl, targetCanvas, tw, th) {
    if (!ensureCanvasSize(targetCanvas, tw, th)) return false;
    const sctx = targetCanvas.getContext('2d', { alpha: false });
    try {
        sctx.save();
        sctx.setTransform(1, 0, 0, 1, 0, 0);
        sctx.globalAlpha = 1;
        sctx.globalCompositeOperation = 'source-over';
        sctx.filter = 'none';
        sctx.restore();
        sctx.clearRect(0, 0, tw, th);
        sctx.drawImage(videoEl, 0, 0, tw, th);
    } catch {
        return false;
    }
    return true;
}

/**
 * @param {'preview'|'capture'} [quality] — capture uses slightly stronger mask feather for still photos.
 */
async function renderPortraitFrameToCanvas(destCanvas, videoEl, mode, quality = 'preview') {
    let w = Math.floor(videoEl.videoWidth);
    let h = Math.floor(videoEl.videoHeight);
    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) return false;
    /* Many vision models expect even width/height */
    w -= w % 2;
    h -= h % 2;
    if (w < 2 || h < 2) return false;

    /* Resizing clears the bitmap — only when dimensions change stops preview flicker */
    if (!ensureCanvasSize(destCanvas, w, h)) return false;
    const ctx = destCanvas.getContext('2d');
    if (mode === 'none' || !mode) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        ctx.clearRect(0, 0, w, h);
        ctx.restore();
        ctx.drawImage(videoEl, 0, 0, w, h);
        return false;
    }
    if (!_segmentSourceCanvas) _segmentSourceCanvas = document.createElement('canvas');
    if (!copyVideoFrameToCanvas(videoEl, _segmentSourceCanvas, w, h)) {
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        ctx.clearRect(0, 0, w, h);
        ctx.restore();
        ctx.drawImage(videoEl, 0, 0, w, h);
        return false;
    }
    const frameCanvas = _segmentSourceCanvas;
    try {
        const API = bodySegApi();
        if (!API) return false;
        const segmenter = await getPortraitSegmenter();
        const people = await segmenter.segmentPeople(frameCanvas);
        if (mode === 'blur') {
            if (!_portraitBlurStageCanvas) _portraitBlurStageCanvas = document.createElement('canvas');
            ensureCanvasSize(_portraitBlurStageCanvas, w, h);
            const bctx = _portraitBlurStageCanvas.getContext('2d');
            bctx.save();
            bctx.setTransform(1, 0, 0, 1, 0, 0);
            bctx.globalAlpha = 1;
            bctx.globalCompositeOperation = 'source-over';
            bctx.filter = 'none';
            bctx.clearRect(0, 0, w, h);
            bctx.restore();
            await API.drawBokehEffect(_portraitBlurStageCanvas, frameCanvas, people, 0.42, 8, 11, false);
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.filter = 'none';
            ctx.clearRect(0, 0, w, h);
            ctx.restore();
            ctx.drawImage(_portraitBlurStageCanvas, 0, 0, w, h);
            return true;
        }
        if (mode === 'solid') {
            const list = Array.isArray(people) ? people : (people ? [people] : []);
            const seg = list[0];
            if (!seg?.mask) {
                ctx.save();
                ctx.setTransform(1, 0, 0, 1, 0, 0);
                ctx.globalAlpha = 1;
                ctx.globalCompositeOperation = 'source-over';
                ctx.filter = 'none';
                ctx.clearRect(0, 0, w, h);
                ctx.restore();
                ctx.drawImage(frameCanvas, 0, 0, w, h);
                return false;
            }
            if (!_solidMaskCanvas) _solidMaskCanvas = document.createElement('canvas');
            if (!_solidFgCanvas) _solidFgCanvas = document.createElement('canvas');
            if (!_solidMaskBlurredCanvas) _solidMaskBlurredCanvas = document.createElement('canvas');
            if (!_solidMaskHiCanvas) _solidMaskHiCanvas = document.createElement('canvas');
            const mC = _solidMaskCanvas;
            const mBlur = _solidMaskBlurredCanvas;
            const fgC = _solidFgCanvas;
            const mHi = _solidMaskHiCanvas;
            const mctx = mC.getContext('2d');
            let maskW;
            let maskH;
            let usedSoftMaskStudioPath = false;
            try {
                const rawIm = await Promise.resolve(seg.mask.toImageData());
                if (!rawIm?.data?.length || rawIm.width < 2 || rawIm.height < 2) {
                    throw new Error('empty soft mask');
                }
                const soft = softMaskImageDataFromModelMask(rawIm, quality);
                applyStudioMaskNoiseFloor(soft);
                smoothStudioMaskAlphaWeighted(soft, quality === 'capture' ? 0.2 : 0.16);
                ensureCanvasSize(mC, soft.width, soft.height);
                mctx.save();
                mctx.setTransform(1, 0, 0, 1, 0, 0);
                mctx.globalAlpha = 1;
                mctx.globalCompositeOperation = 'source-over';
                mctx.filter = 'none';
                mctx.restore();
                mctx.clearRect(0, 0, mC.width, mC.height);
                mctx.putImageData(soft, 0, 0);
                maskW = soft.width;
                maskH = soft.height;
                usedSoftMaskStudioPath = true;
            } catch {
                const bin = await API.toBinaryMask(
                    people,
                    { r: 255, g: 255, b: 255, a: 255 },
                    { r: 0, g: 0, b: 0, a: 0 },
                    false,
                    0.36
                );
                if (!bin?.width || !bin.height) {
                    ctx.save();
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.globalAlpha = 1;
                    ctx.globalCompositeOperation = 'source-over';
                    ctx.filter = 'none';
                    ctx.clearRect(0, 0, w, h);
                    ctx.restore();
                    ctx.drawImage(frameCanvas, 0, 0, w, h);
                    return false;
                }
                ensureCanvasSize(mC, bin.width, bin.height);
                mctx.save();
                mctx.setTransform(1, 0, 0, 1, 0, 0);
                mctx.globalAlpha = 1;
                mctx.globalCompositeOperation = 'source-over';
                mctx.filter = 'none';
                mctx.restore();
                mctx.clearRect(0, 0, mC.width, mC.height);
                mctx.putImageData(bin, 0, 0);
                maskW = bin.width;
                maskH = bin.height;
            }

            const mbCtx = mBlur.getContext('2d');
            const px = w * h;
            const isCap = quality === 'capture';
            const hiPxCap = isCap ? 2_000_000 : 1_350_000;
            const useHiFeather = px <= hiPxCap;
            /* Weighted α already anti-aliases lightly — keep GPU feather modest for sharp-yet-smooth studio edges */
            const hiBlur = isCap ? 4 : 2;
            const flatBlur = isCap ? 3 : 2;
            if (useHiFeather) {
                const cap = 1600;
                const hw = Math.min(Math.max(w * 2, w), cap);
                const hh = Math.min(Math.max(h * 2, h), cap);
                ensureCanvasSize(mHi, hw, hh);
                const hiCtx = mHi.getContext('2d');
                hiCtx.save();
                hiCtx.setTransform(1, 0, 0, 1, 0, 0);
                hiCtx.globalAlpha = 1;
                hiCtx.globalCompositeOperation = 'source-over';
                hiCtx.filter = 'none';
                hiCtx.restore();
                hiCtx.clearRect(0, 0, hw, hh);
                hiCtx.imageSmoothingEnabled = true;
                hiCtx.imageSmoothingQuality = 'high';
                hiCtx.filter = `blur(${hiBlur}px)`;
                hiCtx.drawImage(mC, 0, 0, maskW, maskH, 0, 0, hw, hh);
                hiCtx.filter = 'none';
                ensureCanvasSize(mBlur, w, h);
                mbCtx.save();
                mbCtx.setTransform(1, 0, 0, 1, 0, 0);
                mbCtx.globalAlpha = 1;
                mbCtx.globalCompositeOperation = 'source-over';
                mbCtx.filter = 'none';
                mbCtx.restore();
                mbCtx.clearRect(0, 0, w, h);
                mbCtx.imageSmoothingEnabled = true;
                mbCtx.imageSmoothingQuality = 'high';
                mbCtx.drawImage(mHi, 0, 0, hw, hh, 0, 0, w, h);
            } else {
                ensureCanvasSize(mBlur, w, h);
                mbCtx.save();
                mbCtx.setTransform(1, 0, 0, 1, 0, 0);
                mbCtx.globalAlpha = 1;
                mbCtx.globalCompositeOperation = 'source-over';
                mbCtx.filter = 'none';
                mbCtx.restore();
                mbCtx.clearRect(0, 0, w, h);
                mbCtx.imageSmoothingEnabled = true;
                mbCtx.imageSmoothingQuality = 'high';
                mbCtx.filter = `blur(${flatBlur}px)`;
                mbCtx.drawImage(mC, 0, 0, maskW, maskH, 0, 0, w, h);
                mbCtx.filter = 'none';
            }

            let frameRgbForMask = null;
            try {
                const fctx = frameCanvas.getContext('2d', { willReadFrequently: true });
                frameRgbForMask = fctx.getImageData(0, 0, w, h).data;
            } catch (_) {
                /* hair guard uses luminance only when frame is readable */
            }

            if (usedSoftMaskStudioPath) {
                if (!_solidMaskFullResCanvas) _solidMaskFullResCanvas = document.createElement('canvas');
                ensureCanvasSize(_solidMaskFullResCanvas, w, h);
                const frx = _solidMaskFullResCanvas.getContext('2d', { willReadFrequently: true });
                frx.save();
                frx.setTransform(1, 0, 0, 1, 0, 0);
                frx.globalAlpha = 1;
                frx.globalCompositeOperation = 'source-over';
                frx.filter = 'none';
                frx.restore();
                frx.imageSmoothingEnabled = true;
                frx.imageSmoothingQuality = 'high';
                frx.clearRect(0, 0, w, h);
                frx.drawImage(mC, 0, 0, maskW, maskH, 0, 0, w, h);
                try {
                    const sharpId = frx.getImageData(0, 0, w, h);
                    const blurId = mbCtx.getImageData(0, 0, w, h);
                    const { grad, maxG } = computeAlphaGradientMagnitudeFromRgba(sharpId.data, w, h);
                    const merged = mergeStudioMaskGradientFeather(sharpId.data, blurId.data, w, h, grad, maxG);
                    applyStudioMaskEdgeSolidify(merged, w, h, frameRgbForMask);
                    mbCtx.putImageData(merged, 0, 0);
                } catch (_) {
                    try {
                        const blurOnly = mbCtx.getImageData(0, 0, w, h);
                        applyStudioMaskEdgeSolidify(blurOnly, w, h, frameRgbForMask);
                        mbCtx.putImageData(blurOnly, 0, 0);
                    } catch (_e) {
                        /* keep uniform blur mask */
                    }
                }
            } else {
                try {
                    const blurOnly = mbCtx.getImageData(0, 0, w, h);
                    applyStudioMaskEdgeSolidify(blurOnly, w, h, frameRgbForMask);
                    mbCtx.putImageData(blurOnly, 0, 0);
                } catch (_) {
                    /* keep blurred mask */
                }
            }

            ensureCanvasSize(fgC, w, h);
            const fgX = fgC.getContext('2d', { willReadFrequently: true });
            fgX.save();
            fgX.setTransform(1, 0, 0, 1, 0, 0);
            fgX.globalAlpha = 1;
            fgX.globalCompositeOperation = 'source-over';
            fgX.filter = 'none';
            fgX.restore();
            fgX.imageSmoothingEnabled = true;
            fgX.imageSmoothingQuality = 'high';
            fgX.clearRect(0, 0, w, h);
            fgX.drawImage(frameCanvas, 0, 0, w, h);
            fgX.globalCompositeOperation = 'destination-in';
            fgX.drawImage(mBlur, 0, 0, w, h);
            fgX.globalCompositeOperation = 'source-over';
            try {
                const edgeFix = fgX.getImageData(0, 0, w, h);
                const dmul = quality === 'capture' ? 1 : 0.64;
                defringeStudioTransitionRegion(
                    edgeFix.data,
                    STUDIO_DEFRINGE_RGB.r,
                    STUDIO_DEFRINGE_RGB.g,
                    STUDIO_DEFRINGE_RGB.b,
                    dmul
                );
                suppressStudioEdgeAlphaNoise(edgeFix.data);
                removeStudioIsolatedSpeckles(edgeFix.data, w, h);
                applyStudioFaceRegionLighting(edgeFix.data, w, h);
                fgX.putImageData(edgeFix, 0, 0);
            } catch (_) {
                /* tainted canvas etc. */
            }
            applyStudioSubjectToneAlign(fgX, w, h);
            ctx.save();
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.filter = 'none';
            ctx.clearRect(0, 0, w, h);
            ctx.restore();
            fillStudioBackdropGradient(ctx, w, h);
            drawStudioContactShadow(ctx, w, h);
            ctx.drawImage(fgC, 0, 0);
            return true;
        }
    } catch (err) {
        console.warn('Portrait background:', err);
    }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    ctx.filter = 'none';
    ctx.clearRect(0, 0, w, h);
    ctx.restore();
    ctx.drawImage(frameCanvas, 0, 0, w, h);
    return false;
}

function cancelPortraitPreviewLoop() {
    portraitPreviewActive = false;
    portraitPreviewProcessing = false;
    portraitPreviewNextAllowed = 0;
    if (portraitPreviewVfcHandle != null && typeof video.cancelVideoFrameCallback === 'function') {
        try { video.cancelVideoFrameCallback(portraitPreviewVfcHandle); } catch (_) { /* ignore */ }
    }
    portraitPreviewVfcHandle = null;
    if (portraitPreviewRafId != null) {
        cancelAnimationFrame(portraitPreviewRafId);
        portraitPreviewRafId = null;
    }
    if (webcamCanvasArea) webcamCanvasArea.classList.remove('preview-fx-active');
    video.style.opacity = '';
}

function schedulePortraitPreviewNext() {
    if (!portraitPreviewActive || !video.srcObject) return;
    if (getPhotoBgMode() === 'none') {
        cancelPortraitPreviewLoop();
        return;
    }
    if (typeof video.requestVideoFrameCallback === 'function') {
        portraitPreviewVfcHandle = video.requestVideoFrameCallback(() => {
            portraitPreviewVfcHandle = null;
            void runOnePortraitPreviewFrame();
        });
    } else {
        portraitPreviewRafId = requestAnimationFrame(() => {
            portraitPreviewRafId = null;
            void runOnePortraitPreviewFrame();
        });
    }
}

async function runOnePortraitPreviewFrame() {
    if (!portraitPreviewActive || !video.srcObject || !videoPreviewEffect) return;
    if (getPhotoBgMode() === 'none') {
        cancelPortraitPreviewLoop();
        return;
    }
    if (portraitPreviewProcessing) {
        return;
    }
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !video.videoWidth) {
        schedulePortraitPreviewNext();
        return;
    }
    const now = performance.now();
    if (now < portraitPreviewNextAllowed) {
        const wait = Math.max(8, portraitPreviewNextAllowed - now);
        setTimeout(() => {
            if (portraitPreviewActive && video.srcObject) schedulePortraitPreviewNext();
        }, wait);
        return;
    }
    portraitPreviewProcessing = true;
    try {
        await renderPortraitFrameToCanvas(videoPreviewEffect, video, getPhotoBgMode());
        if (webcamCanvasArea) webcamCanvasArea.classList.add('preview-fx-active');
    } catch (err) {
        console.warn('Portrait preview frame:', err);
        cancelPortraitPreviewLoop();
        showToast('Background effect failed to load — check network or try Natural.', 'warning');
    } finally {
        portraitPreviewProcessing = false;
        portraitPreviewNextAllowed = performance.now() + PORTRAIT_PREVIEW_MIN_GAP_MS;
    }
    if (portraitPreviewActive && video.srcObject && getPhotoBgMode() !== 'none') {
        schedulePortraitPreviewNext();
    }
}

async function startPortraitPreviewLoop() {
    if (!videoPreviewEffect || !video.srcObject) return;
    cancelPortraitPreviewLoop();
    if (getPhotoBgMode() === 'none') return;
    synchronouslyPaintRawPreviewOnEffectCanvas();
    try {
        await ensurePortraitMlLibs();
    } catch (err) {
        console.warn(err);
        showToast('Could not load portrait tools — use Natural or retry.', 'warning');
        const nat = document.querySelector('input[name="photoBgMode"][value="none"]');
        if (nat) nat.checked = true;
        video.style.opacity = '';
        if (webcamCanvasArea) webcamCanvasArea.classList.remove('preview-fx-active');
        return;
    }
    portraitPreviewActive = true;
    video.style.opacity = '0';
    schedulePortraitPreviewNext();
}

async function startCamera() {
    try {
        cancelPortraitPreviewLoop();
        schedulePortraitMlWarmup();
        croppedPhoto.style.display = 'none';
        /* After capture, cropped canvas stayed on top (higher z-index) — hid live video and felt “frozen” on Retake */
        // Stop any existing stream before requesting a new one
        if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
        video.srcObject = null;
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 800, height: 1000 } });
        video.srcObject = stream;
        video.style.display = 'block';
        video.style.opacity = '';
        cameraError.textContent = '';
        photoPlaceholder.style.display = 'none';
        btnStart.style.display = 'none';
        btnCapture.style.display = 'inline-flex';
        btnRetake.style.display = 'none';
        btnGenerate.style.display = 'none';
        video.addEventListener('playing', () => {
            void startPortraitPreviewLoop();
        }, { once: true });
    } catch (err) { cameraError.textContent = 'Camera failed: ' + err.message; }
}

async function capturePhoto() {
    cancelPortraitPreviewLoop();
    resetPortraitMaskTemporalState();
    if (!video.srcObject) return;
    const vw = video.videoWidth, vh = video.videoHeight;
    if (!vw || !vh) {
        showAlert('Camera is still starting — wait a moment, then capture again.');
        return;
    }
    const mode = getPhotoBgMode();
    const prevCap = btnCapture.textContent;
    if (mode !== 'none') {
        btnCapture.disabled = true;
        btnCapture.textContent = 'Processing…';
    }
    try {
        const appliedFx = await renderPortraitFrameToCanvas(croppedPhoto, video, mode, 'capture');
        if (mode !== 'none' && !appliedFx) {
            showToast('Portrait background unavailable — saved the original photo.', 'warning');
        }
        const fullQualityDataURL = croppedPhoto.toDataURL('image/jpeg', 0.95);
        const cloudDataURL = croppedPhoto.toDataURL('image/jpeg', 0.5);
        capturedPhotoDataURL = fullQualityDataURL;
        capturedCloudDataURL = cloudDataURL;

        video.style.display = 'none';
        croppedPhoto.style.display = 'block';
        croppedPhoto.classList.remove('photo-fade-in');
        void croppedPhoto.offsetWidth;
        croppedPhoto.classList.add('photo-fade-in');
        btnCapture.style.display = 'none';
        btnRetake.style.display = 'inline-flex';
        btnGenerate.style.display = 'inline-flex';
        if (stream) {
            stream.getTracks().forEach(t => t.stop());
            stream = null;
        }
        video.srcObject = null;
        btnStart.style.display = 'none';
    } finally {
        if (mode !== 'none') {
            btnCapture.disabled = false;
            btnCapture.textContent = prevCap;
        }
    }
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

    /* Tall portrait slot; drawImageCover scales uniformly to fill it (no stretch), clips excess like a zoomed crop */
    const phY = 160, phW = 435, phH = 575, phX = (CR80_W - phW) / 2;
    if (capturedPhotoDataURL) {
        try {
            const ph = await loadImage(capturedPhotoDataURL);
            ctx.save();
            ctx.beginPath(); ctx.roundRect(phX, phY, phW, phH, 15); ctx.clip();
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(phX, phY, phW, phH);
            drawImageCover(ctx, ph, phX, phY, phW, phH);
            ctx.restore();
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
        if (resp.status === 401) {
            forceOperatorReLogin('Session expired or the server was restarted. Please sign in again to save.');
            return;
        }
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
    const contractorOther = document.getElementById('contractorOther');
    const designationOther = document.getElementById('designationOther');
    if (contractorOther) contractorOther.value = '';
    if (designationOther) designationOther.value = '';
    updateOthersFieldsVisibility();
    document.getElementById('contact').value = '';
    document.getElementById('doi').value = '';
    document.getElementById('validity').value = '';
    document.getElementById('issueDate').value = '';

    capturedPhotoDataURL = null;
    capturedCloudDataURL = null;
    void disposePortraitSegmenter();
    const bgNone = document.querySelector('input[name="photoBgMode"][value="none"]');
    if (bgNone) bgNone.checked = true;
    video.style.display = 'none';
    croppedPhoto.style.display = 'none';
    croppedPhoto.classList.remove('photo-fade-in');
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
    initSession().catch((e) => console.error('initSession failed:', e));

    const btnViewRecords = document.getElementById('btnViewRecords');
    const btnExportSiteExcel = document.getElementById('btnExportSiteExcel');
    const closeRecords = document.getElementById('closeRecords');

    if (btnViewRecords) btnViewRecords.onclick = loadSiteRecords;
    if (btnExportSiteExcel) btnExportSiteExcel.onclick = exportSiteToExcel;
    if (closeRecords) closeRecords.onclick = () => document.getElementById('recordsModal').style.display = 'none';

    const closeAlert = document.getElementById('closeAlert');
    if (closeAlert) closeAlert.onclick = () => document.getElementById('customAlert').style.display = 'none';

    const selContractor = document.getElementById('contractor');
    const selDesignation = document.getElementById('designation');
    if (selContractor) selContractor.addEventListener('change', updateOthersFieldsVisibility);
    if (selDesignation) selDesignation.addEventListener('change', updateOthersFieldsVisibility);

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
    btnCapture.onclick = () => { void capturePhoto(); };

    document.querySelectorAll('input[name="photoBgMode"]').forEach((radio) => {
        radio.addEventListener('change', () => {
            if (!video.srcObject || video.style.display === 'none') return;
            const mode = getPhotoBgMode();
            if (mode === 'none') {
                cancelPortraitPreviewLoop();
                return;
            }
            /* Blur ↔ studio share the same segmenter; restarting the loop cancelled VFC and re-hid video — felt like a long pause */
            if (portraitPreviewActive && photoPortraitSegmenter) {
                portraitPreviewNextAllowed = 0;
                if (!portraitPreviewProcessing) {
                    void runOnePortraitPreviewFrame();
                }
                return;
            }
            void startPortraitPreviewLoop();
        });
    });
    btnRetake.onclick = () => {
        capturedPhotoDataURL = null;
        capturedCloudDataURL = null;
        isSaved = false;
        resetPortraitMaskTemporalState();
        croppedPhoto.style.display = 'none';
        croppedPhoto.classList.remove('photo-fade-in');
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
