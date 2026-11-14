// api/results.js — Vercel serverless function
// Proxies the electiondata.my /results endpoint (EC-declared results) for all 28 Melaka DUN seats.
// Env: ELECTIONDATA_API_KEY (server-side only, never sent to the browser or logged)

const https = require('https');

const STATE = 'Melaka';
const DATE = '2026-11-14';
const SEATS = ["N.01 Kuala Linggi", "N.02 Tanjung Bidara", "N.03 Ayer Limau", "N.04 Lendu", "N.05 Taboh Naning", "N.06 Rembia", "N.07 Gadek", "N.08 Machap Jaya", "N.09 Durian Tunggal", "N.10 Asahan", "N.11 Sungai Udang", "N.12 Pantai Kundor", "N.13 Paya Rumput", "N.14 Kelebang", "N.15 Pengkalan Batu", "N.16 Ayer Keroh", "N.17 Bukit Katil", "N.18 Ayer Molek", "N.19 Kesidang", "N.20 Kota Laksamana", "N.21 Duyong", "N.22 Bandar Hilir", "N.23 Telok Mas", "N.24 Bemban", "N.25 Rim", "N.26 Serkam", "N.27 Merlimau", "N.28 Sungai Rambai"];
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

async function getAll() {
  const out = await Promise.all(SEATS.map(async (seat, i) => {
    const q = '/v1/results?seat=' + encodeURIComponent(seat) + '&state=' + encodeURIComponent(STATE) + '&date=' + DATE;
    const r = await upstream(q);
    if (r.status !== 200 || !r.data) return { i, seat, declared: false, b: [] };
    const ballot = Array.isArray(r.data.ballot) ? r.data.ballot : [];
    const st = (Array.isArray(r.data.stats) && r.data.stats[0]) || {};
    const win = ballot.find((c) => typeof c.result === 'string' && c.result.indexOf('won') === 0);
    const declared = !!win && (st.voter_turnout || 0) > 0;
    return {
      i, seat, declared,
      w: win ? { name: win.name, party: win.party, coal: win.coalition, votes: win.votes } : null,
      maj: st.majority || 0, maj_p: st.majority_perc || null,
      turnout: st.voter_turnout || 0, turnout_p: st.voter_turnout_perc || null,
      rejected: st.votes_rejected || 0,
      b: ballot.map((c) => ({ n: c.name, p: c.party, c: c.coalition, v: c.votes, pc: c.votes_perc, r: c.result })),
    };
  }));
  return { updated: Date.now(), seats: out };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    const c = cache.all;
    let data;
    if (c && Date.now() - c.t < 30000) data = c.v;
    else { data = await getAll(); cache.all = { t: Date.now(), v: data }; }
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json({ ok: true, data });
  } catch (err) {
    const notConfigured = err && err.code === 'NOKEY';
    console.error('results error:', err && err.message);
    return res.status(notConfigured ? 503 : 502).json({
      error: notConfigured ? 'Results are not configured' : 'Results are temporarily unavailable',
    });
  }
};
