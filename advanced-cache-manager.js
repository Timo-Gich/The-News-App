// advanced-cache-manager.js - Enhanced Caching System with Priority Management

class AdvancedCacheManager {
    constructor() {
        this.cacheController = null;
        this.storage = null;
        this.apiClient = null;
        this.offlineManager = null;
        
        // Cache configuration
        this.config = {
            // Cache expiration times (in hours)
            cacheExpirations: {
                featured: 1,      // Featured articles - 1 hour
                bookmarked: 24,   // Bookmarked articles - 24 hours
                trending: 2,      // Trending articles - 2 hours
                category: 4,      // Category pages - 4 hours
                search: 6,        // Search results - 6 hours
                general: 8,       // General articles - 8 hours
                images: 24,       // Images - 24 hours
                api: 2            // API responses - 2 hours
            },
            
            // Cache priorities (higher = more important)
            cachePriorities: {
                featured: 10,
                bookmarked: 9,
                trending: 8,
                search: 7,
                category: 6,
                general: 5,
                images: 3,
                api: 4
            },
            
            // Cache limits
            maxCacheSize: 500,    // Maximum cached items
            maxImageCacheSize: 100, // Maximum cached images
            maxSearchCacheSize: 50, // Maximum cached searches
            
            // Performance settings
            compressionEnabled: true,
            batchOperations: true,
            backgroundCleanup: true
        };
        
        // Cache statistics
        this.stats = {
            hits: 0,
            misses: 0,
            evictions: 0,
            compressionRatio: 0
        };
    }

    init(cacheController, storage, apiClient, offlineManager) {
        this.cacheController = cacheController;
        this.storage = storage;
        this.apiClient = apiClient;
        this.offlineManager = offlineManager;
        
        this.loadCacheStats();
        this.setupBackgroundTasks();
    }

    // ==================== PRIORITY-BASED CACHING ====================

    async cacheWithPriority(data, url, priority = 'general', metadata = {}) {
        const cacheKey = this.generateCacheKey(url);
        const cacheData = {
            key: cacheKey,
            url: url,
            data: data,
            priority: priority,
            timestamp: Date.now(),
            expiresAt: this.calculateExpiration(priority),
            metadata: {
                ...metadata,
                size: this.estimateDataSize(data),
                accessCount: 0,
                lastAccessed: Date.now()
            }
        };

        // Compress data if enabled and beneficial
        if (this.config.compressionEnabled && cacheData.metadata.size > 1024) {
            cacheData.data = await this.compressData(data);
            cacheData.metadata.compressed = true;
        }

        try {
            // Store in IndexedDB with priority
            await this.storage.setSetting(`cache_${cacheKey}`, cacheData);
            
            // Also store in Service Worker cache for faster access
            if (this.cacheController) {
                await this.cacheController.cacheApiResponse(url, new Response(JSON.stringify(data)));
            }

            // Clean up old cache entries
            await this.cleanupCache();
            
            console.log(`[AdvancedCache] Cached ${url} with priority ${priority}`);
            return true;
        } catch (error) {
            console.error('[AdvancedCache] Failed to cache data:', error);
            return false;
        }
    }

    async getCachedData(url, priority = 'general') {
        const cacheKey = this.generateCacheKey(url);
        const cacheData = await this.storage.getSetting(`cache_${cacheKey}`);
        
        if (!cacheData) {
            this.stats.misses++;
            return null;
        }

        // Check if expired
        if (Date.now() > cacheData.expiresAt) {
            await this.storage.setSetting(`cache_${cacheKey}`, null);
            this.stats.misses++;
            return null;
        }

        // Update access statistics
        cacheData.metadata.accessCount++;
        cacheData.metadata.lastAccessed = Date.now();
        await this.storage.setSetting(`cache_${cacheKey}`, cacheData);

        // Decompress if needed
        let data = cacheData.data;
        if (cacheData.metadata.compressed) {
            data = await this.decompressData(data);
        }

        this.stats.hits++;
        console.log(`[AdvancedCache] Retrieved ${url} from cache (priority: ${priority})`);
        return data;
    }

    calculateExpiration(priority) {
        const hours = this.config.cacheExpirations[priority] || this.config.cacheExpirations.general;
        return Date.now() + (hours * 60 * 60 * 1000);
    }

    generateCacheKey(url) {
        // Create a consistent hash of the URL for cache key
        let hash = 0;
        for (let i = 0; i < url.length; i++) {
            const char = url.charCodeAt(i);
            hash = ((hash << 5) - hash) + char;
            hash = hash & hash; // Convert to 32-bit integer
        }
        return `cache_${Math.abs(hash)}_${encodeURIComponent(url).replace(/[^a-zA-Z0-9]/g, '_')}`;
    }

