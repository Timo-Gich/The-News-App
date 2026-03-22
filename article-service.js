// article-service.js - Central Article Coordinator (The Brain)

class ArticleService {
    constructor() {
        this.apiClient = null;
        this.newsApiClient = null;
        this.gnewsApiClient = null;
        this.offlineManager = null;
        this.storage = null;

        // State management
        this.currentPage = 1;
        this.currentCategory = 'latest';
        this.currentLanguage = 'en';
        this.isOnline = navigator.onLine;
        this.searchQuery = '';
        this.fallbackEnabled = false;
        this.gnewsFallbackEnabled = false;
        this.filters = {
            start_date: '',
            end_date: '',
            category: '',
            domain: '',
            keywords: ''
        };

        // Listen for online/offline changes
        window.addEventListener('online', () => this.handleOnline());
        window.addEventListener('offline', () => this.handleOffline());
    }

    // Initialize with dependencies
    init(apiClient, newsApiClient, gnewsApiClient, offlineManager, storage) {
        this.apiClient = apiClient;
        this.newsApiClient = newsApiClient;
        this.gnewsApiClient = gnewsApiClient;
        this.offlineManager = offlineManager;
        this.storage = storage;
        console.log('ArticleService initialized');
    }

    // Enable or disable fallback mechanism
    setFallbackEnabled(enabled) {
        this.fallbackEnabled = enabled;
        console.log(`[ArticleService] Fallback mechanism ${enabled ? 'enabled' : 'disabled'}`);
    }

    // Enable or disable GNews fallback mechanism
    setGNewsFallbackEnabled(enabled) {
        this.gnewsFallbackEnabled = enabled;
        console.log(`[ArticleService] GNews fallback mechanism ${enabled ? 'enabled' : 'disabled'}`);
    }

    // ==================== STATE MANAGEMENT ====================
    handleOnline() {
        console.log('[ArticleService] Network: Online');
        this.isOnline = true;
    }

    handleOffline() {
        console.log('[ArticleService] Network: Offline');
        this.isOnline = false;
    }

    setLanguage(language) {
        this.currentLanguage = language;
        if (this.apiClient) {
            this.apiClient.setLanguage(language);
        }
        if (this.newsApiClient) {
            this.newsApiClient.setLanguage(language);
        }
    }

    // ==================== MAIN PUBLIC API ====================

    /**
     * Get articles - decides between online API, offline storage, or cached data
     * @param {Object} params - { page, category, query, filters }
     * @returns {Promise<Object>} - { articles, source, pageNum, totalResults, hasMore, isCached }
     */
    async getArticles(params = {}) {
        const {
            page = this.currentPage,
                category = this.currentCategory,
                query = this.searchQuery,
                filters = this.filters
        } = params;

        // Update current state
        this.currentPage = page;
        this.currentCategory = category || 'latest';
        this.searchQuery = query;
        this.filters = {...this.filters,
            ...filters
        };

        console.log(`[ArticleService] Getting articles: page=${page}, category=${this.currentCategory}, query=${query ? query.substring(0, 20) + '...' : 'none'}`);

        // SPECIAL HANDLING: Search requests
        if (query && query.trim()) {
            return await this.handleSearchRequest({
                page,
                query,
                filters
            });
        }

        // STANDARD ARTICLE FETCHING
        return await this.handleArticleRequest({
            page,
            category: this.currentCategory,
            filters
        });
    }

    /**
     * Download articles for offline reading
     * @param {Object} params - { category, pages }
     */
    async downloadForOffline(params = {}) {
        const { category = 'latest', pages = 10 } = params;

        if (!this.isOnline) {
            throw new Error('Cannot download offline content while offline');
        }

        console.log(`[ArticleService] Starting offline download: ${pages} pages of ${category}`);

        try {
            const result = await this.offlineManager.downloadPages(category, pages);
            console.log(`[ArticleService] Offline download completed: ${result.downloadedPages} pages`);
            return result;
        } catch (error) {
            console.error('[ArticleService] Offline download failed:', error);
            throw error;
        }
    }

    /**
     * Get all offline articles
     * @param {number} limit - Maximum number of articles to return
     * @returns {Promise<Array>} - Array of offline articles
     */
    async getOfflineArticles(limit = 50) {
        try {
            const articles = await this.storage.getOfflineArticles(limit);
            console.log(`[ArticleService] Retrieved ${articles.length} offline articles`);
            return articles;
        } catch (error) {
            console.error('[ArticleService] Failed to get offline articles:', error);
            return [];
        }
    }

