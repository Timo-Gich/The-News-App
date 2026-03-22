// gnews-api-client.js - GNews API Client

class GNewsAPIClient {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl || 'https://gnews.io/api/v4';
        this.apiKey = apiKey;
        this.language = 'en';
        this.pageSize = 10; // default 10 - can be changed
        this.maxPageSize = 100; // GNews API max

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
        this.supportedCategories = ['general', 'world', 'nation', 'business', 'technology', 'entertainment', 'sports', 'science', 'health'];
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
            'IN': 'in',
            'JP': 'jp',
            'CN': 'cn',
            'BR': 'br',
            'MX': 'mx',
            'AR': 'ar',
            'CL': 'cl',
            'CO': 'co',
            'PE': 'pe'
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
     * Fetch top headlines from GNews API
     * @param {Object} params - { pageToken, category, locale, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, nextPage, source }
     */
    async fetchTopHeadlines(params = {}) {
        const { pageToken = null, category = 'general', locale = null, filters = {} } = params;

        if (!this.apiKey) throw new Error('GNews API key not configured');

        const mappedCategory = this.mapCategory(category);
        const url = this.buildTopHeadlinesUrl({ pageToken, category: mappedCategory, locale, filters });
        console.log(`[GNewsAPIClient] Fetching top headlines: ${url}`);

        const data = await this.makeRequest(url);
        return this.normalizeResponse(data);
    }

    /**
     * Search articles via GNews API
     * @param {Object} params - { pageToken, query, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, nextPage, source }
     */
    async searchArticles(params = {}) {
        const { pageToken = null, query, filters = {} } = params;

        if (!this.apiKey) throw new Error('GNews API key not configured');
        if (!query || !query.trim()) throw new Error('Search query is required');

        const url = this.buildSearchUrl({ pageToken, query: query.trim(), filters });
        console.log(`[GNewsAPIClient] Searching articles: ${url}`);

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

        if (!this.apiKey) throw new Error('GNews API key not configured');
        if (!locale) throw new Error('Locale required for local news');

        const url = this.buildTopHeadlinesUrl({ pageToken, locale, filters });
        console.log(`[GNewsAPIClient] Fetching local news for locale: ${locale}`);

        const data = await this.makeRequest(url);
        const normalized = this.normalizeResponse(data);
        return {...normalized, locale };
    }

    // ==================== URL BUILDING ====================

    mapCategory(category) {
        const mapping = {
            'latest': 'general',
            'general': 'general',
            'world': 'world',
            'nation': 'nation',
            'local': 'nation',
            'business': 'business',
            'technology': 'technology',
            'tech': 'technology',
            'entertainment': 'entertainment',
            'sports': 'sports',
            'science': 'science',
            'health': 'health'
        };
        return mapping[category] || 'general';
    }

    countryCodeToLocale(countryCode) {
        if (!countryCode) return null;
        const code = countryCode.toUpperCase();
        return this.localeMap[code] || null;
    }

    /**
     * Build URL for top-headlines endpoint
     */
    buildTopHeadlinesUrl({ pageToken = null, category = null, locale = null, filters = {} }) {
        if (!this.apiKey) throw new Error('GNews API key is required');
        if (!this.language || !this.isValidLanguage(this.language)) {
            throw new Error('Valid language code is required for GNews API');
        }

        let url = `${this.baseUrl}/top-headlines?apikey=${encodeURIComponent(this.apiKey)}&lang=${encodeURIComponent(this.language)}`;

        // Pagination: GNews uses page parameter
        if (pageToken && typeof pageToken === 'number') {
            url += `&page=${pageToken}`;
        }

        // Size (results per page)
        url += `&max=${this.pageSize}`;

        // Category (if not 'general')
        if (category && category !== 'general' && this.isValidCategory(category)) {
            url += `&category=${encodeURIComponent(category)}`;
        }

        // Country (locale)
        if (locale && this.isValidCountryCode(locale)) {
            url += `&country=${encodeURIComponent(locale)}`;
        }

        // Domain filter
        if (filters.domain && this.isValidDomain(filters.domain)) {
            url += `&in=${encodeURIComponent(filters.domain)}`;
        }

        return url;
    }

