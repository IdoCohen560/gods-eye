import { CONFLICTS_API } from '../config/constants';

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

// Known conflict zone coordinates for mapping GDELT articles to locations
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

function classifyEventType(title: string): string {
  if (/bomb|explo|shell|missile|strike|attack/i.test(title)) return 'Explosion/Remote violence';
  if (/protest|demonstrat|rally|march/i.test(title)) return 'Protests';
  if (/riot|unrest|clash/i.test(title)) return 'Riots';
  return 'Battles';
}

function inferLocation(title: string, country: string): { lat: number; lon: number } | null {
  const text = `${title} ${country}`.toLowerCase();
  for (const [zone, coords] of Object.entries(CONFLICT_ZONES)) {
    if (text.includes(zone.toLowerCase())) {
      // Add some randomness so dots don't stack exactly
      return {
        lat: coords.lat + (Math.random() - 0.5) * 2,
        lon: coords.lon + (Math.random() - 0.5) * 2,
      };
    }
  }
  return null;
}

export async function fetchConflicts(): Promise<ConflictEvent[]> {
  try {
    const res = await fetch(CONFLICTS_API);
    if (!res.ok) {
      console.warn(`GDELT proxy returned ${res.status}`);
      return [];
    }

    const text = await res.text();

    // Guard against non-JSON responses (rate limit messages, HTML errors)
    if (!text.startsWith('{') && !text.startsWith('[')) {
      console.warn('GDELT returned non-JSON response:', text.slice(0, 100));
      return [];
    }

    let data: any;
    try {
      data = JSON.parse(text);
    } catch (e) {
      console.warn('GDELT JSON parse failed:', text.slice(0, 100));
      return [];
    }

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
    console.error('GDELT fetch error:', err);
    return [];
  }
}
