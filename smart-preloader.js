// smart-preloader.js - Intelligent Article Preloading System
class SmartPreloader {
    constructor() {
        this.storage = null;
        this.apiClient = null;
        this.offlineManager = null;
        this.articleService = null;
        
        // User behavior tracking
        this.userBehavior = {
            readingPatterns: {},
            preferences: {},
            engagementMetrics: {},
            downloadHistory: []
        };
        
        // Preloading configuration
        this.config = {
            maxConcurrentDownloads: 3,
            maxDailyDownloads: 50,
            maxStorageMB: 100,
            bandwidthThreshold: 2, // MB/s
            timeOfDayPreferences: {},
            categoryPreferences: {},
            sourcePreferences: {},
            readingSpeed: 200, // words per minute
            sessionDuration: 0
        };
        
        this.isDownloading = false;
        this.downloadQueue = [];
        this.activeDownloads = new Set();
    }

    init(storage, apiClient, offlineManager, articleService) {
        this.storage = storage;
        this.apiClient = apiClient;
        this.offlineManager = offlineManager;
        this.articleService = articleService;
        
        this.loadUserBehavior();
        this.setupEventListeners();
        this.startBehaviorTracking();
    }

    // ==================== BEHAVIOR TRACKING ====================

    setupEventListeners() {
        // Track reading sessions
        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                this.endReadingSession();
            } else {
                this.startReadingSession();
            }
        });

        // Track scroll behavior
        window.addEventListener('scroll', this.debounce(() => {
            this.trackScrollPosition();
        }, 100));

        // Track clicks and interactions
        document.addEventListener('click', (e) => {
            this.trackInteraction(e.target);
        });

        // Track time of day
        setInterval(() => {
            this.updateTimeOfDayPreferences();
        }, 60000); // Update every minute
    }

    startReadingSession() {
        this.userBehavior.sessionStartTime = Date.now();
        this.userBehavior.sessionDuration = 0;
        this.userBehavior.sessionArticles = [];
        this.userBehavior.sessionScrollDepth = 0;
    }

    endReadingSession() {
        if (this.userBehavior.sessionStartTime) {
            const duration = Date.now() - this.userBehavior.sessionStartTime;
            this.userBehavior.sessionDuration = duration;
            this.recordSessionData();
            this.userBehavior.sessionStartTime = null;
        }
    }

    trackScrollPosition() {
        const scrollPercent = (window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100;
        this.userBehavior.sessionScrollDepth = Math.max(this.userBehavior.sessionScrollDepth, scrollPercent);
    }

    trackInteraction(element) {
        const timeOfDay = new Date().getHours();
        const dayOfWeek = new Date().getDay();
        
        // Track category preferences based on clicks
        const categoryElement = element.closest('.news-card') || element.closest('.sidebar-item');
        if (categoryElement) {
            const category = categoryElement.dataset.category || 
                           categoryElement.querySelector('.news-category')?.textContent ||
                           categoryElement.textContent;
            if (category) {
                this.updateCategoryPreference(category, timeOfDay, dayOfWeek);
            }
        }

        // Track source preferences
        const sourceElement = element.closest('.news-card') || element.closest('.sidebar-item');
        if (sourceElement) {
            const source = sourceElement.dataset.source || 
                          sourceElement.querySelector('.news-source')?.textContent;
            if (source) {
                this.updateSourcePreference(source, timeOfDay, dayOfWeek);
            }
        }
    }

    updateCategoryPreference(category, timeOfDay, dayOfWeek) {
        if (!this.userBehavior.preferences.categories) {
            this.userBehavior.preferences.categories = {};
        }
        if (!this.userBehavior.preferences.categories[category]) {
            this.userBehavior.preferences.categories[category] = {
                count: 0,
                timeOfDay: {},
                dayOfWeek: {}
            };
        }
        
        this.userBehavior.preferences.categories[category].count++;
        this.userBehavior.preferences.categories[category].timeOfDay[timeOfDay] = 
            (this.userBehavior.preferences.categories[category].timeOfDay[timeOfDay] || 0) + 1;
        this.userBehavior.preferences.categories[category].dayOfWeek[dayOfWeek] = 
            (this.userBehavior.preferences.categories[category].dayOfWeek[dayOfWeek] || 0) + 1;
    }

    updateSourcePreference(source, timeOfDay, dayOfWeek) {
        if (!this.userBehavior.preferences.sources) {
            this.userBehavior.preferences.sources = {};
        }
        if (!this.userBehavior.preferences.sources[source]) {
            this.userBehavior.preferences.sources[source] = {
                count: 0,
                timeOfDay: {},
                dayOfWeek: {}
            };
        }
        
        this.userBehavior.preferences.sources[source].count++;
        this.userBehavior.preferences.sources[source].timeOfDay[timeOfDay] = 
            (this.userBehavior.preferences.sources[source].timeOfDay[timeOfDay] || 0) + 1;
        this.userBehavior.preferences.sources[source].dayOfWeek[dayOfWeek] = 
            (this.userBehavior.preferences.sources[source].dayOfWeek[dayOfWeek] || 0) + 1;
    }

    updateTimeOfDayPreferences() {
        const hour = new Date().getHours();
        if (!this.userBehavior.timeOfDayPreferences[hour]) {
            this.userBehavior.timeOfDayPreferences[hour] = 0;
        }
        this.userBehavior.timeOfDayPreferences[hour]++;
    }

    recordSessionData() {
        const sessionData = {
            duration: this.userBehavior.sessionDuration,
            scrollDepth: this.userBehavior.sessionScrollDepth,
            articles: this.userBehavior.sessionArticles,
            timestamp: Date.now()
        };
        
        this.userBehavior.engagementMetrics.sessions = this.userBehavior.engagementMetrics.sessions || [];
        this.userBehavior.engagementMetrics.sessions.push(sessionData);
        
        // Keep only last 50 sessions
        if (this.userBehavior.engagementMetrics.sessions.length > 50) {
            this.userBehavior.engagementMetrics.sessions.shift();
        }
    }

    // ==================== INTELLIGENT PREDICTION ====================

    async predictNextArticles() {
        const predictions = [];
        const currentTime = new Date();
        const currentHour = currentTime.getHours();
        const currentDay = currentTime.getDay();

        // 1. Predict based on time of day patterns
        const timeBasedPredictions = this.predictByTimeOfDay(currentHour, currentDay);
        predictions.push(...timeBasedPredictions);

        // 2. Predict based on category preferences
        const categoryPredictions = await this.predictByCategoryPreferences();
        predictions.push(...categoryPredictions);

        // 3. Predict based on source preferences
        const sourcePredictions = await this.predictBySourcePreferences();
        predictions.push(...sourcePredictions);

        // 4. Predict based on reading history patterns
        const historyPredictions = await this.predictByReadingHistory();
        predictions.push(...historyPredictions);

        // 5. Predict trending articles
        const trendingPredictions = await this.predictTrendingArticles();
        predictions.push(...trendingPredictions);

        // Remove duplicates and sort by prediction score
        const uniquePredictions = this.deduplicatePredictions(predictions);
        return uniquePredictions.sort((a, b) => b.score - a.score);
    }

    predictByTimeOfDay(hour, day) {
        const predictions = [];
        const timePreferences = this.userBehavior.timeOfDayPreferences;
        
        // Find similar time slots
        const similarHours = this.findSimilarTimeSlots(hour, timePreferences);
        
        for (const hourPref of similarHours) {
            const categories = this.getPreferredCategoriesForTime(hourPref.hour, hourPref.day);
            categories.forEach(cat => {
                predictions.push({
                    category: cat,
                    score: hourPref.score * 0.8,
                    reason: 'time_of_day_pattern'
                });
            });
        }
        
        return predictions;
    }

    predictByCategoryPreferences() {
        return new Promise(async (resolve) => {
            const predictions = [];
            const categories = this.userBehavior.preferences.categories || {};
            
            // Sort categories by preference score
            const sortedCategories = Object.entries(categories)
                .sort(([,a], [,b]) => b.count - a.count)
                .slice(0, 5); // Top 5 categories

            for (const [category, data] of sortedCategories) {
                const score = this.calculateCategoryScore(category, data);
                predictions.push({
                    category: category,
                    score: score,
                    reason: 'category_preference'
                });
            }
            
            resolve(predictions);
        });
    }

    predictBySourcePreferences() {
        return new Promise(async (resolve) => {
            const predictions = [];
            const sources = this.userBehavior.preferences.sources || {};
            
            // Sort sources by preference score
            const sortedSources = Object.entries(sources)
                .sort(([,a], [,b]) => b.count - a.count)
                .slice(0, 3); // Top 3 sources

            for (const [source, data] of sortedSources) {
                const score = this.calculateSourceScore(source, data);
                predictions.push({
                    source: source,
                    score: score,
                    reason: 'source_preference'
                });
            }
            
            resolve(predictions);
        });
    }

    predictByReadingHistory() {
        return new Promise(async (resolve) => {
            const predictions = [];
            const sessions = this.userBehavior.engagementMetrics.sessions || [];
            
            if (sessions.length === 0) {
                resolve([]);
                return;
            }

            // Analyze reading patterns from last 10 sessions
            const recentSessions = sessions.slice(-10);
            const avgDuration = recentSessions.reduce((sum, s) => sum + s.duration, 0) / recentSessions.length;
            const avgScrollDepth = recentSessions.reduce((sum, s) => sum + s.scrollDepth, 0) / recentSessions.length;

            // Predict articles based on engagement patterns
            if (avgDuration > 300000) { // 5 minutes - deep reader
                predictions.push({
                    category: 'technology',
                    score: 0.9,
                    reason: 'deep_reader_pattern'
                });
                predictions.push({
                    category: 'science',
                    score: 0.85,
                    reason: 'deep_reader_pattern'
                });
            } else if (avgDuration > 120000) { // 2 minutes - medium reader
                predictions.push({
                    category: 'general',
                    score: 0.8,
                    reason: 'medium_reader_pattern'
                });
                predictions.push({
                    category: 'entertainment',
                    score: 0.75,
                    reason: 'medium_reader_pattern'
                });
            } else { // Quick reader
                predictions.push({
                    category: 'sports',
                    score: 0.85,
                    reason: 'quick_reader_pattern'
                });
                predictions.push({
                    category: 'business',
                    score: 0.8,
                    reason: 'quick_reader_pattern'
                });
            }

            resolve(predictions);
        });
    }

    predictTrendingArticles() {
        return new Promise(async (resolve) => {
            const predictions = [];
            
            // Get trending categories from recent API calls
            const trendingCategories = await this.getTrendingCategories();
            trendingCategories.forEach(cat => {
                predictions.push({
                    category: cat.category,
                    score: cat.score * 0.7,
                    reason: 'trending_topic'
                });
            });
            
            resolve(predictions);
        });
    }

    // ==================== SMART DOWNLOAD SYSTEM ====================

    async smartPreload() {
        if (this.isDownloading || !navigator.onLine) {
            return;
        }

        try {
            this.isDownloading = true;
            console.log('[SmartPreloader] Starting smart preloading...');

            // Check if we should preload based on conditions
            if (!await this.shouldPreload()) {
                console.log('[SmartPreloader] Preloading conditions not met');
                this.isDownloading = false;
                return;
            }

            // Get predictions
            const predictions = await this.predictNextArticles();
            console.log(`[SmartPreloader] Generated ${predictions.length} predictions`);

            // Filter and prioritize predictions
            const filteredPredictions = this.filterPredictions(predictions);
            const prioritizedPredictions = this.prioritizePredictions(filteredPredictions);

            // Create download queue
            const downloadQueue = await this.createDownloadQueue(prioritizedPredictions);
            console.log(`[SmartPreloader] Created queue with ${downloadQueue.length} items`);

            // Execute downloads
            await this.executeSmartDownloads(downloadQueue);

            // Save behavior data
            this.saveUserBehavior();

            console.log('[SmartPreloader] Smart preloading completed');
        } catch (error) {
            console.error('[SmartPreloader] Error during preloading:', error);
        } finally {
            this.isDownloading = false;
        }
    }

    async shouldPreload() {
        // Check storage space
        const storageUsage = await this.storage.estimateStorageUsage();
        if (storageUsage.percentage > 80) {
            console.log('[SmartPreloader] Storage nearly full, skipping preload');
            return false;
        }

        // Check download limits
        const todayDownloads = this.getTodayDownloadCount();
        if (todayDownloads >= this.config.maxDailyDownloads) {
            console.log('[SmartPreloader] Daily download limit reached');
            return false;
        }

        // Check time of day (only preload during active hours)
        const hour = new Date().getHours();
        if (hour < 6 || hour > 22) {
            console.log('[SmartPreloader] Outside active hours, skipping preload');
            return false;
        }

        // Check connection quality
        if (!await this.isConnectionSuitable()) {
            console.log('[SmartPreloader] Connection not suitable for preloading');
            return false;
        }

        return true;
    }

    async isConnectionSuitable() {
        if (!navigator.connection) return true;

        const connection = navigator.connection;
        const effectiveType = connection.effectiveType;
        const downlink = connection.downlink;

        // Check if connection is good enough
        if (effectiveType === 'slow-2g' || effectiveType === '2g') {
            return false;
        }
        if (effectiveType === '3g' && downlink < 1) {
            return false;
        }
        if (effectiveType === '4g' && downlink < 2) {
            return false;
        }

        return true;
    }

    getTodayDownloadCount() {
        const today = new Date().toDateString();
        return this.userBehavior.downloadHistory.filter(item => 
            new Date(item.timestamp).toDateString() === today
        ).length;
    }

    filterPredictions(predictions) {
        // Remove predictions with low scores
        return predictions.filter(pred => pred.score > 0.3);
    }

    prioritizePredictions(predictions) {
        // Sort by score and recency
        return predictions.sort((a, b) => {
            const scoreDiff = b.score - a.score;
            if (Math.abs(scoreDiff) < 0.1) {
                // If scores are similar, prioritize by reason importance
                const reasonPriority = {
                    'time_of_day_pattern': 5,
                    'category_preference': 4,
                    'source_preference': 3,
                    'trending_topic': 2,
                    'deep_reader_pattern': 1
                };
                return (reasonPriority[b.reason] || 0) - (reasonPriority[a.reason] || 0);
            }
            return scoreDiff;
        });
    }

    async createDownloadQueue(predictions) {
        const queue = [];
        const maxQueueSize = Math.min(10, this.config.maxDailyDownloads - this.getTodayDownloadCount());

        for (const prediction of predictions) {
            if (queue.length >= maxQueueSize) break;

            try {
                const articles = await this.fetchArticlesForPrediction(prediction);
                const filteredArticles = this.filterArticlesForDownload(articles, prediction);
                
                filteredArticles.forEach(article => {
                    queue.push({
                        article: article,
                        prediction: prediction,
                        priority: prediction.score,
                        timestamp: Date.now()
                    });
                });
            } catch (error) {
                console.warn('[SmartPreloader] Failed to fetch articles for prediction:', error);
            }
        }

        return queue.sort((a, b) => b.priority - a.priority);
    }

    async fetchArticlesForPrediction(prediction) {
        try {
            if (prediction.category) {
                const response = await this.apiClient.fetchArticles({
                    page: 1,
                    category: prediction.category,
                    filters: {}
                });
                return response.articles || [];
            } else if (prediction.source) {
                const response = await this.apiClient.searchArticles({
                    page: 1,
                    query: prediction.source,
                    filters: {}
                });
                return response.articles || [];
            }
        } catch (error) {
            console.warn('[SmartPreloader] Failed to fetch articles:', error);
            return [];
        }
        return [];
    }

    filterArticlesForDownload(articles, prediction) {
        return articles.filter(article => {
            // Filter out already downloaded articles
            const isDownloaded = this.userBehavior.downloadHistory.some(item => 
                item.articleId === article.id
            );
            if (isDownloaded) return false;

            // Filter out articles older than 24 hours (for preloading fresh content)
            const articleDate = new Date(article.published);
            const ageHours = (Date.now() - articleDate.getTime()) / (1000 * 60 * 60);
            if (ageHours > 24) return false;

            // Filter by engagement potential (based on title keywords)
            const engagementKeywords = ['breaking', 'exclusive', 'analysis', 'review', 'guide'];
            const title = (article.title || '').toLowerCase();
            const hasEngagementKeywords = engagementKeywords.some(keyword => title.includes(keyword));
            
            // Always include if high prediction score, otherwise require engagement keywords
            return prediction.score > 0.8 || hasEngagementKeywords;
        }).slice(0, 3); // Limit to 3 articles per prediction
    }

    async executeSmartDownloads(queue) {
        const batchSize = Math.min(this.config.maxConcurrentDownloads, queue.length);
        const batches = this.chunkArray(queue, batchSize);

        for (const batch of batches) {
            const downloadPromises = batch.map(item => this.downloadArticle(item));
            await Promise.all(downloadPromises);
            
            // Wait between batches to avoid overwhelming the server
            await this.delay(2000);
        }
    }

    async downloadArticle(queueItem) {
        const { article, prediction } = queueItem;
        
        try {
            // Check storage before downloading
            const storageUsage = await this.storage.estimateStorageUsage();
            if (storageUsage.percentage > 90) {
                console.log('[SmartPreloader] Storage full, stopping downloads');
                return;
            }

            // Save article for offline
            const saved = await this.storage.saveArticle(article, true);
            if (saved) {
                // Record download history
                this.userBehavior.downloadHistory.push({
                    articleId: article.id,
                    category: article.category,
                    timestamp: Date.now(),
                    predictionReason: prediction.reason,
                    predictionScore: prediction.score
                });

                // Keep download history manageable
                if (this.userBehavior.downloadHistory.length > 1000) {
                    this.userBehavior.downloadHistory = this.userBehavior.downloadHistory.slice(-500);
                }

                console.log(`[SmartPreloader] Downloaded: ${article.title} (${prediction.reason})`);
            }
        } catch (error) {
            console.error('[SmartPreloader] Failed to download article:', error);
        }
    }

    // ==================== UTILITY METHODS ====================

    findSimilarTimeSlots(targetHour, timePreferences) {
        const similarSlots = [];
        const hours = Object.keys(timePreferences).map(h => parseInt(h));
        
        // Find hours with similar activity patterns
        hours.forEach(hour => {
            const score = this.calculateTimeSimilarity(targetHour, hour, timePreferences);
            if (score > 0.5) {
                similarSlots.push({ hour, score });
            }
        });

        return similarSlots.sort((a, b) => b.score - a.score).slice(0, 3);
    }

    calculateTimeSimilarity(hour1, hour2, timePreferences) {
        // Simple similarity calculation based on time proximity and activity levels
        const timeDiff = Math.min(Math.abs(hour1 - hour2), 24 - Math.abs(hour1 - hour2));
        const activity1 = timePreferences[hour1] || 0;
        const activity2 = timePreferences[hour2] || 0;
        
        const timeSimilarity = Math.max(0, 1 - (timeDiff / 12));
        const activitySimilarity = activity1 > 0 && activity2 > 0 ? 1 : 0;
        
        return (timeSimilarity * 0.7) + (activitySimilarity * 0.3);
    }

    getPreferredCategoriesForTime(hour, day) {
        const categories = this.userBehavior.preferences.categories || {};
        const preferredCategories = [];

        Object.entries(categories).forEach(([category, data]) => {
            const timeOfDayScore = data.timeOfDay[hour] || 0;
            const dayOfWeekScore = data.dayOfWeek[day] || 0;
            const totalScore = timeOfDayScore + dayOfWeekScore;
            
            if (totalScore > 0) {
                preferredCategories.push({
                    category,
                    score: totalScore
                });
            }
        });

        return preferredCategories
            .sort((a, b) => b.score - a.score)
            .slice(0, 3)
            .map(item => item.category);
    }

    calculateCategoryScore(category, data) {
        const baseScore = data.count * 0.1;
        const timeOfDayBonus = Object.values(data.timeOfDay).reduce((sum, val) => sum + val, 0) * 0.05;
        const dayOfWeekBonus = Object.values(data.dayOfWeek).reduce((sum, val) => sum + val, 0) * 0.03;
        
        return Math.min(baseScore + timeOfDayBonus + dayOfWeekBonus, 1.0);
    }

    calculateSourceScore(source, data) {
        const baseScore = data.count * 0.15;
        const timeOfDayBonus = Object.values(data.timeOfDay).reduce((sum, val) => sum + val, 0) * 0.08;
        
        return Math.min(baseScore + timeOfDayBonus, 1.0);
    }

    async getTrendingCategories() {
        // Analyze recent downloads and engagement to find trending categories
        const recentDownloads = this.userBehavior.downloadHistory.slice(-50);
        const categoryCounts = {};
        
        recentDownloads.forEach(item => {
            if (item.category) {
                categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
            }
        });

        return Object.entries(categoryCounts)
            .map(([category, count]) => ({
                category,
                score: count / 50
            }))
            .sort((a, b) => b.score - a.score)
            .slice(0, 5);
    }

    deduplicatePredictions(predictions) {
        const seen = new Set();
        return predictions.filter(pred => {
            const key = pred.category || pred.source;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        });
    }

    chunkArray(array, size) {
        const chunks = [];
        for (let i = 0; i < array.length; i += size) {
            chunks.push(array.slice(i, i + size));
        }
        return chunks;
    }

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // ==================== DATA MANAGEMENT ====================

    loadUserBehavior() {
        try {
            const saved = localStorage.getItem('smart_preloader_behavior');
            if (saved) {
                this.userBehavior = JSON.parse(saved);
            }
        } catch (error) {
            console.warn('[SmartPreloader] Failed to load user behavior:', error);
        }
    }

    saveUserBehavior() {
        try {
            localStorage.setItem('smart_preloader_behavior', JSON.stringify(this.userBehavior));
        } catch (error) {
            console.warn('[SmartPreloader] Failed to save user behavior:', error);
        }
    }

    // ==================== PUBLIC API ====================

    async triggerSmartPreload() {
        if (!this.isDownloading) {
            await this.smartPreload();
        }
    }

    getRecommendations() {
        return this.predictNextArticles();
    }

    getStorageStats() {
        return {
            totalDownloads: this.userBehavior.downloadHistory.length,
            categories: Object.keys(this.userBehavior.preferences.categories || {}),
            sources: Object.keys(this.userBehavior.preferences.sources || {}),
            avgSessionDuration: this.calculateAverageSessionDuration()
        };
    }

    calculateAverageSessionDuration() {
        const sessions = this.userBehavior.engagementMetrics.sessions || [];
        if (sessions.length === 0) return 0;
        const totalDuration = sessions.reduce((sum, s) => sum + s.duration, 0);
        return totalDuration / sessions.length;
    }
}

// Export for use in other modules
window.SmartPreloader = SmartPreloader;