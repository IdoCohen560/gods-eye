import {
  twoline2satrec,
  propagate,
  gstime,
  eciToGeodetic,
  degreesLat,
  degreesLong,
} from 'satellite.js';
import type { SatRec } from 'satellite.js';
import { CELESTRAK_API_BASE } from '../config/constants';

export interface SatelliteRecord {
  name: string;
  noradId: number;
  tle1: string;
  tle2: string;
  category: 'station' | 'visual' | 'gps' | 'weather' | 'military' | 'starlink' | 'other';
}

export interface SatellitePosition {
  name: string;
  noradId: number;
  category: SatelliteRecord['category'];
  position: {
    latitude: number;
    longitude: number;
    altitude: number; // km
  } | null;
  orbitPath: { latitude: number; longitude: number; altitude: number }[];
}

const GROUPS: { name: string; category: SatelliteRecord['category']; limit?: number }[] = [
  { name: 'stations', category: 'station' },
  { name: 'visual', category: 'visual' },
  { name: 'gps-ops', category: 'gps' },
  { name: 'weather', category: 'weather' },
  { name: 'military', category: 'military' },
  { name: 'starlink', category: 'starlink', limit: 50 },
];

export async function fetchSatellites(): Promise<SatelliteRecord[]> {
  const results: SatelliteRecord[] = [];

  for (const group of GROUPS) {
    try {
      const res = await fetch(`${CELESTRAK_API_BASE}?group=${group.name}`);
      if (!res.ok) continue;
      const text = await res.text();
      const lines = text.trim().split('\n');
      let count = 0;

      for (let i = 0; i < lines.length - 2; i += 3) {
        if (group.limit && count >= group.limit) break;
        const name = lines[i].trim();
        const tle1 = lines[i + 1].trim();
        const tle2 = lines[i + 2].trim();
        if (!tle1.startsWith('1') || !tle2.startsWith('2')) continue;
        const noradMatch = tle2.match(/^2\s+(\d+)/);
        results.push({
          name,
          noradId: noradMatch ? parseInt(noradMatch[1]) : 0,
          tle1,
          tle2,
          category: group.category,
        });
        count++;
      }
    } catch (err) {
      console.warn(`Failed to fetch TLE group ${group.name}:`, err);
    }
  }

  return results;
}

export function computeOrbitPath(
  satrec: SatRec,
  date: Date,
  numPoints: number = 60,
  periodMinutes: number = 90,
): { latitude: number; longitude: number; altitude: number }[] {
  const path: { latitude: number; longitude: number; altitude: number }[] = [];
  const stepMs = (periodMinutes * 60_000) / numPoints;

  for (let i = 0; i < numPoints; i++) {
    const t = new Date(date.getTime() + i * stepMs);
    try {
      const gmst = gstime(t);
      const result = propagate(satrec, t);
      if (typeof result.position === 'boolean' || !result.position) continue;
      const geo = eciToGeodetic(result.position, gmst);
      path.push({
        latitude: degreesLat(geo.latitude),
        longitude: degreesLong(geo.longitude),
        altitude: geo.height,
      });
    } catch {
      // skip bad points
    }
  }
  return path;
}

export function propagateAll(sats: SatelliteRecord[], date: Date): SatellitePosition[] {
  const gmst = gstime(date);
  return sats.map(sat => {
    try {
      const satrec = twoline2satrec(sat.tle1, sat.tle2);
      const result = propagate(satrec, date);
      if (typeof result.position === 'boolean' || !result.position) {
        return { name: sat.name, noradId: sat.noradId, category: sat.category, position: null, orbitPath: [] };
      }
      const geodetic = eciToGeodetic(result.position, gmst);
      const position = {
        latitude: degreesLat(geodetic.latitude),
        longitude: degreesLong(geodetic.longitude),
        altitude: geodetic.height,
      };

      // Only compute orbit paths for non-Starlink (too many)
      const orbitPath = sat.category !== 'starlink'
        ? computeOrbitPath(satrec, date, 60, 90)
        : [];

      return { name: sat.name, noradId: sat.noradId, category: sat.category, position, orbitPath };
    } catch {
      return { name: sat.name, noradId: sat.noradId, category: sat.category, position: null, orbitPath: [] };
    }
  });
}
