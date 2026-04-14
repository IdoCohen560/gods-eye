export const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || '';
export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

// Backend API base — Express server in dev, Netlify Functions in production
const EXPRESS_BASE = 'http://localhost:3001/api';
const NETLIFY_BASE = '/.netlify/functions';

// Auto-detect: if VITE_API_BASE is set, use it. Otherwise try Express in dev, Netlify in prod.
const API_BASE = import.meta.env.VITE_API_BASE
  || (import.meta.env.DEV ? EXPRESS_BASE : NETLIFY_BASE);

// API endpoints — work with both Express (/api/aircraft) and Netlify (/.netlify/functions/opensky-proxy)
export const OPENSKY_API = API_BASE === NETLIFY_BASE
  ? `${NETLIFY_BASE}/opensky-proxy`
  : `${API_BASE}/aircraft`;

export const CELESTRAK_API_BASE = API_BASE === NETLIFY_BASE
  ? `${NETLIFY_BASE}/celestrak-proxy`
  : `${API_BASE}/satellites`;

export const USGS_API = API_BASE === NETLIFY_BASE
  ? `${NETLIFY_BASE}/usgs-proxy`
  : `${API_BASE}/earthquakes`;

export const CONFLICTS_API = API_BASE === NETLIFY_BASE
  ? `${NETLIFY_BASE}/acled-proxy`
  : `${API_BASE}/conflicts`;

export const FIRMS_API = API_BASE === NETLIFY_BASE
  ? `${NETLIFY_BASE}/firms-proxy`
  : `${API_BASE}/firms`;

export const TRAFFIC_API = API_BASE === NETLIFY_BASE
  ? `${NETLIFY_BASE}/overpass-proxy`
  : `${API_BASE}/traffic`;

export const SHIPS_API = `${API_BASE}/ships`;

export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';

export const FIRMS_MAP_KEY = import.meta.env.VITE_FIRMS_MAP_KEY || '';
export const AISSTREAM_API_KEY = import.meta.env.VITE_AISSTREAM_API_KEY || '';
export const ACLED_EMAIL = import.meta.env.VITE_ACLED_EMAIL || '';
export const ACLED_PASSWORD = import.meta.env.VITE_ACLED_PASSWORD || '';

export const AIRCRAFT_POLL_INTERVAL = 10_000;
export const SATELLITE_UPDATE_INTERVAL = 5_000;
export const TRAFFIC_PARTICLE_COUNT = 5_000;

// Export for use in feeds
export const IS_EXPRESS_BACKEND = API_BASE !== NETLIFY_BASE;