    /**
     * Build URL for search endpoint
     */
    buildSearchUrl({ pageToken = null, query, filters = {} }) {
        if (!this.apiKey) throw new Error('GNews API key is required');
        if (!this.language || !this.isValidLanguage(this.language)) {
            throw new Error('Valid language code is required for GNews API');
        }

        let url = `${this.baseUrl}/search?q=${encodeURIComponent(query)}&apikey=${encodeURIComponent(this.apiKey)}&lang=${encodeURIComponent(this.language)}`;

        // Pagination
        if (pageToken && typeof pageToken === 'number') {
            url += `&page=${pageToken}`;
        }

        // Size (results per page)
        url += `&max=${this.pageSize}`;

        // Country filter
        if (filters.country && this.isValidCountryCode(filters.country)) {
            url += `&country=${encodeURIComponent(filters.country)}`;
        }

        // Domain filter
        if (filters.domain && this.isValidDomain(filters.domain)) {
            url += `&in=${encodeURIComponent(filters.domain)}`;
        }

        // Date range filter
        if (filters.start_date && filters.end_date) {
            url += `&from=${encodeURIComponent(filters.start_date)}&to=${encodeURIComponent(filters.end_date)}`;
        }

        return url;
    }

    // ==================== RESPONSE NORMALIZATION ====================

    normalizeResponse(data) {
        try {
            let articles = [];
            let totalResults = 0;
            let nextPage = null;

            // GNews API returns { articles: [...], totalArticles: number, page: number }
            if (data.articles && Array.isArray(data.articles)) {
                articles = data.articles;
                totalResults = data.totalArticles || articles.length;
                nextPage = data.page ? data.page + 1 : null;
            }

            const normalizedArticles = articles.map(article => this.normalizeArticle(article));

            // Determine if more pages exist (if nextPage is present)
            const hasMore = !!nextPage;

            return {
                articles: normalizedArticles,
                totalResults: totalResults,
                hasMore: hasMore,
                nextPage: nextPage,
                source: 'gnews',
                isCached: false
            };
        } catch (error) {
            console.error('[GNewsAPIClient] Error normalizing response:', error);
            return {
                articles: [],
                totalResults: 0,
                hasMore: false,
                nextPage: null,
                source: 'gnews',
                isCached: false
            };
        }
    }

    normalizeArticle(article) {
        return {
            id: article.url || article.title || '',
            title: article.title || 'Untitled',
            description: article.description || '',
            image: article.image || '',
            link: article.url || '',
            source: (article.source && article.source.name) || 'Unknown',
            published: article.publishedAt || new Date().toISOString(),
            category: [article.category || 'general'],
            keywords: article.keywords || '',
            author: article.author || '',
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
            console.log(`[GNewsAPIClient] Request attempt ${attempt}: ${url}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'NewsApp/1.0'
                },
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                if (response.status === 401) throw new Error('Invalid GNews API key');
                if (response.status === 402) throw new Error('GNews API quota exceeded');
                if (response.status === 429 && attempt < this.maxRetries) {
                    const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt);
                    console.log(`[GNewsAPIClient] Rate limited, retrying in ${retryDelay}ms`);
                    await this.delay(retryDelay);
                    return this.executeRequest(url, attempt + 1);
                }
                if (response.status >= 500 && attempt < this.maxRetries) {
                    const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt - 1);
                    console.log(`[GNewsAPIClient] Server error, retrying in ${retryDelay}ms`);
                    await this.delay(retryDelay);
                    return this.executeRequest(url, attempt + 1);
                }
                throw new Error(`GNews API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            if (!data || typeof data !== 'object') throw new Error('Invalid GNews API response format');
            return data;

        } catch (error) {
            console.error(`[GNewsAPIClient] Request failed (attempt ${attempt}):`, error.message);
            if ((error.name === 'TypeError' || error.name === 'AbortError') && attempt < this.maxRetries) {
                const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt - 1);
                console.log(`[GNewsAPIClient] Network error, retrying in ${retryDelay}ms`);
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
            const testUrl = `${this.baseUrl}/top-headlines?apikey=${this.apiKey}&lang=${this.language}&max=1`;
            await this.makeRequest(testUrl);
            return { status: 'ok' };
        } catch (error) {
            return { status: 'error', message: error.message };
        }
    }

    isValidCategory(category) {
        if (!category) return false;
        return this.supportedCategories.includes(category.toLowerCase());
    }

    isValidCountryCode(countryCode) {
        if (!countryCode) return false;
        // List of supported codes from GNews documentation
        const validCountries = Object.values(this.localeMap);
        return validCountries.includes(countryCode.toLowerCase());
    }

    isValidLanguage(languageCode) {
        if (!languageCode) return false;
        const validLanguages = ['en', 'es', 'fr', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'ar', 'hi', 'ko', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'tr', 'th', 'vi'];
        return validLanguages.includes(languageCode.toLowerCase());
    }

    isValidDomain(domain) {
        if (!domain) return false;
        // Basic domain validation
        return /^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/.test(domain);
    }
}

// Export for use in other modules
window.GNewsAPIClient = GNewsAPIClient;