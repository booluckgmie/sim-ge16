// api/turnout.js — Vercel serverless function
// Proxies the electiondata.my live-turnout API so the key stays server-side.
// Env: ELECTIONDATA_API_KEY (never sent to the browser, never logged)

const https = require('https');

const ELECTION = 'mlk-se16';
const cache = {};

function upstream(path) {
  return new Promise((resolve, reject) => {
    const key = process.env.ELECTIONDATA_API_KEY;
    if (!key) return reject(Object.assign(new Error('not configured'), { code: 'NOKEY' }));
    const req = https.request({
      hostname: 'api.electiondata.my',
      path,
      method: 'GET',
      headers: { Authorization: 'Bearer ' + key, Accept: 'application/json' },
    }, (res) => {
      let body = '';
      res.on('data', (d) => { body += d; });
      res.on('end', () => {
        if (res.statusCode !== 200) return resolve({ status: res.statusCode, data: null });
        try { resolve({ status: 200, data: JSON.parse(body) }); }
        catch (e) { reject(new Error('bad upstream json')); }
      });
    });
    req.on('error', reject);
    req.setTimeout(8000, () => req.destroy(new Error('upstream timeout')));
    req.end();
  });
}

async function cached(k, ttl, fn) {
  const c = cache[k];
  if (c && Date.now() - c.t < ttl) return c.v;
  const v = await fn();
  cache[k] = { t: Date.now(), v };
  return v;
}

async function getLatest() {
  const r = await upstream('/v1/vto/latest?election=' + ELECTION);
  if (r.status !== 200) throw new Error('upstream ' + r.status);
  return r.data;
}

const nIndex = (key) => {
  const m = /^N\.(\d+)/.exec(key);
  return m ? parseInt(m[1], 10) - 1 : -1;
};

function dunArrays(dun) {
  const abs = new Array(28).fill(0);
  const ele = new Array(28).fill(0);
  Object.keys(dun).forEach((k) => {
    const i = nIndex(k);
    if (i >= 0 && i < 28) { abs[i] = dun[k].overall_abs; ele[i] = dun[k].overall_electorate; }
  });
  return { abs, ele };
}

async function getSeries() {
  const latest = await cached('latest', 20000, getLatest);
  const end = parseInt(latest.slot.slice(0, 2), 10) * 60 + parseInt(latest.slot.slice(2), 10);
  const slots = [];
  for (let t = 480; t < end; t += 30) slots.push(t);
  slots.push(end);
  const fmt = (t) => String(Math.floor(t / 60)).padStart(2, '0') + String(t % 60).padStart(2, '0');
  const results = await Promise.all(slots.map(async (t) => {
    if (t === end) return { t, dun: latest.dun };
    const r = await upstream('/v1/vto?election=' + ELECTION + '&level=dun&time=' + fmt(t));
    return { t, dun: r.status === 200 ? r.data : null };
  }));
  const out = [];
  let electorate = null;
  results.forEach((r) => {
    if (!r.dun) return;
    const a = dunArrays(r.dun);
    if (!electorate) electorate = a.ele;
    out.push({ slot: fmt(r.t), abs: a.abs });
  });
  return { timestamp: latest.timestamp, electorate, slots: out };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  const view = req.query && req.query.view === 'series' ? 'series' : 'latest';
  try {
    if (view === 'latest') {
      const data = await cached('latest', 20000, getLatest);
      res.setHeader('Cache-Control', 'public, s-maxage=20, stale-while-revalidate=40');
      return res.status(200).json({ ok: true, data });
    }
    const data = await cached('series', 60000, getSeries);
    res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=120');
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    const notConfigured = err && err.code === 'NOKEY';
    console.error('turnout error:', err && err.message);
    return res.status(notConfigured ? 503 : 502).json({
      error: notConfigured ? 'Live turnout is not configured' : 'Live turnout is temporarily unavailable',
    });
  }
};
