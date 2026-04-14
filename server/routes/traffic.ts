import { Router } from 'express';
import { cacheGet, cacheSet, cacheGetStale } from '../cache';

export const trafficRouter = Router();

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';
const CACHE_TTL = 600_000; // 10 minutes

trafficRouter.get('/', async (req, res) => {
  const query = req.query.data as string;
  if (!query) return res.status(400).json({ error: 'Missing query parameter' });

  const cacheKey = `traffic:${query.slice(0, 100)}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const upstream = await fetch(OVERPASS_URL, {
      method: 'POST',
      body: `data=${encodeURIComponent(query)}`,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    const data = await upstream.json();
    cacheSet(cacheKey, data, CACHE_TTL);
    res.json(data);
  } catch {
    const stale = cacheGetStale(cacheKey);
    if (stale) return res.json(stale);
    res.status(502).json({ error: 'Failed to fetch traffic data' });
  }
});
