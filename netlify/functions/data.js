// netlify/functions/data.js
// Secure API endpoint — all data and model logic runs here, never in the browser

const { getSummary, projectSeats, getTopByRace } = require('../../src/utils/model');

const ALLOWED_ORIGINS = [
  process.env.ALLOWED_ORIGIN,
  'http://localhost:3000',
  'http://localhost:8888',
].filter(Boolean);

function corsHeaders(origin) {
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allowed || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-API-Key',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
  };
}

function validateParams(body) {
  const scen = ['base', 'best', 'worst'].includes(body.scen) ? body.scen : 'base';
  const clamp = (v, min, max, def) => {
    const n = parseInt(v);
    return isNaN(n) ? def : Math.max(min, Math.min(max, n));
  };
  return {
    scen,
    yT:  clamp(body.yT,  40, 95, 72),
    sT:  clamp(body.sT,  50, 95, 78),
    mS:  clamp(body.mS,   0, 100, 48),
    cS:  clamp(body.cS,   0, 100, 78),
    iS:  clamp(body.iS,   0, 100, 68),
    lS:  clamp(body.lS,   0, 100, 45),
  };
}

exports.handler = async (event) => {
  const origin = event.headers.origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey = event.headers['x-api-key'] || '';
  const expectedKey = process.env.API_SECRET_KEY;
  if (expectedKey && apiKey !== expectedKey) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action = 'summary', filters = {}, page = 1, pageSize = 25 } = body;
  const params = validateParams(body);

  try {
    let payload;

    if (action === 'summary') {
      payload = getSummary(params);

    } else if (action === 'seats') {
      const all = projectSeats(params, {
        state: typeof filters.state === 'string' ? filters.state : '',
        race:  typeof filters.race  === 'string' ? filters.race  : '',
        search: typeof filters.search === 'string' ? filters.search.slice(0, 100) : '',
      });
      const pg = Math.max(1, parseInt(page) || 1);
      const ps = Math.min(50, Math.max(1, parseInt(pageSize) || 25));
      payload = {
        total: all.length,
        page: pg,
        pageSize: ps,
        pages: Math.ceil(all.length / ps),
        seats: all.slice((pg - 1) * ps, pg * ps),
      };

    } else if (action === 'race-drill') {
      const idx = { m: 0, c: 1, i: 2, l: 3 }[body.community] ?? 0;
      payload = { topSeats: getTopByRace(params, idx, 10) };

    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ ok: true, data: payload }),
    };

  } catch (err) {
    console.error('GE16 API error:', err);
    return {
      statusCode: 500,
      headers,
      body: JSON.stringify({ error: 'Server error' }),
    };
  }
};
