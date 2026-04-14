export interface ConflictEvent {
  id: string;
  event_type: string;
  title: string;
  latitude: number;
  longitude: number;
  country: string;
  location: string;
  date: string;
  url: string;
  source: string;
}

// ---------------------------------------------------------------------------
// Event type classification from title text
// ---------------------------------------------------------------------------

function classifyEventType(title: string): string {
  if (/bomb|explo|shell|missile|strike|attack/i.test(title)) return 'Explosion/Remote violence';
  if (/protest|demonstrat|rally|march/i.test(title)) return 'Protests';
  if (/riot|unrest|clash/i.test(title)) return 'Riots';
  return 'Battles';
}

// ---------------------------------------------------------------------------
// PRIMARY: GDELT GeoJSON API — returns real coordinates
// ---------------------------------------------------------------------------

interface GeoJSONFeature {
  type: string;
  geometry?: { type: string; coordinates?: number[] };
  properties?: { name?: string; urlcount?: number; url?: string; html?: string };
}

interface GeoJSONResponse {
  type: string;
  features?: GeoJSONFeature[];
}

async function fetchGeoJSON(): Promise<ConflictEvent[] | null> {
  try {
    const res = await fetch('/.netlify/functions/acled-proxy?mode=geo');
    if (!res.ok) return null;

    const data: GeoJSONResponse = await res.json();

    if (!data.features || !Array.isArray(data.features) || data.features.length === 0) {
      return null;
    }

    const events: ConflictEvent[] = [];

    for (const feature of data.features) {
      const coords = feature.geometry?.coordinates;
      if (!coords || coords.length < 2) continue;

      const lon = coords[0];
      const lat = coords[1];

      // Sanity-check coordinates
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      if (lat < -90 || lat > 90 || lon < -180 || lon > 180) continue;

      const name = feature.properties?.name || '';
      const eventUrl = feature.properties?.url || '';

      let source = '';
      if (eventUrl) {
        try { source = new URL(eventUrl).hostname; } catch { /* skip */ }
      }

      events.push({
        id: eventUrl || `geo-${lat}-${lon}-${events.length}`,
        event_type: classifyEventType(name),
        title: name,
        latitude: lat,
        longitude: lon,
        country: '',
        location: name,
        date: new Date().toISOString(),
        url: eventUrl,
        source,
      });
    }

    return events.length > 0 ? events : null;
  } catch (err) {
    console.warn('GDELT GeoJSON fetch failed, will fall back to doc API:', err);
    return null;
  }
}

// ---------------------------------------------------------------------------
// FALLBACK: GDELT Doc API + inferLocation (original approach)
// ---------------------------------------------------------------------------

const CONFLICT_ZONES: Record<string, { lat: number; lon: number }> = {
  'Ukraine': { lat: 48.3794, lon: 31.1656 },
  'Russia': { lat: 55.7558, lon: 37.6173 },
  'Israel': { lat: 31.0461, lon: 34.8516 },
  'Palestine': { lat: 31.9522, lon: 35.2332 },
  'Gaza': { lat: 31.3547, lon: 34.3088 },
  'Sudan': { lat: 15.5007, lon: 32.5599 },
  'Syria': { lat: 34.8021, lon: 38.9968 },
  'Yemen': { lat: 15.3694, lon: 44.1910 },
  'Myanmar': { lat: 19.7633, lon: 96.0785 },
  'Somalia': { lat: 5.1521, lon: 46.1996 },
  'Iraq': { lat: 33.3152, lon: 44.3661 },
  'Afghanistan': { lat: 34.5553, lon: 69.2075 },
  'Libya': { lat: 32.8872, lon: 13.1913 },
  'Ethiopia': { lat: 9.0250, lon: 38.7469 },
  'Congo': { lat: -4.4419, lon: 15.2663 },
  'Nigeria': { lat: 9.0579, lon: 7.4951 },
  'Pakistan': { lat: 33.6844, lon: 73.0479 },
  'Lebanon': { lat: 33.8547, lon: 35.8623 },
  'Iran': { lat: 35.6892, lon: 51.3890 },
  'Mexico': { lat: 19.4326, lon: -99.1332 },
  'Colombia': { lat: 4.7110, lon: -74.0721 },
};

function inferLocation(title: string, country: string): { lat: number; lon: number } | null {
  const text = `${title} ${country}`.toLowerCase();
  for (const [zone, coords] of Object.entries(CONFLICT_ZONES)) {
    if (text.includes(zone.toLowerCase())) {
      return {
        lat: coords.lat + (Math.random() - 0.5) * 2,
        lon: coords.lon + (Math.random() - 0.5) * 2,
      };
    }
  }
  return null;
}

async function fetchDocFallback(): Promise<ConflictEvent[]> {
  try {
    const res = await fetch('/.netlify/functions/acled-proxy?mode=doc');
    if (!res.ok) return [];
    const data = await res.json();

    if (!data.articles) return [];

    const events: ConflictEvent[] = [];

    for (const article of data.articles) {
      const title = article.title || '';
      const country = article.sourcecountry || '';
      const location = inferLocation(title, country);
      if (!location) continue;

      events.push({
        id: article.url || `${location.lat}-${location.lon}-${Date.now()}`,
        event_type: classifyEventType(title),
        title,
        latitude: location.lat,
        longitude: location.lon,
        country,
        location: country,
        date: article.seendate || '',
        url: article.url || '',
        source: article.domain || '',
      });
    }

    return events;
  } catch (err) {
    console.error('GDELT doc fallback fetch error:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Public entry point — tries GeoJSON first, falls back to doc API
// ---------------------------------------------------------------------------

export async function fetchConflicts(): Promise<ConflictEvent[]> {
  const geoEvents = await fetchGeoJSON();
  if (geoEvents) return geoEvents;

  return fetchDocFallback();
}
