// performance-optimizer.js - Performance Optimization System

class PerformanceOptimizer {
    constructor() {
        this.virtuallizer = null;
        this.bundleOptimizer = null;
        this.imageOptimizer = null;
        this.memoryManager = null;
        
        // Performance metrics
        this.metrics = {
            renderTime: 0,
            memoryUsage: 0,
            imageLoadTime: 0,
            scrollPerformance: 0,
            bundleSize: 0
        };
        
        // Configuration
        this.config = {
            virtualization: {
                itemHeight: 320, // Average height of news card
                buffer: 5,       // Number of items to render outside viewport
                threshold: 0.1   // Intersection Observer threshold
            },
            imageOptimization: {
                lazyLoad: true,
                placeholderColor: '#f0f0f0',
                quality: 0.8,
                progressive: true
            },
            memoryManagement: {
                maxArticles: 1000,
                cleanupInterval: 60000, // 1 minute
                memoryThreshold: 100 * 1024 * 1024 // 100MB
            }
        };
    }

    init() {
        this.virtuallizer = new Virtualizer(this.config.virtualization);
        this.bundleOptimizer = new BundleOptimizer();
        this.imageOptimizer = new ImageOptimizer(this.config.imageOptimization);
        this.memoryManager = new MemoryManager(this.config.memoryManagement);
        
        this.setupPerformanceMonitoring();
        this.setupOptimizations();
    }

    // ==================== PERFORMANCE MONITORING ====================

    setupPerformanceMonitoring() {
        // Setup performance monitoring
        this.setupMetricsCollection();
        this.setupPerformanceObserver();
    }

    setupOptimizations() {
        // Initialize all optimization systems
        this.virtuallizer.init();
        this.imageOptimizer.init();
        this.memoryManager.init();
    }

    setupMetricsCollection() {
        // Collect performance metrics
        setInterval(() => {
            this.collectMetrics();
        }, 5000);
    }

    setupPerformanceObserver() {
        if ('PerformanceObserver' in window) {
            const observer = new PerformanceObserver((list) => {
                list.getEntries().forEach((entry) => {
                    if (entry.entryType === 'navigation') {
                        this.metrics.renderTime = entry.loadEventEnd - entry.loadEventStart;
                    }
                });
            });
            observer.observe({ entryTypes: ['navigation'] });
        }
    }

    collectMetrics() {
        // Collect various performance metrics
        if (performance.memory) {
            this.metrics.memoryUsage = performance.memory.usedJSHeapSize;
        }
        
        // Measure scroll performance
        this.measureScrollPerformance();
        
        // Measure image loading
        this.measureImageLoadTime();
    }

    measureScrollPerformance() {
        let lastScrollTime = 0;
        let frameCount = 0;
        
        const measureScroll = () => {
            frameCount++;
            const now = performance.now();
            if (now - lastScrollTime >= 1000) {
                this.metrics.scrollPerformance = frameCount;
                frameCount = 0;
                lastScrollTime = now;
            }
            requestAnimationFrame(measureScroll);
        };
        
        window.addEventListener('scroll', () => {
            requestAnimationFrame(measureScroll);
        });
    }

    measureImageLoadTime() {
        const images = document.querySelectorAll('img');
        let loadedCount = 0;
        let totalTime = 0;
        
        images.forEach(img => {
            const startTime = performance.now();
            img.onload = () => {
                loadedCount++;
                totalTime += performance.now() - startTime;
                this.metrics.imageLoadTime = totalTime / loadedCount;
            };
        });
    }
}

// Virtualizer class (standalone)
class Virtualizer {
    constructor(config) {
        this.config = config;
        this.container = null;
        this.items = [];
        this.visibleRange = { start: 0, end: 0 };
        this.observer = null;
        this.isVirtualizing = false;
    }

