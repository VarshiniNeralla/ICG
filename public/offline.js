'use strict';

/**
 * Operator offline support: IndexedDB cache, save/reissue outbox, fetch retries.
 * Exposed as window.ParichayOffline.
 */
(function (global) {
    const DB_NAME = 'parichay-offline';
    const DB_VERSION = 1;
    const STORE_KV = 'kv';
    const STORE_PHOTOS = 'photos';
    const STORE_OUTBOX = 'outbox';
    const FETCH_TIMEOUT_MS = 12000;
    const FLUSH_INTERVAL_MS = 20000;

    let dbPromise = null;
    let memoryKv = new Map();
    let memoryPhotos = new Map();
    let memoryOutbox = [];
    let idbAvailable = true;
    let flushing = false;
    let flushTimer = null;
    let listenersBound = false;

    const hooks = {
        getApiBase: () => '',
        getAuthHeaders: () => ({}),
        getSite: () => '',
        on401: () => {},
        onFlushDone: () => {}
    };

    function uuid() {
        if (global.crypto && typeof global.crypto.randomUUID === 'function') {
            return global.crypto.randomUUID();
        }
        return 'ob-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
    }

    function sleep(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    function isOnline() {
        return global.navigator.onLine !== false;
    }

    function openDb() {
        if (dbPromise) return dbPromise;
        if (!global.indexedDB) {
            idbAvailable = false;
            dbPromise = Promise.resolve(null);
            return dbPromise;
        }
        dbPromise = new Promise((resolve) => {
            try {
                const req = indexedDB.open(DB_NAME, DB_VERSION);
                req.onupgradeneeded = () => {
                    const db = req.result;
                    if (!db.objectStoreNames.contains(STORE_KV)) db.createObjectStore(STORE_KV, { keyPath: 'key' });
                    if (!db.objectStoreNames.contains(STORE_PHOTOS)) db.createObjectStore(STORE_PHOTOS, { keyPath: 'id' });
                    if (!db.objectStoreNames.contains(STORE_OUTBOX)) {
                        const out = db.createObjectStore(STORE_OUTBOX, { keyPath: 'id' });
                        out.createIndex('site', 'site', { unique: false });
                    }
                };
                req.onsuccess = () => resolve(req.result);
                req.onerror = () => {
                    idbAvailable = false;
                    resolve(null);
                };
            } catch {
                idbAvailable = false;
                resolve(null);
            }
        });
        return dbPromise;
    }

    function idbOp(storeName, mode, fn) {
        return openDb().then((db) => {
            if (!db) return fn(null);
            return new Promise((resolve, reject) => {
                const tx = db.transaction(storeName, mode);
                const store = tx.objectStore(storeName);
                const result = fn(store);
                tx.oncomplete = () => resolve(result);
                tx.onerror = () => reject(tx.error);
                tx.onabort = () => reject(tx.error || new Error('IndexedDB aborted'));
            });
        });
    }

    function kvGet(key) {
        return idbOp(STORE_KV, 'readonly', (store) => {
            if (!store) return memoryKv.get(key);
            return new Promise((resolve, reject) => {
                const req = store.get(key);
                req.onsuccess = () => resolve(req.result ? req.result.value : undefined);
                req.onerror = () => reject(req.error);
            });
        }).catch(() => memoryKv.get(key));
    }

    function kvSet(key, value) {
        memoryKv.set(key, value);
        return idbOp(STORE_KV, 'readwrite', (store) => {
            if (!store) return;
            store.put({ key, value });
        }).catch(() => {});
    }

    function photoKey(site, aadhar) {
        return 'photo:' + (site || '') + ':' + (aadhar || '');
    }

    function dataUrlToBlob(dataUrl) {
        if (!dataUrl || typeof dataUrl !== 'string' || !dataUrl.startsWith('data:')) return null;
        try {
            const comma = dataUrl.indexOf(',');
            if (comma < 0) return null;
            const header = dataUrl.slice(0, comma);
            const b64 = dataUrl.slice(comma + 1);
            const mime = (header.match(/:(.*?);/) || [])[1] || 'image/jpeg';
            const bin = atob(b64);
            const arr = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
            return new Blob([arr], { type: mime });
        } catch {
            return null;
        }
    }

    function blobToDataUrl(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    async function putPhoto(id, dataUrlOrBlob) {
        if (!id || !dataUrlOrBlob) return;
        let blob = dataUrlOrBlob instanceof Blob ? dataUrlOrBlob : dataUrlToBlob(dataUrlOrBlob);
        if (!blob && typeof dataUrlOrBlob === 'string' && dataUrlOrBlob.startsWith('data:')) {
            memoryPhotos.set(id, dataUrlOrBlob);
            return;
        }
        if (!blob) return;
        memoryPhotos.set(id, blob);
        try {
            await idbOp(STORE_PHOTOS, 'readwrite', (store) => {
                if (!store) return;
                store.put({ id, blob, type: blob.type || 'image/jpeg' });
            });
        } catch {
            /* memory fallback */
        }
    }

    async function getPhotoDataURL(id) {
        if (!id) return null;
        const mem = memoryPhotos.get(id);
        if (mem) {
            if (typeof mem === 'string') return mem;
            try { return await blobToDataUrl(mem); } catch { /* continue */ }
        }
        try {
            const rec = await idbOp(STORE_PHOTOS, 'readonly', (store) => {
                if (!store) return null;
                return new Promise((resolve, reject) => {
                    const req = store.get(id);
                    req.onsuccess = () => resolve(req.result || null);
                    req.onerror = () => reject(req.error);
                });
            });
            if (rec && rec.blob) {
                memoryPhotos.set(id, rec.blob);
                return await blobToDataUrl(rec.blob);
            }
        } catch { /* ignore */ }
        return null;
    }

    async function listOutbox(site) {
        try {
            const all = await idbOp(STORE_OUTBOX, 'readonly', (store) => {
                if (!store) {
                    return site ? memoryOutbox.filter((i) => i.site === site) : memoryOutbox.slice();
                }
                return new Promise((resolve, reject) => {
                    const req = site ? store.index('site').getAll(site) : store.getAll();
                    req.onsuccess = () => resolve(req.result || []);
                    req.onerror = () => reject(req.error);
                });
            });
            return Array.isArray(all) ? all : [];
        } catch {
            return site ? memoryOutbox.filter((i) => i.site === site) : memoryOutbox.slice();
        }
    }

    async function putOutboxItem(item) {
        const idx = memoryOutbox.findIndex((i) => i.id === item.id);
        if (idx >= 0) memoryOutbox[idx] = item;
        else memoryOutbox.push(item);
        try {
            await idbOp(STORE_OUTBOX, 'readwrite', (store) => {
                if (!store) return;
                store.put(item);
            });
        } catch { /* memory fallback */ }
    }

    async function deleteOutboxItem(id) {
        memoryOutbox = memoryOutbox.filter((i) => i.id !== id);
        try {
            await idbOp(STORE_OUTBOX, 'readwrite', (store) => {
                if (!store) return;
                store.delete(id);
            });
        } catch { /* ignore */ }
    }

    function stripPhotoForCache(record) {
        if (!record) return record;
        const copy = { ...record };
        if (copy.photoPath && typeof copy.photoPath === 'string' && copy.photoPath.startsWith('data:')) {
            copy.photoPath = '';
        }
        return copy;
    }

    async function getCachedRecords(site) {
        const wrap = await kvGet('records:' + site);
        return wrap && Array.isArray(wrap.records) ? wrap.records : [];
    }

    async function setCachedRecords(site, records) {
        const cleaned = (records || []).map(stripPhotoForCache);
        await kvSet('records:' + site, { records: cleaned, savedAt: new Date().toISOString() });
    }

    async function upsertCachedRecord(site, record) {
        const records = await getCachedRecords(site);
        const aadhar = record && record.aadhar;
        let found = false;
        const next = records.map((r) => {
            if (aadhar && r.aadhar === aadhar) {
                found = true;
                return stripPhotoForCache({ ...r, ...record });
            }
            return r;
        });
        if (!found) next.unshift(stripPhotoForCache(record));
        await setCachedRecords(site, next);
        return next;
    }

    async function getMasterLists(site) {
        return (await kvGet('masters:' + (site || '_global'))) || null;
    }

    async function setMasterLists(site, lists) {
        await kvSet('masters:' + (site || '_global'), lists);
    }

    function payloadWithoutPhoto(data) {
        const copy = { ...data };
        delete copy.photoPath;
        return copy;
    }

    async function enqueueSave(data) {
        const site = data.site || hooks.getSite();
        const existing = (await listOutbox(site)).find(
            (i) => i.type === 'save' && i.status === 'pending' && i.payload && i.payload.aadhar === data.aadhar
        );
        const id = existing ? existing.id : uuid();
        const pKey = photoKey(site, data.aadhar);
        if (data.photoPath) await putPhoto(pKey, data.photoPath);
        const item = {
            id,
            site,
            type: 'save',
            status: 'pending',
            error: null,
            createdAt: existing ? existing.createdAt : new Date().toISOString(),
            photoId: pKey,
            payload: payloadWithoutPhoto({ ...data, createdAt: data.createdAt || new Date().toISOString() })
        };
        await putOutboxItem(item);
        return item;
    }

    async function enqueueReissue(record, updates) {
        const site = record.site || hooks.getSite();
        const recordId = record._id || record.id;
        const existing = (await listOutbox(site)).find(
            (i) => i.type === 'reissue' && i.status === 'pending' && String(i.payload && i.payload.recordId) === String(recordId)
        );
        const id = existing ? existing.id : uuid();
        const item = {
            id,
            site,
            type: 'reissue',
            status: 'pending',
            error: null,
            createdAt: existing ? existing.createdAt : new Date().toISOString(),
            photoId: photoKey(site, record.aadhar),
            payload: {
                recordId,
                aadhar: record.aadhar,
                fullName: record.fullName,
                doi: updates.doi,
                issueDate: updates.issueDate,
                reissueCount: updates.reissueCount
            }
        };
        await putOutboxItem(item);
        await upsertCachedRecord(site, {
            ...record,
            doi: updates.doi,
            issueDate: updates.issueDate,
            reissueCount: updates.reissueCount
        });
        return item;
    }

    async function patchPendingSave(site, aadhar, patch) {
        const items = await listOutbox(site);
        const item = items.find((i) => i.type === 'save' && i.payload && i.payload.aadhar === aadhar);
        if (!item) return;
        item.payload = { ...item.payload, ...patch };
        await putOutboxItem(item);
    }

    async function pruneSyncedSaves(site, serverAadhars) {
        const items = await listOutbox(site);
        for (const item of items) {
            if (item.type !== 'save') continue;
            const aadhar = item.payload && item.payload.aadhar;
            if (aadhar && serverAadhars.has(aadhar) && item.status !== 'conflict') {
                await deleteOutboxItem(item.id);
            }
        }
    }

    function mergeRecords(cachedRecords, outboxItems) {
        const byAadhar = new Map();
        (cachedRecords || []).forEach((r) => {
            const key = r.aadhar || r._id || JSON.stringify(r);
            byAadhar.set(key, { ...r, _syncStatus: r._syncStatus || 'synced', _local: false });
        });

        (outboxItems || []).forEach((item) => {
            if (item.type === 'save' && item.payload) {
                const aadhar = item.payload.aadhar;
                const onServer = aadhar && byAadhar.has(aadhar) && byAadhar.get(aadhar)._syncStatus === 'synced' && !byAadhar.get(aadhar)._outboxId;
                if (item.status === 'pending' || item.status === 'error' || item.status === 'conflict') {
                    if (onServer && item.status === 'pending') return;
                    byAadhar.set(aadhar || item.id, {
                        ...item.payload,
                        photoPath: item.payload.photoPath || '',
                        _syncStatus: item.status === 'pending' ? 'pending' : item.status,
                        _local: true,
                        _outboxId: item.id,
                        _outboxError: item.error || null,
                        _savedAt: item.createdAt
                    });
                }
            }
            if (item.type === 'reissue' && item.payload) {
                const aadhar = item.payload.aadhar;
                const rec = aadhar ? byAadhar.get(aadhar) : null;
                if (rec && (item.status === 'pending' || item.status === 'error')) {
                    rec.doi = item.payload.doi || rec.doi;
                    rec.issueDate = item.payload.issueDate || rec.issueDate;
                    rec.reissueCount = item.payload.reissueCount != null ? item.payload.reissueCount : rec.reissueCount;
                    rec._syncStatus = item.status === 'pending' ? 'pending-reissue' : item.status;
                    rec._outboxId = item.id;
                    rec._outboxError = item.error || null;
                    byAadhar.set(aadhar, rec);
                }
            }
        });

        const merged = Array.from(byAadhar.values());
        const rank = (s) => {
            if (s === 'conflict' || s === 'error') return 0;
            if (s === 'pending' || s === 'pending-reissue') return 1;
            return 2;
        };
        merged.sort((a, b) => rank(a._syncStatus) - rank(b._syncStatus));
        return merged;
    }

    async function apiFetch(url, options = {}, extra = {}) {
        const retries = extra.retries != null ? extra.retries : 2;
        const timeoutMs = extra.timeoutMs != null ? extra.timeoutMs : FETCH_TIMEOUT_MS;
        let lastErr = null;
        for (let attempt = 0; attempt <= retries; attempt++) {
            const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
            const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
            try {
                const resp = await fetch(url, ctrl ? { ...options, signal: ctrl.signal } : options);
                if (timer) clearTimeout(timer);
                if (resp.status >= 500 && attempt < retries) {
                    await sleep(400 * Math.pow(2, attempt));
                    continue;
                }
                return resp;
            } catch (err) {
                if (timer) clearTimeout(timer);
                lastErr = err;
                if (attempt < retries) await sleep(400 * Math.pow(2, attempt));
            }
        }
        throw lastErr || new Error('Network request failed');
    }

    function looksLikeOurDuplicate(payload, existing) {
        if (!payload || !existing) return false;
        const sameName = String(existing.fullName || '').trim().toLowerCase() === String(payload.fullName || '').trim().toLowerCase();
        const sameSite = !existing.site || !payload.site || existing.site === payload.site;
        return sameName && sameSite;
    }

    async function flushSaveItem(item) {
        const apiBase = hooks.getApiBase();
        let photoPath = '';
        if (item.photoId) photoPath = (await getPhotoDataURL(item.photoId)) || '';
        const body = { ...item.payload, photoPath };
        const resp = await apiFetch(`${apiBase}/api/save-employee`, {
            method: 'POST',
            headers: hooks.getAuthHeaders(),
            body: JSON.stringify(body)
        }, { retries: 1 });

        if (resp.status === 401) {
            hooks.on401();
            return 'auth';
        }
        if (!resp.ok) {
            item.status = 'error';
            item.error = 'Server returned ' + resp.status;
            await putOutboxItem(item);
            return 'error';
        }
        const result = await resp.json().catch(() => ({}));
        const warnings = result.warnings || [];
        const dupWarn = warnings.find((w) => /duplicate/i.test(w));

        if (result.saved) {
            await deleteOutboxItem(item.id);
            await upsertCachedRecord(item.site, { ...item.payload, photoPath: '' });
            return 'synced';
        }
        if (dupWarn) {
            try {
                const dupResp = await apiFetch(`${apiBase}/api/check-duplicate`, {
                    method: 'POST',
                    headers: hooks.getAuthHeaders(),
                    body: JSON.stringify({ aadhar: item.payload.aadhar, contact: item.payload.contact })
                }, { retries: 0 });
                const dup = dupResp.ok ? await dupResp.json() : null;
                if (dup && dup.duplicate && looksLikeOurDuplicate(item.payload, dup.existing)) {
                    await deleteOutboxItem(item.id);
                    await upsertCachedRecord(item.site, { ...item.payload, photoPath: '' });
                    return 'synced';
                }
            } catch { /* treat as conflict below */ }
            item.status = 'conflict';
            item.error = dupWarn;
            await putOutboxItem(item);
            return 'conflict';
        }
        item.status = 'error';
        item.error = warnings[0] || 'Save failed';
        await putOutboxItem(item);
        return 'error';
    }

    async function flushReissueItem(item) {
        const apiBase = hooks.getApiBase();
        const recordId = item.payload && item.payload.recordId;
        if (!recordId) {
            await deleteOutboxItem(item.id);
            return 'synced';
        }
        const resp = await apiFetch(`${apiBase}/api/employees/${recordId}/reissue`, {
            method: 'POST',
            headers: hooks.getAuthHeaders()
        }, { retries: 1 });

        if (resp.status === 401) {
            hooks.on401();
            return 'auth';
        }
        const result = await resp.json().catch(() => ({}));
        if (!resp.ok) {
            item.status = 'error';
            item.error = result.error || ('Server returned ' + resp.status);
            await putOutboxItem(item);
            return 'error';
        }
        await deleteOutboxItem(item.id);
        if (item.payload && item.payload.aadhar) {
            await upsertCachedRecord(item.site, {
                aadhar: item.payload.aadhar,
                doi: result.doi || item.payload.doi,
                issueDate: result.issueDate || item.payload.issueDate,
                reissueCount: result.reissueCount != null ? result.reissueCount : item.payload.reissueCount
            });
        }
        return 'synced';
    }

    async function flushOutbox() {
        if (flushing) return { skipped: true };
        if (!isOnline()) {
            updateBanner();
            return { pending: true };
        }
        const site = hooks.getSite();
        if (!site) return { pending: false };

        flushing = true;
        updateBanner();
        const summary = { synced: 0, pending: 0, conflicts: 0, errors: 0, auth: false };
        try {
            const items = (await listOutbox(site))
                .filter((i) => i.status === 'pending' || i.status === 'error')
                .sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));

            for (const item of items) {
                try {
                    const outcome = item.type === 'reissue' ? await flushReissueItem(item) : await flushSaveItem(item);
                    if (outcome === 'auth') {
                        summary.auth = true;
                        break;
                    }
                    if (outcome === 'synced') summary.synced++;
                    else if (outcome === 'conflict') summary.conflicts++;
                    else summary.errors++;
                } catch {
                    summary.pending++;
                }
            }
            const remaining = await listOutbox(site);
            summary.pending = remaining.filter((i) => i.status === 'pending').length;
            summary.conflicts = remaining.filter((i) => i.status === 'conflict').length;
            summary.errors = remaining.filter((i) => i.status === 'error').length;
        } finally {
            flushing = false;
            updateBanner();
            try { hooks.onFlushDone(summary); } catch { /* ignore */ }
        }
        return summary;
    }

    async function outboxCounts(site) {
        const items = await listOutbox(site || hooks.getSite());
        return {
            pending: items.filter((i) => i.status === 'pending' || i.status === 'error').length,
            conflicts: items.filter((i) => i.status === 'conflict').length,
            flushing
        };
    }

    function updateBanner() {
        const el = document.getElementById('offlineBanner');
        const text = document.getElementById('offlineBannerText');
        if (!el || !text) return;
        const site = hooks.getSite();
        Promise.resolve(outboxCounts(site)).then((counts) => {
            el.classList.remove('offline-banner--offline', 'offline-banner--syncing', 'offline-banner--warn');
            document.body.classList.remove('has-offline-banner');
            if (!isOnline()) {
                text.textContent = 'Offline — records will sync when connected';
                el.classList.add('offline-banner--offline');
                el.hidden = false;
                document.body.classList.add('has-offline-banner');
                return;
            }
            if (counts.flushing) {
                text.textContent = 'Syncing queued records…';
                el.classList.add('offline-banner--syncing');
                el.hidden = false;
                document.body.classList.add('has-offline-banner');
                return;
            }
            if (counts.pending > 0) {
                text.textContent = `Waiting to sync ${counts.pending} record${counts.pending === 1 ? '' : 's'}…`;
                el.classList.add('offline-banner--syncing');
                el.hidden = false;
                document.body.classList.add('has-offline-banner');
                return;
            }
            if (counts.conflicts > 0) {
                text.textContent = `${counts.conflicts} record${counts.conflicts === 1 ? '' : 's'} could not sync (duplicate). Check My Records.`;
                el.classList.add('offline-banner--warn');
                el.hidden = false;
                document.body.classList.add('has-offline-banner');
                return;
            }
            el.hidden = true;
        }).catch(() => {});
    }

    async function migrateLegacy(site) {
        if (!site || !global.localStorage) return;
        const prefix = 'ep_local_records_';
        const keys = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (k && k.startsWith(prefix)) keys.push(k);
        }
        for (const key of keys) {
            let rows = [];
            try { rows = JSON.parse(localStorage.getItem(key) || '[]'); } catch { rows = []; }
            if (!Array.isArray(rows) || !rows.length) {
                try { localStorage.removeItem(key); } catch { /* ignore */ }
                continue;
            }
            const keySite = key.slice(prefix.length) || site;
            for (const row of rows) {
                try {
                    await enqueueSave({ ...row, site: row.site || keySite });
                } catch { /* skip bad row */ }
            }
            try { localStorage.removeItem(key); } catch { /* ignore */ }
        }
    }

    function findLocalDuplicate(records, outboxItems, aadhar, contact) {
        const pool = [];
        (records || []).forEach((r) => pool.push(r));
        (outboxItems || []).forEach((item) => {
            if (item.type === 'save' && item.payload) pool.push(item.payload);
        });
        let matchedOn = null;
        let existing = null;
        for (const r of pool) {
            const aadharMatch = aadhar && r.aadhar && String(r.aadhar) === String(aadhar);
            const contactMatch = contact && r.contact && String(r.contact) === String(contact);
            if (!aadharMatch && !contactMatch) continue;
            existing = r;
            if (aadharMatch && contactMatch) matchedOn = 'both';
            else if (aadharMatch) matchedOn = 'aadhar';
            else matchedOn = 'contact';
            break;
        }
        if (!existing) return null;
        return { duplicate: true, matchedOn, existing, _offline: true };
    }

    function configure(next) {
        Object.assign(hooks, next || {});
    }

    async function init() {
        await openDb();
        if (!idbAvailable) {
            try {
                const raw = localStorage.getItem('parichay_offline_mem_outbox');
                if (raw) memoryOutbox = JSON.parse(raw);
            } catch { /* ignore */ }
        }
    }

    function startListeners() {
        if (listenersBound) return;
        listenersBound = true;
        global.addEventListener('online', () => {
            updateBanner();
            flushOutbox();
        });
        global.addEventListener('offline', () => updateBanner());
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                updateBanner();
                flushOutbox();
            }
        });
        flushTimer = setInterval(() => {
            if (isOnline()) flushOutbox();
            else updateBanner();
        }, FLUSH_INTERVAL_MS);
        updateBanner();
        if (isOnline()) flushOutbox();
    }

    global.ParichayOffline = {
        init,
        configure,
        startListeners,
        isOnline,
        apiFetch,
        photoKey,
        putPhoto,
        getPhotoDataURL,
        enqueueSave,
        enqueueReissue,
        patchPendingSave,
        flushOutbox,
        listOutbox,
        pruneSyncedSaves,
        getCachedRecords,
        setCachedRecords,
        upsertCachedRecord,
        getMasterLists,
        setMasterLists,
        mergeRecords,
        migrateLegacy,
        findLocalDuplicate,
        outboxCounts,
        updateBanner,
        isFlushing: () => flushing
    };
})(window);
