import { Router } from 'express';
import { cacheGet, cacheSet, cacheGetStale } from '../cache';

export const earthquakeRouter = Router();

const USGS_URL = 'https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/all_day.geojson';
const CACHE_TTL = 60_000; // 1 minute

earthquakeRouter.get('/', async (_req, res) => {
  const cached = cacheGet('earthquakes');
  if (cached) return res.json(cached);

  try {
    const upstream = await fetch(USGS_URL);
    const data = await upstream.json();
    cacheSet('earthquakes', data, CACHE_TTL);
    res.json(data);
  } catch {
    const stale = cacheGetStale('earthquakes');
    if (stale) return res.json(stale);
    res.status(502).json({ error: 'Failed to fetch earthquakes' });
  }
});
