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

        const url = this.buildTopNewsUrl(page, locale, filters);
        console.log(`[NewsAPIClient] Fetching local news for locale: ${locale}`);

        const data = await this.makeRequest(url);
        const normalized = this.normalizeResponse(data, 'top');

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
        let url = `${this.baseUrl}/latest?apikey=${this.apiKey}&language=${this.language}&page=${page}`;

        // Add category if not 'general'
        if (category && category !== 'general') {
            url += `&category=${encodeURIComponent(category)}`;
        }

        // Add country filter for local news (NewsData.io uses country parameter)
        if (locale) {
            url += `&country=${encodeURIComponent(locale)}`;
        }

        // Add date filters (NewsData.io uses from_date and to_date)
        if (filters.start_date && filters.end_date) {
            url += `&from_date=${filters.start_date}&to_date=${filters.end_date}`;
        }

        return url;
    }

    /**
     * Build URL for archive endpoint (NewsData.io)
     */
    buildTopNewsUrl(page, locale, filters) {
        let url = `${this.baseUrl}/archive?apikey=${this.apiKey}&language=${this.language}&page=${page}`;

        // Add country filter for local news
        if (locale) {
            url += `&country=${encodeURIComponent(locale)}`;
        }

        // Add date filters
        if (filters.start_date) {
            url += `&from_date=${filters.start_date}`;
        }
        if (filters.end_date) {
            url += `&to_date=${filters.end_date}`;
        }

        return url;
    }

    /**
     * Build URL for search endpoint (NewsData.io)
     */
    buildSearchUrl(page, query, filters) {
        let url = `${this.baseUrl}/latest?apikey=${this.apiKey}&language=${this.language}&q=${encodeURIComponent(query)}&page=${page}`;

        // Add category if provided
        if (filters.category) {
            const mappedCategory = this.mapCategory(filters.category);
            if (mappedCategory) {
                url += `&category=${encodeURIComponent(mappedCategory)}`;
            }
        }

        // Add country filter
        if (filters.country) {
            url += `&country=${encodeURIComponent(filters.country)}`;
        }

        // Add date filters
        if (filters.start_date) {
            url += `&from_date=${filters.start_date}`;
        }
        if (filters.end_date) {
            url += `&to_date=${filters.end_date}`;
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
}

// Export for use in other modules
window.NewsAPIClient = NewsAPIClient;