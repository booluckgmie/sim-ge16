// netlify/functions/data.js
// Secure API endpoint — all data and model logic runs here, never in the browser

const https = require('https');
const { getSummary, projectSeats, getTopByRace, getSeatAnalysis } = require('../../src/utils/model');

const ALLOWED_ORIGINS = [
  process.env.ALLOWED_ORIGIN,
  'http://localhost:3000',
  'http://localhost:8888',
].filter(Boolean);

const VALID_COALITIONS = ['PH', 'PN', 'BN', 'GPS'];

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
    yT: clamp(body.yT,  40, 95, 72),
    sT: clamp(body.sT,  50, 95, 78),
    mS: clamp(body.mS,   0, 100, 48),
    cS: clamp(body.cS,   0, 100, 78),
    iS: clamp(body.iS,   0, 100, 68),
    lS: clamp(body.lS,   0, 100, 45),
  };
}

// ── Groq LLM call (server-side only — key never sent to browser) ──────────────
function callGroq(params, summary, analysis, coalition) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return Promise.reject(new Error('AI insight service not configured (GROQ_API_KEY missing)'));

  const p   = summary.parties || {};
  const c   = summary.coalitions || {};
  const t   = analysis.tiers || {};
  const v   = summary.verdict || {};
  const atRisk  = (analysis.atRisk  || []).slice(0, 5);
  const flipOps = (analysis.flipOpps || []).slice(0, 5);

  const scenLabel = { base: 'Base case', best: 'Best case', worst: 'Worst case' }[params.scen] || params.scen;
  const coalLabel = { PH: 'Pakatan Harapan (PH)', PN: 'Perikatan Nasional (PN)', BN: 'Barisan Nasional (BN)', GPS: 'Gabungan Parti Sarawak (GPS)' }[coalition] || coalition;

  const prompt =
`You are a senior Malaysian political analyst explaining a GE16 simulation result to a general audience.

SIMULATION PARAMETERS
Scenario: ${scenLabel} | Youth turnout: ${params.yT}% | Senior turnout: ${params.sT}%
PH support — Malay: ${params.mS}%, Chinese: ${params.cS}%, Indian: ${params.iS}%, Other: ${params.lS}%

PROJECTED SEAT TOTALS (222 seats, majority = 112)
PH Bloc: ${summary.phBloc} (PKR ${p.PKR||0} · DAP ${p.DAP||0} · AMANAH ${p.AMANAH||0} · BERSAMA ${p.BERSAMA||0})
PN: ${c.pn||0} (BERSATU ${p['PN-BERSATU']||0} · PAS ${p['PN-PAS']||0})
BN: ${c.bn||0} (UMNO ${p['BN-UMNO']||0} · MCA ${p['BN-MCA']||0})
GPS (Sarawak): ${c.gps||0}
Overall verdict: ${v.text || '—'}

ANALYSIS — ${coalLabel} PERSPECTIVE
Stronghold: ${t.stronghold||0} | Safe: ${t.safe||0} | Leaning: ${t.leaning||0} | At-Risk: ${t.atRisk||0} | Flip Opportunities: ${t.flipOpps||0}
${atRisk.length  ? 'Most vulnerable seats: ' + atRisk.map(s  => s.name + ' ' + Math.round(s.winProb*100) + '%').join(', ') : ''}
${flipOps.length ? 'Top flip targets: '      + flipOps.map(s => s.name + ' ' + Math.round(s.winProb*100) + '%').join(', ') : ''}

Write a focused political analysis in 3–4 short paragraphs:
1. What this result means for government formation
2. The decisive battleground seats and why they matter
3. Which voter groups are the swing factor
4. One realistic scenario that could shift the outcome

Keep it clear, specific, and accessible to a non-expert Malaysian audience.`;

  const reqBody = JSON.stringify({
    model: 'llama-3.3-70b-versatile',
    messages: [
      { role: 'system', content: 'You are a concise, factual Malaysian political analyst. No bullet points — write in flowing paragraphs. Stay under 380 words.' },
      { role: 'user', content: prompt },
    ],
    max_tokens: 520,
    temperature: 0.5,
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.groq.com',
      path: '/openai/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${key}`,
        'Content-Length': Buffer.byteLength(reqBody),
      },
    }, (res) => {
      let raw = '';
      res.on('data', chunk => { raw += chunk; });
      res.on('end', () => {
        try {
          const json = JSON.parse(raw);
          if (json.error) return reject(new Error(json.error.message || 'Groq error'));
          const text = json.choices?.[0]?.message?.content?.trim() || '';
          if (!text) return reject(new Error('Empty response from AI'));
          resolve({ text, model: json.model || 'llama-3.3-70b-versatile', tokens: json.usage?.total_tokens || 0 });
        } catch (e) {
          reject(new Error('Failed to parse AI response'));
        }
      });
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(new Error('AI request timed out')); });
    req.write(reqBody);
    req.end();
  });
}

exports.handler = async (event) => {
  const origin  = event.headers.origin || '';
  const headers = corsHeaders(origin);

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const apiKey      = event.headers['x-api-key'] || '';
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
  const params    = validateParams(body);
  const coalition = VALID_COALITIONS.includes(body.coalition) ? body.coalition : 'PH';

  try {
    let payload;

    if (action === 'summary') {
      payload = getSummary(params);

    } else if (action === 'seats') {
      const sortBy = typeof body.sortBy === 'string' ? body.sortBy : '';
      const all = projectSeats(params, {
        state:  typeof filters.state  === 'string' ? filters.state  : '',
        race:   typeof filters.race   === 'string' ? filters.race   : '',
        search: typeof filters.search === 'string' ? filters.search.slice(0, 100) : '',
        sortBy: ['prob-asc','prob-desc',''].includes(sortBy) ? sortBy : '',
      }, coalition);
      const pg = Math.max(1, parseInt(page) || 1);
      const ps = Math.min(50, Math.max(1, parseInt(pageSize) || 25));
      payload = {
        total: all.length, page: pg, pageSize: ps,
        pages: Math.ceil(all.length / ps),
        seats: all.slice((pg - 1) * ps, pg * ps),
      };

    } else if (action === 'race-drill') {
      const idx = { m: 0, c: 1, i: 2, l: 3 }[body.community] ?? 0;
      payload = { topSeats: getTopByRace(params, idx, 10, coalition) };

    } else if (action === 'seat-analysis') {
      payload = getSeatAnalysis(params, coalition);

    } else if (action === 'insight') {
      const summary  = getSummary(params);
      const analysis = getSeatAnalysis(params, coalition);
      payload = await callGroq(params, summary, analysis, coalition);

    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
    }

    return { statusCode: 200, headers, body: JSON.stringify({ ok: true, data: payload }) };

  } catch (err) {
    console.error('GE16 API error:', err);
    return { statusCode: 500, headers, body: JSON.stringify({ error: err.message || 'Server error' }) };
  }
};
