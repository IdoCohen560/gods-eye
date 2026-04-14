import { Router } from 'express';
import { cacheGet, cacheSet, cacheGetStale } from '../cache';

export const firmsRouter = Router();

const CACHE_TTL = 300_000; // 5 minutes

firmsRouter.get('/', async (req, res) => {
  const mapKey = process.env.FIRMS_MAP_KEY || process.env.VITE_FIRMS_MAP_KEY;
  if (!mapKey) {
    return res.status(400).json({ error: 'FIRMS MAP_KEY not configured' });
  }

  const coords = (req.query.coords as string) || 'world';
  const cacheKey = `firms:${coords}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.set('Content-Type', 'text/csv');
    return res.send(cached);
  }

  try {
    const url = `https://firms.modaps.eosdis.nasa.gov/api/area/csv/${mapKey}/VIIRS_SNPP_NRT/${coords}/1`;
    const upstream = await fetch(url);
    const data = await upstream.text();
    cacheSet(cacheKey, data, CACHE_TTL);
    res.set('Content-Type', 'text/csv');
    res.send(data);
  } catch {
    const stale = cacheGetStale(cacheKey);
    if (stale) { res.set('Content-Type', 'text/csv'); return res.send(stale); }
    res.status(502).json({ error: 'Failed to fetch FIRMS data' });
  }
});
