// news-api-client.js - News API Client for fallback support

class NewsAPIClient {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl || 'https://newsdata.io/api/1';
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
        this.supportedCategories = ['general', 'science', 'sports', 'business', 'health', 'entertainment', 'tech', 'politics', 'food', 'travel'];
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

    // ==================== MAIN API METHODS ====================

    /**
     * Fetch articles from News API
     * @param {Object} params - { page, category, filters, locale }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, source }
     */
    async fetchArticles(params = {}) {
        const { page = 1, category = 'general', filters = {}, locale = null } = params;

        if (!this.apiKey) {
            throw new Error('News API key not configured');
        }

        // Map category to supported News API categories
        const mappedCategory = this.mapCategory(category);

        // Use headlines endpoint for category-specific news, top for general
        const url = this.buildHeadlinesUrl(page, mappedCategory, locale, filters);
        console.log(`[NewsAPIClient] Fetching articles: ${url}`);

        const data = await this.makeRequest(url);
        const normalized = this.normalizeResponse(data, 'headlines');

        return {
            ...normalized,
            source: 'news_api'
        };
    }

    /**
     * Search articles via News API
     * @param {Object} params - { page, query, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore, source }
     */
    async searchArticles(params = {}) {
        const { page = 1, query, filters = {} } = params;

        if (!this.apiKey) {
            throw new Error('News API key not configured');
        }

        if (!query || !query.trim()) {
            throw new Error('Search query is required');
        }

        const url = this.buildSearchUrl(page, query, filters);
        console.log(`[NewsAPIClient] Searching articles: ${url}`);

        const data = await this.makeRequest(url);
        const normalized = this.normalizeResponse(data, 'top');

        return {
            ...normalized,
            source: 'news_api'
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
            throw new Error('News API key not configured');
        }

        if (!locale) {
            throw new Error('Locale required for local news');
        }

        const url = this.buildHeadlinesUrl(page, 'general', locale, filters);
        console.log(`[NewsAPIClient] Fetching local news for locale: ${locale}`);

        const data = await this.makeRequest(url);
        const normalized = this.normalizeResponse(data, 'headlines');

        return {
            ...normalized,
            source: 'news_api',
            locale: locale
        };
    }

    // ==================== URL BUILDING ====================

