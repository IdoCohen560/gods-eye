import { TRAFFIC_API } from '../config/constants';

export interface RoadSegment {
  id: number;
  coords: [number, number][]; // [lon, lat]
  type: string;
}

export async function fetchRoads(bounds: {
  south: number; west: number; north: number; east: number;
}): Promise<RoadSegment[]> {
  const bbox = `${bounds.south},${bounds.west},${bounds.north},${bounds.east}`;
  const query = `[out:json][timeout:25];way["highway"~"motorway|trunk|primary|secondary"](${bbox});out geom;`;

  const res = await fetch(`${TRAFFIC_API}?data=${encodeURIComponent(query)}`);
  if (!res.ok) throw new Error(`Overpass error: ${res.status}`);
  const data = await res.json();

  return data.elements
    .filter((el: any) => el.type === 'way' && el.geometry)
    .map((el: any): RoadSegment => ({
      id: el.id,
      coords: el.geometry.map((g: any) => [g.lon, g.lat]),
      type: el.tags?.highway || 'road',
    }));
}
