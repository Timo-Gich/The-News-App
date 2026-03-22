// cache-controller.js - Service Worker and Cache Management
class CacheController {
    constructor() {
        this.CACHE_NAME = 'currents-news-v2.0';
        this.API_CACHE_NAME = 'currents-api-v2.0';
        this.IMAGE_CACHE_NAME = 'currents-images-v2.0';

        this.cacheExpirations = {
            static: 60 * 60 * 24 * 30, // 30 days
            api: 60 * 60 * 2, // 2 hours
            images: 60 * 60 * 24 * 7 // 7 days
        };

        this.isServiceWorkerSupported = 'serviceWorker' in navigator;
        this.registration = null;
    }

    async init() {
        if (!this.isServiceWorkerSupported) {
            console.warn('Service Worker not supported');
            return false;
        }

        try {
            // Clear any existing service workers first
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const registration of registrations) {
                    console.log('Unregistering old service worker:', registration.scope);
                    await registration.unregister();
                }
            }

            // Calculate dynamic scope for GitHub Pages compatibility
            const baseUrl = window.location.pathname.replace(/\/[^\/]*$/, '/');
            const scope = baseUrl || './';

            // Register enhanced service worker with robust caching
            this.registration = await navigator.serviceWorker.register('./sw-enhanced.js', {
                scope: scope,
                updateViaCache: 'none'
            });

            console.log('Service Worker registered:', this.registration);

            // Check for updates
            if (this.registration.waiting) {
                this.showUpdateNotification();
            }