    // ==================== SMART CACHE INVALIDATION ====================

    async invalidateCache(pattern, priorityThreshold = 0) {
        try {
            // Get all cache keys
            const allKeys = await this.getAllCacheKeys();
            
            for (const key of allKeys) {
                const cacheData = await this.storage.getSetting(key);
                if (cacheData && cacheData.priority >= priorityThreshold) {
                    // Check if URL matches pattern
                    if (this.matchesPattern(cacheData.url, pattern)) {
                        await this.storage.setSetting(key, null);
                        console.log(`[AdvancedCache] Invalidated cache for ${cacheData.url}`);
                    }
                }
            }
        } catch (error) {
            console.error('[AdvancedCache] Failed to invalidate cache:', error);
        }
    }

    async invalidateExpiredCache() {
        try {
            const allKeys = await this.getAllCacheKeys();
            let expiredCount = 0;
            
            for (const key of allKeys) {
                const cacheData = await this.storage.getSetting(key);
                if (cacheData && Date.now() > cacheData.expiresAt) {
                    await this.storage.setSetting(key, null);
                    expiredCount++;
                }
            }
            
            console.log(`[AdvancedCache] Cleaned up ${expiredCount} expired cache entries`);
            return expiredCount;
        } catch (error) {
            console.error('[AdvancedCache] Failed to clean expired cache:', error);
            return 0;
        }
    }

    async cleanupCache() {
        try {
            const allKeys = await this.getAllCacheKeys();
            const cacheEntries = [];
            
            // Load all cache entries with their metadata
            for (const key of allKeys) {
                const cacheData = await this.storage.getSetting(key);
                if (cacheData) {
                    cacheEntries.push({
                        key: key,
                        data: cacheData,
                        priority: cacheData.priority,
                        lastAccessed: cacheData.metadata.lastAccessed,
                        size: cacheData.metadata.size
                    });
                }
            }

            // Sort by priority (high to low), then by last accessed (recent to old)
            cacheEntries.sort((a, b) => {
                if (a.priority !== b.priority) {
                    return b.priority - a.priority;
                }
                return a.lastAccessed - b.lastAccessed;
            });

            // Remove excess entries, starting with lowest priority and oldest
            const maxEntries = this.config.maxCacheSize;
            let evictedCount = 0;

            if (cacheEntries.length > maxEntries) {
                const toRemove = cacheEntries.slice(maxEntries);
                
                for (const entry of toRemove) {
                    await this.storage.setSetting(entry.key, null);
                    evictedCount++;
                }
            }

            this.stats.evictions += evictedCount;
            console.log(`[AdvancedCache] Cache cleanup: evicted ${evictedCount} entries`);
            return evictedCount;
        } catch (error) {
            console.error('[AdvancedCache] Failed to cleanup cache:', error);
            return 0;
        }
    }

    // ==================== INTELLIGENT PRELOADING ====================

    async preloadHighPriorityContent() {
        try {
            console.log('[AdvancedCache] Starting high-priority content preloading...');
            
            // 1. Preload featured articles
            await this.preloadFeaturedArticles();
            
            // 2. Preload bookmarked articles
            await this.preloadBookmarkedArticles();
            
            // 3. Preload trending content
            await this.preloadTrendingContent();
            
            // 4. Preload category pages for frequently accessed categories
            await this.preloadFrequentCategories();
            
            console.log('[AdvancedCache] High-priority preloading completed');
        } catch (error) {
            console.error('[AdvancedCache] Preloading failed:', error);
        }
    }

    async preloadFeaturedArticles() {
        try {
            const featuredArticles = await this.getFeaturedArticles();
            for (const article of featuredArticles) {
                await this.cacheWithPriority(
                    article, 
                    `featured_${article.id}`, 
                    'featured',
                    { type: 'article', category: article.category }
                );
            }
        } catch (error) {
            console.warn('[AdvancedCache] Failed to preload featured articles:', error);
        }
    }

    async preloadBookmarkedArticles() {
        try {
            const bookmarkedArticles = await this.storage.getBookmarkedArticles();
            for (const article of bookmarkedArticles) {
                await this.cacheWithPriority(
                    article,
                    `bookmarked_${article.id}`,
                    'bookmarked',
                    { type: 'article', bookmarked: true }
                );
            }
        } catch (error) {
            console.warn('[AdvancedCache] Failed to preload bookmarked articles:', error);
        }
    }

