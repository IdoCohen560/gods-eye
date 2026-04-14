import type { Handler } from '@netlify/functions';

const GDELT_GEO_URL = 'https://api.gdeltproject.org/api/v2/geo/geo';
const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

const handler: Handler = async (event) => {
  try {
    const mode = event.queryStringParameters?.mode || 'geo';

    let url: string;

    if (mode === 'geo') {
      const params = new URLSearchParams({
        query: 'conflict OR violence OR attack OR bombing',
        format: 'GeoJSON',
        timespan: '24h',
        maxpoints: '500',
      });
      url = `${GDELT_GEO_URL}?${params}`;
    } else {
      const params = new URLSearchParams({
        query: 'conflict OR violence OR attack OR bombing OR shelling OR protest OR riot',
        mode: 'artlist',
        maxrecords: '250',
        format: 'json',
        sort: 'DateDesc',
      });
      url = `${GDELT_DOC_URL}?${params}`;
    }

    const res = await fetch(url);
    const data = await res.text();

    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=600',
      },
      body: data,
    };
  } catch {
    return {
      statusCode: 502,
      body: JSON.stringify({ error: 'Failed to fetch from GDELT' }),
    };
  }
};

export { handler };
