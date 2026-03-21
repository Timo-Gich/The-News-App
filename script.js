// script.js - UI Layer for News Application

class CurrentsNewsApp {
    constructor() {
        // Services
        this.articleService = null;
        this.apiClient = null;
        this.newsApiClient = null;
        this.offlineManager = null;

        // UI State
        this.currentCategory = 'latest';
        this.currentLanguage = 'en';
        this.searchQuery = '';
        this.filters = {
            start_date: '',
            end_date: '',
            category: '',
            domain: '',
            keywords: ''
        };
        this.articles = [];
        this.hasMorePages = true;

        // Fetch lock to prevent concurrent API calls
        this.isFetching = false;

        // UI elements
        this.isDarkMode = localStorage.getItem('darkMode') === 'true';
        this.deferredPrompt = null;

        // Initialize the app
        this.init();
    }

    // ==================== INITIALIZATION ====================
    async init() {
        // Set up theme first
        this.setTheme(this.isDarkMode);

        // Initialize services
        await this.initServices();

        // Check for saved API keys
        const savedCurrentsKey = localStorage.getItem('currents_api_key');
        const savedNewsKey = localStorage.getItem('news_api_key');

        if (savedCurrentsKey) {
            await this.setupAPIClient(savedCurrentsKey);
        }

        if (savedNewsKey) {
            await this.setupNewsAPIClient(savedNewsKey);
        }

        // Show modal if no Currents API key (Currents is required, News API is optional)
        if (savedCurrentsKey) {
            this.hideApiKeyModal();
            await this.loadLatestNews();
        } else {
            this.showApiKeyModal();
        }

        // Set up event listeners
        this.setupEventListeners();

        // Update dates for filters
        this.updateDateFilters();

        // Setup scroll to top functionality
        this.setupScrollToTop();

        // Enhanced error handling for GitHub Pages
        this.setupGitHubPagesErrorHandling();
    }

    async initServices() {
        try {
            // Create service instances
            this.offlineManager = new OfflineManager();
            this.apiClient = new APIClient('https://api.currentsapi.services/v1', null);
            this.newsApiClient = new NewsAPIClient('https://newsdata.io/api/1', null);
            this.articleService = new ArticleService();

            // Initialize offline manager first
            await this.offlineManager.init();
            console.log('Offline Manager initialized');

            // Connect services
            this.offlineManager.setAPIClient(this.apiClient);
            this.articleService.init(this.apiClient, this.newsApiClient, this.offlineManager, this.offlineManager.storage);

            // Set up toast function
            this.showToast = this.offlineManager.showToast.bind(this.offlineManager);

            // Start auto-download
            this.offlineManager.autoDownloadLatestPages();

            // Update stats
            await this.offlineManager.updateStats();

        } catch (error) {
            console.warn('Service initialization failed:', error);
        }
    }

    async setupAPIClient(apiKey) {
        this.apiClient.setAPIConfig({
            apiKey: apiKey,
            baseUrl: 'https://api.currentsapi.services/v1',
            language: this.currentLanguage
        });

        // Update article service language
        if (this.articleService) {
            this.articleService.setLanguage(this.currentLanguage);
        }
    }

    async setupNewsAPIClient(apiKey) {
        this.newsApiClient.setAPIConfig({
            apiKey: apiKey,
            baseUrl: 'https://newsdata.io/api/1',
            language: this.currentLanguage
        });

        console.log('[UI] NewsData.io client configured as fallback');
    }

    // ==================== GITHUB PAGES ERROR HANDLING ====================
    setupGitHubPagesErrorHandling() {
        // Handle 404 errors gracefully
        window.addEventListener('error', (event) => {
            console.warn('Resource loading error:', event.error);

            // If it's a 404 error, try to reload the page
            if (event.error && event.error.message &&
                (event.error.message.includes('404') || event.error.message.includes('Not Found'))) {
                this.showToast('Resource not found. Retrying...', 'warning');
                setTimeout(() => {
                    window.location.reload();
                }, 1000);
            }
        });

        // Handle fetch errors
        const originalFetch = window.fetch;
        window.fetch = async(...args) => {
            try {
                const response = await originalFetch(...args);
                if (!response.ok && response.status === 404) {
                    console.warn('404 error in fetch:', args[0]);
                    this.showToast('Resource not found. Using cached data.', 'warning');
                }
                return response;
            } catch (error) {
                console.error('Fetch error:', error);
                throw error;
            }
        };

        // Handle service worker registration errors
        if ('serviceWorker' in navigator) {
            navigator.serviceWorker.ready.catch((error) => {
                console.warn('Service Worker registration failed:', error);
                this.showToast('Service Worker failed to register. Some features may not work.', 'warning');
            });
        }

        // Handle manifest.json loading errors
        const manifestLink = document.querySelector('link[rel="manifest"]');
        if (manifestLink) {
            manifestLink.addEventListener('error', () => {
                console.warn('Manifest.json failed to load');
                this.showToast('PWA manifest failed to load. App may not install properly.', 'warning');
            });
        }
    }

    // ==================== THEME MANAGEMENT ====================
    setTheme(isDarkMode) {
        this.isDarkMode = isDarkMode;

        // Update body data-theme attribute
        if (isDarkMode) {
            document.body.setAttribute('data-theme', 'dark');
        } else {
            document.body.setAttribute('data-theme', 'light');
        }

        // Save preference
        localStorage.setItem('darkMode', isDarkMode.toString());

        // Update theme toggle button icon
        const themeToggle = document.querySelector('.theme-toggle i');
        if (themeToggle) {
            themeToggle.className = isDarkMode ? 'fas fa-sun' : 'fas fa-moon';
        }
    }

    toggleTheme() {
        this.setTheme(!this.isDarkMode);
        this.showToast(this.isDarkMode ? 'Dark mode enabled' : 'Light mode enabled', 'info');
    }

    // ==================== MODAL METHODS ====================
    showApiKeyModal() {
        document.getElementById('api-key-modal').classList.add('show');
    }

    hideApiKeyModal() {
        document.getElementById('api-key-modal').classList.remove('show');
    }

    hideArticleModal() {
        document.getElementById('article-modal').classList.remove('show');
    }

