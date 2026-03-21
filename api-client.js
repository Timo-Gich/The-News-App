// api-client.js - Dedicated API Client for Currents News API

class APIClient {
    constructor(baseUrl, apiKey) {
        this.baseUrl = baseUrl;
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
    }

    setAPIConfig({ apiKey, baseUrl, language }) {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
        if (language) this.language = language;
    }

    setLanguage(language) {
        this.language = language;
    }

    // ==================== MAIN API METHODS ====================

    /**
     * Fetch articles from API
     * @param {Object} params - { page, category, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore }
     */
    async fetchArticles(params = {}) {
        const { page = 1, category = 'latest', filters = {} } = params;

        if (!this.apiKey) {
            const error = new Error('Currents API key not configured');
            error.code = 'NO_API_KEY';
            throw error;
        }

        const url = this.buildLatestNewsUrl(page, category, filters);
        console.log(`[APIClient] Fetching articles from Currents API: page=${page}, category=${category}`);

        const data = await this.makeRequest(url);
        return {
            articles: data.news || [],
            totalResults: data.totalResults || data.total || 0,
            page: data.page || page,
            hasMore: data.hasMore || false
        };
    }

    /**
     * Search articles via API
     * @param {Object} params - { page, query, filters }
     * @returns {Promise<Object>} - { articles, totalResults, hasMore }
     */
    async searchArticles(params = {}) {
        const { page = 1, query, filters = {} } = params;

        if (!this.apiKey) {
            const error = new Error('Currents API key not configured');
            error.code = 'NO_API_KEY';
            throw error;
        }

        if (!query || !query.trim()) {
            throw new Error('Search query is required');
        }

        const url = this.buildSearchUrl(page, query, filters);
        console.log(`[APIClient] Searching articles via Currents API: query="${query}"`);

        const data = await this.makeRequest(url);
        return {
            articles: data.news || [],
            totalResults: data.totalResults || data.total || 0,
            page: data.page || page,
            hasMore: data.hasMore || false
        };
    }

    // ==================== URL BUILDING ====================

    /**
     * Build URL for latest news endpoint
     */
    buildLatestNewsUrl(page, category, filters) {
            let url = `${this.baseUrl}/latest-news?language=${this.language}&page=${page}&page_size=${this.pageSize}&apiKey=${this.apiKey}`;

            // Map UI categories to API-compatible categories
            const apiCategory = this.mapCategoryToAPI(category);

            // Add category if not 'latest' and if we have a valid API category
            if (apiCategory && apiCategory !== 'latest') {
                url += `&category=${encodeURIComponent(apiCategory)}`;
            }

            // Add filters
            if (filters.start_date && filters.end_date) {
                url += `&start_date=${filters.start_date}&end_date=${filters.end_date}`;
            }

            if (filters.domain) {
                url += `&domain=${encodeURIComponent(filters.domain)}`;
            }

            if (filters.keywords) {
                url += `&keywords=${encodeURIComponent(filters.keywords)}`;
            }

            return url;
        }
        /**
         * Map UI categories to Currents API compatible categories
         */
    mapCategoryToAPI(category) {
        if (!category || category === 'latest') {
            return 'latest';
        }

        // Currents API category mapping
        const categoryMap = {
            // UI Category: API Category
            'world': 'world',
            'politics': 'politics',
            'local': 'local',
            'entertainment': 'entertainment',
            'technology': 'technology',
            'tech': 'technology', // Alias for technology
            'business': 'business',
            'sports': 'sports',
            'health': 'health',
            'science': 'science',

            // Additional Currents API categories that might be supported
            'general': 'general',
            'economy': 'business', // Map economy to business
            'finance': 'business', // Map finance to business
            'lifestyle': 'entertainment', // Map lifestyle to entertainment
            'culture': 'entertainment', // Map culture to entertainment
            'education': 'science', // Map education to science
            'environment': 'science', // Map environment to science
        };

        return categoryMap[category.toLowerCase()] || category;
    }

    /**
     * Build URL for search endpoint
     */
    buildSearchUrl(page, query, filters) {
        let url = `${this.baseUrl}/search?language=${this.language}&keywords=${encodeURIComponent(query)}&page=${page}&page_size=${this.pageSize}&apiKey=${this.apiKey}`;

        // Add date range
        if (filters.start_date && filters.end_date) {
            url += `&start_date=${filters.start_date}&end_date=${filters.end_date}`;
        }

        // Add other filters
        if (filters.domain) {
            url += `&domain=${encodeURIComponent(filters.domain)}`;
        }

        if (filters.category) {
            url += `&category=${encodeURIComponent(filters.category)}`;
        }

        return url;
    }

    // ==================== REQUEST HANDLING ====================

    /**
     * Make HTTP request with retry logic and rate limiting
     */
    async makeRequest(url) {
        // Add to queue for rate limiting
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
            console.log(`[APIClient] Request attempt ${attempt}: ${url}`);

            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Accept': 'application/json',
                    'User-Agent': 'CurrentsNewsApp/1.0'
                },
                // Timeout after 30 seconds
                signal: AbortSignal.timeout(30000)
            });

            if (!response.ok) {
                // Handle specific error codes
                if (response.status === 401) {
                    throw new Error('Invalid API key');
                } else if (response.status === 429) {
                    // Rate limited - retry with longer delay
                    if (attempt < this.maxRetries) {
                        const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt);
                        console.log(`[APIClient] Rate limited, retrying in ${retryDelay}ms`);
                        await this.delay(retryDelay);
                        return this.executeRequest(url, attempt + 1);
                    }
                    throw new Error('Rate limit exceeded');
                } else if (response.status >= 500) {
                    // Server error - retry
                    if (attempt < this.maxRetries) {
                        const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt - 1);
                        console.log(`[APIClient] Server error, retrying in ${retryDelay}ms`);
                        await this.delay(retryDelay);
                        return this.executeRequest(url, attempt + 1);
                    }
                }

                throw new Error(`API Error: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();

            // Validate response structure
            if (!data || typeof data !== 'object') {
                throw new Error('Invalid API response format');
            }

            return data;

        } catch (error) {
            console.error(`[APIClient] Request failed (attempt ${attempt}):`, error.message);

            // Retry on network errors
            if ((error.name === 'TypeError' || error.name === 'AbortError') && attempt < this.maxRetries) {
                const retryDelay = this.retryDelay * Math.pow(this.backoffMultiplier, attempt - 1);
                console.log(`[APIClient] Network error, retrying in ${retryDelay}ms`);
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
            // Simple health check with a minimal request
            const testUrl = `${this.baseUrl}/latest-news?language=${this.language}&page=1&page_size=1&apiKey=${this.apiKey}`;
            await this.makeRequest(testUrl);
            return { status: 'ok' };
        } catch (error) {
            return { status: 'error', message: error.message };
        }
    }
}

// Export for use in other modules
window.APIClient = APIClient;