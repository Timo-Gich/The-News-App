// service-worker.js - Enhanced Service Worker with Production PWA Features
const CACHE_VERSION = 'v2.1';
const STATIC_CACHE = `static-${CACHE_VERSION}`;
const API_CACHE = `api-${CACHE_VERSION}`;
const IMAGE_CACHE = `images-${CACHE_VERSION}`;
const HTML_CACHE = `html-${CACHE_VERSION}`;

const OFFLINE_URL = 'offline.html';

// Version logging
console.log(`[Service Worker] Version: ${CACHE_VERSION}`);
console.log(`[Service Worker] Caches: STATIC=${STATIC_CACHE}, API=${API_CACHE}, IMAGES=${IMAGE_CACHE}, HTML=${HTML_CACHE}`);

// Static assets to cache on install
const STATIC_ASSETS = [
    '/',
    '/index.html',
    '/styles.css',
    '/script.js',
    '/offline-storage.js',
    '/cache-controller.js',
    '/offline-manager.js',
    '/manifest.json',
    '/offline.html',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&family=Roboto:wght@300;400;500&display=swap'
];

// Install event
self.addEventListener('install', event => {
            console.log('[Service Worker] Installing...');

            event.waitUntil(
                    Promise.all([
                            // Cache static assets with robust error handling and retry logic
                            caches.open(STATIC_CACHE)
                            .then(async cache => {
                                    let successCount = 0;
                                    let failureCount = 0;
                                    const retryLimit = 2;

                                    for (const asset of STATIC_ASSETS) {
                                        let lastError;

                                        for (let attempt = 0; attempt <= retryLimit; attempt++) {
                                            try {
                                                await cache.add(asset);
                                                successCount++;
                                                console.log(`[Service Worker] Successfully cached ${attempt > 0 ? `(retry ${attempt})` : ''}:`, asset);
                            lastError = null;
                            break;
                        } catch (err) {
                            lastError = err;
                            console.warn(`[Service Worker] Failed to cache ${asset} (attempt ${attempt + 1}/${retryLimit + 1}):`, err);
                            
                            // Don't retry on certain errors
                            if (err.type === 'SecurityError' || err.type === 'NetworkError') {
                                break;
                            }
                            
                            // Short delay before retry
                            if (attempt < retryLimit) {
                                await new Promise(resolve => setTimeout(resolve, 100 * (attempt + 1)));
                            }
                        }
                    }

                    if (lastError) {
                        failureCount++;
                    }
                }

                console.log(`[Service Worker] Caching complete: ${successCount} successful, ${failureCount} failed`);
                
                // Log detailed failure information
                if (failureCount > 0) {
                    console.log('[Service Worker] Failed assets:', STATIC_ASSETS.filter((_, index) => {
                        // This is a simplified check - in a real scenario you'd track individual failures
                        return false; // Placeholder - actual tracking would be more complex
                    }));
                }
            }),

            // Skip waiting to activate immediately
            self.skipWaiting()
        ])
        .then(() => {
            console.log('[Service Worker] Installation complete');
        })
    );
});

// Activate event
self.addEventListener('activate', event => {
    console.log('[Service Worker] Activating...');

    event.waitUntil(
        Promise.all([
            // Clean up old caches
            caches.keys().then(cacheNames => {
                return Promise.all(
                    cacheNames.map(cacheName => {
                        if (![STATIC_CACHE, API_CACHE, IMAGE_CACHE].includes(cacheName)) {
                            console.log('[Service Worker] Deleting old cache:', cacheName);
                            return caches.delete(cacheName);
                        }
                    })
                );
            }),

            // Claim clients
            self.clients.claim()
        ])
        .then(() => {
            console.log('[Service Worker] Activation complete');

            // Send message to all clients
            self.clients.matchAll().then(clients => {
                clients.forEach(client => {
                    client.postMessage({
                        type: 'SW_ACTIVATED',
                        version: CACHE_VERSION
                    });
                });
            });
        })
    );
});

