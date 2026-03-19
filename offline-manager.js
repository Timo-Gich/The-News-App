// offline-manager.js - Offline Download Manager (Simplified)

class OfflineManager {
    constructor() {
        this.storage = new OfflineStorage();
        this.cacheController = new CacheController();

        this.isOnline = navigator.onLine;
        this.offlineMode = false;
        this.syncInProgress = false;

        this.stats = {
            totalArticles: 0,
            offlineArticles: 0,
            storageUsage: 0,
            lastSync: null
        };
    }

    async init() {
        console.log('Initializing Offline Manager...');

        // Initialize storage
        const storageInitialized = await this.storage.init();
        if (!storageInitialized) {
            console.warn('Offline storage initialization failed');
        }

        // Initialize cache controller
        const cacheInitialized = await this.cacheController.init();
        if (!cacheInitialized) {
            console.warn('Cache controller initialization failed');
        }

        // Set up online/offline listeners
        this.setupNetworkListeners();

        // Update initial stats
        await this.updateStats();

        // Check if we should start in offline mode
        this.checkInitialConnection();

        console.log('Offline Manager initialized');
        return true;
    }

    setupNetworkListeners() {
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());

        // Listen for service worker messages
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.addEventListener('message', (event) => {
                this.handleServiceWorkerMessage(event);
            });
        }
    }

    checkInitialConnection() {
        this.isOnline = navigator.onLine;

        if (!this.isOnline) {
            this.enableOfflineMode();
            this.showOfflineIndicator();
        } else {
            this.disableOfflineMode();
            this.hideOfflineIndicator();
        }
    }

    async handleOnline() {
        console.log('Network: Online');
        this.isOnline = true;
        this.disableOfflineMode();
        this.hideOfflineIndicator();

        // Try to sync pending actions
        await this.syncPendingActions();

        // Update cache in background
        this.updateCacheInBackground();

        // Update stats
        await this.updateStats();

        // Show online notification
        this.showToast('Back online! Syncing your data...', 'success');
    }

    async handleOffline() {
        console.log('Network: Offline');
        this.isOnline = false;
        this.enableOfflineMode();
        this.showOfflineIndicator();

        // Update stats
        await this.updateStats();

        // Show offline notification
        this.showToast('You are offline. Using cached articles.', 'warning');
    }

    enableOfflineMode() {
        this.offlineMode = true;
        document.body.classList.add('offline-mode');

        // Update UI elements
        this.updateConnectionStatus('offline');
    }

    disableOfflineMode() {
        this.offlineMode = false;
        document.body.classList.remove('offline-mode');

        // Update UI elements
        this.updateConnectionStatus('online');
    }

    async saveArticleForOffline(article) {
        if (!article || !article.id) {
            throw new Error('Invalid article');
        }

        try {
            // Save to IndexedDB
            const saved = await this.storage.saveArticle(article, true);

            if (saved) {
                // Cache the article image if available
                if (article.image && article.image !== "None") {
                    await this.cacheArticleImage(article.image);
                }

                // Update stats
                await this.updateStats();

                // Show success message
                this.showToast('Article saved for offline reading!', 'success');

                return true;
            }

            return false;
        } catch (error) {
            console.error('Failed to save article for offline:', error);
            this.showToast('Failed to save article for offline', 'error');
            return false;
        }
    }

    async cacheArticleImage(imageUrl) {
        if (!imageUrl || !this.isOnline) return false;

        try {
            const response = await fetch(imageUrl);
            if (response.ok) {
                await this.cacheController.cacheImage(imageUrl, response.clone());
                return true;
            }
        } catch (error) {
            console.error('Failed to cache image:', error);
        }

        return false;
    }

    async getOfflineArticles(limit = 50, offset = 0) {
        try {
            const articles = await this.storage.getOfflineArticles(limit, offset);
            return articles;
        } catch (error) {
            console.error('Failed to get offline articles:', error);
            return [];
        }
    }

    async searchOfflineArticles(query, filters = {}) {
        try {
            const articles = await this.storage.searchArticles(query, filters);
            return articles;
        } catch (error) {
            console.error('Failed to search offline articles:', error);
            return [];
        }
    }

    async getArticleWithOfflineStatus(articleId) {
        try {
            // Get article from IndexedDB
            const offlineArticle = await this.storage.getArticle(articleId);

            if (offlineArticle) {
                // Check if it's saved for offline
                return {
                    ...offlineArticle,
                    availableOffline: offlineArticle.savedForOffline || false,
                    read: offlineArticle.read || false
                };
            }

            return null;
        } catch (error) {
            console.error('Failed to get article offline status:', error);
            return null;
        }
    }

    async updateReadingProgress(articleId, progress) {
        try {
            await this.storage.updateReadingProgress(articleId, progress);

            // Queue sync action if online
            if (this.isOnline) {
                await this.storage.queueOfflineAction({
                    type: 'update_progress',
                    articleId: articleId,
                    progress: progress
                });
            }

            return true;
        } catch (error) {
            console.error('Failed to update reading progress:', error);
            return false;
        }
    }

    async toggleBookmark(article) {
        try {
            const result = await this.storage.toggleBookmark(article);

            // Queue sync action if online
            if (this.isOnline) {
                await this.storage.queueOfflineAction({
                    type: 'bookmark',
                    articleId: article.id,
                    bookmarked: result.bookmarked,
                    article: article
                });
            }

            // Update stats
            await this.updateStats();

            this.showToast(
                result.bookmarked ? 'Article bookmarked!' : 'Bookmark removed!',
                result.bookmarked ? 'success' : 'info'
            );

            return result;
        } catch (error) {
            console.error('Failed to toggle bookmark:', error);
            this.showToast('Failed to update bookmark', 'error');
            return { bookmarked: false };
        }
    }

    async isArticleBookmarked(articleId) {
        try {
            return await this.storage.isArticleBookmarked(articleId);
        } catch (error) {
            console.error('Failed to check bookmark status:', error);
            return false;
        }
    }

    async getBookmarkedArticles() {
        try {
            return await this.storage.getBookmarkedArticles();
        } catch (error) {
            console.error('Failed to get bookmarked articles:', error);
            return [];
        }
    }

    async syncPendingActions() {
        if (this.syncInProgress || !this.isOnline) {
            return;
        }

        this.syncInProgress = true;

        try {
            const pendingActions = await this.storage.getPendingActions();

            if (pendingActions.length === 0) {
                this.syncInProgress = false;
                return;
            }

            console.log(`Syncing ${pendingActions.length} pending actions...`);

            let successCount = 0;
            let failCount = 0;

            for (const action of pendingActions) {
                try {
                    // Here you would sync with your backend
                    // For now, we'll just mark as completed
                    await this.storage.updateActionStatus(action.id, 'completed');
                    successCount++;

                    // Simulate API call delay
                    await new Promise(resolve => setTimeout(resolve, 100));
                } catch (error) {
                    console.error('Failed to sync action:', error);
                    await this.storage.updateActionStatus(action.id, 'failed');
                    failCount++;
                }
            }

            console.log(`Sync completed: ${successCount} succeeded, ${failCount} failed`);

            if (successCount > 0) {
                this.showToast(`Synced ${successCount} actions`, 'success');
            }

            // Update last sync time
            this.stats.lastSync = new Date().toISOString();
            await this.storage.setSetting('lastSync', this.stats.lastSync);

        } catch (error) {
            console.error('Sync failed:', error);
        } finally {
            this.syncInProgress = false;
        }
    }

    async updateCacheInBackground() {
        if (!this.isOnline) return;

        try {
            // Update latest news cache
            await this.cacheController.sendMessageToServiceWorker({
                type: 'UPDATE_CACHE',
                timestamp: Date.now()
            });

            // Clean up expired cache
            await this.cacheController.cleanupExpiredCache();

            console.log('Background cache update completed');
        } catch (error) {
            console.error('Background cache update failed:', error);
        }
    }

    async updateStats() {
        try {
            // Get storage stats
            const storageStats = await this.storage.getStorageStats();
            if (storageStats) {
                this.stats.totalArticles = storageStats.totalArticles || 0;
                this.stats.offlineArticles = storageStats.offlineArticles || 0;
                this.stats.readArticles = storageStats.readArticles || 0;
                this.stats.bookmarkedArticles = storageStats.bookmarkedArticles || 0;
            }

            // Get storage usage
            const storageUsage = await this.storage.estimateStorageUsage();
            if (storageUsage) {
                this.stats.storageUsage = storageUsage.usage || 0;
                this.stats.storageQuota = storageUsage.quota || 0;
                this.stats.storagePercentage = storageUsage.percentage || 0;
            }

            // Get last sync time
            const lastSync = await this.storage.getSetting('lastSync');
            this.stats.lastSync = lastSync;

            // Update UI
            this.updateStatsUI();

            return this.stats;
        } catch (error) {
            console.error('Failed to update stats:', error);
            return this.stats;
        }
    }

    updateStatsUI() {
        // Update offline count in stats bar
        const offlineCountEl = document.getElementById('offline-count');
        if (offlineCountEl) {
            offlineCountEl.textContent = this.stats.offlineArticles;
        }

        // Update storage progress bar
        const storageBar = document.getElementById('storage-bar');
        const storageText = document.getElementById('storage-text');

        if (storageBar && storageText) {
            const percentage = this.stats.storagePercentage;
            const usedMB = Math.round(this.stats.storageUsage / (1024 * 1024) * 100) / 100;
            const quotaMB = Math.round(this.stats.storageQuota / (1024 * 1024) * 100) / 100;

            storageBar.style.width = Math.min(percentage, 100) + '%';
            storageBar.style.backgroundColor = percentage > 90 ? '#ef4444' :
                percentage > 70 ? '#f59e0b' : '#10b981';

            storageText.textContent = `${usedMB} MB of ${quotaMB} MB used`;
        }
    }

    updateConnectionStatus(status) {
        const connectionStatusEl = document.getElementById('connection-status');
        const offlineIndicatorEl = document.getElementById('offline-indicator');

        if (connectionStatusEl) {
            connectionStatusEl.className = `connection-status ${status}`;
            connectionStatusEl.querySelector('.status-text').textContent =
                status === 'online' ? 'Online' : 'Offline';
        }

        if (offlineIndicatorEl) {
            offlineIndicatorEl.style.display = status === 'offline' ? 'flex' : 'none';
        }
    }

    showOfflineIndicator() {
        const indicator = document.getElementById('offline-indicator');
        if (indicator) {
            indicator.style.display = 'flex';
            indicator.innerHTML = '<i class="fas fa-wifi-slash"></i><span>Offline</span>';
        }
    }

    hideOfflineIndicator() {
        const indicator = document.getElementById('offline-indicator');
        if (indicator) {
            indicator.style.display = 'none';
        }
    }

    async clearOldArticles(days = 30) {
        try {
            const deletedCount = await this.storage.clearOldArticles(days);

            // Also clean expired cache
            await this.cacheController.cleanupExpiredCache();

            // Update stats
            await this.updateStats();

            this.showToast(`Cleared ${deletedCount} old articles`, 'success');
            return deletedCount;
        } catch (error) {
            console.error('Failed to clear old articles:', error);
            this.showToast('Failed to clear old articles', 'error');
            return 0;
        }
    }

    async clearAllOfflineData() {
        if (!confirm('Are you sure you want to clear all offline data? This cannot be undone.')) {
            return false;
        }

        try {
            // Clear IndexedDB
            await this.storage.clearAllData();

            // Clear cache
            await this.cacheController.clearAllCache();

            // Update stats
            await this.updateStats();

            this.showToast('All offline data cleared', 'success');
            return true;
        } catch (error) {
            console.error('Failed to clear offline data:', error);
            this.showToast('Failed to clear offline data', 'error');
            return false;
        }
    }

    async exportLibrary() {
        try {
            const articles = await this.storage.getOfflineArticles(1000, 0);
            const bookmarks = await this.storage.getBookmarkedArticles();

            const exportData = {
                version: '1.0',
                exportedAt: new Date().toISOString(),
                articles: articles,
                bookmarks: bookmarks,
                stats: this.stats
            };

            const blob = new Blob([JSON.stringify(exportData, null, 2)], {
                type: 'application/json'
            });

            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `currents-news-library-${new Date().toISOString().split('T')[0]}.json`;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);

            this.showToast('Library exported successfully', 'success');
            return true;
        } catch (error) {
            console.error('Failed to export library:', error);
            this.showToast('Failed to export library', 'error');
            return false;
        }
    }

    handleServiceWorkerMessage(event) {
        const { data } = event;

        switch (data.type) {
            case 'CACHE_UPDATED':
                console.log('Cache updated via service worker');
                break;

            case 'BACKGROUND_SYNC_COMPLETED':
                console.log('Background sync completed');
                this.showToast('Background sync completed', 'info');
                break;

            case 'NEW_CONTENT_AVAILABLE':
                console.log('New content available');
                this.showToast('New content is available. Refresh to see it.', 'info');
                break;
        }
    }

    showToast(message, type = 'info') {
        // Create toast element
        const container = document.getElementById('toast-container');
        if (!container) return;

        const toast = document.createElement('div');
        toast.className = `toast ${type}`;

        const icons = {
            'success': 'fas fa-check-circle',
            'error': 'fas fa-exclamation-circle',
            'warning': 'fas fa-exclamation-triangle',
            'info': 'fas fa-info-circle'
        };

        toast.innerHTML = `
            <div class="toast-icon">
                <i class="${icons[type] || icons.info}"></i>
            </div>
            <div class="toast-message">${message}</div>
            <button class="toast-close">
                <i class="fas fa-times"></i>
            </button>
        `;

        container.appendChild(toast);

        // Remove toast after 5 seconds
        setTimeout(() => {
            if (toast.parentNode) {
                toast.remove();
            }
        }, 5000);

        // Close button
        toast.querySelector('.toast-close').addEventListener('click', () => {
            toast.remove();
        });
    }

    async prefetchRelatedArticles(currentArticle) {
        if (!this.isOnline) return;

        try {
            // Get articles from same category
            const offlineArticles = await this.storage.searchArticles('', {
                category: currentArticle.category && currentArticle.category[0]
            });

            // Prefetch images for related articles
            const articlesToPrefetch = offlineArticles
                .filter(article => article.id !== currentArticle.id)
                .slice(0, 3);

            await this.cacheController.prefetchArticleImages(articlesToPrefetch);
        } catch (error) {
            // Silent fail for prefetching
        }
    }

    async getCacheStats() {
        try {
            const cacheStats = await this.cacheController.getCacheStats();
            const storageStats = await this.storage.getStorageStats();

            return {
                cache: cacheStats,
                storage: storageStats,
                total: cacheStats.total + (storageStats.totalArticles * 50) // Estimate
            };
        } catch (error) {
            console.error('Failed to get cache stats:', error);
            return null;
        }
    }

    // ===== OFFLINE DOWNLOAD SYSTEM =====

    // Initialize with API client reference for downloads
    setAPIClient(apiClient) {
        this.apiClient = apiClient;
    }

    // Smart Auto-Download Controller (Background, Small)
    async autoDownloadLatestPages() {
        try {
            // Check if auto-download already ran this session
            const sessionStatus = await this.storage.getSessionAutoDownloadStatus();
            if (sessionStatus) {
                console.log('[AutoDownload] Already ran this session, skipping');
                return;
            }

            // Check prerequisites
            if (!this.isOnline) {
                console.log('[AutoDownload] Offline, skipping auto-download');
                return;
            }

            // Check connection quality (Wi-Fi preferred)
            const connection = navigator.connection || navigator.mozConnection || navigator.webkitConnection;
            if (connection) {
                if (connection.effectiveType && connection.effectiveType.includes('2g')) {
                    console.log('[AutoDownload] Poor connection, skipping');
                    return;
                }
            }

            // Check battery level
            if (navigator.getBattery) {
                try {
                    const battery = await navigator.getBattery();
                    if (battery.level < 0.2) {
                        console.log('[AutoDownload] Low battery, skipping');
                        return;
                    }
                } catch (error) {
                    console.log('[AutoDownload] Battery check failed, proceeding');
                }
            }

            // Check storage quota
            const storageUsage = await this.storage.estimateStorageUsage();
            if (storageUsage.percentage > 80) {
                console.log('[AutoDownload] Storage nearly full, skipping');
                return;
            }

            console.log('[AutoDownload] Starting auto-download of pages 1-2');

            // Download pages 1 and 2 of latest news
            const downloadPromises = [];
            for (let pageNum = 1; pageNum <= 2; pageNum++) {
                downloadPromises.push(this.downloadPageForOffline(pageNum, 'latest', 'auto'));
            }

            const results = await Promise.allSettled(downloadPromises);
            const successfulDownloads = results.filter(r => r.status === 'fulfilled').length;

            if (successfulDownloads > 0) {
                await this.storage.setSessionAutoDownloadStatus(true);
                await this.storage.setLastAutoDownloadTime(new Date().toISOString());
                console.log(`[AutoDownload] Completed: ${successfulDownloads} pages downloaded`);
                this.showToast(`Auto-downloaded ${successfulDownloads} pages for offline reading`, 'success');
            }

        } catch (error) {
            console.error('[AutoDownload] Failed:', error);
        }
    }

    // Manual Bulk Download Controller (User-Controlled, Large)
    async downloadPages(category = 'latest', pageCount = 15) {
        try {
            if (!this.isOnline || !navigator.onLine) {
                throw new Error('Must be online to download articles');
            }

            if (!this.apiClient) {
                throw new Error('API client not configured');
            }

            // Check storage quota
            const storageUsage = await this.storage.estimateStorageUsage();
            if (storageUsage.percentage > 80) {
                throw new Error('Storage nearly full');
            }

            console.log(`[Download] Starting bulk download: ${pageCount} pages of ${category}`);

            // Show progress UI
            this.showDownloadProgress(true, 0, pageCount);

            let downloadedPages = 0;
            let totalSizeMB = 0;
            let downloadedArticles = [];

            // Download pages sequentially
            for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
                try {
                    const result = await this.downloadPageForOffline(pageNum, category, 'manual');
                    if (result.success) {
                        downloadedPages++;
                        totalSizeMB += result.sizeMB;
                        downloadedArticles.push(...result.articles);

                        // Update progress
                        this.updateDownloadProgress(downloadedPages, pageCount, result.sizeMB);
                    }
                } catch (error) {
                    console.error(`[Download] Failed to download page ${pageNum}:`, error);
                }
            }

            // Hide progress UI
            this.showDownloadProgress(false);

            // Update stats
            await this.updateStats();

            return {
                downloadedPages,
                totalSizeMB,
                downloadedArticles: downloadedArticles.length,
                success: downloadedPages > 0
            };

        } catch (error) {
            console.error('[Download] Bulk download failed:', error);
            this.showDownloadProgress(false);
            throw error;
        }
    }

    // Helper: Download a single page for offline
    async downloadPageForOffline(pageNum, category = 'latest', origin = 'manual') {
        try {
            if (!this.apiClient) {
                throw new Error('API client not available');
            }

            // Fetch articles for this page using API client
            const apiResponse = await this.apiClient.fetchArticles({
                page: pageNum,
                category: category,
                filters: {}
            });

            if (!apiResponse.articles || apiResponse.articles.length === 0) {
                return { success: false, sizeMB: 0, articles: [] };
            }

            // Save articles to offline storage
            for (const article of apiResponse.articles) {
                await this.storage.saveArticle(article, true);
            }

            // Cache the page for faster access
            await this.storage.cacheArticlesPage(apiResponse.articles, pageNum, category, origin);

            const sizeMB = this.storage.calculateArticlesSize(apiResponse.articles);
            console.log(`[Download] Cached page ${pageNum} (${apiResponse.articles.length} articles, ${sizeMB.toFixed(2)}MB)`);

            return {
                success: true,
                sizeMB: sizeMB,
                articles: apiResponse.articles
            };

        } catch (error) {
            console.error(`[Download] Failed to download page ${pageNum}:`, error);
            return { success: false, sizeMB: 0, articles: [] };
        }
    }

    // Download Progress UI Management
    showDownloadProgress(show, current = 0, total = 0) {
        const progressContainer = document.getElementById('download-progress-container');
        if (!progressContainer) return;

        if (show) {
            progressContainer.style.display = 'block';
            progressContainer.querySelector('.progress-count').textContent = `${current}/${total}`;
            progressContainer.querySelector('.progress-bar-fill').style.width = '0%';
            progressContainer.querySelector('.progress-text').textContent = 'Downloading...';
        } else {
            progressContainer.style.display = 'none';
        }
    }

    updateDownloadProgress(current, total, pageMB) {
        const progressContainer = document.getElementById('download-progress-container');
        if (!progressContainer) return;

        const percentage = (current / total) * 100;
        const progressFill = progressContainer.querySelector('.progress-bar-fill');
        const progressText = progressContainer.querySelector('.progress-text');
        const progressCount = progressContainer.querySelector('.progress-count');

        progressFill.style.width = `${percentage}%`;
        progressText.textContent = `Downloading page ${current} (${pageMB.toFixed(2)} MB)`;
        progressCount.textContent = `${current}/${total}`;

        // Update color based on progress
        if (percentage > 90) {
            progressFill.style.backgroundColor = '#10b981';
        } else if (percentage > 50) {
            progressFill.style.backgroundColor = '#f59e0b';
        }
    }

    // Cancel download handler
    cancelDownload() {
        // This would be called from UI button
        console.log('[ManualDownload] Cancel requested');
        // Implementation would need to track active downloads
    }

    // ===== END OF OFFLINEMANAGER =====
}

window.OfflineManager = OfflineManager;
