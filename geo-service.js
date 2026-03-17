/**
 * Geolocation Service
 * Handles user location detection via Geolocation API and reverse geocoding
 * Provides country code and caches location for 24 hours
 */

class GeoService {
    constructor() {
        this.locationCache = this.loadLocationCache();
        this.countryLanguageMap = this.initCountryLanguageMap();
    }

    /**
     * Detect user's location via Geolocation API
     * @returns {Promise<Object>} { latitude, longitude, country, countryCode, error }
     */
    async detectUserLocation() {
        // Check cache first
        if (this.locationCache && this.isLocationCacheValid()) {
            console.log('[GeoService] Using cached location:', this.locationCache);
            return {
                latitude: this.locationCache.latitude,
                longitude: this.locationCache.longitude,
                country: this.locationCache.country,
                countryCode: this.locationCache.countryCode,
                cached: true,
                error: null
            };
        }

        return new Promise((resolve) => {
            // Check if Geolocation API is supported
            if (!navigator.geolocation) {
                console.warn('[GeoService] Geolocation API not supported');
                resolve({
                    error: 'geolocation_not_supported',
                    latitude: null,
                    longitude: null,
                    country: null,
                    countryCode: null
                });
                return;
            }

            navigator.geolocation.getCurrentPosition(
                async(position) => {
                    const { latitude, longitude } = position.coords;
                    console.log('[GeoService] Geolocation detected:', { latitude, longitude });

                    try {
                        // Reverse geocode to get country
                        const geoData = await this.reverseGeocode(latitude, longitude);
                        if (geoData.error) {
                            resolve(geoData);
                            return;
                        }

                        // Cache the location
                        this.cacheLocation({
                            latitude,
                            longitude,
                            country: geoData.country,
                            countryCode: geoData.countryCode,
                            timestamp: Date.now()
                        });

                        resolve({
                            latitude,
                            longitude,
                            country: geoData.country,
                            countryCode: geoData.countryCode,
                            cached: false,
                            error: null
                        });
                    } catch (err) {
                        console.error('[GeoService] Error reverse geocoding:', err);
                        resolve({
                            error: 'reverse_geocode_failed',
                            latitude,
                            longitude,
                            country: null,
                            countryCode: null
                        });
                    }
                },
                (error) => {
                    console.warn('[GeoService] Geolocation permission denied:', error.code);
                    const errorMap = {
                        1: 'permission_denied', // User denied
                        2: 'position_unavailable', // Position unavailable
                        3: 'timeout', // Timeout
                        4: 'unknown_error' // Unknown error
                    };
                    resolve({
                        error: errorMap[error.code] || 'unknown_error',
                        latitude: null,
                        longitude: null,
                        country: null,
                        countryCode: null
                    });
                }, {
                    timeout: 10000, // 10 second timeout
                    enableHighAccuracy: false // Balance speed vs accuracy
                }
            );
        });
    }

    /**
     * Reverse geocode latitude/longitude to country using free API
     * @param {number} latitude
     * @param {number} longitude
     * @returns {Promise<Object>}
     */
    async reverseGeocode(latitude, longitude) {
        try {
            const response = await fetch(
                `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latitude}&lon=${longitude}`, { timeout: 5000 }
            );

            if (!response.ok) {
                console.warn('[GeoService] Reverse geocode API returned status:', response.status);
                return { error: 'reverse_geocode_failed' };
            }

            const data = await response.json();
            const address = data.address || {};
            const countryCodeRaw = address.country_code;
            const countryCode = countryCodeRaw ? countryCodeRaw.toUpperCase() : null;
            const country = address.country;

            if (!countryCode) {
                console.warn('[GeoService] Country code not found in response:', data);
                return { error: 'country_code_not_found' };
            }

            console.log('[GeoService] Reverse geocoded:', { country, countryCode });
            return { country, countryCode, error: null };
        } catch (err) {
            console.error('[GeoService] Reverse geocode error:', err);
            return { error: 'reverse_geocode_error', details: err.message };
        }
    }

    /**
     * Load cached location from localStorage
     * @returns {Object|null}
     */
    loadLocationCache() {
        try {
            const cached = localStorage.getItem('geo_location_cache');
            return cached ? JSON.parse(cached) : null;
        } catch (err) {
            console.error('[GeoService] Error loading cache:', err);
            return null;
        }
    }

