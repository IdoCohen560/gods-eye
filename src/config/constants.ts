export const CESIUM_ION_TOKEN = import.meta.env.VITE_CESIUM_ION_TOKEN || '';
export const GOOGLE_MAPS_API_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

export const OPENSKY_API = '/.netlify/functions/opensky-proxy';
export const CELESTRAK_API = 'https://celestrak.org/NORAD/elements/gp.php';
export const GIBS_WMTS_URL = 'https://gibs.earthdata.nasa.gov/wmts/epsg4326/best/wmts.cgi';
export const NOMINATIM_URL = 'https://nominatim.openstreetmap.org/search';
export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export const FIRMS_MAP_KEY = import.meta.env.VITE_FIRMS_MAP_KEY || '';
export const AISSTREAM_API_KEY = import.meta.env.VITE_AISSTREAM_API_KEY || '';
export const ACLED_EMAIL = import.meta.env.VITE_ACLED_EMAIL || '';
export const ACLED_PASSWORD = import.meta.env.VITE_ACLED_PASSWORD || '';

export const AIRCRAFT_POLL_INTERVAL = 10_000;
export const SATELLITE_UPDATE_INTERVAL = 5_000;
export const TRAFFIC_PARTICLE_COUNT = 5_000;
