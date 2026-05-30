// src/utils/model.js
// All projection logic lives here — on the server, never sent to the browser

const { SEATS } = require('../data/seats');
const { RACE } = require('../data/race');

function getWinner(seat, params) {
  const { scen = 'base', yT = 72, sT = 78, mS = 48, cS = 78, iS = 68, lS = 45 } = params;
  const [code,,,,, youth, best, base, worst, bF, pnF] = seat;
  let w = scen === 'best' ? best : scen === 'worst' ? worst : base;

  const r = RACE[code] || [50, 20, 10, 20];
  const [mp, cp, ip, lp] = r;
  const yAdj = (yT - 72) / 100;
  const sAdj = (sT - 78) / 100;
  const yFr = youth / 100;

  const rph = (mp/100)*(mS/100) + (cp/100)*(cS/100) + (ip/100)*(iS/100) + (lp/100)*(lS/100);
  const bph = (mp/100)*0.48 + (cp/100)*0.78 + (ip/100)*0.68 + (lp/100)*0.45;
  const tot = (rph - bph) + yAdj*yFr*0.4 + sAdj*(1-yFr)*0.3;
  const F = 0.12;

  if ((w==='PKR'||w==='DAP'||w==='AMANAH') && tot < -F && bF >= 3) return 'BERSAMA';
  if ((w==='PKR'||w==='DAP'||w==='AMANAH') && tot < -F*1.5 && pnF >= 3) return 'PN-BERSATU';
  if (w==='BERSAMA' && tot > F && bF <= 3) return 'PKR';
  if ((w==='PN-PAS'||w==='PN-BERSATU') && mS > 60 && tot > F && pnF <= 2) return 'PKR';
  if (w==='BN-UMNO' && tot < -F && pnF >= 2 && mp > 70) return 'PN-BERSATU';
  return w;
}

function tally(params) {
  const counts = {};
  SEATS.forEach(seat => {
    const w = getWinner(seat, params);
    const grp = w.startsWith('GPS') ? 'GPS' : w.startsWith('BN') ? 'BN' : w.startsWith('PN') ? 'PN' : w;
    counts[grp] = (counts[grp] || 0) + 1;
    counts['_' + w] = (counts['_' + w] || 0) + 1;
  });
  return counts;
}

function raceProfile(code) {
  const r = RACE[code] || [50, 20, 10, 20];
  if (r[0] >= 65) return { type: 'malay', label: 'Malay-dom', col: '#185FA5' };
  if (r[1] >= 45) return { type: 'chinese', label: 'Chinese-dom', col: '#A32D2D' };
  if (r[2] >= 18) return { type: 'indian', label: 'High Indian', col: '#854F0B' };
  return { type: 'mixed', label: 'Mixed', col: '#5F5E5A' };
}

function projectSeats(params, filters = {}) {
  let seats = SEATS;
  const { state, race, search } = filters;

  if (state) seats = seats.filter(s => s[2] === state);
  if (race) seats = seats.filter(s => raceProfile(s[0]).type === race);
  if (search) {
    const q = search.toLowerCase();
    seats = seats.filter(s =>
      s[0].toLowerCase().includes(q) ||
      s[1].toLowerCase().includes(q) ||
      s[2].toLowerCase().includes(q)
    );
  }

  return seats.map(s => {
    const w = getWinner(s, params);
    const r = RACE[s[0]] || [50, 20, 10, 20];
    const prof = raceProfile(s[0]);
    return {
      code: s[0],
      name: s[1],
      state: s[2],
      ge15: s[3],
      voters: s[4],
      youth: s[5],
      projected: w,
      raceProfile: prof.type,
      raceLabel: prof.label,
      raceCol: prof.col,
      melayu: r[0],
      cina: r[1],
      india: r[2],
      lain: r[3],
    };
  });
}

function getSummary(params) {
  const t = tally(params);
  const ph = (t.PKR||0) + (t.DAP||0) + (t.AMANAH||0);
  const bm = t.BERSAMA || 0;
  const pn = t.PN || 0;
  const bn = t.BN || 0;
  const gps = t.GPS || 0;
  const war = t.WARISAN || 0;
  const phBloc = ph + bm;
  const opp = pn + bn;

  let verdictType, verdictText;
  if (phBloc + gps >= 112) {
    verdictType = 'ok';
    verdictText = `PH + GPS bloc totals ${phBloc + gps} seats — majority secured (need 112 of 222)`;
  } else if (phBloc >= 112) {
    verdictType = 'ok';
    verdictText = `PH bloc alone at ${phBloc} — majority. GPS adds governing stability.`;
  } else if (opp + gps >= 112) {
    verdictType = 'no';
    verdictText = `PN+BN+GPS reach ${opp + gps} — opposition can form government`;
  } else {
    verdictType = 'warn';
    verdictText = `Hung parliament — PH bloc ${phBloc} · PN+BN ${opp} · GPS (${gps}) is kingmaker`;
  }

  return {
    coalitions: { ph, bm, pn, bn, gps, war },
    phBloc, opp, verdict: { type: verdictType, text: verdictText },
    states: [...new Set(SEATS.map(s => s[2]))]
  };
}

function getTopByRace(params, raceIdx, limit = 10) {
  return [...SEATS]
    .sort((a, b) => (RACE[b[0]]?.[raceIdx] || 0) - (RACE[a[0]]?.[raceIdx] || 0))
    .slice(0, limit)
    .map(s => ({
      code: s[0],
      name: s[1],
      state: s[2],
      pct: RACE[s[0]]?.[raceIdx] || 0,
      projected: getWinner(s, params),
    }));
}

module.exports = { getSummary, projectSeats, getTopByRace, tally };