    /**
     * Cache location in localStorage
     * @param {Object} locationData
     */
    cacheLocation(locationData) {
        try {
            localStorage.setItem('geo_location_cache', JSON.stringify(locationData));
            this.locationCache = locationData;
            console.log('[GeoService] Location cached');
        } catch (err) {
            console.error('[GeoService] Error caching location:', err);
        }
    }

    /**
     * Check if cached location is still valid (24 hours)
     * @returns {boolean}
     */
    isLocationCacheValid() {
        if (!this.locationCache || !this.locationCache.timestamp) {
            return false;
        }
        const cacheAgeHours = (Date.now() - this.locationCache.timestamp) / (1000 * 60 * 60);
        return cacheAgeHours < 24;
    }

    /**
     * Clear cached location (e.g., for testing or user reset)
     */
    clearCache() {
        try {
            localStorage.removeItem('geo_location_cache');
            this.locationCache = null;
            console.log('[GeoService] Cache cleared');
        } catch (err) {
            console.error('[GeoService] Error clearing cache:', err);
        }
    }

    /**
     * Map country code to news language
     * @param {string} countryCode - ISO 3166-1 alpha-2 country code
     * @returns {string} Language code for news API
     */
    getLanguageForCountry(countryCode) {
        if (!countryCode) return 'en';
        return this.countryLanguageMap[countryCode.toUpperCase()] || 'en';
    }

    /**
     * Initialize country to language mapping
     * Maps to Currents API supported languages: EN, ES, FR, DE, IT, PT
     * @returns {Object}
     */
    initCountryLanguageMap() {
        return {
            // Spanish speaking countries
            'ES': 'es',
            'MX': 'es',
            'AR': 'es',
            'CO': 'es',
            'PE': 'es',
            'VE': 'es',
            'CL': 'es',
            'EC': 'es',
            'BO': 'es',
            'PY': 'es',
            'UY': 'es',
            'CU': 'es',
            'DO': 'es',
            'GT': 'es',
            'HN': 'es',
            'SV': 'es',
            'NI': 'es',
            'CR': 'es',
            'PA': 'es',
            'BZ': 'es',
            'GQ': 'es',
            'PH': 'es',
            'EH': 'es',

            // French speaking countries
            'FR': 'fr',
            'CA': 'fr',
            'BE': 'fr',
            'CH': 'fr',
            'SN': 'fr',
            'CI': 'fr',
            'DJ': 'fr',
            'CM': 'fr',
            'CG': 'fr',
            'GA': 'fr',
            'BJ': 'fr',
            'BF': 'fr',
            'CD': 'fr',
            'TG': 'fr',
            'NE': 'fr',
            'ML': 'fr',
            'GN': 'fr',
            'MG': 'fr',
            'HT': 'fr',
            'LU': 'fr',
            'BW': 'fr',
            'RW': 'fr',
            'BI': 'fr',
            'KM': 'fr',
            'MU': 'fr',
            'SC': 'fr',
            'VG': 'fr',
            'BL': 'fr',
            'MF': 'fr',
            'RE': 'fr',
            'GP': 'fr',
            'MQ': 'fr',
            'YT': 'fr',

            // German speaking countries
            'DE': 'de',
            'AT': 'de',
            'CH': 'de',
            'LI': 'de',
            'LU': 'de',

            // Italian speaking countries
            'IT': 'it',
            'SM': 'it',
            'VA': 'it',

            // Portuguese speaking countries
            'PT': 'pt',
            'BR': 'pt',
            'AO': 'pt',
            'MZ': 'pt',
            'CV': 'pt',
            'ST': 'pt',
            'GW': 'pt',
            'TL': 'pt',
            'MO': 'pt',

            // English speaking countries (majority - default fallback)
            'US': 'en',
            'GB': 'en',
            'AU': 'en',
            'NZ': 'en',
            'ZA': 'en',
            'IN': 'en',
            'SG': 'en',
            'HK': 'en',
            'IE': 'en',
            'JM': 'en',
            'TT': 'en',
            'KE': 'en',
            'UG': 'en',
            'NG': 'en',
            'GH': 'en'
        };
    }
}

// Create global instance
const geoService = new GeoService();