    async preloadTrendingContent() {
        try {
            // Get trending categories from user behavior
            const trendingCategories = await this.getTrendingCategories();
            
            for (const category of trendingCategories) {
                const articles = await this.fetchCategoryArticles(category);
                await this.cacheWithPriority(
                    articles,
                    `category_${category}`,
                    'trending',
                    { type: 'category', category: category }
                );
            }
        } catch (error) {
            console.warn('[AdvancedCache] Failed to preload trending content:', error);
        }
    }

    async preloadFrequentCategories() {
        try {
            const frequentCategories = await this.getFrequentCategories();
            
            for (const category of frequentCategories) {
                const articles = await this.fetchCategoryArticles(category);
                await this.cacheWithPriority(
                    articles,
                    `category_${category}`,
                    'category',
                    { type: 'category', category: category, frequent: true }
                );
            }
        } catch (error) {
            console.warn('[AdvancedCache] Failed to preload frequent categories:', error);
        }
    }

    // ==================== DATA COMPRESSION ====================

    async compressData(data) {
        if (!this.config.compressionEnabled) return data;
        
        try {
            // Simple compression for text data
            const jsonString = JSON.stringify(data);
            const encoder = new TextEncoder();
            const uint8Array = encoder.encode(jsonString);
            
            // Use TextEncoder/Decoder for basic compression simulation
            // In a real implementation, you might use libraries like pako for gzip
            const compressed = btoa(String.fromCharCode(...uint8Array));
            
            this.stats.compressionRatio = compressed.length / jsonString.length;
            return { compressed: true, data: compressed };
        } catch (error) {
            console.warn('[AdvancedCache] Compression failed, storing uncompressed:', error);
            return data;
        }
    }

    async decompressData(compressedData) {
        if (!compressedData.compressed) return compressedData;
        
        try {
            const binaryString = atob(compressedData.data);
            const uint8Array = new Uint8Array(binaryString.length);
            for (let i = 0; i < binaryString.length; i++) {
                uint8Array[i] = binaryString.charCodeAt(i);
            }
            const decoder = new TextDecoder();
            const jsonString = decoder.decode(uint8Array);
            return JSON.parse(jsonString);
        } catch (error) {
            console.error('[AdvancedCache] Decompression failed:', error);
            return compressedData;
        }
    }

    estimateDataSize(data) {
        try {
            return JSON.stringify(data).length;
        } catch (error) {
            return 0;
        }
    }

    // ==================== CACHE ANALYTICS ====================

    getCacheStats() {
        const hitRate = this.stats.hits / (this.stats.hits + this.stats.misses) || 0;
        return {
            ...this.stats,
            hitRate: Math.round(hitRate * 100) / 100,
            compressionRatio: Math.round(this.stats.compressionRatio * 100) / 100,
            totalCachedItems: this.getAllCacheKeys().length || 0
        };
    }

    async getCacheHealth() {
        const stats = this.getCacheStats();
        const allKeys = await this.getAllCacheKeys();
        const cacheEntries = [];
        
        for (const key of allKeys) {
            const cacheData = await this.storage.getSetting(key);
            if (cacheData) {
                cacheEntries.push({
                    url: cacheData.url,
                    priority: cacheData.priority,
                    age: Date.now() - cacheData.timestamp,
                    accessCount: cacheData.metadata.accessCount,
                    size: cacheData.metadata.size
                });
            }
        }

        // Analyze cache health
        const health = {
            totalItems: cacheEntries.length,
            byPriority: this.groupByPriority(cacheEntries),
            byAge: this.groupByAge(cacheEntries),
            byAccessCount: this.groupByAccessCount(cacheEntries),
            recommendations: this.generateRecommendations(cacheEntries, stats)
        };

        return health;
    }

    groupByPriority(entries) {
        const groups = {};
        entries.forEach(entry => {
            const priority = entry.priority;
            if (!groups[priority]) groups[priority] = 0;
            groups[priority]++;
        });
        return groups;
    }

    groupByAge(entries) {
        const groups = { fresh: 0, recent: 0, old: 0, stale: 0 };
        entries.forEach(entry => {
            const hours = entry.age / (1000 * 60 * 60);
            if (hours < 1) groups.fresh++;
            else if (hours < 6) groups.recent++;
            else if (hours < 24) groups.old++;
            else groups.stale++;
        });
        return groups;
    }

    groupByAccessCount(entries) {
        const groups = { never: 0, low: 0, medium: 0, high: 0 };
        entries.forEach(entry => {
            const count = entry.accessCount;
            if (count === 0) groups.never++;
            else if (count < 5) groups.low++;
            else if (count < 20) groups.medium++;
            else groups.high++;
        });
        return groups;
    }

