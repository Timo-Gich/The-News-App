// news-api-client.js - NewsData.io API Client

class NewsAPIClient {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl || 'https://newsdata.io/api/1';
        this.apiKey = apiKey;
        this.language = 'en';
        this.pageSize = 10;                // default 10 (free plan max) – can be changed
        this.maxPageSize = 50;             // paid plan max

        // Rate limiting
        this.requestQueue = [];
        this.isProcessingQueue = false;
        this.minRequestInterval = 100;      // ms between requests
        this.lastRequestTime = 0;

        // Retry configuration
        this.maxRetries = 3;
        this.retryDelay = 1000;             // ms
        this.backoffMultiplier = 2;

        // Category and locale mapping
        this.supportedCategories = ['general', 'science', 'sports', 'business', 'health', 'entertainment', 'technology', 'politics', 'food', 'travel'];
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

    setAPIConfig({ apiKey, baseUrl, language }) {
        this.apiKey = apiKey;
        if (baseUrl) this.baseUrl = baseUrl;
        if (language) this.language = language;
    }

    setLanguage(language) {
        this.language = language;
    }

    setPageSize(size) {
        if (size >= 1 && size <= this.maxPageSize) {
            this.pageSize = size;
        } else {
            console.warn(`Page size must be between 1 and ${this.maxPageSize}. Keeping ${this.pageSize}`);
        }
    }

    // ==================== MAIN API METHODS ====================

    /**
     * Fetch latest articles (headlines) from NewsData.io
     * @param {Object} params - { pageToken, category, locale, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, nextPage, source }
     */
    async fetchArticles(params = {}) {
        const { pageToken = null, category = 'general', locale = null, filters = {} } = params;

        if (!this.apiKey) throw new Error('News API key not configured');

        const mappedCategory = this.mapCategory(category);
        const url = this.buildLatestUrl({ pageToken, category: mappedCategory, locale, filters });
        console.log(`[NewsAPIClient] Fetching articles: ${url}`);

        const data = await this.makeRequest(url);
        return this.normalizeResponse(data);
    }

    /**
     * Search articles via NewsData.io (uses /latest with q parameter)
     * @param {Object} params - { pageToken, query, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, nextPage, source }
     */
    async searchArticles(params = {}) {
        const { pageToken = null, query, filters = {} } = params;

        if (!this.apiKey) throw new Error('News API key not configured');
        if (!query || !query.trim()) throw new Error('Search query is required');

        const url = this.buildLatestUrl({ pageToken, q: query.trim(), filters });
        console.log(`[NewsAPIClient] Searching articles: ${url}`);

        const data = await this.makeRequest(url);
        return this.normalizeResponse(data);
    }

    /**
     * Fetch local news by locale (uses country parameter)
     * @param {Object} params - { pageToken, locale, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, nextPage, source, locale }
     */
    async fetchLocalNews(params = {}) {
        const { pageToken = null, locale = null, filters = {} } = params;

        if (!this.apiKey) throw new Error('News API key not configured');
        if (!locale) throw new Error('Locale required for local news');

        const url = this.buildLatestUrl({ pageToken, locale, filters });
        console.log(`[NewsAPIClient] Fetching local news for locale: ${locale}`);

        const data = await this.makeRequest(url);
        const normalized = this.normalizeResponse(data);
        return { ...normalized, locale };
    }

    // ==================== URL BUILDING ====================

    mapCategory(category) {
        const mapping = {
            'latest': 'general',
            'general': 'general',
            'world': 'general',
            'technology': 'technology',
            'tech': 'technology',      // fix: map 'tech' to 'technology'
            'business': 'business',
            'sports': 'sports',
            'health': 'health',
            'entertainment': 'entertainment',
            'politics': 'politics',
            'science': 'science',
            'local': 'general'
        };
        return mapping[category] || 'general';
    }

    countryCodeToLocale(countryCode) {
        if (!countryCode) return null;
        const code = countryCode.toUpperCase();
        return this.localeMap[code] || null;
    }

    /**
     * Build URL for /latest endpoint with all supported parameters
     */
    buildLatestUrl({ pageToken = null, category = null, locale = null, q = null, filters = {} }) {
        if (!this.apiKey) throw new Error('NewsData.io API key is required');
        if (!this.language || !this.isValidLanguage(this.language)) {
            throw new Error('Valid language code is required for NewsData.io');
        }

        let url = `${this.baseUrl}/latest?apikey=${encodeURIComponent(this.apiKey)}&language=${encodeURIComponent(this.language)}`;

        // Pagination: only add if it's a string token (from nextPage)
        if (pageToken && typeof pageToken === 'string') {
            url += `&page=${encodeURIComponent(pageToken)}`;
        }

        // Size (results per page)
        url += `&size=${this.pageSize}`;

        // Query (search)
        if (q) {
            url += `&q=${encodeURIComponent(q)}`;
        }

        // Category (if not 'general')
        if (category && category !== 'general' && this.isValidCategory(category)) {
            url += `&category=${encodeURIComponent(category)}`;
        }

        // Country (locale)
        if (locale && this.isValidCountryCode(locale)) {
            url += `&country=${encodeURIComponent(locale)}`;
        }

        // Domain filter – must be a valid source ID
        if (filters.domain && this.isValidDomainId(filters.domain)) {
            url += `&domain=${encodeURIComponent(filters.domain)}`;
        }

        // Optionally, you can add other filters like prioritydomain, datatype, etc.
        // but keep them out unless needed.

        return url;
    }

