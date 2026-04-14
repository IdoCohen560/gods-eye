import { USGS_API } from '../config/constants';

export interface Earthquake {
  id: string;
  magnitude: number;
  latitude: number;
  longitude: number;
  depth: number; // km
  place: string;
  time: number; // unix ms
  tsunami: boolean;
}

export async function fetchEarthquakes(): Promise<Earthquake[]> {
  const res = await fetch(USGS_API);
  if (!res.ok) throw new Error(`USGS API error: ${res.status}`);
  const data = await res.json();

  return data.features.map((f: any): Earthquake => ({
    id: f.id,
    magnitude: f.properties.mag,
    latitude: f.geometry.coordinates[1],
    longitude: f.geometry.coordinates[0],
    depth: f.geometry.coordinates[2],
    place: f.properties.place || 'Unknown',
    time: f.properties.time,
    tsunami: f.properties.tsunami === 1,
  }));
}
