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
    /** Downscaled RGB snapshot for segmentation (never full-res ML). */
    let _portraitSegCanvas = null;
    let _solidMaskBlurredCanvas = null;
    /** Feathered mask scaled to full video dimensions (single coordinate system for compositing). */
    let _portraitMaskFullCanvas = null;
    let _portraitLastValidMaskCanvas = null;
    let portraitSegmentationInFlight = false;
    /** Single blit to preview canvas reduces visible tearing vs painting bokeh directly on the live canvas. */
    let _portraitBlurStageCanvas = null;
    let portraitPreviewNextAllowed = 0;
    /** Target max dimension (px) for segmentation input; adapted down on slow frames. */
let portraitSegMaxDim = 720;
    /** Minimum ms between segmentation ticks (~10–15 FPS). */
    let portraitMinFrameGapMs = Math.round(1000 / 12);
    let portraitTfBackendKind = 'webgl';
    let portraitSlowFrameStreak = 0;
    let _softMaskReuse = null;
let _prevMaskAlpha = null;
    let _warmSegCanvas = null;
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
            if (typeof tf.getBackend === 'function') {
                portraitTfBackendKind = tf.getBackend() === 'webgl' ? 'webgl' : 'cpu';
            }
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
                    await tf.ready();
                } catch {
                    portraitTfBackendKind = 'cpu';
                    await tf.setBackend('cpu');
                    await tf.ready();
                }
                if (typeof tf.getBackend === 'function') {
                    portraitTfBackendKind = tf.getBackend() === 'webgl' ? 'webgl' : 'cpu';
                }
                applyPortraitPerfBaseline();
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
                await warmPortraitSegmenterOnce();
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

    function applyPortraitPerfBaseline() {
    portraitSegMaxDim = portraitTfBackendKind === 'webgl' ? 720 : 640;
        portraitMinFrameGapMs = portraitTfBackendKind === 'webgl' ? Math.round(1000 / 12) : Math.round(1000 / 10);
        portraitSlowFrameStreak = 0;
    }

    function portraitNoteProcessingDuration(ms) {
        if (ms > 120) {
            portraitSlowFrameStreak++;
            if (portraitSlowFrameStreak >= 3) {
                portraitSlowFrameStreak = 0;
                portraitSegMaxDim = Math.max(240, portraitSegMaxDim - 80);
                portraitMinFrameGapMs = Math.min(150, portraitMinFrameGapMs + 12);
            }
        } else {
            portraitSlowFrameStreak = Math.max(0, portraitSlowFrameStreak - 1);
        }
    }

    /** Even dimensions; longest side capped at maxDim (480p-class segmentation). */
    function computePortraitSegDims(fullW, fullH, maxDim) {
        const scale = Math.min(1, maxDim / Math.max(fullW, fullH));
        let sw = Math.max(2, Math.floor(fullW * scale));
        let sh = Math.max(2, Math.floor(fullH * scale));
        sw -= sw % 2;
        sh -= sh % 2;
        return { sw, sh };
    }

    async function warmPortraitSegmenterOnce() {
        try {
            const seg = await getPortraitSegmenter();
            if (!_warmSegCanvas) _warmSegCanvas = document.createElement('canvas');
            _warmSegCanvas.width = 160;
            _warmSegCanvas.height = 160;
            const wx = _warmSegCanvas.getContext('2d', { alpha: false });
            wx.fillStyle = '#505050';
            wx.fillRect(0, 0, 160, 160);
            await seg.segmentPeople(_warmSegCanvas);
        } catch (_) { /* best-effort warm-up */ }
    }

    /** Reset adaptive portrait tuning on retake / new capture. */
    function resetPortraitMaskTemporalState() {
        applyPortraitPerfBaseline();
    _prevMaskAlpha = null;
    }

    /* Soft radial “key” backdrop (brighter behind subject) + edge vignette — reads like lit seamless paper */
    const STUDIO_BACKDROP_CENTER = '#fcfdff';
    const STUDIO_BACKDROP_MID = '#f4f6fa';
    const STUDIO_BACKDROP_EDGE = '#e1e4ed';

    /** Radial studio fill: brighter key behind upper subject, gentle falloff toward slightly cooler edges */
    function fillStudioBackdropGradient(ctx, w, h) {
        ctx.save();
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.filter = 'none';
        const mx = w * 0.5;
        const my = h * 0.34;
        const r = Math.hypot(w, h) * 0.78;
        const g = ctx.createRadialGradient(mx, my, 0, mx, my, r);
        g.addColorStop(0, STUDIO_BACKDROP_CENTER);
        g.addColorStop(0.42, STUDIO_BACKDROP_MID);
        g.addColorStop(1, STUDIO_BACKDROP_EDGE);
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
        ctx.restore();
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

    /** Drop very low alpha (sensor / model speckle) before GPU feather. */
    function applyStudioMaskNoiseFloor(imd) {
        const d = imd.data;
        const floor = Math.round(0.3 * 255);
        for (let i = 0; i < d.length; i += 4) {
            if (d[i + 3] < floor) {
                d[i + 3] = 0;
            }
        }
    }

    /**
     * Model mask semantics (body-segmentation): R = part id, G/B = 0, A = foreground probability 0–255.
     * Keeps a softer confidence ramp to preserve edge detail and hair strands.
     */
    function softMaskImageDataFromModelMask(rawIm, quality) {
        const SOFT_LO = 100;
        const SOFT_HI = 180;
        const mw = rawIm.width;
        const mh = rawIm.height;
        if (!_softMaskReuse || _softMaskReuse.width !== mw || _softMaskReuse.height !== mh) {
            _softMaskReuse = new ImageData(mw, mh);
        }
        const od = _softMaskReuse.data;
        for (let i = 0; i < od.length; i += 4) {
            const rawA = rawIm.data[i + 3];
            let a = 0;
            if (rawA < SOFT_LO) {
                a = 0;
            } else if (rawA > SOFT_HI) {
                a = 255;
            } else {
                a = rawA;
            }
            od[i] = 255;
            od[i + 1] = 255;
            od[i + 2] = 255;
            od[i + 3] = a;
        }
        return _softMaskReuse;
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

    const PORTRAIT_MASK_ALPHA_SAMPLE = 5;
    /** Minimum % of pixels with alpha > sample threshold to treat mask as “strong” (logging only). */
    const PORTRAIT_MASK_STRONG_COVERAGE_PCT = 2;

    /** % of pixels with alpha > `alphaThreshold` (0–100). */
    function portraitMaskCoveragePercent(imd, alphaThreshold = PORTRAIT_MASK_ALPHA_SAMPLE) {
        if (!imd?.data?.length) return 0;
        const d = imd.data;
        const n = d.length >> 2;
        if (n === 0) return 0;
        let hi = 0;
        for (let i = 3; i < d.length; i += 4) {
            if (d[i] > alphaThreshold) hi++;
        }
        return (100 * hi) / n;
    }

    /** Fail-safe only when segmentation produced no usable foreground alpha. */
    function portraitMaskIsCompletelyEmpty(imd) {
        return portraitMaskCoveragePercent(imd, PORTRAIT_MASK_ALPHA_SAMPLE) <= 0;
    }

    /** Visualization-only: strengthen soft alphas so borderline masks still matte (does not affect ML). */
    function portraitMaskAlphaBoostVisualization(imd) {
        const d = imd.data;
        for (let i = 3; i < d.length; i += 4) {
            if (d[i] === 0) continue;
            d[i] = Math.min(255, Math.round(d[i] * 1.5));
        }
    }

    /** `?portraitDebugMask=1` or `window.__ICG_PORTRAIT_DEBUG_MASK = true` — draws the feathered mask full-frame. */
    function portraitDebugMaskEnabled() {
        if (typeof window !== 'undefined' && window.__ICG_PORTRAIT_DEBUG_MASK) return true;
        try {
            return typeof location !== 'undefined' && new URLSearchParams(location.search).get('portraitDebugMask') === '1';
        } catch {
            return false;
        }
    }

    /** `?portraitLog=1` — extra console logging + weak-mask dev stripe. */
    function portraitVerboseMaskLog() {
        if (typeof window !== 'undefined' && window.__ICG_PORTRAIT_VERBOSE_LOG) return true;
        try {
            return typeof location !== 'undefined' && new URLSearchParams(location.search).get('portraitLog') === '1';
        } catch {
            return false;
        }
    }

    /** `?portraitHardTest=1` — white background + masked subject only (compositing sanity check). */
    function portraitHardTestEnabled() {
        if (typeof window !== 'undefined' && window.__ICG_PORTRAIT_HARD_TEST) return true;
        try {
            return typeof location !== 'undefined' && new URLSearchParams(location.search).get('portraitHardTest') === '1';
        } catch {
            return false;
        }
    }

    /**
     * Builds soft or binary mask on mC and feathered alpha on mBlur. Mutates _solidMaskCanvas / _solidMaskBlurredCanvas.
     * Contexts are acquired after each `ensureCanvasSize` so they are never stale.
     * @returns {Promise<{ ok: boolean, maskW: number, maskH: number, coveragePercent: number }>}
     */
    async function buildPortraitFeatheredMask(people, API, quality, mC, mBlur) {
        const list = Array.isArray(people) ? people : (people ? [people] : []);
        const seg = list[0];
        let maskW = 0;
        let maskH = 0;
        let coveragePercent = 0;

        const commitBinaryToMC = (bin) => {
            maskW = bin.width;
            maskH = bin.height;
            coveragePercent = portraitMaskCoveragePercent(bin, PORTRAIT_MASK_ALPHA_SAMPLE);
            coveragePercent = portraitMaskCoveragePercent(bin, PORTRAIT_MASK_ALPHA_SAMPLE);
            if (portraitMaskIsCompletelyEmpty(bin)) {
                return false;
            }
            if (coveragePercent > 0 && coveragePercent < PORTRAIT_MASK_STRONG_COVERAGE_PCT) {
                portraitMaskAlphaBoostVisualization(bin);
                coveragePercent = portraitMaskCoveragePercent(bin, PORTRAIT_MASK_ALPHA_SAMPLE);
            }
            ensureCanvasSize(mC, maskW, maskH);
            const mx = mC.getContext('2d', { alpha: true });
            mx.save();
            mx.setTransform(1, 0, 0, 1, 0, 0);
            mx.globalAlpha = 1;
            mx.globalCompositeOperation = 'source-over';
            mx.filter = 'none';
            mx.clearRect(0, 0, maskW, maskH);
            mx.putImageData(bin, 0, 0);
            mx.restore();
            return true;
        };

        const commitSoftToMC = (soft) => {
            applyStudioMaskNoiseFloor(soft);
            coveragePercent = portraitMaskCoveragePercent(soft, PORTRAIT_MASK_ALPHA_SAMPLE);
            coveragePercent = portraitMaskCoveragePercent(soft, PORTRAIT_MASK_ALPHA_SAMPLE);
            if (portraitMaskIsCompletelyEmpty(soft)) {
                return false;
            }
            if (coveragePercent > 0 && coveragePercent < PORTRAIT_MASK_STRONG_COVERAGE_PCT) {
                portraitMaskAlphaBoostVisualization(soft);
                coveragePercent = portraitMaskCoveragePercent(soft, PORTRAIT_MASK_ALPHA_SAMPLE);
            }
            maskW = soft.width;
            maskH = soft.height;
            ensureCanvasSize(mC, maskW, maskH);
            const mx = mC.getContext('2d', { alpha: true });
            mx.save();
            mx.setTransform(1, 0, 0, 1, 0, 0);
            mx.globalAlpha = 1;
            mx.globalCompositeOperation = 'source-over';
            mx.filter = 'none';
            mx.clearRect(0, 0, maskW, maskH);
            mx.putImageData(soft, 0, 0);
            mx.restore();
            return true;
        };

        if (!seg?.mask) {
            const bin = await API.toBinaryMask(
                people,
                { r: 255, g: 255, b: 255, a: 255 },
                { r: 0, g: 0, b: 0, a: 0 },
                false,
                0.36
            );
            if (!bin?.width || !bin.height || !commitBinaryToMC(bin)) {
                return { ok: false, maskW: 0, maskH: 0, coveragePercent: 0 };
            }
        } else {
            try {
                const rawIm = await Promise.resolve(seg.mask.toImageData());
                if (!rawIm?.data?.length || rawIm.width < 2 || rawIm.height < 2) {
                    throw new Error('empty soft mask');
                }
                const soft = softMaskImageDataFromModelMask(rawIm, quality);
                if (!commitSoftToMC(soft)) {
                    return { ok: false, maskW: 0, maskH: 0, coveragePercent: 0 };
                }
            } catch {
                const bin = await API.toBinaryMask(
                    people,
                    { r: 255, g: 255, b: 255, a: 255 },
                    { r: 0, g: 0, b: 0, a: 0 },
                    false,
                    0.36
                );
                if (!bin?.width || !bin.height || !commitBinaryToMC(bin)) {
                    return { ok: false, maskW: 0, maskH: 0, coveragePercent: 0 };
                }
            }
        }
        ensureCanvasSize(mBlur, maskW, maskH);
        const bx = mBlur.getContext('2d', { alpha: true });
        bx.save();
        bx.setTransform(1, 0, 0, 1, 0, 0);
        bx.globalAlpha = 1;
        bx.globalCompositeOperation = 'source-over';
        bx.filter = 'none';
        bx.clearRect(0, 0, maskW, maskH);
        bx.imageSmoothingEnabled = true;
        bx.imageSmoothingQuality = 'low';
        bx.drawImage(mC, 0, 0);
        bx.filter = 'none';
        bx.restore();
        return { ok: true, maskW, maskH, coveragePercent };
    }

    function getPortraitLastValidMaskForSize(w, h) {
        if (!_portraitLastValidMaskCanvas) return null;
        if (_portraitLastValidMaskCanvas.width !== w || _portraitLastValidMaskCanvas.height !== h) return null;
        return _portraitLastValidMaskCanvas;
    }

    function schedulePortraitMaskUpdate(videoEl, quality, w, h) {
        if (portraitSegmentationInFlight) return;
        portraitSegmentationInFlight = true;
        void (async () => {
            try {
                const maxSegDim = quality === 'capture'
                    ? 896
                    : 720;
                const { sw, sh } = computePortraitSegDims(w, h, maxSegDim);
                if (!_portraitSegCanvas) _portraitSegCanvas = document.createElement('canvas');
                if (!copyVideoFrameToCanvas(videoEl, _portraitSegCanvas, sw, sh)) return;
                const API = bodySegApi();
                if (!API) return;
                const segmenter = await getPortraitSegmenter();
                const people = await segmenter.segmentPeople(_portraitSegCanvas);

                if (portraitDebugMaskEnabled() || portraitVerboseMaskLog()) {
                    const plist = Array.isArray(people) ? people : (people ? [people] : []);
                    const seg0 = plist[0];
                    console.log('Segmentation result:', {
                        people,
                        firstKeys: seg0 ? Object.keys(seg0) : [],
                        hasMask: !!(seg0 && seg0.mask),
                    });
                    if (typeof tf !== 'undefined' && typeof tf.getBackend === 'function') {
                        console.log('TF Backend:', tf.getBackend());
                    }
                }

                if (!_solidMaskCanvas) _solidMaskCanvas = document.createElement('canvas');
                if (!_solidMaskBlurredCanvas) _solidMaskBlurredCanvas = document.createElement('canvas');
                const maskRes = await buildPortraitFeatheredMask(people, API, quality, _solidMaskCanvas, _solidMaskBlurredCanvas);
                if (!maskRes.ok) return;
                const { maskW, maskH, coveragePercent } = maskRes;

                if (!_portraitLastValidMaskCanvas) _portraitLastValidMaskCanvas = document.createElement('canvas');
                ensureCanvasSize(_portraitLastValidMaskCanvas, w, h);
                const lm = _portraitLastValidMaskCanvas.getContext('2d', { alpha: true });
                lm.setTransform(1, 0, 0, 1, 0, 0);
                lm.globalAlpha = 1;
                lm.globalCompositeOperation = 'source-over';
                lm.filter = 'none';
                lm.clearRect(0, 0, w, h);
                lm.imageSmoothingEnabled = true;
                lm.imageSmoothingQuality = 'low';
                lm.filter = quality === 'capture' ? 'blur(1.0px)' : 'blur(0.7px)';
                lm.drawImage(_solidMaskCanvas, 0, 0, maskW, maskH, 0, 0, w, h);
                lm.filter = 'none';
                const finalMaskIm = lm.getImageData(0, 0, w, h);
                const d = finalMaskIm.data;
                if (_prevMaskAlpha && _prevMaskAlpha.length === d.length) {
                    for (let i = 3; i < d.length; i += 4) {
                        d[i] = Math.round((d[i] * 0.85) + (_prevMaskAlpha[i] * 0.15));
                    }
                }
                _prevMaskAlpha = new Uint8ClampedArray(d);
                lm.putImageData(finalMaskIm, 0, 0);

                if (portraitVerboseMaskLog()) {
                    console.log('Mask coverage:', coveragePercent);
                }
            } catch (err) {
                console.warn('Portrait mask update:', err);
            } finally {
                portraitSegmentationInFlight = false;
            }
        })();
    }

    /**
     * @param {'preview'|'capture'} [quality] — capture uses slightly stronger mask feather for still photos.
     * Segmentation always runs on a downscaled copy; output is composited at full display resolution.
     */
    async function renderPortraitFrameToCanvas(destCanvas, videoEl, mode, quality = 'preview') {
        let w = Math.floor(videoEl.videoWidth);
        let h = Math.floor(videoEl.videoHeight);
        if (!Number.isFinite(w) || !Number.isFinite(h) || w < 2 || h < 2) return false;
        w -= w % 2;
        h -= h % 2;
        if (w < 2 || h < 2) return false;

        if (!ensureCanvasSize(destCanvas, w, h)) return false;
        const ctx = destCanvas.getContext('2d', { alpha: false });

        const resetCtx2d = (c) => {
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.globalAlpha = 1;
            c.globalCompositeOperation = 'source-over';
            c.filter = 'none';
        };

        // STEP 0: reset state — only clear at frame start (never after background).
        resetCtx2d(ctx);
        ctx.clearRect(0, 0, w, h);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);

        if (!_solidFgCanvas) _solidFgCanvas = document.createElement('canvas');
        const fgC = _solidFgCanvas;
        ensureCanvasSize(fgC, w, h);
        /** Alpha must be true so destination-in leaves real transparency; main canvas stays alpha:false. */
        const fgX = fgC.getContext('2d', { alpha: true });

        // STEP 1: background (always drawn on top of safety fill; no clear after this).
        if (portraitHardTestEnabled()) {
            resetCtx2d(ctx);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
        } else if (mode === 'blur') {
            if (!_portraitBlurStageCanvas) _portraitBlurStageCanvas = document.createElement('canvas');
            ensureCanvasSize(_portraitBlurStageCanvas, w, h);
            const bctx = _portraitBlurStageCanvas.getContext('2d', { alpha: false });
            resetCtx2d(bctx);
            bctx.clearRect(0, 0, w, h);
            bctx.imageSmoothingEnabled = true;
            bctx.imageSmoothingQuality = 'low';
            const fullBlurPx = quality === 'capture' ? 12 : 11;
            bctx.filter = `blur(${fullBlurPx}px)`;
            bctx.drawImage(videoEl, 0, 0, w, h);
            bctx.filter = 'none';
            resetCtx2d(ctx);
            ctx.drawImage(_portraitBlurStageCanvas, 0, 0, w, h);
        } else if (mode === 'solid') {
            resetCtx2d(ctx);
            fillStudioBackdropGradient(ctx, w, h);
            drawStudioContactShadow(ctx, w, h);
        } else {
            resetCtx2d(ctx);
            ctx.drawImage(videoEl, 0, 0, w, h);
        }

        if (mode === 'blur' || mode === 'solid') {
            schedulePortraitMaskUpdate(videoEl, quality, w, h);
        }

        const lastMask = getPortraitLastValidMaskForSize(w, h);
        const usePortraitFg = (mode === 'blur' || mode === 'solid') && lastMask;

        if (usePortraitFg) {
            resetCtx2d(fgX);
            fgX.clearRect(0, 0, w, h);
            fgX.globalCompositeOperation = 'source-over';
            fgX.drawImage(videoEl, 0, 0, w, h);
            fgX.globalCompositeOperation = 'destination-in';
            fgX.drawImage(lastMask, 0, 0, w, h);
            fgX.globalCompositeOperation = 'source-over';
            resetCtx2d(ctx);
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(fgC, 0, 0, w, h);
        } else if (mode === 'blur' || mode === 'solid') {
            resetCtx2d(ctx);
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(videoEl, 0, 0, w, h);
        }

        if (portraitDebugMaskEnabled() && lastMask && (mode === 'blur' || mode === 'solid')) {
            resetCtx2d(ctx);
            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, h);
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(lastMask, 0, 0, w, h);
        }

        return mode !== 'none';
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
            schedulePortraitPreviewNext();
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
        const t0 = performance.now();
        try {
            await renderPortraitFrameToCanvas(videoPreviewEffect, video, getPhotoBgMode());
            if (webcamCanvasArea) webcamCanvasArea.classList.add('preview-fx-active');
        } catch (err) {
            console.warn('Portrait preview frame:', err);
            cancelPortraitPreviewLoop();
            showToast('Background effect failed to load — check network or try Natural.', 'warning');
        } finally {
            portraitPreviewProcessing = false;
            portraitPreviewNextAllowed = performance.now() + portraitMinFrameGapMs;
            portraitNoteProcessingDuration(performance.now() - t0);
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
