/* Parichay operator app shell — cache static assets; never intercept writes. */
const CACHE_NAME = 'parichay-op-v1';
const PRECACHE_URLS = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/offline.js',
    '/states-districts.js',
    '/xlsx.min.js',
    '/new_logo.png',
    '/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil((async () => {
        const cache = await caches.open(CACHE_NAME);
        for (const url of PRECACHE_URLS) {
            try {
                await cache.add(url);
            } catch (err) {
                console.warn('[sw] precache failed', url, err);
            }
        }
        await self.skipWaiting();
    })());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((keys) =>
            Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
        ).then(() => self.clients.claim())
    );
});

function isApiWrite(request, url) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return true;
    return false;
}

function isMasterOrEmployeesGet(url) {
    if (url.pathname === '/api/employees') return true;
    if (url.pathname === '/api/sites' || url.pathname === '/api/contractors' || url.pathname === '/api/roles') return true;
    return false;
}

function isStaticAsset(url) {
    if (url.origin !== self.location.origin) return false;
    if (url.pathname.startsWith('/api/')) return false;
    if (url.pathname.startsWith('/admin')) return false;
    return true;
}

async function cacheMatchIgnoreSearch(request) {
    const cache = await caches.open(CACHE_NAME);
    const exact = await cache.match(request);
    if (exact) return exact;
    const url = new URL(request.url);
    if (url.search) {
        url.search = '';
        const stripped = await cache.match(url.href);
        if (stripped) return stripped;
    }
    return undefined;
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return;
    }

    if (url.origin !== self.location.origin) {
        return;
    }

    if (url.pathname.startsWith('/api/')) {
        if (isApiWrite(request, url)) return;
        if (!isMasterOrEmployeesGet(url)) return;

        event.respondWith((async () => {
            const cache = await caches.open(CACHE_NAME);
            try {
                const resp = await fetch(request);
                if (resp && resp.ok) {
                    cache.put(request, resp.clone());
                }
                return resp;
            } catch (err) {
                const cached = await cache.match(request);
                if (cached) return cached;
                throw err;
            }
        })());
        return;
    }

    if (!isStaticAsset(url)) return;

    event.respondWith((async () => {
        const cached = await cacheMatchIgnoreSearch(request);
        if (cached) {
            event.waitUntil(
                fetch(request).then((resp) => {
                    if (resp && resp.ok) {
                        return caches.open(CACHE_NAME).then((cache) => cache.put(request, resp));
                    }
                }).catch(() => {})
            );
            return cached;
        }
        try {
            const resp = await fetch(request);
            if (resp && resp.ok) {
                const cache = await caches.open(CACHE_NAME);
                cache.put(request, resp.clone());
            }
            return resp;
        } catch (err) {
            if (url.pathname === '/' || url.pathname === '/index.html' || url.pathname.endsWith('.html')) {
                const fallback = await cacheMatchIgnoreSearch(new Request('/index.html'));
                if (fallback) return fallback;
            }
            throw err;
        }
    })());
});