            // Listen for updates
            this.registration.addEventListener('updatefound', () => {
                const newWorker = this.registration.installing;
                console.log('Service Worker update found:', newWorker.state);

                newWorker.addEventListener('statechange', () => {
                    if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
                        this.showUpdateNotification();
                    }
                });
            });

            // Wait for service worker to be ready
            await navigator.serviceWorker.ready;

            // Initialize caches
            await this.initCaches();

            return true;
        } catch (error) {
            console.error('Service Worker registration failed:', error);
            return false;
        }
    }

    async initCaches() {
        try {
            // Open or create caches
            const cachePromises = [
                caches.open(this.CACHE_NAME),
                caches.open(this.API_CACHE_NAME),
                caches.open(this.IMAGE_CACHE_NAME)
            ];

            await Promise.all(cachePromises);
            console.log('Caches initialized');
        } catch (error) {
            console.error('Cache initialization failed:', error);
        }
    }

    async cacheStaticAssets(assets) {
        if (!this.isServiceWorkerSupported) return;

        try {
            const cache = await caches.open(this.CACHE_NAME);
            await cache.addAll(assets);
            console.log('Static assets cached');
        } catch (error) {
            console.error('Failed to cache static assets:', error);
        }
    }

    async cacheApiResponse(url, response) {
        if (!this.isServiceWorkerSupported) return;

        try {
            const cache = await caches.open(this.API_CACHE_NAME);

            // Add timestamp for expiration
            const headers = new Headers(response.headers);
            headers.append('sw-cached-timestamp', Date.now().toString());

            const cachedResponse = new Response(response.body, {
                status: response.status,
                statusText: response.statusText,
                headers: headers
            });

            await cache.put(url, cachedResponse);
            console.log('API response cached:', url);
        } catch (error) {
            console.error('Failed to cache API response:', error);
        }
    }

    async cacheImage(url, response) {
        if (!this.isServiceWorkerSupported) return;

        try {
            const cache = await caches.open(this.IMAGE_CACHE_NAME);
            await cache.put(url, response);
            console.log('Image cached:', url);
        } catch (error) {
            console.error('Failed to cache image:', error);
        }
    }

    async getCachedResponse(url, cacheName = null) {
        if (!this.isServiceWorkerSupported) return null;

        try {
            let cacheToUse;

            if (cacheName) {
                cacheToUse = await caches.open(cacheName);
            } else {
                // Determine which cache to use based on URL
                if (url.includes('api.currentsapi.services')) {
                    cacheToUse = await caches.open(this.API_CACHE_NAME);
                } else if (this.isImageUrl(url)) {
                    cacheToUse = await caches.open(this.IMAGE_CACHE_NAME);
                } else {
                    cacheToUse = await caches.open(this.CACHE_NAME);
                }
            }

            const response = await cacheToUse.match(url);

            if (response) {
                // Check if cache has expired
                const cachedTimestamp = response.headers.get('sw-cached-timestamp');
                if (cachedTimestamp) {
                    const cacheAge = Date.now() - parseInt(cachedTimestamp);
                    const maxAge = this.getCacheMaxAge(url);

                    if (cacheAge > maxAge * 1000) {
                        // Cache expired, delete it
                        await cacheToUse.delete(url);
                        return null;
                    }
                }

                return response;
            }

            return null;
        } catch (error) {
            console.error('Failed to get cached response:', error);
            return null;
        }
    }

    getCacheMaxAge(url) {
        if (url.includes('api.currentsapi.services')) {
            return this.cacheExpirations.api;
        } else if (this.isImageUrl(url)) {
            return this.cacheExpirations.images;
        } else {
            return this.cacheExpirations.static;
        }
    }

    isImageUrl(url) {
        return /\.(jpg|jpeg|png|gif|webp|svg)$/i.test(url) ||
            url.includes('unsplash.com') ||
            url.includes('images.unsplash.com');
    }

    async cleanupExpiredCache() {
        if (!this.isServiceWorkerSupported) return;

        try {
            const cacheNames = await caches.keys();
            const currentCaches = [this.CACHE_NAME, this.API_CACHE_NAME, this.IMAGE_CACHE_NAME];

            // Delete old caches
            for (const cacheName of cacheNames) {
                if (!currentCaches.includes(cacheName)) {
                    await caches.delete(cacheName);
                    console.log('Deleted old cache:', cacheName);
                }
            }

            // Clean expired items from current caches
            await this.cleanExpiredCacheItems(this.API_CACHE_NAME);
            await this.cleanExpiredCacheItems(this.IMAGE_CACHE_NAME);

            console.log('Cache cleanup completed');
        } catch (error) {
            console.error('Cache cleanup failed:', error);
        }
    }

    async cleanExpiredCacheItems(cacheName) {
        try {
            const cache = await caches.open(cacheName);
            const requests = await cache.keys();
            const now = Date.now();

            for (const request of requests) {
                const response = await cache.match(request);
                if (response) {
                    const cachedTimestamp = response.headers.get('sw-cached-timestamp');
                    if (cachedTimestamp) {
                        const cacheAge = now - parseInt(cachedTimestamp);
                        const maxAge = this.getCacheMaxAge(request.url) * 1000;

                        if (cacheAge > maxAge) {
                            await cache.delete(request);
                        }
                    }
                }
            }
        } catch (error) {
            console.error('Error cleaning expired cache items:', error);
        }
    }

    async prefetchArticleImages(articles) {
        if (!this.isServiceWorkerSupported || !navigator.onLine) return;

        try {
            const imageUrls = articles
                .map(article => article.image)
                .filter(url => url && url !== "None" && this.isImageUrl(url))
                .slice(0, 5); // Prefetch only first 5 images

            for (const url of imageUrls) {
                try {
                    const response = await fetch(url, { mode: 'no-cors' });
                    if (response.ok) {
                        await this.cacheImage(url, response);
                    }
                } catch (error) {
                    // Silently fail for prefetching
                }
            }
        } catch (error) {
            console.error('Image prefetching failed:', error);
        }
    }

    async getCacheStats() {
        if (!this.isServiceWorkerSupported) {
            return { static: 0, api: 0, images: 0, total: 0 };
        }

        try {
            const cacheNames = [this.CACHE_NAME, this.API_CACHE_NAME, this.IMAGE_CACHE_NAME];
            const stats = { static: 0, api: 0, images: 0, total: 0 };

            for (const cacheName of cacheNames) {
                const cache = await caches.open(cacheName);
                const requests = await cache.keys();

                let size = 0;
                for (const request of requests) {
                    const response = await cache.match(request);
                    if (response) {
                        const blob = await response.blob();
                        size += blob.size;
                    }
                }

                if (cacheName === this.CACHE_NAME) {
                    stats.static = Math.round(size / 1024); // KB
                } else if (cacheName === this.API_CACHE_NAME) {
                    stats.api = Math.round(size / 1024);
                } else if (cacheName === this.IMAGE_CACHE_NAME) {
                    stats.images = Math.round(size / 1024);
                }
            }

            stats.total = stats.static + stats.api + stats.images;
            return stats;
        } catch (error) {
            console.error('Failed to get cache stats:', error);
            return { static: 0, api: 0, images: 0, total: 0 };
        }
    }

    async clearAllCache() {
        if (!this.isServiceWorkerSupported) return false;

        try {
            const cacheNames = await caches.keys();

            for (const cacheName of cacheNames) {
                await caches.delete(cacheName);
            }

            console.log('All cache cleared');
            return true;
        } catch (error) {
            console.error('Failed to clear cache:', error);
            return false;
        }
    }

    showUpdateNotification() {
        // Create update notification toast
        const toast = document.createElement('div');
        toast.className = 'toast info update-toast';
        toast.innerHTML = `
            <div class="toast-icon">
                <i class="fas fa-sync-alt"></i>
            </div>
            <div class="toast-message">
                <strong>Update Available</strong>
                <p>A new version is available. Refresh to update.</p>
            </div>
            <button class="toast-action btn btn-primary" id="update-btn">
                Refresh
            </button>
            <button class="toast-close">
                <i class="fas fa-times"></i>
            </button>
        `;

        document.getElementById('toast-container').appendChild(toast);

        // Add event listeners
        toast.querySelector('#update-btn').addEventListener('click', () => {
            if (this.registration && this.registration.waiting) {
                this.registration.waiting.postMessage({ type: 'SKIP_WAITING' });
            }
            window.location.reload();
        });

        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.remove();
        });

        // Auto-remove after 30 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 30000);
    }

    async requestBackgroundSync() {
        if (!this.registration || !('sync' in this.registration)) {
            return false;
        }

        try {
            await this.registration.sync.register('sync-news');
            console.log('Background sync registered');
            return true;
        } catch (error) {
            console.error('Background sync registration failed:', error);
            return false;
        }
    }

    async requestPeriodicSync() {
        if (!this.registration || !('periodicSync' in this.registration)) {
            return false;
        }

        try {
            // Check if periodic sync is supported and permitted
            const status = await navigator.permissions.query({
                name: 'periodic-background-sync'
            });

            if (status.state === 'granted') {
                await this.registration.periodicSync.register('news-update', {
                    minInterval: 24 * 60 * 60 * 1000 // 24 hours
                });
                console.log('Periodic sync registered');
                return true;
            }
        } catch (error) {
            console.error('Periodic sync not supported:', error);
        }

        return false;
    }

    async sendMessageToServiceWorker(message) {
        if (!this.registration || !this.registration.active) {
            return false;
        }

        try {
            await this.registration.active.postMessage(message);
            return true;
        } catch (error) {
            console.error('Failed to send message to service worker:', error);
            return false;
        }
    }
}

window.CacheController = CacheController;