    /**
     * Map Currents API categories to News API categories
     */
    mapCategory(category) {
        const mapping = {
            'latest': 'general',
            'general': 'general',
            'world': 'general',
            'technology': 'tech',
            'tech': 'tech',
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

    /**
     * Convert country code to News API locale
     */
    countryCodeToLocale(countryCode) {
        if (!countryCode) return null;
        const code = countryCode.toUpperCase();
        return this.localeMap[code] || null;
    }

    /**
     * Build URL for latest news endpoint (NewsData.io)
     */
    buildHeadlinesUrl(page, category, locale, filters) {
        // Validate required parameters
        if (!this.apiKey) {
            throw new Error('NewsData.io API key is required');
        }

        if (!this.language || !this.isValidLanguage(this.language)) {
            throw new Error('Valid language code is required for NewsData.io');
        }

        let url = `${this.baseUrl}/latest?apikey=${encodeURIComponent(this.apiKey)}&language=${encodeURIComponent(this.language)}&page=${page}`;

        // Add category if not 'general' and valid
        if (category && category !== 'general' && this.isValidCategory(category)) {
            url += `&category=${encodeURIComponent(category)}`;
        }

        // Add country filter for local news (NewsData.io uses country parameter)
        if (locale && this.isValidCountryCode(locale)) {
            url += `&country=${encodeURIComponent(locale)}`;
        }

        // Add date filters (NewsData.io uses from_date and to_date)
        if (filters.start_date && filters.end_date && this.isValidDate(filters.start_date) && this.isValidDate(filters.end_date)) {
            url += `&from_date=${filters.start_date}&to_date=${filters.end_date}`;
        }

        return url;
    }

    /**
     * Build URL for archive endpoint (NewsData.io)
     */
    buildTopNewsUrl(page, locale, filters) {
        // Validate required parameters
        if (!this.apiKey) {
            throw new Error('NewsData.io API key is required');
        }

        if (!this.language || !this.isValidLanguage(this.language)) {
            throw new Error('Valid language code is required for NewsData.io');
        }

        // Archive endpoint requires date filters
        if (!filters.start_date || !filters.end_date) {
            throw new Error('Archive endpoint requires both start_date and end_date parameters');
        }

        if (!this.isValidDate(filters.start_date) || !this.isValidDate(filters.end_date)) {
            throw new Error('Invalid date format. Use YYYY-MM-DD format');
        }

        let url = `${this.baseUrl}/archive?apikey=${encodeURIComponent(this.apiKey)}&language=${encodeURIComponent(this.language)}&page=${page}&from_date=${filters.start_date}&to_date=${filters.end_date}`;

        // Add country filter for local news
        if (locale && this.isValidCountryCode(locale)) {
            url += `&country=${encodeURIComponent(locale)}`;
        }

        return url;
    }

    /**
     * Build URL for search endpoint (NewsData.io)
     */
    buildSearchUrl(page, query, filters) {
        // Validate required parameters
        if (!this.apiKey) {
            throw new Error('NewsData.io API key is required');
        }

        if (!this.language || !this.isValidLanguage(this.language)) {
            throw new Error('Valid language code is required for NewsData.io');
        }

        // Query parameter is required for search
        if (!query || !query.trim()) {
            throw new Error('Search query is required for NewsData.io');
        }

        let url = `${this.baseUrl}/latest?apikey=${encodeURIComponent(this.apiKey)}&language=${encodeURIComponent(this.language)}&page=${page}&q=${encodeURIComponent(query.trim())}`;

        // Add category if provided
        if (filters.category) {
            const mappedCategory = this.mapCategory(filters.category);
            if (mappedCategory && this.isValidCategory(mappedCategory)) {
                url += `&category=${encodeURIComponent(mappedCategory)}`;
            }
        }

        // Add country filter
        if (filters.country && this.isValidCountryCode(filters.country)) {
            url += `&country=${encodeURIComponent(filters.country)}`;
        }

        // Add date filters
        if (filters.start_date && filters.end_date && this.isValidDate(filters.start_date) && this.isValidDate(filters.end_date)) {
            url += `&from_date=${filters.start_date}&to_date=${filters.end_date}`;
        }

        return url;
    }

    // ==================== RESPONSE NORMALIZATION ====================

    /**
     * Normalize NewsData.io responses to common format
     */
    normalizeResponse(data, endpointType) {
        try {
            let articles = [];
            let totalResults = 0;

            // NewsData.io uses 'results' array for articles
            if (data.results && Array.isArray(data.results)) {
                articles = data.results;
                totalResults = data.totalResults || articles.length;
            } else if (data.data && Array.isArray(data.data)) {
                // Fallback for other endpoints
                articles = data.data;
                totalResults = data.totalResults || articles.length;
            }

            // Check if there are more pages (NewsData.io provides nextPage)
            const hasMore = data.nextPage ? true : (articles.length >= this.pageSize);

            // Normalize article fields
            const normalizedArticles = articles.map(article => this.normalizeArticle(article));

            return {
                articles: normalizedArticles,
                totalResults: totalResults,
                hasMore: hasMore,
                isCached: false
            };
        } catch (error) {
            console.error('[NewsAPIClient] Error normalizing response:', error);
            return {
                articles: [],
                totalResults: 0,
                hasMore: false,
                isCached: false
            };
        }
    }

    /**
     * Normalize individual article to match Currents format
     */
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
            author: article.creator || article.author || '',
            snippet: article.snippet || article.description || ''
        };
    }

    // ==================== REQUEST HANDLING ====================

    /**
     * Make HTTP request with retry logic and rate limiting
     */
    async makeRequest(url) {
        return new Promise((resolve, reject) => {
            this.requestQueue.push({ url, resolve, reject });
            this.processQueue();
        });
    }

