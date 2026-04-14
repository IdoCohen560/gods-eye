import { Router } from 'express';
import { cacheGet, cacheSet, cacheGetStale } from '../cache';

export const aircraftRouter = Router();

const OPENSKY_URL = 'https://opensky-network.org/api/states/all';
const CACHE_TTL = 8_000; // 8s — slightly less than poll interval

aircraftRouter.get('/', async (req, res) => {
  const { lamin, lomin, lamax, lomax } = req.query;
  if (!lamin || !lomin || !lamax || !lomax) {
    return res.status(400).json({ error: 'Missing bounds parameters' });
  }

  const cacheKey = `aircraft:${lamin},${lomin},${lamax},${lomax}`;
  const cached = cacheGet(cacheKey);
  if (cached) return res.json(cached);

  try {
    const params = new URLSearchParams({
      lamin: String(lamin), lomin: String(lomin),
      lamax: String(lamax), lomax: String(lomax),
    });
    const url = `${OPENSKY_URL}?${params}`;

    const headers: Record<string, string> = {};
    const username = process.env.OPENSKY_USERNAME || process.env.VITE_OPENSKY_USERNAME;
    const password = process.env.OPENSKY_PASSWORD || process.env.VITE_OPENSKY_PASSWORD;
    if (username && password) {
      headers['Authorization'] = 'Basic ' +
        Buffer.from(`${username}:${password}`).toString('base64');
    }

    const upstream = await fetch(url, { headers });
    const data = await upstream.json();
    cacheSet(cacheKey, data, CACHE_TTL);
    res.json(data);
  } catch (err) {
    const stale = cacheGetStale(cacheKey);
    if (stale) return res.json(stale);
    res.status(502).json({ error: 'Failed to fetch aircraft', states: [] });
  }
});