    // ==================== RESPONSE NORMALIZATION ====================

    normalizeResponse(data) {
        try {
            let articles = [];
            let totalResults = 0;
            let nextPage = null;

            // NewsData.io returns { status, totalResults, results, nextPage }
            if (data.results && Array.isArray(data.results)) {
                articles = data.results;
                totalResults = data.totalResults || articles.length;
                nextPage = data.nextPage || null;
            }

            const normalizedArticles = articles.map(article => this.normalizeArticle(article));

            // Determine if more pages exist (if nextPage token is present)
            const hasMore = !!nextPage;

            return {
                articles: normalizedArticles,
                totalResults: totalResults,
                hasMore: hasMore,
                nextPage: nextPage,      // expose token for pagination
                source: 'newsdata_io',
                isCached: false
            };
        } catch (error) {
            console.error('[NewsAPIClient] Error normalizing response:', error);
            return {
                articles: [],
                totalResults: 0,
                hasMore: false,
                nextPage: null,
                source: 'newsdata_io',
                isCached: false
            };
        }
    }

    normalizeArticle(article) {
        return {
            id: article.article_id || article.uuid || article.id || '',
            title: article.title || 'Untitled',
            description: article.description || article.snippet || '',
            image: article.image_url || article.image || '',
            link: article.link || article.url || '',
            source: article.source_name || article.source || 'Unknown',
            published: article.pubDate || article.published_at || article.published || new Date().toISOString(),
            category: Array.isArray(article.category) ? article.category : [article.category || 'general'],
            keywords: article.keywords || article.tags || '',
            author: article.creator ? (Array.isArray(article.creator) ? article.creator.join(', ') : article.creator) : '',
            snippet: article.description || ''
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
        if (this.isProcessingQueue || this.requestQueue.length === 0) return;
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

            if (this.requestQueue.length > 0) await this.delay(50);
        }

        this.isProcessingQueue = false;
    }

    async executeRequest(url, attempt = 1) {
        try {
            console.log(`[NewsAPIClient] Request attempt ${attempt}: ${url}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'NewsApp/1.0'
                },
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                if (response.status === 401) throw new Error('Invalid News API key');
                if (response.status === 402) throw new Error('News API quota exceeded');
                if (response.status === 429 && attempt < this.maxRetries) {
                    const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt);
                    console.log(`[NewsAPIClient] Rate limited, retrying in ${retryDelay}ms`);
                    await this.delay(retryDelay);
                    return this.executeRequest(url, attempt + 1);
                }
                if (response.status >= 500 && attempt < this.maxRetries) {
                    const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt - 1);
                    console.log(`[NewsAPIClient] Server error, retrying in ${retryDelay}ms`);
                    await this.delay(retryDelay);
                    return this.executeRequest(url, attempt + 1);
                }
                throw new Error(`News API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            if (!data || typeof data !== 'object') throw new Error('Invalid News API response format');
            return data;

        } catch (error) {
            console.error(`[NewsAPIClient] Request failed (attempt ${attempt}):`, error.message);
            if ((error.name === 'TypeError' || error.name === 'AbortError') && attempt < this.maxRetries) {
                const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt - 1);
                console.log(`[NewsAPIClient] Network error, retrying in ${retryDelay}ms`);
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
            const testUrl = `${this.baseUrl}/latest?apikey=${this.apiKey}&language=${this.language}&size=1`;
            await this.makeRequest(testUrl);
            return { status: 'ok' };
        } catch (error) {
            return { status: 'error', message: error.message };
        }
    }

    isValidCategory(category) {
        if (!category) return false;
        const validCategories = ['general', 'business', 'sports', 'technology', 'entertainment', 'health', 'science'];
        return validCategories.includes(category.toLowerCase());
    }

    isValidCountryCode(countryCode) {
        if (!countryCode) return false;
        // List of supported codes from documentation (as of 2026)
        const validCountries = ['us', 'ca', 'au', 'gb', 'de', 'fr', 'es', 'it', 'nl', 'se', 'no', 'in', 'jp', 'cn', 'br', 'mx', 'ar', 'cl', 'co', 'pe'];
        return validCountries.includes(countryCode.toLowerCase());
    }

    isValidLanguage(languageCode) {
        if (!languageCode) return false;
        const validLanguages = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'ar', 'hi', 'ko', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'tr', 'th', 'vi'];
        return validLanguages.includes(languageCode.toLowerCase());
    }

    isValidDomainId(domain) {
        if (!domain) return false;
        // Source IDs are typically lowercase letters, numbers, underscores
        return /^[a-z0-9_]+$/.test(domain);
    }
}

// Export for use in other modules
window.NewsAPIClient = NewsAPIClient;