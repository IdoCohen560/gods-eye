import { FIRMS_API } from '../config/constants';

export interface FireHotspot {
  latitude: number;
  longitude: number;
  brightness: number;
  confidence: string;
  frp: number;
  daynight: string;
  acq_date: string;
  acq_time: string;
}

export async function fetchFIRMS(bounds?: {
  west: number; south: number; east: number; north: number;
}): Promise<FireHotspot[]> {
  try {
    const coords = bounds
      ? `${bounds.west},${bounds.south},${bounds.east},${bounds.north}`
      : 'world';

    const res = await fetch(`${FIRMS_API}?coords=${coords}`);
    if (!res.ok) return [];
    const text = await res.text();
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',');
    const latIdx = headers.indexOf('latitude');
    const lonIdx = headers.indexOf('longitude');
    const brightIdx = headers.indexOf('bright_ti4');
    const confIdx = headers.indexOf('confidence');
    const frpIdx = headers.indexOf('frp');
    const dnIdx = headers.indexOf('daynight');
    const dateIdx = headers.indexOf('acq_date');
    const timeIdx = headers.indexOf('acq_time');

    const hotspots: FireHotspot[] = [];
    for (let i = 1; i < Math.min(lines.length, 1001); i++) {
      const cols = lines[i].split(',');
      if (cols.length < headers.length) continue;
      hotspots.push({
        latitude: parseFloat(cols[latIdx]),
        longitude: parseFloat(cols[lonIdx]),
        brightness: parseFloat(cols[brightIdx]) || 0,
        confidence: cols[confIdx] || 'nominal',
        frp: parseFloat(cols[frpIdx]) || 0,
        daynight: cols[dnIdx] || 'D',
        acq_date: cols[dateIdx] || '',
        acq_time: cols[timeIdx] || '',
      });
    }
    return hotspots;
  } catch (err) {
    console.error('FIRMS fetch error:', err);
    return [];
  }
}