    init(container, items) {
        this.container = container;
        this.items = items;
        this.visibleRange = { start: 0, end: Math.ceil(container.clientHeight / this.config.itemHeight) + this.config.buffer };
        
        this.setupObserver();
        this.renderVisibleItems();
        this.setupScrollHandler();
    }

    setupObserver() {
        this.observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadItem(entry.target);
                } else {
                    this.unloadItem(entry.target);
                }
            });
        }, {
            root: null,
            rootMargin: `${this.config.itemHeight * this.config.buffer}px`,
            threshold: this.config.threshold
        });
    }

    setupScrollHandler() {
        let ticking = false;
        
        this.container.addEventListener('scroll', () => {
            if (!ticking) {
                requestAnimationFrame(() => {
                    this.updateVisibleRange();
                    ticking = false;
                });
                ticking = true;
            }
        });
    }

    updateVisibleRange() {
        const scrollTop = this.container.scrollTop;
        const containerHeight = this.container.clientHeight;
        const start = Math.max(0, Math.floor(scrollTop / this.config.itemHeight) - this.config.buffer);
        const end = Math.min(this.items.length, Math.ceil((scrollTop + containerHeight) / this.config.itemHeight) + this.config.buffer);
        
        if (start !== this.visibleRange.start || end !== this.visibleRange.end) {
            this.visibleRange = { start, end };
            this.renderVisibleItems();
        }
    }

    renderVisibleItems() {
        // Clear existing items
        this.container.innerHTML = '';
        
        // Create and append visible items
        for (let i = this.visibleRange.start; i < this.visibleRange.end; i++) {
            const item = this.createVirtualItem(this.items[i], i);
            this.container.appendChild(item);
        }
    }

    createVirtualItem(data, index) {
        const item = document.createElement('div');
        item.className = 'virtual-item';
        item.style.height = `${this.config.itemHeight}px`;
        item.style.top = `${index * this.config.itemHeight}px`;
        item.dataset.index = index;
        
        // Create content placeholder
        const content = document.createElement('div');
        content.className = 'virtual-item-content';
        content.innerHTML = this.createItemContent(data);
        
        item.appendChild(content);
        return item;
    }

    createItemContent(data) {
        // Create optimized HTML for news card
        return `
            <div class="news-card virtual-card">
                <div class="news-image">
                    <img src="${this.getPlaceholder()}" 
                         data-src="${data.image}" 
                         alt="${data.title}"
                         loading="lazy"
                         class="lazy-image">
                </div>
                <div class="news-content">
                    <h3 class="news-title">${this.truncateText(data.title, 80)}</h3>
                    <p class="news-description">${this.truncateText(data.description, 120)}</p>
                    <div class="news-meta">
                        <span class="news-source">${data.source}</span>
                        <span class="news-date">${this.formatDate(data.published)}</span>
                        <span class="news-category">${data.category}</span>
                    </div>
                </div>
            </div>
        `;
    }

    loadItem(element) {
        const img = element.querySelector('.lazy-image');
        if (img && img.dataset.src) {
            img.src = img.dataset.src;
            img.classList.remove('lazy-image');
        }
    }

    unloadItem(element) {
        const img = element.querySelector('img');
        if (img && !img.classList.contains('lazy-image')) {
            img.dataset.src = img.src;
            img.src = this.getPlaceholder();
            img.classList.add('lazy-image');
        }
    }

    truncateText(text, maxLength) {
        if (!text) return '';
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    formatDate(dateString) {
        const date = new Date(dateString);
        return date.toLocaleDateString();
    }

    getPlaceholder() {
        // Create a simple placeholder
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 250;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = '#f0f0f0';
        ctx.fillRect(0, 0, 400, 250);
        ctx.fillStyle = '#ccc';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Loading...', 200, 130);
        return canvas.toDataURL();
    }
}

// ImageOptimizer class (standalone)
class ImageOptimizer {
    constructor(config) {
        this.config = config;
        this.lazyLoader = null;
        this.placeholderCache = new Map();
    }

