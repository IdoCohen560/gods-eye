import { Router } from 'express';
import { cacheGet, cacheSet, cacheGetStale } from '../cache';

export const satelliteRouter = Router();

const CACHE_TTL = 3600_000; // 1 hour — TLE data doesn't change often

satelliteRouter.get('/', async (req, res) => {
  const group = (req.query.group as string) || 'stations';
  const cacheKey = `tle:${group}`;
  const cached = cacheGet(cacheKey);
  if (cached) {
    res.set('Content-Type', 'text/plain');
    return res.send(cached);
  }

  try {
    const upstream = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
      { headers: { 'User-Agent': 'GodsEye/1.0' } }
    );
    const data = await upstream.text();
    cacheSet(cacheKey, data, CACHE_TTL);
    res.set('Content-Type', 'text/plain');
    res.send(data);
  } catch {
    const stale = cacheGetStale(cacheKey);
    if (stale) { res.set('Content-Type', 'text/plain'); return res.send(stale); }
    res.status(502).send('Failed to fetch TLE data');
  }
});