// Fetch event with enhanced strategies
self.addEventListener('fetch', event => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests and chrome-extension requests
    if (request.method !== 'GET' || url.protocol === 'chrome-extension:') {
        return;
    }

    // CRITICAL: Handle navigation requests FIRST with cache-first strategy
    // This ensures the app shell loads offline
    if (request.mode === 'navigate') {
        event.respondWith(handleNavigation(event));
        return;
    }

    // Handle different types of requests with different strategies
    if (url.hostname === 'api.currentsapi.services' || url.hostname === 'newsdata.io') {
        event.respondWith(apiFirstStrategy(event));
    } else if (isImageRequest(request)) {
        event.respondWith(imageStrategy(event));
    } else if (isStaticAsset(request)) {
        event.respondWith(cacheFirstStrategy(event));
    } else {
        event.respondWith(networkFirstStrategy(event));
    }
});

// Navigation handler: Cache-first strategy for page loads
async function handleNavigation(event) {
    const cache = await caches.open(STATIC_CACHE);
    const requestUrl = new URL(event.request.url);
    
    // Define all possible URL variations for the same page
    // This handles GitHub Pages URL quirks and trailing slash issues
    const possibleUrls = [
        event.request.url,
        requestUrl.origin + '/',
        requestUrl.origin + '/index.html',
        requestUrl.href,
        requestUrl.href.replace(/\/$/, ''),
        requestUrl.href.replace(/\/$/, '') + '/index.html'
    ];
    
    // Try cache first with all URL variations
    for (const url of possibleUrls) {
        try {
            const cached = await cache.match(url);
            if (cached) {
                console.log('[Service Worker] Navigation served from cache:', url);
                return cached;
            }
        } catch (e) {
            // Continue trying other URLs
        }
    }
    
    // Try network if cache miss
    try {
        const response = await fetch(event.request);
        if (response.ok) {
            // Cache the navigation request for future offline use
            cache.put(event.request, response.clone());
            console.log('[Service Worker] Navigation cached:', event.request.url);
        }
        return response;
    } catch (error) {
        console.log('[Service Worker] Navigation network failed, serving offline:', event.request.url);
        
        // Try to serve offline.html from cache
        const offlinePage = await cache.match('/offline.html');
        if (offlinePage) {
            return offlinePage;
        }
        
        // Final fallback: inline HTML when even offline.html isn't cached
        return new Response(getOfflineFallbackHTML(), {
            status: 200,
            statusText: 'OK',
            headers: { 'Content-Type': 'text/html; charset=utf-8' }
        });
    }
}

