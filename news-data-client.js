// news-data-client.js - NewsData.io API Client for fallback support

class NewsDataClient {
    constructor(apiKey) {
        this.baseUrl = 'https://newsdata.io/api/1/';
        this.apiKey = apiKey;
        this.language = 'en';
        this.pageSize = 30;

        // Rate limiting
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.minRequestInterval = 100; // ms between requests
        this.lastRequestTime = 0;

        // Retry configuration
        this.maxRetries = 3;
        this.retryDelay = 1000; // ms
        this.backoffMultiplier = 2;

        // Category and locale mapping
        this.supportedCategories = ['business', 'entertainment', 'environment', 'food', 'health', 'politics', 'science', 'sports', 'technology', 'top', 'tourism', 'world'];
        this.localeMap = {
            'US': 'us',
            'CA': 'ca',
            'AU': 'au',
            'GB': 'gb',
            'ES': 'es',
            'FR': 'fr',
            'DE': 'de',
            'IT': 'it',
            'NL': 'nl',
            'SE': 'se',
            'NO': 'no',
            'IN': 'in'
        };
    }

    setAPIConfig({ apiKey, language }) {
        this.apiKey = apiKey;
        if (language) this.language = language;
    }

    setLanguage(language) {
        this.language = language;
    }

    // ==================== MAIN API METHODS ====================

    /**
     * Fetch articles from NewsData.io
     * @param {Object} params - { page, category, filters, locale }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, source }
     */
    async fetchArticles(params = {}) {
        const { page = 1, category = 'top', filters = {}, locale = null } = params;

        if (!this.apiKey) {
            throw new Error('NewsData.io API key not configured');
        }

        const mappedCategory = this.mapCategory(category);
        const url = this.buildUrl('news', { page, category: mappedCategory, country: locale, ...filters });
        console.log(`[NewsDataClient] Fetching articles: ${url}`);

        const data = await this.makeRequest(url);
        const normalized = this.normalizeResponse(data);

        return {
            ...normalized,
            source: 'newsdata_api'
        };
    }

    /**
     * Search articles via NewsData.io
     * @param {Object} params - { page, query, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, source }
     */
    async searchArticles(params = {}) {
        const { page = 1, query, filters = {} } = params;

        if (!this.apiKey) {
            throw new Error('NewsData.io API key not configured');
        }

        if (!query || !query.trim()) {
            throw new Error('Search query is required');
        }

        const url = this.buildUrl('news', { page, q: query, ...filters });
        console.log(`[NewsDataClient] Searching articles: ${url}`);

        const data = await this.makeRequest(url);
        const normalized = this.normalizeResponse(data);

        return {
            ...normalized,
            source: 'newsdata_api'
        };
    }

    /**
     * Fetch local news by locale
     * @param {Object} params - { page, locale, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, source, locale }
     */
    async fetchLocalNews(params = {}) {
        const { page = 1, locale = null, filters = {} } = params;

        if (!this.apiKey) {
            throw new Error('NewsData.io API key not configured');
        }

        if (!locale) {
            throw new Error('Locale required for local news');
        }

        const url = this.buildUrl('news', { page, country: locale, ...filters });
        console.log(`[NewsDataClient] Fetching local news for locale: ${locale}`);

        const data = await this.makeRequest(url);
        const normalized = this.normalizeResponse(data);

        return {
            ...normalized,
            source: 'newsdata_api',
            locale: locale
        };
    }

    // ==================== URL BUILDING ====================

    mapCategory(category) {
        const mapping = {
            'latest': 'top',
            'general': 'top',
            'world': 'world',
            'technology': 'technology',
            'tech': 'technology',
            'business': 'business',
            'sports': 'sports',
            'health': 'health',
            'entertainment': 'entertainment',
            'politics': 'politics',
            'science': 'science',
            'local': 'top'
        };

        return mapping[category] || 'top';
    }

    countryCodeToLocale(countryCode) {
        if (!countryCode) return null;
        const code = countryCode.toUpperCase();
        return this.localeMap[code] || null;
    }

