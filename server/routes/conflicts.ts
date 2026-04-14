import { Router } from 'express';
import { cacheGet, cacheSet, cacheGetStale } from '../cache';

export const conflictRouter = Router();

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const CACHE_TTL = 600_000; // 10 minutes — GDELT rate-limits aggressively

conflictRouter.get('/', async (_req, res) => {
  const cached = cacheGet('conflicts');
  if (cached) return res.json(cached);

  try {
    const params = new URLSearchParams({
      query: 'conflict OR violence OR attack OR bombing OR shelling OR protest OR riot',
      mode: 'artlist',
      maxrecords: '250',
      format: 'json',
      sort: 'DateDesc',
    });

    const upstream = await fetch(`${GDELT_URL}?${params}`);
    const text = await upstream.text();

    // GDELT returns plain text error when rate-limited
    if (!text.startsWith('{') && !text.startsWith('[')) {
      const stale = cacheGetStale('conflicts');
      if (stale) return res.json(stale);
      return res.status(429).json({ error: 'GDELT rate limited', articles: [] });
    }

    const data = JSON.parse(text);
    cacheSet('conflicts', data, CACHE_TTL);
    res.json(data);
  } catch {
    const stale = cacheGetStale('conflicts');
    if (stale) return res.json(stale);
    res.status(502).json({ error: 'Failed to fetch conflicts', articles: [] });
  }
});