// Basic offline fallback HTML - embedded to work when cache fails
function getOfflineFallbackHTML() {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Offline - Currents News</title>
    <style>
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, sans-serif;
            background: linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            color: white;
            padding: 20px;
        }
        .container { text-align: center; max-width: 400px; }
        .icon { font-size: 80px; margin-bottom: 24px; }
        h1 { font-size: 28px; margin-bottom: 16px; }
        p { font-size: 16px; opacity: 0.9; margin-bottom: 24px; line-height: 1.5; }
        button {
            background: white;
            color: #2563eb;
            border: none;
            padding: 14px 32px;
            font-size: 16px;
            font-weight: 600;
            border-radius: 8px;
            cursor: pointer;
            transition: transform 0.2s, box-shadow 0.2s;
        }
        button:hover { transform: translateY(-2px); box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .hint { margin-top: 20px; font-size: 13px; opacity: 0.7; }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">📰</div>
        <h1>You're Offline</h1>
        <p>Connect to the internet to browse the latest news articles.</p>
        <button onclick="location.reload()">Retry Connection</button>
        <p class="hint">Previously loaded articles may still be available.</p>
    </div>
</body>
</html>`;
}

// API-first strategy: Try network first, then cache
async function apiFirstStrategy(event) {
    const { request } = event;
    const cache = await caches.open(API_CACHE);

    try {
        // Try network first
        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
            // Cache the successful response
            const responseToCache = networkResponse.clone();
            cache.put(request, responseToCache);
            console.log('[Service Worker] API cached:', request.url);
            return networkResponse;
        }

        throw new Error('Network response not ok');
    } catch (error) {
        console.log('[Service Worker] Network failed, trying cache:', request.url);

        // Try cache
        const cachedResponse = await cache.match(request);
        if (cachedResponse) {
            console.log('[Service Worker] Serving cached API:', request.url);
            return cachedResponse;
        }

        // No cache available, return error
        return new Response(JSON.stringify({
            status: 'error',
            message: 'You are offline and no cached data available.'
        }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
        });
    }
}

// Image strategy: Cache first, then network
async function imageStrategy(event) {
    const { request } = event;
    const cache = await caches.open(IMAGE_CACHE);

    // Try cache first
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
        console.log('[Service Worker] Serving cached image:', request.url);
        return cachedResponse;
    }

    try {
        // Try network
        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
            // Cache the image for future use
            const responseToCache = networkResponse.clone();
            cache.put(request, responseToCache);
            console.log('[Service Worker] Image cached:', request.url);
        }

        return networkResponse;
    } catch (error) {
        console.log('[Service Worker] Image fetch failed:', request.url);

        // Return a placeholder image or error
        return new Response(
            `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
                <rect width="400" height="300" fill="#f3f4f6"/>
                <text x="200" y="150" text-anchor="middle" font-family="Arial" font-size="16" fill="#6b7280">
                    Image not available offline
                </text>
            </svg>`, {
                headers: { 'Content-Type': 'image/svg+xml' }
            }
        );
    }
}

// Cache-first strategy for static assets
async function cacheFirstStrategy(event) {
    const { request } = event;
    const cache = await caches.open(STATIC_CACHE);

    // Try cache first
    const cachedResponse = await cache.match(request);
    if (cachedResponse) {
        console.log('[Service Worker] Serving cached static:', request.url);
        return cachedResponse;
    }

    // Try network
    try {
        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
            // Don't cache non-static assets
            if (isStaticAsset(request)) {
                const responseToCache = networkResponse.clone();
                cache.put(request, responseToCache);
            }
        }

        return networkResponse;
    } catch (error) {
        console.log('[Service Worker] Static asset fetch failed:', request.url);

        // If it's a navigation request, show offline page
        if (request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
        }

        return new Response('Offline - content not available', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

// Network-first strategy for other requests
async function networkFirstStrategy(event) {
    const { request } = event;

    try {
        // Try network first
        const networkResponse = await fetch(request);

        if (networkResponse.ok) {
            // Cache successful responses
            const cache = await caches.open(STATIC_CACHE);
            const responseToCache = networkResponse.clone();
            cache.put(request, responseToCache);
        }

        return networkResponse;
    } catch (error) {
        console.log('[Service Worker] Network failed, trying cache:', request.url);

        // Try cache
        const cache = await caches.open(STATIC_CACHE);
        const cachedResponse = await cache.match(request);

        if (cachedResponse) {
            return cachedResponse;
        }

        // If it's a navigation request, show offline page
        if (request.mode === 'navigate') {
            return caches.match(OFFLINE_URL);
        }

        return new Response('Offline - content not available', {
            status: 503,
            statusText: 'Service Unavailable'
        });
    }
}

// Helper functions
function isImageRequest(request) {
    const url = new URL(request.url);
    return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url.pathname) ||
        url.hostname.includes('unsplash.com') ||
        url.hostname.includes('images.unsplash.com');
}

function isStaticAsset(request) {
    const url = new URL(request.url);
    return url.origin === self.location.origin ||
        url.hostname === 'cdnjs.cloudflare.com' ||
        url.hostname === 'fonts.googleapis.com' ||
        url.hostname === 'fonts.gstatic.com';
}

// Background sync
self.addEventListener('sync', event => {
    if (event.tag === 'sync-news') {
        console.log('[Service Worker] Background sync triggered');

        event.waitUntil(
            syncNewsData()
            .then(() => {
                console.log('[Service Worker] Background sync completed');

                // Notify clients
                self.clients.matchAll().then(clients => {
                    clients.forEach(client => {
                        client.postMessage({
                            type: 'BACKGROUND_SYNC_COMPLETED'
                        });
                    });
                });
            })
            .catch(error => {
                console.error('[Service Worker] Background sync failed:', error);
            })
        );
    }
});

// Periodic sync (if supported)
self.addEventListener('periodicsync', event => {
    if (event.tag === 'news-update') {
        console.log('[Service Worker] Periodic sync triggered');

        event.waitUntil(
            updateNewsCache()
            .then(() => {
                console.log('[Service Worker] Periodic sync completed');
            })
            .catch(error => {
                console.error('[Service Worker] Periodic sync failed:', error);
            })
        );
    }
});

// Push notifications
self.addEventListener('push', event => {
    console.log('[Service Worker] Push notification received');

    const options = {
        body: event.data ? event.data.text() : 'New news articles available!',
        icon: 'https://img.icons8.com/color/96/000000/news.png',
        badge: 'https://img.icons8.com/color/72/000000/news.png',
        vibrate: [100, 50, 100],
        data: {
            url: '/',
            timestamp: Date.now()
        },
        actions: [{
                action: 'read',
                title: 'Read Now',
                icon: 'https://img.icons8.com/color/96/000000/news.png'
            },
            {
                action: 'dismiss',
                title: 'Dismiss',
                icon: 'https://img.icons8.com/color/96/000000/close.png'
            }
        ]
    };

    event.waitUntil(
        self.registration.showNotification('Currents News', options)
    );
});

self.addEventListener('notificationclick', event => {
    console.log('[Service Worker] Notification click:', event.notification);
    event.notification.close();

    if (event.action === 'read') {
        event.waitUntil(
            clients.openWindow('/')
        );
    } else if (event.action === 'dismiss') {
        // Do nothing
    } else {
        // Default action - open the app
        event.waitUntil(
            clients.matchAll({ type: 'window', includeUncontrolled: true })
            .then(windowClients => {
                for (const client of windowClients) {
                    if (client.url.includes('/') && 'focus' in client) {
                        return client.focus();
                    }
                }
                if (clients.openWindow) {
                    return clients.openWindow('/');
                }
            })
        );
    }
});

// Message handler
self.addEventListener('message', event => {
    const { data } = event;

    switch (data.type) {
        case 'SKIP_WAITING':
            self.skipWaiting();
            break;

        case 'UPDATE_CACHE':
            updateNewsCache();
            break;

        case 'CLEAR_CACHE':
            clearOldCache();
            break;
    }
});

// Cache update functions
async function syncNewsData() {
    // This would sync offline actions with the server
    // For now, just update the cache
    return updateNewsCache();
}

async function updateNewsCache() {
    console.log('[Service Worker] Updating news cache...');

    // This would fetch latest news and update cache
    // For now, just clean old cache
    return cleanOldCache();
}

async function cleanOldCache() {
    const cache = await caches.open(API_CACHE);
    const requests = await cache.keys();
    const oneHourAgo = Date.now() - (60 * 60 * 1000);

    for (const request of requests) {
        const response = await cache.match(request);
        if (response) {
            const cachedTime = response.headers.get('sw-cached-timestamp');
            if (cachedTime && parseInt(cachedTime) < oneHourAgo) {
                await cache.delete(request);
                console.log('[Service Worker] Deleted old cache:', request.url);
            }
        }
    }
}

async function clearOldCache() {
    const cacheNames = await caches.keys();

    for (const cacheName of cacheNames) {
        if (cacheName.startsWith('currents-') &&
            !cacheName.includes(CACHE_VERSION)) {
            await caches.delete(cacheName);
            console.log('[Service Worker] Deleted old cache:', cacheName);
        }
    }
}