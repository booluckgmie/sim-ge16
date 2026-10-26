// api/analytics.js — Vercel serverless function
// Proxies Vercel Web Analytics API so browser gets live data without exposing token

const https = require('https');

const PROJECT_ID = 'prj_Dmdw8qvR8V2DeaVmp01jAe2ERTuS';
const TEAM_ID = 'team_YWXoh9J5uvtJSnOIlBq2H8Rl';

function vercelGet(path, params) {
  return new Promise((resolve, reject) => {
    const token = process.env.ANALYTICS_TOKEN;
    if (!token) return reject(new Error('ANALYTICS_TOKEN not set'));

    const parts = [];
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach(item => parts.push(k + '[]=' + encodeURIComponent(item)));
      else parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(v));
    }
    const fullPath = path + '?' + parts.join('&');


    const options = {
      hostname: 'api.vercel.com',
      path: fullPath,
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=60');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  const since = '2026-10-01T00:00:00.000Z';
  const until = new Date().toISOString();
  const base = { projectId: PROJECT_ID, teamId: TEAM_ID, since, until };

  try {
    const [countRes, pageRes, deviceRes, countryRes] = await Promise.all([
      vercelGet('/v1/query/web-analytics/visits/count', base),
      vercelGet('/v1/query/web-analytics/visits/aggregate', { ...base, by: ['requestPath'], limit: 10 }),
      vercelGet('/v1/query/web-analytics/visits/aggregate', { ...base, by: ['deviceType'] }),
      vercelGet('/v1/query/web-analytics/visits/aggregate', { ...base, by: ['country'], limit: 15 }),
    ]);

    const countData = countRes.data?.data ?? {};
    const views = countData.pageviews ?? 0;
    const visitors = countData.visitors ?? 0;

    const pages = (pageRes.data?.data ?? []).map(r => ({
      label: r.requestPath ?? '/',
      views: r.pageviews ?? 0,
    })).sort((a, b) => b.views - a.views);

    const devices = {};
    (deviceRes.data?.data ?? []).forEach(r => {
      const key = (r.deviceType ?? 'unknown');
      const label = key.charAt(0).toUpperCase() + key.slice(1);
      devices[label] = r.pageviews ?? 0;
    });

    const COUNTRY_FLAGS = {
      MY: '🇲🇾', US: '🇺🇸', AU: '🇦🇺', CA: '🇨🇦', CH: '🇨🇭', SE: '🇸🇪', SG: '🇸🇬',
      GB: '🇬🇧', DE: '🇩🇪', FR: '🇫🇷', JP: '🇯🇵', IN: '🇮🇳', CN: '🇨🇳', BR: '🇧🇷',
      NL: '🇳🇱', TH: '🇹🇭', ID: '🇮🇩', PH: '🇵🇭', HK: '🇭🇰', NZ: '🇳🇿', ZA: '🇿🇦',
      AE: '🇦🇪', SA: '🇸🇦', KR: '🇰🇷', TW: '🇹🇼', MX: '🇲🇽', AR: '🇦🇷', NG: '🇳🇬',
    };
    const COUNTRY_NAMES = {
      MY: 'Malaysia', US: 'United States', AU: 'Australia', CA: 'Canada', CH: 'Switzerland',
      SE: 'Sweden', SG: 'Singapore', GB: 'United Kingdom', DE: 'Germany', FR: 'France',
      JP: 'Japan', IN: 'India', CN: 'China', BR: 'Brazil', NL: 'Netherlands',
      TH: 'Thailand', ID: 'Indonesia', PH: 'Philippines', HK: 'Hong Kong', NZ: 'New Zealand',
      ZA: 'South Africa', AE: 'UAE', SA: 'Saudi Arabia', KR: 'South Korea', TW: 'Taiwan',
      MX: 'Mexico', AR: 'Argentina', NG: 'Nigeria',
    };
    const COLORS = ['#2563EB','#059669','#D97706','#7C3AED','#DC2626','#0891B2','#BE185D','#65A30D','#B45309','#6366F1'];

    const countries = (countryRes.data?.data ?? []).map((r, i) => {
      const code = (r.country ?? '').toUpperCase();
      return {
        code,
        name: COUNTRY_NAMES[code] ?? code,
        flag: COUNTRY_FLAGS[code] ?? '🌍',
        visitors: r.visitors ?? 0,
        color: COLORS[i % COLORS.length],
      };
    }).sort((a, b) => b.visitors - a.visitors);

    res.status(200).json({ views, visitors, pages, devices, countries, since, until });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