    buildUrl(endpoint, params) {
        let url = `${this.baseUrl}${endpoint}?apikey=${this.apiKey}&language=${this.language}`;
        
        for (const key in params) {
            if (params[key]) {
                url += `&${key}=${encodeURIComponent(params[key])}`;
            }
        }
        
        return url;
    }

    // ==================== RESPONSE NORMALIZATION ====================

    normalizeResponse(data) {
        try {
            const articles = data.results || [];
            const totalResults = data.totalResults || 0;
            const normalizedArticles = articles.map(article => this.normalizeArticle(article));

            return {
                articles: normalizedArticles,
                totalResults: totalResults,
                hasMore: data.nextPage !== null,
                isCached: false
            };
        } catch (error) {
            console.error('[NewsDataClient] Error normalizing response:', error);
            return {
                articles: [],
                totalResults: 0,
                hasMore: false,
                isCached: false
            };
        }
    }

    normalizeArticle(article) {
        return {
            id: article.article_id || '',
            title: article.title || 'Untitled',
            description: article.description || '',
            image: article.image_url || '',
            link: article.link || '',
            source: article.source_id || 'Unknown',
            published: article.pubDate || new Date().toISOString(),
            category: Array.isArray(article.category) ? article.category : [article.category || 'general'],
            keywords: article.keywords || '',
            author: article.creator || '',
            snippet: article.content || ''
        };
    }

    // ==================== REQUEST HANDLING ====================

    async makeRequest(url) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ url, resolve, reject });
            this.processQueue();
        });
    }

    async processQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const { url, resolve, reject } = this.requestQueue.shift();

            try {
                const now = Date.now();
                const timeSinceLastRequest = now - this.lastRequestTime;
                if (timeSinceLastRequest < this.minRequestInterval) {
                    await this.delay(this.minRequestInterval - timeSinceLastRequest);
                }

                const result = await this.executeRequest(url);
                this.lastRequestTime = Date.now();
                resolve(result);
            } catch (error) {
                reject(error);
            }

            if (this.requestQueue.length > 0) {
                await this.delay(50);
            }
        }

        this.isProcessingQueue = false;
    }

    async executeRequest(url, attempt = 1) {
        try {
            console.log(`[NewsDataClient] Request attempt ${attempt}: ${url}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'NewsApp/1.0'
                },
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                if (response.status === 401) {
                    throw new Error('Invalid NewsData.io API key');
                } else if (response.status === 402) {
                    throw new Error('NewsData.io API quota exceeded');
                } else if (response.status === 429) {
                    if (attempt < this.maxRetries) {
                        const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt);
                        console.log(`[NewsDataClient] Rate limited, retrying in ${retryDelay}ms`);
                        await this.delay(retryDelay);
                        return this.executeRequest(url, attempt + 1);
                    }
                    throw new Error('NewsData.io API rate limit exceeded');
                } else if (response.status >= 500) {
                    if (attempt < this.maxRetries) {
                        const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt - 1);
                        console.log(`[NewsDataClient] Server error, retrying in ${retryDelay}ms`);
                        await this.delay(retryDelay);
                        return this.executeRequest(url, attempt + 1);
                    }
                }

                throw new Error(`NewsData.io API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            if (!data || typeof data !== 'object') {
                throw new Error('Invalid NewsData.io API response format');
            }

            return data;

        } catch (error) {
            console.error(`[NewsDataClient] Request failed (attempt ${attempt}):`, error.message);

            if ((error.name === 'TypeError' || error.name === 'AbortError') && attempt < this.maxRetries) {
                const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt - 1);
                console.log(`[NewsDataClient] Network error, retrying in ${retryDelay}ms`);
                await this.delay(retryDelay);
                return this.executeRequest(url, attempt + 1);
            }

            throw error;
        }
    }

    // ==================== UTILITIES ====================

    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    async getStatus() {
        try {
            const testUrl = this.buildUrl('news', { limit: 1 });
            await this.makeRequest(testUrl);
            return { status: 'ok' };
        } catch (error) {
            return { status: 'error', message: error.message };
        }
    }
}

// Export for use in other modules
window.NewsDataClient = NewsDataClient;