    generateRecommendations(entries, stats) {
        const recommendations = [];
        
        // Check hit rate
        if (stats.hitRate < 0.5) {
            recommendations.push({
                type: 'performance',
                priority: 'high',
                message: 'Low cache hit rate detected. Consider increasing cache expiration times or preloading more content.'
            });
        }

        // Check compression ratio
        if (stats.compressionRatio > 0.8) {
            recommendations.push({
                type: 'storage',
                priority: 'medium',
                message: 'High compression ratio. Consider enabling more aggressive compression or reducing cache size.'
            });
        }

        // Check stale items
        const staleItems = entries.filter(e => e.age > 24 * 60 * 60 * 1000).length;
        if (staleItems > entries.length * 0.2) {
            recommendations.push({
                type: 'maintenance',
                priority: 'medium',
                message: 'Many stale cache items detected. Consider running cache cleanup more frequently.'
            });
        }

        return recommendations;
    }

    // ==================== BACKGROUND TASKS ====================

    setupBackgroundTasks() {
        if (!this.config.backgroundCleanup) return;

        // Cleanup expired cache every 30 minutes
        setInterval(async () => {
            await this.invalidateExpiredCache();
        }, 30 * 60 * 1000);

        // Update cache stats every 10 minutes
        setInterval(() => {
            this.saveCacheStats();
        }, 10 * 60 * 1000);

        // Preload high-priority content every 2 hours
        setInterval(async () => {
            if (navigator.onLine) {
                await this.preloadHighPriorityContent();
            }
        }, 2 * 60 * 60 * 1000);
    }

    // ==================== UTILITY METHODS ====================

    async getAllCacheKeys() {
        // This would need to be implemented based on your storage system
        // For now, return empty array - you'd need to implement key enumeration
        return [];
    }

    matchesPattern(url, pattern) {
        if (typeof pattern === 'string') {
            return url.includes(pattern);
        } else if (pattern instanceof RegExp) {
            return pattern.test(url);
        }
        return false;
    }

    async getFeaturedArticles() {
        // Get featured articles from API or cache
        try {
            const response = await this.apiClient.fetchArticles({
                page: 1,
                category: 'latest',
                filters: {}
            });
            return response.articles.slice(0, 5); // Return top 5 as featured
        } catch (error) {
            return [];
        }
    }

    async getTrendingCategories() {
        // Analyze user behavior to find trending categories
        const behavior = await this.storage.getSetting('smart_preloader_behavior');
        if (!behavior || !behavior.downloadHistory) return ['latest', 'world', 'technology'];
        
        const categoryCounts = {};
        behavior.downloadHistory.slice(-20).forEach(item => {
            if (item.category) {
                categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
            }
        });

        return Object.entries(categoryCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 3)
            .map(([category]) => category);
    }

    async getFrequentCategories() {
        // Get categories the user accesses most frequently
        const behavior = await this.storage.getSetting('smart_preloader_behavior');
        if (!behavior || !behavior.preferences) return ['latest'];
        
        const categories = behavior.preferences.categories || {};
        return Object.entries(categories)
            .sort(([,a], [,b]) => b.count - a.count)
            .slice(0, 3)
            .map(([category]) => category);
    }

    async fetchCategoryArticles(category) {
        try {
            const response = await this.apiClient.fetchArticles({
                page: 1,
                category: category,
                filters: {}
            });
            return response.articles;
        } catch (error) {
            return [];
        }
    }

    loadCacheStats() {
        try {
            const saved = localStorage.getItem('advanced_cache_stats');
            if (saved) {
                this.stats = JSON.parse(saved);
            }
        } catch (error) {
            console.warn('[AdvancedCache] Failed to load cache stats:', error);
        }
    }

    saveCacheStats() {
        try {
            localStorage.setItem('advanced_cache_stats', JSON.stringify(this.stats));
        } catch (error) {
            console.warn('[AdvancedCache] Failed to save cache stats:', error);
        }
    }

    // ==================== PUBLIC API ====================

    async warmCache() {
        await this.preloadHighPriorityContent();
    }

    async clearCache(priorityThreshold = 0) {
        const allKeys = await this.getAllCacheKeys();
        let clearedCount = 0;
        
        for (const key of allKeys) {
            const cacheData = await this.storage.getSetting(key);
            if (cacheData && cacheData.priority >= priorityThreshold) {
                await this.storage.setSetting(key, null);
                clearedCount++;
            }
        }
        
        console.log(`[AdvancedCache] Cleared ${clearedCount} cache entries`);
        return clearedCount;
    }

    async optimizeCache() {
        // Run comprehensive cache optimization
        await this.cleanupCache();
        await this.invalidateExpiredCache();
        await this.preloadHighPriorityContent();
        return this.getCacheHealth();
    }
}

// Export for use in other modules
window.AdvancedCacheManager = AdvancedCacheManager;