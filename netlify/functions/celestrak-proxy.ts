import type { Handler } from '@netlify/functions';

const handler: Handler = async (event) => {
  const group = event.queryStringParameters?.group || 'stations';

  try {
    const res = await fetch(
      `https://celestrak.org/NORAD/elements/gp.php?GROUP=${group}&FORMAT=tle`,
      { headers: { 'User-Agent': 'GodsEye/1.0' } }
    );
    const data = await res.text();

    return {
      statusCode: res.status,
      headers: {
        'Content-Type': 'text/plain',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
      body: data,
    };
  } catch {
    return { statusCode: 502, body: 'Failed to fetch from CelesTrak' };
  }
};

export { handler };