    /**
     * Search offline articles
     * @param {string} query - Search query
     * @param {Object} filters - Search filters
     * @returns {Promise<Array>} - Array of matching articles
     */
    async searchOfflineArticles(query, filters = {}) {
        try {
            const articles = await this.storage.searchArticles(query, filters);
            console.log(`[ArticleService] Offline search found ${articles.length} articles for "${query}"`);
            return articles;
        } catch (error) {
            console.error('[ArticleService] Offline search failed:', error);
            return [];
        }
    }

    // ==================== PRIVATE METHODS ====================

    /**
     * Handle search requests (online + offline fallback)
     * CURRENTS API IS PRIMARY - only fallback to News API for quota/server errors
     */
    async handleSearchRequest({ page, query, filters }) {
        // Step 1: Try cached search results first
        const cachedResults = await this.storage.getCachedSearchResults(query, filters);
        if (cachedResults && cachedResults.length > 0) {
            console.log(`[ArticleService] Using cached search results for "${query}" (${cachedResults.length} articles)`);
            return {
                articles: cachedResults,
                source: 'search_cache',
                pageNum: page,
                isCached: true,
                totalResults: cachedResults.length
            };
        }

        // Step 2: If online, perform API search with Currents as PRIMARY
        if (this.isOnline && this.apiClient) {
            try {
                console.log(`[ArticleService] Performing search via Currents API for "${query}"`);
                const apiResponse = await this.apiClient.searchArticles({ page, query, filters });

                if (apiResponse.articles && apiResponse.articles.length > 0) {
                    // Cache search results for future use
                    await this.storage.cacheSearchResults(query, filters, apiResponse.articles);

                    console.log(`[ArticleService] Search found ${apiResponse.articles.length} articles from Currents API`);
                    return {
                        articles: apiResponse.articles,
                        source: 'currents_search',
                        pageNum: page,
                        isCached: false,
                        totalResults: apiResponse.totalResults,
                        hasMore: apiResponse.hasMore
                    };
                } else {
                    // Empty results from Currents API search - don't fallback
                    console.warn(`[ArticleService] Currents API search returned no results for: "${query}"`);
                    return {
                        articles: [],
                        source: 'currents_search_empty',
                        pageNum: page,
                        isCached: false,
                        totalResults: 0,
                        hasMore: false
                    };
                }
            } catch (error) {
                console.warn(`[ArticleService] Currents API search failed: ${error.message}`);

                // Check if this is a NO_API_KEY error - if so, re-throw immediately without fallback
                if (error.code === 'NO_API_KEY') {
                    console.error(`[ArticleService] Currents API key not configured - cannot continue`);
                    throw error; // Re-throw so UI knows API key is missing
                }

                // Broader fallback condition
                const isApiKeyError = error.message.includes('Invalid API key') || error.message.includes('401');
                const shouldFallback = this.fallbackEnabled && !isApiKeyError;

                // ONLY fallback to News API for quota/server errors when explicitly enabled
                if (shouldFallback && this.fallbackEnabled && this.newsApiClient) {
                    console.log(`[ArticleService] on Currents API search, attempting fallback to News API...`);

                    try {
                        const newsFilters = this.convertFiltersToNewsAPI(filters);
                        const newsResponse = await this.newsApiClient.searchArticles({ page, query, filters: newsFilters });

                        if (newsResponse.articles && newsResponse.articles.length > 0) {
                            console.log(`[ArticleService] Search found ${newsResponse.articles.length} articles from News API (fallback)`);

                            // Cache search results
                            await this.storage.cacheSearchResults(query, filters, newsResponse.articles).catch(err =>
                                console.warn('[ArticleService] Failed to cache search results:', err)
                            );

                            return {
                                articles: newsResponse.articles,
                                source: 'search_news_api_fallback',
                                pageNum: page,
                                isCached: false,
                                totalResults: newsResponse.totalResults,
                                hasMore: newsResponse.hasMore
                            };
                        }
                    } catch (fallbackError) {
                        console.error('[ArticleService] News API search fallback also failed:', fallbackError.message);
                        // Continue to offline search below
                    }


                    // Try GNews API as additional fallback if enabled
                    if (this.gnewsFallbackEnabled && this.gnewsApiClient) {
                        console.log(`[ArticleService] on Currents API search, attempting fallback to GNews API...`);

                        try {
                            const gnewsResponse = await this.gnewsApiClient.searchArticles({ page, query, filters });

                            if (gnewsResponse.articles && gnewsResponse.articles.length > 0) {
                                console.log(`[ArticleService] Search found ${gnewsResponse.articles.length} articles from GNews API (fallback)`);

                                // Cache search results
                                await this.storage.cacheSearchResults(query, filters, gnewsResponse.articles).catch(err =>
                                    console.warn('[ArticleService] Failed to cache search results:', err)
                                );

                                return {
                                    articles: gnewsResponse.articles,
                                    source: 'search_gnews_api_fallback',
                                    pageNum: page,
                                    isCached: false,
                                    totalResults: gnewsResponse.totalResults,
                                    hasMore: gnewsResponse.hasMore
                                };
                            }
                        } catch (gnewsError) {
                            console.error('[ArticleService] GNews API search fallback also failed:', gnewsError.message);
                            // Continue to offline search below
                        }
                    }

                    // Fall through to offline search
                }
            }
        } else if (!this.apiClient) {
            console.error('[ArticleService] Currents API client not initialized');
        }

        // Step 3: Offline search fallback
        try {
            console.log(`[ArticleService] Performing offline search for "${query}"`);
            const offlineResults = await this.storage.searchArticles(query, filters);

            if (offlineResults && offlineResults.length > 0) {
                console.log(`[ArticleService] Offline search found ${offlineResults.length} articles`);
                return {
                    articles: offlineResults,
                    source: 'search_offline',
                    pageNum: page,
                    isCached: true,
                    totalResults: offlineResults.length
                };
            }
        } catch (error) {
            console.warn(`[ArticleService] Offline search failed: ${error.message}`);
        }

        // No search results found
        return {
            articles: [],
            source: 'search_empty',
            pageNum: page,
            isCached: false,
            totalResults: 0
        };
    }