    /**
     * Process the request queue with rate limiting
     */
    async processQueue() {
        if (this.isProcessingQueue || this.requestQueue.length === 0) {
            return;
        }

        this.isProcessingQueue = true;

        while (this.requestQueue.length > 0) {
            const { url, resolve, reject } = this.requestQueue.shift();

            try {
                // Rate limiting: ensure minimum interval between requests
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

            // Small delay between queued requests
            if (this.requestQueue.length > 0) {
                await this.delay(50);
            }
        }

        this.isProcessingQueue = false;
    }

    /**
     * Execute a single request with retry logic
     */
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
                // Handle specific error codes
                if (response.status === 401) {
                    throw new Error('Invalid News API key');
                } else if (response.status === 402) {
                    throw new Error('News API quota exceeded');
                } else if (response.status === 429) {
                    // Rate limited - retry with longer delay
                    if (attempt < this.maxRetries) {
                        const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt);
                        console.log(`[NewsAPIClient] Rate limited, retrying in ${retryDelay}ms`);
                        await this.delay(retryDelay);
                        return this.executeRequest(url, attempt + 1);
                    }
                    throw new Error('News API rate limit exceeded');
                } else if (response.status >= 500) {
                    // Server error - retry
                    if (attempt < this.maxRetries) {
                        const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt - 1);
                        console.log(`[NewsAPIClient] Server error, retrying in ${retryDelay}ms`);
                        await this.delay(retryDelay);
                        return this.executeRequest(url, attempt + 1);
                    }
                }

                throw new Error(`News API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // Validate response structure
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid News API response format');
            }

            return data;

        } catch (error) {
            console.error(`[NewsAPIClient] Request failed (attempt ${attempt}):`, error.message);

            // Retry on network errors
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

    /**
     * Delay helper
     */
    delay(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Get API status/health check
     */
    async getStatus() {
        try {
            const testUrl = `${this.baseUrl}/news/headlines?api_token=${this.apiKey}&language=${this.language}&page=1`;
            await this.makeRequest(testUrl);
            return { status: 'ok' };
        } catch (error) {
            return { status: 'error', message: error.message };
        }
    }

    /**
     * Validate category for NewsData.io
     */
    isValidCategory(category) {
        if (!category) return false;
        const validCategories = ['general', 'business', 'sports', 'technology', 'entertainment', 'health', 'science'];
        return validCategories.includes(category.toLowerCase());
    }

    /**
     * Validate country code for NewsData.io
     */
    isValidCountryCode(countryCode) {
        if (!countryCode) return false;
        // NewsData.io supports these country codes
        const validCountries = ['us', 'ca', 'au', 'gb', 'de', 'fr', 'es', 'it', 'nl', 'se', 'no', 'in', 'jp', 'cn', 'br', 'mx', 'ar', 'cl', 'co', 'pe'];
        return validCountries.includes(countryCode.toLowerCase());
    }

    /**
     * Validate date format for NewsData.io
     */
    isValidDate(dateString) {
        if (!dateString) return false;
        // NewsData.io expects YYYY-MM-DD format
        const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
        if (!dateRegex.test(dateString)) return false;

        try {
            const date = new Date(dateString);
            return date instanceof Date && !isNaN(date.getTime());
        } catch (error) {
            return false;
        }
    }

    /**
     * Validate language code for NewsData.io
     */
    isValidLanguage(languageCode) {
        if (!languageCode) return false;
        // NewsData.io supports these language codes
        const validLanguages = ['en', 'fr', 'es', 'de', 'it', 'pt', 'ru', 'ja', 'zh', 'ar', 'hi', 'ko', 'nl', 'sv', 'no', 'da', 'fi', 'pl', 'tr', 'th', 'vi'];
        return validLanguages.includes(languageCode.toLowerCase());
    }
}

// Export for use in other modules
window.NewsAPIClient = NewsAPIClient;