    showArticleModal(article) {
        // Set current article ID on modal for offline saving
        const modal = document.getElementById('article-modal');
        modal.dataset.currentArticleId = article.id;

        // Format date
        const date = new Date(article.published);
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });

        // Get domain from URL
        let domain = 'Unknown Source';
        try {
            if (article.url) {
                domain = new URL(article.url).hostname.replace('www.', '');
            }
        } catch (e) {
            console.log('Invalid URL:', article.url);
        }

        // Get categories - handle both string and array
        let categories = 'General';
        if (article.category) {
            if (Array.isArray(article.category)) {
                categories = article.category.length > 0 ? article.category.join(', ') : 'General';
            } else if (typeof article.category === 'string') {
                categories = article.category;
            }
        }

        // Update modal content
        document.getElementById('modal-title').textContent = article.title;
        document.getElementById('modal-source').innerHTML = `<i class="fas fa-globe"></i> ${domain}`;
        document.getElementById('modal-date').innerHTML = `<i class="far fa-clock"></i> ${formattedDate}`;
        document.getElementById('modal-author').innerHTML = article.author ?
            `<i class="fas fa-user"></i> ${article.author}` :
            `<i class="fas fa-user"></i> Unknown Author`;
        document.getElementById('modal-category').innerHTML = `<i class="fas fa-tag"></i> ${categories}`;

        // Update modal image
        const modalImage = document.getElementById('modal-image');
        if (article.image && article.image !== "None") {
            modalImage.src = article.image;
            modalImage.alt = article.title;
            modalImage.style.display = 'block';
        } else {
            modalImage.style.display = 'none';
        }

        document.getElementById('modal-description').textContent =
            article.description || 'No description available for this article.';

        document.getElementById('modal-read-full').href = article.url;

        // Show modal
        document.getElementById('article-modal').classList.add('show');
    }

    showInstallButton() {
        document.getElementById('install-btn').style.display = 'flex';
    }

    hideInstallButton() {
        document.getElementById('install-btn').style.display = 'none';
    }

    // ==================== EVENT LISTENERS ====================
    setupEventListeners() {
        // Helper function to safely add event listeners
        const addListener = (selector, event, handler) => {
            const element = typeof selector === 'string' ?
                document.querySelector(selector) :
                document.getElementById(selector);
            if (element) {
                element.addEventListener(event, handler);
            }
        };

        // Helper function for ID elements
        const addIdListener = (id, event, handler) => {
            const element = document.getElementById(id);
            if (element) {
                element.addEventListener(event, handler);
            }
        };

        // Helper function for class elements
        const addClassListener = (className, event, handler) => {
            const element = document.querySelector(className);
            if (element) {
                element.addEventListener(event, handler);
            }
        };

        // Theme toggle
        addClassListener('.theme-toggle', 'click', () => {
            this.toggleTheme();
        });

        // ==================== HAMBURGER MENU TOGGLE ====================
        // Hamburger menu button
        addIdListener('hamburger-menu', 'click', () => {
            const sidebar = document.getElementById('sidebar');
            const overlay = document.getElementById('sidebar-overlay');
            if (sidebar && overlay) {
                sidebar.classList.toggle('show');
                overlay.classList.toggle('show');
            }
        });

        // Close sidebar when overlay is clicked
        const sidebarOverlay = document.getElementById('sidebar-overlay');
        if (sidebarOverlay) {
            sidebarOverlay.addEventListener('click', () => {
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('sidebar-overlay');
                if (sidebar && overlay) {
                    sidebar.classList.remove('show');
                    overlay.classList.remove('show');
                }
            });
        }

        // Close sidebar when sidebar items are clicked (mobile)
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.addEventListener('click', (e) => {
                e.preventDefault();

                // Update active state
                document.querySelectorAll('.sidebar-item').forEach(i => i.classList.remove('active'));
                item.classList.add('active');

                const category = item.dataset.category;

                // Handle offline library and download buttons differently
                if (item.id === 'offline-library-btn') {
                    this.showOfflineLibraryModal();
                } else if (item.id === 'download-offline-link') {
                    // Download button logic already handled elsewhere
                } else if (category) {
                    this.loadCategoryNews(category);
                }

                // Close sidebar on mobile
                const sidebar = document.getElementById('sidebar');
                const overlay = document.getElementById('sidebar-overlay');
                if (window.innerWidth <= 768 && sidebar && overlay) {
                    sidebar.classList.remove('show');
                    overlay.classList.remove('show');
                }
            });
        });

        // ==================== END HAMBURGER MENU ====================

        // Bottom navigation category clicks (updated to use sidebar)
        // Note: Sidebar navigation is handled at the end of hamburger menu section above

        // For backward compatibility, also handle nav-item elements if they exist
        document.querySelectorAll('.nav-item').forEach(link => {
            link.addEventListener('click', (e) => {
                e.preventDefault();
                const category = e.currentTarget.dataset.category;
                if (category) {
                    this.setActiveCategory(category);
                    this.loadCategoryNews(category);
                }
            });
        });

        // Language change
        addIdListener('language-select', 'change', (e) => {
            this.currentLanguage = e.target.value;
            this.updateStats();
            this.loadCategoryNews(this.currentCategory);
        });

        // Search with debouncing
        addIdListener('search-btn', 'click', () => {
            this.performSearch();
        });

        addIdListener('search-input', 'keypress', (e) => {
            if (e.key === 'Enter') {
                this.performSearch();
            }
        });

        // Add improved debounced search input listener with duplicate prevention
        const searchInput = document.getElementById('search-input');
        if (searchInput) {
            let lastSearchQuery = '';
            searchInput.addEventListener('input', this.debounce((e) => {
                const query = e.target.value.trim();
                // Only search if query is 3+ chars AND different from last search
                if (query.length >= 3 && query !== lastSearchQuery) {
                    lastSearchQuery = query;
                    console.log(`[UI] Triggering auto-search for: "${query}"`);
                    // Perform auto-search directly
                    this.searchQuery = query;
                    this.currentPage = 1;
                    this.loadNews({
                        source: 'search',
                        query: query,
                        filters: this.filters,
                        pageNum: 1
                    });
                }
                // Reset last query if user clears the search
                else if (query.length === 0) {
                    lastSearchQuery = '';
                }
            }, 800)); // Increased debounce delay to prevent excessive API calls
        }

        // Advanced filters toggle
        addIdListener('advanced-toggle', 'click', () => {
            const filters = document.getElementById('advanced-filters');
            if (filters) {
                filters.classList.toggle('show');
            }
        });

        // Apply filters
        addIdListener('apply-filters', 'click', () => {
            this.applyFilters();
        });

        // Clear filters
        addIdListener('clear-filters', 'click', () => {
            this.clearFilters();
        });

        // Offline search toggle
        addIdListener('offline-search-toggle', 'click', () => {
            this.toggleOfflineSearch();
        });

        // Pagination
        addIdListener('prev-page', 'click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.loadNews({
                    source: this.currentCategory,
                    category: this.currentCategory,
                    query: this.searchQuery,
                    filters: this.filters,
                    pageNum: this.currentPage
                });
            }
        });

        addIdListener('next-page', 'click', () => {
            if (this.hasMorePages !== false) {
                this.currentPage++;
                this.loadNews({
                    source: this.currentCategory,
                    category: this.currentCategory,
                    query: this.searchQuery,
                    filters: this.filters,
                    pageNum: this.currentPage
                });
            }
        });

        // Historical search
        addIdListener('historical-search-btn', 'click', () => {
            this.performHistoricalSearch();
        });

        addIdListener('historical-search', 'keypress', (e) => {
            if (e.key === 'Enter') {
                this.performHistoricalSearch();
            }
        });

        // Refresh news
        addIdListener('refresh-news', 'click', (e) => {
            e.preventDefault();
            this.loadCategoryNews(this.currentCategory);
        });

        // Retry button
        addIdListener('retry-btn', 'click', () => {
            this.loadCategoryNews(this.currentCategory);
        });

        // Use offline articles button
        addIdListener('use-offline-btn', 'click', () => {
            this.loadOfflineArticles();
        });

        // API Key modal
        addIdListener('save-key-btn', 'click', () => {
            this.saveApiKey();
        });

        // News API key input - enable/disable fallback checkbox
        const newsApiKeyInput = document.getElementById('news-api-key-input');
        if (newsApiKeyInput) {
            newsApiKeyInput.addEventListener('input', () => {
                const hasNewsKey = newsApiKeyInput.value.trim().length > 0;
                const fallbackCheckbox = document.getElementById('enable-fallback');
                const fallbackStatusHint = document.getElementById('fallback-status-hint');

                if (hasNewsKey) {
                    fallbackCheckbox.disabled = false;
                    if (fallbackStatusHint) {
                        fallbackStatusHint.style.display = 'none';
                    }
                } else {
                    fallbackCheckbox.disabled = true;
                    fallbackCheckbox.checked = false;
                    if (fallbackStatusHint) {
                        fallbackStatusHint.style.display = 'block';
                    }
                }
            });
        }

        addIdListener('try-demo-btn', 'click', () => {
            this.useDemoMode();
        });

        // Reset API key
        addIdListener('reset-api-key', 'click', (e) => {
            e.preventDefault();
            this.resetApiKey();
        });

        // Close modals when clicking outside
        window.addEventListener('click', (e) => {
            const articleModal = document.getElementById('article-modal');
            const libraryModal = document.getElementById('offline-library-modal');
            const apiModal = document.getElementById('api-key-modal');

            if (e.target === articleModal) {
                this.hideArticleModal();
            }
            if (e.target === libraryModal) {
                this.hideOfflineLibraryModal();
            }
            if (e.target === apiModal) {
                this.hideApiKeyModal();
            }
        });

        // Modal close buttons
        addIdListener('modal-close', 'click', () => {
            this.hideArticleModal();
        });

        addIdListener('library-modal-close', 'click', () => {
            this.hideOfflineLibraryModal();
        });

        // Offline library button
        addIdListener('offline-library-btn', 'click', (e) => {
            e.preventDefault();
            this.showOfflineLibrary();
        });

        // Save for offline button in modal
        addIdListener('modal-save-offline', 'click', () => {
            this.saveCurrentArticleForOffline();
        });

        // Offline library controls
        addIdListener('sync-offline', 'click', () => {
            this.syncOfflineData();
        });

        addIdListener('clear-old-articles', 'click', () => {
            this.clearOldOfflineArticles();
        });

        addIdListener('export-library', 'click', () => {
            this.exportOfflineLibrary();
        });

        addIdListener('library-search-btn', 'click', () => {
            this.searchOfflineLibrary();
        });

        addIdListener('library-search', 'keypress', (e) => {
            if (e.key === 'Enter') {
                this.searchOfflineLibrary();
            }
        });

        // Storage manager
        addIdListener('storage-manager', 'click', (e) => {
            e.preventDefault();
            this.showOfflineLibrary();
        });

        // Download offline button (new location)
        addIdListener('download-offline-link', 'click', (e) => {
            e.preventDefault();
            this.downloadOfflineArticles();
        });

        // Load more button
        addIdListener('load-more-btn', 'click', () => {
            this.loadMoreArticles();
        });

        // PWA Install button
        addIdListener('install-btn', 'click', () => {
            this.installPWA();
        });

        // Listen for beforeinstallprompt event
        window.addEventListener('beforeinstallprompt', (e) => {
            this.deferredPrompt = e;
            this.showInstallButton();
        });

        // Listen for app installed event
        window.addEventListener('appinstalled', () => {
            console.log('App installed successfully');
            this.hideInstallButton();
            this.showToast('App installed successfully!', 'success');
            this.deferredPrompt = null;
        });
    }

    // ==================== SCROLL TO TOP ====================
    setupScrollToTop() {
        const scrollBtn = document.getElementById('scroll-top-btn');
        if (!scrollBtn) return;

        window.addEventListener('scroll', () => {
            if (window.scrollY > 500) {
                scrollBtn.classList.add('show');
            } else {
                scrollBtn.classList.remove('show');
            }
        });

        scrollBtn.addEventListener('click', () => {
            window.scrollTo({ top: 0, behavior: 'smooth' });
        });
    }

    // ==================== OFFLINE FEATURES ====================
    async toggleOfflineSearch() {
        const offlineSearchBtn = document.getElementById('offline-search-toggle');
        const searchInput = document.getElementById('search-input');

        if (offlineSearchBtn.classList.contains('active')) {
            // Switch to online search
            offlineSearchBtn.classList.remove('active');
            offlineSearchBtn.innerHTML = '<i class="fas fa-database"></i> Offline Search';
            searchInput.placeholder = 'Search for news, topics, or keywords...';
            this.showToast('Switched to online search', 'info');
        } else {
            // Switch to offline search
            offlineSearchBtn.classList.add('active');
            offlineSearchBtn.innerHTML = '<i class="fas fa-wifi"></i> Online Search';
            searchInput.placeholder = 'Search offline articles...';
            this.showToast('Switched to offline search', 'info');
        }
    }

    async saveCurrentArticleForOffline() {
        const modal = document.getElementById('article-modal');
        const articleId = modal.dataset.currentArticleId;

        if (!articleId) {
            this.showToast('No article selected', 'error');
            return;
        }

        // Find the article in current articles
        const article = this.articles.find(a => a.id === articleId);
        if (!article) {
            this.showToast('Article not found', 'error');
            return;
        }

        try {
            const saved = await this.offlineManager.saveArticleForOffline(article);
            if (saved) {
                // Update modal button
                const saveBtn = document.getElementById('modal-save-offline');
                if (saveBtn) {
                    saveBtn.innerHTML = '<i class="fas fa-check"></i> Saved Offline';
                    saveBtn.disabled = true;
                }

                // Show offline badge
                const offlineBadge = document.getElementById('modal-offline-badge');
                if (offlineBadge) {
                    offlineBadge.style.display = 'inline-flex';
                }
            }
        } catch (error) {
            console.error('Failed to save article for offline:', error);
        }
    }

    async showOfflineLibrary() {
        this.showOfflineLibraryModal();
        await this.loadOfflineLibrary();
    }

    async loadOfflineLibrary() {
        try {
            const articles = await this.offlineManager.getOfflineArticles(50);
            const stats = await this.offlineManager.updateStats();

            // Update library stats
            document.getElementById('library-total').textContent = stats.totalArticles || 0;
            document.getElementById('library-size').textContent =
                Math.round((stats.storageUsage || 0) / (1024 * 1024) * 100) / 100 + ' MB';
            document.getElementById('library-read').textContent = stats.readArticles || 0;
            document.getElementById('library-bookmarked').textContent = stats.bookmarkedArticles || 0;

            // Render articles
            this.renderOfflineLibraryArticles(articles);
        } catch (error) {
            console.error('Failed to load offline library:', error);
            this.showToast('Failed to load offline library', 'error');
        }
    }

    renderOfflineLibraryArticles(articles) {
        const container = document.getElementById('library-articles');
        if (!container) return;

        container.innerHTML = '';

        if (articles.length === 0) {
            container.innerHTML = `
                <div class="no-articles" style="text-align: center; padding: 40px 20px;">
                    <i class="fas fa-inbox" style="font-size: 48px; color: var(--text-secondary); margin-bottom: 15px;"></i>
                    <h3>No offline articles</h3>
                    <p>Save articles for offline reading to see them here.</p>
                </div>
            `;
            return;
        }

        articles.forEach(article => {
            const card = this.createOfflineLibraryCard(article);
            container.appendChild(card);
        });
    }

    createOfflineLibraryCard(article) {
            const card = document.createElement('div');
            card.className = 'offline-library-card';

            // Format date
            const date = new Date(article.published || article.savedDate);
            const formattedDate = date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });

            card.innerHTML = `
            <div class="offline-library-card-header">
                <h4 class="offline-library-card-title">${this.truncateText(article.title, 80)}</h4>
                <div class="offline-library-card-actions">
                    <button class="btn-icon" data-action="read" title="Read">
                        <i class="fas fa-book-open"></i>
                    </button>
                    <button class="btn-icon" data-action="delete" title="Remove">
                        <i class="fas fa-trash"></i>
                    </button>
                </div>
            </div>
            <div class="offline-library-card-body">
                <p class="offline-library-card-description">${this.truncateText(article.description || 'No description', 120)}</p>
                <div class="offline-library-card-meta">
                    <span class="offline-library-card-date">
                        <i class="far fa-clock"></i> ${formattedDate}
                    </span>
                    ${article.read ? '<span class="offline-library-card-read"><i class="fas fa-check"></i> Read</span>' : ''}
                    ${article.category && article.category[0] ? 
                        `<span class="offline-library-card-category">${article.category[0]}</span>` : ''}
                </div>
            </div>
        `;

        // Add event listeners
        card.querySelector('[data-action="read"]').addEventListener('click', () => {
            this.showArticleModal(article);
        });

        card.querySelector('[data-action="delete"]').addEventListener('click', () => {
            this.removeArticleFromOfflineLibrary(article.id);
        });

        return card;
    }

    async removeArticleFromOfflineLibrary(articleId) {
        if (!confirm('Remove this article from your offline library?')) {
            return;
        }

        try {
            // Delete the article from storage
            const deleted = await this.offlineManager.storage.deleteArticle(articleId);

            if (deleted) {
                // Update stats and refresh the library view
                await this.offlineManager.updateStats();
                await this.loadOfflineLibrary();

                this.showToast('Article removed from offline library', 'success');
            } else {
                this.showToast('Article not found', 'warning');
            }
        } catch (error) {
            console.error('Failed to remove article:', error);
            this.showToast('Failed to remove article', 'error');
        }
    }

    async searchOfflineLibrary() {
        const searchInput = document.getElementById('library-search');
        const query = searchInput ? searchInput.value.trim() : '';

        if (!query) {
            this.showToast('Please enter a search term', 'warning');
            return;
        }

        try {
            const articles = await this.offlineManager.searchOfflineArticles(query);
            this.renderOfflineLibraryArticles(articles);
            
            if (articles.length === 0) {
                this.showToast('No offline articles found', 'info');
            }
        } catch (error) {
            console.error('Failed to search offline library:', error);
            this.showToast('Failed to search offline library', 'error');
        }
    }

    async syncOfflineData() {
        this.showToast('Syncing offline data...', 'info');
        
        try {
            await this.offlineManager.syncPendingActions();
            await this.loadOfflineLibrary();
        } catch (error) {
            console.error('Sync failed:', error);
            this.showToast('Sync failed', 'error');
        }
    }

    async clearOldOfflineArticles() {
        const days = prompt('Clear articles older than how many days?', '30');
        if (!days || isNaN(days)) return;

        try {
            const deleted = await this.offlineManager.clearOldArticles(parseInt(days));
            await this.loadOfflineLibrary();
            
            if (deleted > 0) {
                this.showToast(`Cleared ${deleted} old articles`, 'success');
            } else {
                this.showToast('No old articles found', 'info');
            }
        } catch (error) {
            console.error('Failed to clear old articles:', error);
            this.showToast('Failed to clear old articles', 'error');
        }
    }

    async exportOfflineLibrary() {
        try {
            await this.offlineManager.exportLibrary();
        } catch (error) {
            console.error('Export failed:', error);
        }
    }

    async loadOfflineArticles() {
        this.currentPage = 1;
        this.searchQuery = '';

        await this.loadNews({
            source: 'offline',
            pageNum: 1
        });
    }

    showOfflineLibraryModal() {
        document.getElementById('offline-library-modal').classList.add('show');
    }

    hideOfflineLibraryModal() {
        document.getElementById('offline-library-modal').classList.remove('show');
    }

    createArticleCard(article) {
        const card = document.createElement('div');
        card.className = 'news-card';
        card.dataset.articleId = article.id;

        // Format date
        const date = new Date(article.published);
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });

        // Get domain from URL
        let domain = 'Unknown Source';
        try {
            if (article.url) {
                domain = new URL(article.url).hostname.replace('www.', '');
            }
        } catch (e) {
            console.log('Invalid URL:', article.url);
        }

        // Get first category or default
        let category = 'general';
        if (article.category) {
            if (Array.isArray(article.category)) {
                category = article.category.length > 0 ? article.category[0] : 'general';
            } else if (typeof article.category === 'string') {
                category = article.category;
            }
        }

        // Check if image is available
        const hasImage = article.image && article.image !== "None";

        // Check if article is available offline
        const isAvailableOffline = article.availableOffline || false;

        card.innerHTML = `
            <div class="news-image">
                ${hasImage ? 
                    `<img src="${article.image}" alt="${article.title}" loading="lazy">` : 
                    `<div class="no-image"><i class="fas fa-newspaper"></i></div>`
                }
                ${isAvailableOffline ? 
                    `<div class="offline-badge"><i class="fas fa-download"></i> Offline</div>` : ''
                }
            </div>
            <div class="news-content">
                <h3 class="news-title">${this.truncateText(article.title, 100)}</h3>
                <p class="news-description">${this.truncateText(article.description || 'No description available', 150)}</p>
                <div class="news-meta">
                    <div class="news-source">
                        <i class="fas fa-globe"></i>
                        <span>${domain}</span>
                    </div>
                    <div class="news-date">
                        <i class="far fa-clock"></i>
                        <span>${formattedDate}</span>
                    </div>
                    <span class="news-category">${category}</span>
                </div>
            </div>
        `;
        
        // Add click event to open modal
        card.addEventListener('click', () => {
            this.showArticleModal(article);
        });
        
        return card;
    }

    async showArticleModal(article) {
        // Set current article ID on modal for offline saving
        const modal = document.getElementById('article-modal');
        modal.dataset.currentArticleId = article.id;
        
        // Format date
        const date = new Date(article.published);
        const formattedDate = date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
        
        // Get domain from URL
        let domain = 'Unknown Source';
        try {
            if (article.url) {
                domain = new URL(article.url).hostname.replace('www.', '');
            }
        } catch (e) {
            console.log('Invalid URL:', article.url);
        }
        
        // Get categories
        const categories = article.category && article.category.length > 0 
            ? article.category.join(', ') 
            : 'General';
        
        // Check if article is available offline
        const offlineArticle = await this.offlineManager.getArticleWithOfflineStatus(article.id);
        const isAvailableOffline = offlineArticle ? offlineArticle.availableOffline : false;
        const isBookmarked = offlineArticle ? 
            await this.offlineManager.isArticleBookmarked(article.id) : false;
        const readingProgress = offlineArticle ? offlineArticle.progress : 0;
        
        // Update modal content
        document.getElementById('modal-title').textContent = article.title;
        document.getElementById('modal-source').innerHTML = `<i class="fas fa-globe"></i> ${domain}`;
        document.getElementById('modal-date').innerHTML = `<i class="far fa-clock"></i> ${formattedDate}`;
        document.getElementById('modal-author').innerHTML = article.author ? 
            `<i class="fas fa-user"></i> ${article.author}` : 
            `<i class="fas fa-user"></i> Unknown Author`;
        document.getElementById('modal-category').innerHTML = `<i class="fas fa-tag"></i> ${categories}`;
        
        // Update offline badge
        const offlineBadge = document.getElementById('modal-offline-badge');
        if (offlineBadge) {
            offlineBadge.style.display = isAvailableOffline ? 'inline-flex' : 'none';
        }
        
        // Update modal image
        const modalImage = document.getElementById('modal-image');
        if (article.image && article.image !== "None") {
            modalImage.src = article.image;
            modalImage.alt = article.title;
            modalImage.style.display = 'block';
        } else {
            modalImage.style.display = 'none';
        }
        
        document.getElementById('modal-description').textContent = 
            article.description || 'No description available for this article.';
        
        document.getElementById('modal-read-full').href = article.url;
        
        // Update bookmark button
        const bookmarkBtn = document.getElementById('modal-bookmark');
        if (bookmarkBtn) {
            bookmarkBtn.innerHTML = isBookmarked ? 
                `<i class="fas fa-bookmark"></i> Remove Bookmark` : 
                `<i class="far fa-bookmark"></i> Bookmark`;
            
            bookmarkBtn.onclick = () => this.toggleBookmark(article);
        }
        
        // Update save for offline button
        const saveOfflineBtn = document.getElementById('modal-save-offline');
        if (saveOfflineBtn) {
            if (isAvailableOffline) {
                saveOfflineBtn.innerHTML = '<i class="fas fa-check"></i> Saved Offline';
                saveOfflineBtn.disabled = true;
            } else {
                saveOfflineBtn.innerHTML = '<i class="far fa-save"></i> Save for Offline';
                saveOfflineBtn.disabled = false;
                saveOfflineBtn.onclick = () => this.saveCurrentArticleForOffline();
            }
        }
        
        // Update share button
        const shareBtn = document.getElementById('modal-share');
        if (shareBtn) {
            shareBtn.onclick = () => this.shareArticle(article);
        }
        
        // Update reading progress
        const progressContainer = document.getElementById('reading-progress');
        const progressFill = document.getElementById('progress-fill');
        const progressText = document.getElementById('progress-text');
        
        if (readingProgress > 0) {
            progressContainer.style.display = 'block';
            progressFill.style.width = readingProgress + '%';
            progressText.textContent = readingProgress + '% read';
        } else {
            progressContainer.style.display = 'none';
        }
        
        // Show modal
        document.getElementById('article-modal')?.classList.add('show');
        
        // Prefetch related articles in background
        this.offlineManager.prefetchRelatedArticles(article);
    }

    async toggleBookmark(article) {
        const result = await this.offlineManager.toggleBookmark(article);
        
        // Update modal button
        const bookmarkBtn = document.getElementById('modal-bookmark');
        if (bookmarkBtn) {
            bookmarkBtn.innerHTML = result.bookmarked ? 
                `<i class="fas fa-bookmark"></i> Remove Bookmark` : 
                `<i class="far fa-bookmark"></i> Bookmark`;
        }
    }

    async performSearch() {
        const searchInput = document.getElementById('search-input');
        const query = searchInput ? searchInput.value.trim() : '';

        if (!query) {
            this.showToast('Please enter a search term', 'warning');
            return;
        }

        this.searchQuery = query;
        this.currentPage = 1;

        await this.loadNews({
            source: 'search',
            query: query,
            filters: this.filters,
            pageNum: 1
        });
    }

    // Update the updateStats method to include offline stats
    async updateStats() {
        // Update offline stats via offline manager
        await this.offlineManager.updateStats();
        
        // Update existing stats
        const articleCount = document.getElementById('article-count');
        const lastUpdated = document.getElementById('last-updated');
        const currentLanguage = document.getElementById('current-language');
        
        if (articleCount) articleCount.textContent = this.articles.length;
        if (lastUpdated) lastUpdated.textContent = new Date().toLocaleTimeString([], { 
            hour: '2-digit', 
            minute: '2-digit' 
        });
        
        const languageNames = {
            'en': 'English',
            'es': 'Spanish',
            'fr': 'French',
            'de': 'German',
            'it': 'Italian',
            'pt': 'Portuguese'
        };
        
        if (currentLanguage) {
            currentLanguage.textContent = languageNames[this.currentLanguage] || this.currentLanguage;
        }
    }

    // Keep all your existing API methods, but add offline fallback
    async makeApiRequest(url) {
        if (!this.apiKey) {
            this.showApiKeyModal();
            throw new Error('API key required');
        }

        // Check if offline
        if (!navigator.onLine) {
            console.log('Offline mode: using cached data');
            
            // Try to get cached data
            const cachedData = await this.getCachedNews();
            if (cachedData.length > 0) {
                return { status: 'ok', news: cachedData };
            }
            
            // Try to get offline articles from IndexedDB
            const offlineArticles = await this.offlineManager.getOfflineArticles(20);
            if (offlineArticles.length > 0) {
                return { status: 'ok', news: offlineArticles };
            }
            
            throw new Error('You are offline and no cached data available');
        }

        try {
            const response = await fetch(url);

            if (!response.ok) {
                if (response.status === 401) {
                    // Invalid API key
                    localStorage.removeItem('currents_api_key');
                    this.apiKey = null;
                    this.showApiKeyModal();
                    this.showToast('Your API key is invalid. Please enter a new one.', 'error');
                    throw new Error('Invalid API key');
                }
                throw new Error(`API Error: ${response.status}`);
            }

            const data = await response.json();
            return data;
        } catch (error) {
            console.error('API request failed:', error);

            // Try cached data as fallback
            if (error.message !== 'You are offline and no cached data available') {
                const cachedData = await this.getCachedNews();
                if (cachedData.length > 0) {
                    this.showToast('Using cached data', 'warning');
                    return { status: 'ok', news: cachedData };
                }
            }

            throw error;
        }
    }

    // Add this method to check for cached news
    async getCachedNews() {
        // This would check the cache controller for cached API responses
        // For now, return empty array
        return [];
    }

    // Additional missing methods that are referenced elsewhere
    loadLatestNews() {
        this.loadCategoryNews('latest');
    }

    setActiveCategory(category) {
        this.currentCategory = category;
        
        // Remove active from nav items (old bottom nav, if present)
        document.querySelectorAll('.nav-item').forEach(link => {
            link.classList.remove('active');
        });
        
        // Remove active from sidebar items (new sidebar nav)
        document.querySelectorAll('.sidebar-item').forEach(item => {
            item.classList.remove('active');
        });
        
        // Set active on nav-item
        const activeNavElement = document.querySelector(`.nav-item[data-category="${category}"]`);
        if (activeNavElement) {
            activeNavElement.classList.add('active');
        }
        
        // Set active on sidebar-item
        const activeSidebarElement = document.querySelector(`.sidebar-item[data-category="${category}"]`);
        if (activeSidebarElement) {
            activeSidebarElement.classList.add('active');
        }
    }

    async loadCategoryNews(category) {
        this.currentCategory = category || 'latest';
        this.currentPage = 1;
        this.searchQuery = '';

        console.log(`[UI] Loading category: ${this.currentCategory}`);

        await this.loadNews({
            source: 'category',
            category: this.currentCategory,
            pageNum: 1
        });
    }

    async loadNews(params = {}, append = false) {
        if (this.isFetching) {
            console.log('[UI] Fetch already in progress, skipping duplicate request');
            return;
        }

        const {
            source = 'latest',
            category,
            query = null,
            filters = {},
            pageNum = 1
        } = params;

        this.isFetching = true;
        this.showLoading();

        try {
            let result;
            if ((category || this.currentCategory) === 'local') {
                console.log('[UI] Loading local news');
                const location = await geoService.detectUserLocation();
                if (location.error) {
                    console.warn('[UI] Location detection failed:', location.error);
                    const errorMessages = {
                        'permission_denied': 'Location permission denied. Showing world news instead.',
                        'position_unavailable': 'Location not available. Showing world news instead.',
                        'geolocation_not_supported': 'Geolocation not supported. Showing world news instead.',
                        'geolocation_timeout': 'Location detection timed out. Showing world news instead.',
                        'location_unavailable': 'Unable to detect location. Showing world news instead.'
                    };
                    const errorMsg = errorMessages[location.error] || 'Unable to detect location. Showing world news instead.';
                    this.showToast(errorMsg, 'warning');
                    result = await this.articleService.getArticles({
                        page: pageNum,
                        category: 'latest',
                        query: query,
                        filters: filters
                    });
                } else {
                    console.log('[UI] Location detected:', location.country, location.countryCode);
                    result = await this.articleService.getLocalNews(location);
                }
            } else {
                result = await this.articleService.getArticles({
                    page: pageNum,
                    category: category || this.currentCategory,
                    query: query,
                    filters: filters
                });
            }

            if (append) {
                this.articles = [...this.articles, ...result.articles];
            } else {
                this.articles = result.articles;
            }
            this.currentPage = pageNum;

            if (result.hasMore === false && result.totalResults !== undefined && result.totalResults > 0) {
                this.hasMorePages = false;
            } else {
                this.hasMorePages = true;
            }

            this.renderArticles(result.articles, append);
            this.hideLoading();
            this.updateStats();
            this.hideError();

            const sourceLabel = result.source === 'api' ? 'online' :
                result.source === 'cache' ? 'cached' :
                result.source === 'offline' ? 'offline' :
                result.source === 'search_api' ? 'search results' :
                result.source === 'search_cache' ? 'cached search' :
                result.source === 'search_offline' ? 'offline search' : 'articles';
            const locationLabel = (category || this.currentCategory) === 'local' && result.location ? ` (${result.location.country})` : '';
            const message = `Loaded ${result.articles.length} articles (${sourceLabel})${locationLabel}`;
            this.showToast(message, result.isCached ? 'warning' : 'success');

        } catch (error) {
            console.error('Failed to load news:', error);
            this.hideLoading();

            if (error.code === 'NO_API_KEY' || error.message.includes('API key not configured')) {
                this.showApiKeyModal();
                this.showError('Currents API key required. Please configure your API key to load articles.');
                this.isFetching = false;
                return;
            }

            if (this.articles && this.articles.length > 0) {
                this.showToast(`Network issue. Showing existing results.`, 'warning');
                this.isFetching = false;
                return;
            }

            this.showError(`Failed to load news: ${error.message}`);
        } finally {
            this.isFetching = false;
        }
    }

    buildApiUrl(category) {
        let url = `${this.baseUrl}/latest-news?language=${this.currentLanguage}`;
        
        // Add API key
        if (this.apiKey) {
            url += `&apiKey=${this.apiKey}`;
        }
        
        // Add category if not 'latest'
        if (category && category !== 'latest') {
            url += `&category=${encodeURIComponent(category)}`;
        }
        
        // Add date range for historical news
        if (this.filters.start_date && this.filters.end_date) {
            url += `&start_date=${this.filters.start_date}&end_date=${this.filters.end_date}`;
        }
        
        // Add other filters
        if (this.filters.domain) {
            url += `&domain=${encodeURIComponent(this.filters.domain)}`;
        }
        
        if (this.filters.keywords) {
            url += `&keywords=${encodeURIComponent(this.filters.keywords)}`;
        }
        
        return url;
    }

    // DEPRECATED: loadArticles() - No longer used with unified pagination
    // Kept for backward compatibility but replaced by direct loadNews() calls

    renderArticles(articles = null, append = false) {
        const container = document.getElementById('news-grid');
        if (!container) return;

        const articlesToRender = articles || this.articles;

        if (!append) {
            container.innerHTML = '';
        }

        if (articlesToRender.length === 0) {
            if (!append) {
                container.innerHTML = `
                    <div class="no-articles" style="text-align: center; padding: 40px 20px;">
                        <i class="fas fa-newspaper" style="font-size: 48px; color: var(--text-secondary); margin-bottom: 15px;"></i>
                        <h3>No articles found</h3>
                        <p>Try adjusting your search or filters.</p>
                    </div>
                `;
            }
            return;
        }

        // Display featured article on first page only
        if (!append && articlesToRender.length > 0 && this.currentPage === 1) {
            const featuredArticle = articlesToRender[0];
            this.displayFeaturedArticle(featuredArticle);
            
            // Render only remaining articles in grid (skip first one as it's featured)
            articlesToRender.slice(1).forEach(article => {
                const card = this.createArticleCard(article);
                container.appendChild(card);
            });
        } else {
            // Normal render for pagination or append mode
            articlesToRender.forEach(article => {
                const card = this.createArticleCard(article);
                container.appendChild(card);
            });
        }

        this.updatePagination();
    }

    displayFeaturedArticle(article) {
        const featuredSection = document.getElementById('featured-article');
        if (!featuredSection) return;

        const imageUrl = article.image || '';
        // Handle category - could be string or array from API
        let category = article.category || 'General';
        if (Array.isArray(category)) {
            category = category[0] || 'General';
        }
        if (typeof category !== 'string') {
            category = String(category);
        }
        const title = article.title || 'Untitled';
        const description = article.description || '';
        const source = article.source || 'Unknown Source';
        const date = article.published ? new Date(article.published).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '';

        // Set featured article content
        document.getElementById('featured-image').src = imageUrl;
        document.getElementById('featured-title').textContent = title;
        document.getElementById('featured-description').textContent = description;
        document.getElementById('featured-category').textContent = category.toUpperCase();
        document.getElementById('featured-source').textContent = source;
        document.getElementById('featured-date').textContent = date;

        // Make featured section clickable to open article modal
        featuredSection.style.display = 'block';
        featuredSection.onclick = () => {
            this.showArticleModal(article);
        };
    }

    // Clean pagination - shows Prev/Next buttons
    updatePagination() {
        const prevBtn = document.getElementById('prev-page');
        const nextBtn = document.getElementById('next-page');
        const loadMoreBtn = document.getElementById('load-more-btn');
        const pageInfo = document.getElementById('page-info');
        const currentPageEl = document.getElementById('current-page');

        if (!pageInfo) return;

        // Update current page display
        if (currentPageEl) currentPageEl.textContent = this.currentPage;

        // Handle Previous Button
        if (prevBtn) {
            prevBtn.style.display = 'none';
        }

        // Handle Next Button
        if (nextBtn) {
            nextBtn.style.display = 'none';
        }

        // Show Load More button
        if (loadMoreBtn) {
            loadMoreBtn.style.display = this.hasMorePages ? 'inline-flex' : 'none';
        }

        // Update page info text
        if (!this.hasMorePages) {
            pageInfo.innerHTML = `Page <span id="current-page">${this.currentPage}</span> • All articles loaded`;
        } else {
            pageInfo.innerHTML = `Page <span id="current-page">${this.currentPage}</span>`;
        }
    }

    updateDateFilters() {
        // This method needs to be implemented
        // Set up date filters UI
    }

    applyFilters() {
        // This method needs to be implemented
        console.log('Applying filters...');
    }

    clearFilters() {
        // This function needs to be implemented
        console.log('Clearing filters...');
    }

    showLoading() {
        document.getElementById('loading').style.display = 'flex';
    }

    hideLoading() {
        document.getElementById('loading').style.display = 'none';
    }

    showError(message) {
        document.getElementById('error-message').textContent = message;
        document.getElementById('error-container').style.display = 'block';
    }

    hideError() {
        const el = document.getElementById('error-container');
        if (el) el.style.display = 'none';
    }

    shareArticle(article) {
        const shareData = {
            title: article.title,
            text: article.description || 'Check out this article',
            url: article.url
        };

        // Check if Web Share API is supported and available
        if (navigator.share && navigator.canShare && navigator.canShare(shareData)) {
            try {
                navigator.share(shareData)
                    .then(() => {
                        this.showToast('Article shared successfully!', 'success');
                    })
                    .catch((error) => {
                        // User cancelled or error occurred
                        if (error.name !== 'AbortError') {
                            console.error('Share failed:', error);
                            this.showToast('Failed to share article', 'error');
                        }
                    });
            } catch (error) {
                console.error('Share API error:', error);
                this.fallbackShare(article);
            }
        } else {
            // Fallback to clipboard sharing
            this.fallbackShare(article);
        }
    }

    async fallbackShare(article) {
        try {
            const shareText = `${article.title}\n\n${article.description || 'Check out this article'}\n\n${article.url}`;

            // Try to copy to clipboard
            if (navigator.clipboard && navigator.clipboard.writeText) {
                await navigator.clipboard.writeText(shareText);
                this.showToast('Article link copied to clipboard!', 'success');
            } else {
                // Fallback for older browsers - use document.execCommand
                const textArea = document.createElement('textarea');
                textArea.value = shareText;
                textArea.style.position = 'fixed';
                textArea.style.left = '-999999px';
                textArea.style.top = '-999999px';
                document.body.appendChild(textArea);
                textArea.focus();
                textArea.select();

                const successful = document.execCommand('copy');
                document.body.removeChild(textArea);

                if (successful) {
                    this.showToast('Article link copied to clipboard!', 'success');
                } else {
                    this.showToast('Unable to copy to clipboard. Please copy the URL manually.', 'warning');
                }
            }
        } catch (error) {
            console.error('Fallback share failed:', error);
            this.showToast('Unable to share article. Please copy the URL manually.', 'error');
        }
    }

    installPWA() {
        if (this.deferredPrompt) {
            this.deferredPrompt.prompt();
            this.deferredPrompt.userChoice.then((choiceResult) => {
                if (choiceResult.outcome === 'accepted') {
                    this.showToast('PWA installed successfully!', 'success');
                }
                this.deferredPrompt = null;
                this.hideInstallButton();
            });
        }
    }

    saveApiKey() {
        const currentsApiKey = document.getElementById('api-key-input').value.trim();
        const newsApiKey = document.getElementById('news-api-key-input').value.trim();
        const saveChecked = document.getElementById('save-api-key').checked;
        const enableFallback = document.getElementById('enable-fallback').checked;

        // Currents API key is required
        if (!currentsApiKey) {
            this.showToast('Please enter a Currents API key (required)', 'error');
            return;
        }

        // Save keys if checkbox is checked
        if (saveChecked) {
            localStorage.setItem('currents_api_key', currentsApiKey);
            
            // Only save News API key if provided
            if (newsApiKey) {
                localStorage.setItem('news_api_key', newsApiKey);
                localStorage.setItem('enable_api_fallback', enableFallback ? 'true' : 'false');
            }
        }

        // Configure API clients
        this.setupAPIClient(currentsApiKey);
        if (newsApiKey) {
            this.setupNewsAPIClient(newsApiKey);
        }

        // Inform ArticleService about fallback status
        if (this.articleService) {
            this.articleService.setFallbackEnabled(enableFallback && newsApiKey);
        }

        this.hideApiKeyModal();
        this.loadLatestNews();
        
        const message = newsApiKey && enableFallback 
            ? 'API keys saved! Fallback enabled.' 
            : 'Currents API key saved successfully';
        this.showToast(message, 'success');
    }

    useDemoMode() {
        // This method needs to be implemented
        console.log('Using demo mode');
        this.hideApiKeyModal();
    }

    resetApiKey() {
        localStorage.removeItem('currents_api_key');
        this.apiKey = null;
        this.showToast('API key reset', 'info');
    }

    async performHistoricalSearch() {
        const searchInput = document.getElementById('historical-search');
        const startDateInput = document.getElementById('historical-start-date');
        const endDateInput = document.getElementById('historical-end-date');

        const query = searchInput ? searchInput.value.trim() : '';
        const startDate = startDateInput ? startDateInput.value : '';
        const endDate = endDateInput ? endDateInput.value : '';

        if (!query) {
            this.showToast('Please enter a search term for historical search', 'warning');
            return;
        }

        // Validate date range
        if (!startDate || !endDate) {
            this.showToast('Please set both start and end dates for historical search', 'warning');
            return;
        }

        // Validate date range
        const start = new Date(startDate);
        const end = new Date(endDate);
        const now = new Date();

        if (start > end) {
            this.showToast('Start date must be before end date', 'warning');
            return;
        }

        if (end > now) {
            this.showToast('End date cannot be in the future', 'warning');
            return;
        }

        // Check if date range is reasonable (not too broad)
        const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
        if (daysDiff > 365) {
            this.showToast('Date range cannot exceed 365 days for performance reasons', 'warning');
            return;
        }

        this.searchQuery = query;
        this.currentPage = 1;

        console.log(`Performing historical search for "${query}" from ${startDate} to ${endDate} (${daysDiff} days)`);

        // Show loading state
        this.showToast('Searching historical news...', 'info');

        await this.loadNews({
            source: 'search',
            query: query,
            filters: {
                start_date: startDate,
                end_date: endDate,
                category: '',
                domain: ''
            },
            pageNum: 1
        });
    }

    async fetchHistoricalNews(query, filters) {
        try {
            // Build historical search URL
            let url = `${this.baseUrl}/search?language=${this.currentLanguage}&keywords=${encodeURIComponent(query)}`;
            
            // Add API key
            if (this.apiKey) {
                url += `&apiKey=${this.apiKey}`;
            }
            
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
            
            console.log('Fetching historical news from:', url);
            
            // Make API request
            const data = await this.makeApiRequest(url);
            
            if (data && data.news) {
                return data.news;
            } else {
                throw new Error('No historical news data received');
            }
        } catch (error) {
            console.error('Failed to fetch historical news:', error);
            throw error;
        }
    }

    // Utility method for debouncing function calls
    debounce(func, delay) {
        let timeoutId;
        return function (...args) {
            clearTimeout(timeoutId);
            timeoutId = setTimeout(() => func.apply(this, args), delay);
        };
    }



    truncateText(text, limit) {
        if (text.length <= limit) return text;
        return text.slice(0, limit) + '...';
    }

    // ==================== LOAD MORE FUNCTIONALITY ====================
    async loadMoreArticles() {
        this.currentPage++;
        await this.loadNews({
            source: this.currentCategory,
            category: this.currentCategory,
            query: this.searchQuery,
            filters: this.filters,
            pageNum: this.currentPage
        }, true);
    }

    // ==================== DOWNLOAD OFFLINE ARTICLES ====================
    async downloadOfflineArticles() {
        try {
            const articlesPerPage = this.apiClient.pageSize || 30;
            // Get dynamic estimates
            const est15 = await this.offlineManager.storage.estimateDownloadSize(15, articlesPerPage);
            const est20 = await this.offlineManager.storage.estimateDownloadSize(20, articlesPerPage);

            // Prompt user for number of pages to download
            const pageCount = prompt(
                'How many pages would you like to download for offline reading?\n\n' +
                `Each page contains ~${articlesPerPage} articles.\n` +
                `Recommended: 15 pages (~${est15.sizeText})\n` +
                `Maximum: 20 pages (~${est20.sizeText})`,
                '15'
            );

            if (!pageCount || isNaN(pageCount)) {
                return;
            }

            const count = parseInt(pageCount);
            if (count < 1 || count > 20) {
                this.showToast('Please enter a number between 1 and 20', 'warning');
                return;
            }

            // Start manual download using ArticleService
            const result = await this.articleService.downloadForOffline({
                category: ['latest', 'world', 'politics'],
                pages: count
            });

            if (result.success) {
                this.showToast(`Downloaded ${result.downloadedPages} pages (${result.totalSizeMB.toFixed(1)} MB)`, 'success');
                // Refresh the current view to show downloaded articles
                await this.loadLatestNews();
            } else {
                this.showToast('Download failed', 'error');
            }

        } catch (error) {
            console.error('Download failed:', error);
            this.showToast('Download failed: ' + error.message, 'error');
        }
    }
}

// Initialize the application when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.newsApp = new CurrentsNewsApp();
});