    /**
     * Handle standard article requests (latest, categories)
     * CURRENTS API IS PRIMARY - only fallback to News API for quota/server errors
     */
    async handleArticleRequest({ page, category, filters }) {
        // Step 1: Try to get cached page first (if offline or as fallback)
        if (!this.isOnline) {
            const cachedPage = await this.storage.getArticlesPage(page, category);
            if (cachedPage && cachedPage.length > 0) {
                console.log(`[ArticleService] Using cached page ${page} for ${category} (${cachedPage.length} articles)`);
                return {
                    articles: cachedPage,
                    source: 'cache',
                    pageNum: page,
                    isCached: true
                };
            }
        }

        // Step 2: If online, try primary API (Currents) - THIS IS PRIMARY
        if (this.isOnline && this.apiClient) {
            try {
                const apiResponse = await this.apiClient.fetchArticles({ page, category, filters });

                if (apiResponse.articles && apiResponse.articles.length > 0) {
                    // Cache this page for offline use (background operation)
                    this.storage.cacheArticlesPage(apiResponse.articles, page, category).catch(err =>
                        console.warn('[ArticleService] Failed to cache page:', err)
                    );

                    console.log(`[ArticleService] Fetched ${apiResponse.articles.length} articles from Currents API`);
                    return {
                        articles: apiResponse.articles,
                        source: 'currents_api',
                        pageNum: page,
                        isCached: false,
                        totalResults: apiResponse.totalResults,
                        hasMore: apiResponse.hasMore
                    };
                } else {
                    // Empty response from Currents API - try keyword search as fallback
                    console.warn(`[ArticleService] Currents API returned empty results for category: ${category}`);

                    // Try keyword-based search for the category
                    const categoryKeywords = this.getCategoryKeywords(category);
                    if (categoryKeywords) {
                        console.log(`[ArticleService] Attempting keyword search for category: ${category} -> "${categoryKeywords}"`);

                        const searchResponse = await this.handleSearchRequest({
                            page,
                            query: categoryKeywords,
                            filters
                        });

                        if (searchResponse.articles && searchResponse.articles.length > 0) {
                            console.log(`[ArticleService] Keyword search found ${searchResponse.articles.length} articles for category: ${category}`);
                            return {
                                ...searchResponse,
                                source: 'category_keyword_fallback'
                            };
                        }
                    }

                    return {
                        articles: [],
                        source: 'currents_api_empty',
                        pageNum: page,
                        isCached: false,
                        totalResults: 0,
                        hasMore: false
                    };
                }
            } catch (error) {
                console.warn(`[ArticleService] Currents API fetch failed: ${error.message}`);

                // Check if this is a NO_API_KEY error - if so, re-throw immediately without fallback
                if (error.code === 'NO_API_KEY') {
                    console.error(`[ArticleService] Currents API key not configured - cannot continue`);
                    throw error; // Re-throw so UI knows API key is missing
                }

                // Broader fallback condition
                const isApiKeyError = error.message.includes('Invalid API key') || error.message.includes('401');
                const shouldFallback = this.fallbackEnabled && !isApiKeyError;

                // ONLY try fallback to News API for quota/server errors, and only if explicitly enabled
                if (shouldFallback && this.fallbackEnabled && this.newsApiClient) {
                    console.log(`[ArticleService] on Currents API, attempting fallback to News API...`);

                    try {
                        const newsFilters = this.convertFiltersToNewsAPI(filters);
                        const newsResponse = await this.newsApiClient.fetchArticles({ page, category, filters: newsFilters });

                        if (newsResponse.articles && newsResponse.articles.length > 0) {
                            console.log(`[ArticleService] Fetched ${newsResponse.articles.length} articles from News API (fallback)`);

                            // Cache this page for offline use
                            this.storage.cacheArticlesPage(newsResponse.articles, page, category).catch(err =>
                                console.warn('[ArticleService] Failed to cache fallback page:', err)
                            );

                            return {
                                articles: newsResponse.articles,
                                source: 'news_api_fallback',
                                pageNum: page,
                                isCached: false,
                                totalResults: newsResponse.totalResults,
                                hasMore: newsResponse.hasMore
                            };
                        }
                    } catch (fallbackError) {
                        console.error('[ArticleService] News API fallback also failed:', fallbackError.message);
                        // Continue to regular fallbacks below
                    }


                    // Try GNews API as additional fallback if enabled
                    if (this.gnewsFallbackEnabled && this.gnewsApiClient) {
                        console.log(`[ArticleService] on Currents API, attempting fallback to GNews API...`);

                        try {
                            const gnewsResponse = await this.gnewsApiClient.fetchTopHeadlines({ page, category, filters });

                            if (gnewsResponse.articles && gnewsResponse.articles.length > 0) {
                                console.log(`[ArticleService] Fetched ${gnewsResponse.articles.length} articles from GNews API (fallback)`);

                                // Cache this page for offline use
                                this.storage.cacheArticlesPage(gnewsResponse.articles, page, category).catch(err =>
                                    console.warn('[ArticleService] Failed to cache GNews fallback page:', err)
                                );

                                return {
                                    articles: gnewsResponse.articles,
                                    source: 'gnews_api_fallback',
                                    pageNum: page,
                                    isCached: false,
                                    totalResults: gnewsResponse.totalResults,
                                    hasMore: gnewsResponse.hasMore
                                };
                            }
                        } catch (gnewsError) {
                            console.error('[ArticleService] GNews API fallback also failed:', gnewsError.message);
                            // Continue to regular fallbacks below
                        }
                    }

                    // Fall through to offline fallback
                }
            }
        } else if (!this.apiClient) {
            console.error('[ArticleService] Currents API client not initialized');
        }

        // Step 3: Fallback: Try IndexedDB (all saved articles)
        try {
            const offlineArticles = await this.storage.getOfflineArticles(30, (page - 1) * 30);
            if (offlineArticles && offlineArticles.length > 0) {
                console.log(`[ArticleService] Using IndexedDB fallback (${offlineArticles.length} articles)`);
                return {
                    articles: offlineArticles,
                    source: 'offline',
                    pageNum: page,
                    isCached: true
                };
            }
        } catch (error) {
            console.warn(`[ArticleService] IndexedDB fallback failed: ${error.message}`);
        }

        // Step 4: Try cached pages from latest news
        try {
            const cachedPages = await this.storage.getAllCachedPages(category);
            if (cachedPages.length > 0) {
                // Merge all cached pages into one array
                const allCachedArticles = cachedPages.flatMap(page => page.articles);

                if (allCachedArticles.length > 0) {
                    console.log(`[ArticleService] Using cached pages (${allCachedArticles.length} articles)`);
                    return {
                        articles: allCachedArticles,
                        source: 'cached_pages',
                        pageNum: page,
                        isCached: true
                    };
                }
            }
        } catch (error) {
            console.warn(`[ArticleService] Cached pages fallback failed: ${error.message}`);
        }

        // No data available
        throw new Error('No articles available (offline and no cache)');
    }