    init() {
        if (this.config.lazyLoad) {
            this.setupLazyLoading();
        }
    }

    setupLazyLoading() {
        this.lazyLoader = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting) {
                    this.loadImage(entry.target);
                    this.lazyLoader.unobserve(entry.target);
                }
            });
        }, {
            rootMargin: '50px 0px',
            threshold: 0.01
        });
    }

    loadImage(imgElement) {
        const originalSrc = imgElement.dataset.src;
        if (!originalSrc) return;

        // Create optimized image URL
        const optimizedSrc = this.getOptimizedImageUrl(originalSrc);
        
        const img = new Image();
        img.onload = () => {
            imgElement.src = optimizedSrc;
            imgElement.classList.add('loaded');
        };
        img.src = optimizedSrc;
    }

    getOptimizedImageUrl(originalUrl) {
        if (!originalUrl || originalUrl === "None") {
            return this.getPlaceholder();
        }

        // Add optimization parameters to image URL
        try {
            const url = new URL(originalUrl);
            url.searchParams.set('w', '400');
            url.searchParams.set('q', Math.floor(this.config.quality * 100));
            url.searchParams.set('auto', 'format');
            return url.toString();
        } catch (error) {
            return originalUrl;
        }
    }

    getPlaceholder() {
        if (this.placeholderCache.has('default')) {
            return this.placeholderCache.get('default');
        }

        const placeholder = this.createPlaceholder(this.config.placeholderColor);
        this.placeholderCache.set('default', placeholder);
        return placeholder;
    }

    createPlaceholder(color) {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 250;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, 400, 250);
        ctx.fillStyle = '#ccc';
        ctx.font = '14px Arial';
        ctx.textAlign = 'center';
        ctx.fillText('Loading...', 200, 130);
        return canvas.toDataURL();
    }

    preloadCriticalImages() {
        const criticalImages = document.querySelectorAll('.news-card .news-image img');
        criticalImages.forEach(img => {
            if (img.dataset.src) {
                this.preloadImage(img.dataset.src);
            }
        });
    }

    preloadImage(url) {
        const link = document.createElement('link');
        link.rel = 'preload';
        link.as = 'image';
        link.href = this.getOptimizedImageUrl(url);
        document.head.appendChild(link);
    }
}

// BundleOptimizer class (standalone)
class BundleOptimizer {
    constructor() {
        this.chunkSizes = new Map();
        this.loadedModules = new Set();
    }

    async optimizeBundle() {
        // Dynamic import for non-critical modules
        this.setupDynamicImports();
        
        // Code splitting for different features
        this.setupCodeSplitting();
        
        // Tree shaking optimization
        this.optimizeTreeShaking();
    }

    setupDynamicImports() {
        // Example: Dynamically import heavy modules when needed
        const heavyModules = {
            'chart': () => import('./analytics-charts.js'),
            'editor': () => import('./text-editor.js'),
            'pdf': () => import('./pdf-generator.js')
        };

        window.loadModule = async (moduleName) => {
            if (this.loadedModules.has(moduleName)) {
                return true;
            }

            try {
                const module = await heavyModules[moduleName]();
                this.loadedModules.add(moduleName);
                return module;
            } catch (error) {
                console.error(`Failed to load module ${moduleName}:`, error);
                return null;
            }
        };
    }

    setupCodeSplitting() {
        // Split code based on routes/features
        const routeMap = {
            '/': ['core', 'news'],
            '/offline': ['offline', 'storage'],
            '/analytics': ['analytics', 'charts'],
            '/settings': ['settings', 'preferences']
        };

        // Implement route-based loading
        window.addEventListener('hashchange', () => {
            this.loadRouteModules(window.location.hash);
        });

        // Load initial route
        this.loadRouteModules(window.location.hash || '/');
    }

    async loadRouteModules(route) {
        const modules = routeMap[route] || ['core'];
        const loadPromises = modules.map(module => this.loadModule(module));
        await Promise.all(loadPromises);
    }

