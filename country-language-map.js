/**
 * Country to Language Mapping
 * Maps ISO 3166-1 alpha-2 country codes to Currents API supported languages
 * Supported languages: EN (English), ES (Spanish), FR (French), DE (German), IT (Italian), PT (Portuguese)
 */

const COUNTRY_LANGUAGE_MAP = {
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
    'EH': 'es',

    // French speaking countries
    'FR': 'fr',
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
    'LI': 'de',

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
    'MO': 'pt'
};

/**
 * Get language code for a given country code
 * @param {string} countryCode - ISO 3166-1 alpha-2 country code
 * @returns {string} Language code (default: 'en' for English)
 */
function getLanguageForCountry(countryCode) {
    if (!countryCode) return 'en';
    return COUNTRY_LANGUAGE_MAP[countryCode.toUpperCase()] || 'en';
}

/**
 * Get friendly country name for display
 * @param {string} countryCode - ISO country code
 * @returns {string} Country name
 */
function getCountryName(countryCode) {
    const countryNames = {
        'US': 'United States',
        'GB': 'United Kingdom',
        'FR': 'France',
        'DE': 'Germany',
        'ES': 'Spain',
        'IT': 'Italy',
        'PT': 'Portugal',
        'BR': 'Brazil',
        'MX': 'Mexico',
        'CA': 'Canada',
        'AU': 'Australia',
        'NZ': 'New Zealand',
        'IN': 'India',
        'JP': 'Japan',
        'CN': 'China',
        'RU': 'Russia',
        'KR': 'South Korea',
        'SG': 'Singapore',
        'HK': 'Hong Kong',
        'ZA': 'South Africa',
        'NG': 'Nigeria',
        'EG': 'Egypt',
        'KE': 'Kenya',
        'AR': 'Argentina',
        'CL': 'Chile',
        'CO': 'Colombia',
        'PE': 'Peru',
        'SE': 'Sweden',
        'NO': 'Norway',
        'DK': 'Denmark',
        'NL': 'Netherlands',
        'BE': 'Belgium',
        'CH': 'Switzerland',
        'AT': 'Austria',
        'PH': 'Philippines',
        'TH': 'Thailand',
        'VN': 'Vietnam',
        'ID': 'Indonesia',
        'MY': 'Malaysia',
        'PK': 'Pakistan',
        'BD': 'Bangladesh',
        'GH': 'Ghana',
        'UG': 'Uganda',
        'TZ': 'Tanzania'
    };
    if (!countryCode) return 'Unknown';
    var upperCode = countryCode.toUpperCase();
    return countryNames[upperCode] || upperCode || 'Unknown';
}