    /**
     * Get keyword search terms for categories that might not be supported by the API
     */
    getCategoryKeywords(category) {
        const keywordMap = {
            'world': 'world news international',
            'politics': 'politics government policy',
            'local': 'local news city community',
            'entertainment': 'entertainment movies music celebrities',
            'technology': 'technology tech gadgets innovation',
            'tech': 'technology tech gadgets innovation',
            'business': 'business economy finance market',
            'sports': 'sports games athletics competition',
            'health': 'health medicine wellness fitness',
            'science': 'science research discovery technology',
            'general': 'news current events'
        };

        return keywordMap[category.toLowerCase()] || null;
    }

    /**
     * Convert Currents API filter format to News API format
     */
    convertFiltersToNewsAPI(currentsFilters) {
        return {
            start_date: currentsFilters.start_date,
            end_date: currentsFilters.end_date
        };
    }

    /**
     * Get local news based on user's location (country)
     * @param {Object} location - { country, countryCode, latitude, longitude }
     * @returns {Promise<Object>} - { articles, source, pageNum, isCached }
     */
    async getLocalNews(location = {}) {
        const { countryCode, country } = location;

        if (!countryCode) {
            console.warn('[ArticleService] No country code provided for local news');
            return await this.getArticles({ category: 'latest' });
        }

        // Map country code to GNews API locale
        const gnewsLocale = this.gnewsApiClient ? this.gnewsApiClient.countryCodeToLocale(countryCode) : null;
        // Map country code to News API locale
        const newsApiLocale = this.newsApiClient ? this.newsApiClient.countryCodeToLocale(countryCode) : null;

        // Map country to language for API
        const language = getLanguageForCountry(countryCode);
        const originalLanguage = this.currentLanguage;

        try {
            // Set language for this request
            this.setLanguage(language);

            const countryName = getCountryName(countryCode) || country;
            console.log(`[ArticleService] Fetching local news for ${countryName} (${language}, gnews locale: ${gnewsLocale}, newsapi locale: ${newsApiLocale})`);

            // Try GNews API first for local news if locale is supported
            if (gnewsLocale && this.gnewsApiClient && this.isOnline) {
                try {
                    console.log(`[ArticleService] Using GNews API for local news (locale=${gnewsLocale})`);
                    const gnewsResponse = await this.gnewsApiClient.fetchLocalNews({ page: 1, locale: gnewsLocale });

                    if (gnewsResponse.articles && gnewsResponse.articles.length > 0) {
                        console.log(`[ArticleService] Fetched ${gnewsResponse.articles.length} local articles from GNews API`);
                        return {
                            articles: gnewsResponse.articles,
                            source: 'gnews_api_local',
                            location: { country, countryCode },
                            isCached: false,
                            totalResults: gnewsResponse.totalResults,
                            hasMore: gnewsResponse.hasMore
                        };
                    }
                } catch (error) {
                    console.warn('[ArticleService] GNews API local news failed, falling back to News API:', error.message);
                }
            }

            // Try News API second for local news if locale is supported
            if (newsApiLocale && this.newsApiClient && this.isOnline) {
                try {
                    console.log(`[ArticleService] Using News API for local news (locale=${newsApiLocale})`);
                    const newsResponse = await this.newsApiClient.fetchLocalNews({ page: 1, locale: newsApiLocale });

                    if (newsResponse.articles && newsResponse.articles.length > 0) {
                        console.log(`[ArticleService] Fetched ${newsResponse.articles.length} local articles from News API`);
                        return {
                            articles: newsResponse.articles,
                            source: 'news_api_local',
                            location: { country, countryCode },
                            isCached: false,
                            totalResults: newsResponse.totalResults,
                            hasMore: newsResponse.hasMore
                        };
                    }
                } catch (error) {
                    console.warn('[ArticleService] News API local news failed, falling back to keyword search:', error.message);
                    // Fall through to keyword-based search
                }
            }

            // Fallback: Use keywords with country name for Currents API
            console.log('[ArticleService] Falling back to Currents API for local news');
            const keywords = countryName;
            const params = {
                page: 1,
                category: 'latest',
                filters: {
                    keywords: keywords,
                    ...this.filters
                }
            };

            // Get articles using standard method (handles all fallback layers)
            const response = await this.handleArticleRequest(params);

            return {
                ...response,
                location: { country, countryCode }
            };
        } catch (error) {
            console.error('[ArticleService] Local news fetch failed:', error);
            return await this.getArticles({ category: 'latest' });
        } finally {
            // Restore original language
            this.setLanguage(originalLanguage);
        }
    }
}

// Export for use in other modules
window.ArticleService = ArticleService;