    optimizeTreeShaking() {
        // Remove unused CSS
        this.removeUnusedCSS();
        
        // Minimize JavaScript
        this.minimizeJavaScript();
    }

    removeUnusedCSS() {
        // This would typically be done during build time
        // But we can implement runtime CSS optimization
        const styleSheets = Array.from(document.styleSheets);
        styleSheets.forEach(sheet => {
            try {
                const rules = Array.from(sheet.cssRules || sheet.rules);
                rules.forEach(rule => {
                    if (rule.selectorText && !document.querySelector(rule.selectorText)) {
                        sheet.deleteRule(rule);
                    }
                });
            } catch (error) {
                // Cross-origin stylesheets can't be accessed
            }
        });
    }

    minimizeJavaScript() {
        // Remove unused event listeners
        this.removeUnusedEventListeners();
        
        // Clear unused variables
        this.clearUnusedVariables();
    }

    removeUnusedEventListeners() {
        // This is a simplified example
        // In practice, you'd track all event listeners
        const elements = document.querySelectorAll('*');
        elements.forEach(element => {
            if (element.hasAttribute('data-unused')) {
                element.remove();
            }
        });
    }

    clearUnusedVariables() {
        // Clear global variables that are no longer needed
        if (window.tempData) {
            window.tempData = null;
        }
    }
}

// MemoryManager class (standalone)
class MemoryManager {
    constructor(config) {
        this.config = config;
        this.memoryUsage = 0;
        this.cleanupTimer = null;
    }

    init() {
        this.startMonitoring();
        this.setupCleanupTimer();
    }

    startMonitoring() {
        setInterval(() => {
            this.measureMemoryUsage();
            if (this.memoryUsage > this.config.memoryThreshold) {
                this.performCleanup();
            }
        }, 10000); // Check every 10 seconds
    }

    setupCleanupTimer() {
        this.cleanupTimer = setInterval(() => {
            this.performCleanup();
        }, this.config.cleanupInterval);
    }

    measureMemoryUsage() {
        if (performance.memory) {
            this.memoryUsage = performance.memory.usedJSHeapSize;
        }
    }

    performCleanup() {
        console.log('[MemoryManager] Performing cleanup...');
        
        // Clear unused images
        this.clearUnusedImages();
        
        // Clear unused cache
        this.clearUnusedCache();
        
        // Force garbage collection hint
        if (window.gc) {
            try {
                window.gc();
            } catch (error) {
                // GC might not be available
            }
        }
    }

    clearUnusedImages() {
        const images = document.querySelectorAll('img');
        let clearedCount = 0;
        
        images.forEach(img => {
            if (img.dataset.src && !this.isImageInViewport(img)) {
                img.src = '';
                clearedCount++;
            }
        });
        
        console.log(`[MemoryManager] Cleared ${clearedCount} unused images`);
    }

    clearUnusedCache() {
        // Clear localStorage cache if it's too large
        try {
            const cacheSize = JSON.stringify(localStorage).length;
            if (cacheSize > 10 * 1024 * 1024) { // 10MB
                // Clear old cache entries
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith('cache_')) {
                        localStorage.removeItem(key);
                    }
                });
                console.log('[MemoryManager] Cleared cache entries');
            }
        } catch (error) {
            console.warn('[MemoryManager] Failed to clear cache:', error);
        }
    }

    isImageInViewport(element) {
        const rect = element.getBoundingClientRect();
        return (
            rect.top >= 0 &&
            rect.left >= 0 &&
            rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
            rect.right <= (window.innerWidth || document.documentElement.clientWidth)
        );
    }
}

// Export for use in other modules
window.PerformanceOptimizer = PerformanceOptimizer;
window.Virtualizer = Virtualizer;
window.ImageOptimizer = ImageOptimizer;
window.BundleOptimizer = BundleOptimizer;
window.MemoryManager = MemoryManager;