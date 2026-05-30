// src/utils/model.js
// All projection logic lives here — on the server, never sent to the browser

const { SEATS } = require('../data/seats');
const { RACE } = require('../data/race');

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }

// Raw swing value — how far PH support has moved from baseline
function calcSwing(seat, params) {
  const { yT = 72, sT = 78, mS = 48, cS = 78, iS = 68, lS = 45 } = params;
  const [code,,,,, youth] = seat;
  const r = RACE[code] || [50, 20, 10, 20];
  const [mp, cp, ip, lp] = r;
  const yAdj = (yT - 72) / 100;
  const sAdj = (sT - 78) / 100;
  const yFr = youth / 100;
  const rph = (mp/100)*(mS/100) + (cp/100)*(cS/100) + (ip/100)*(iS/100) + (lp/100)*(lS/100);
  const bph = (mp/100)*0.48 + (cp/100)*0.78 + (ip/100)*0.68 + (lp/100)*0.45;
  return (rph - bph) + yAdj*yFr*0.4 + sAdj*(1-yFr)*0.3;
}

function getWinner(seat, params) {
  const { scen = 'base' } = params;
  const [,,,,,,best,base,worst,bF,pnF] = seat;
  let w = scen === 'best' ? best : scen === 'worst' ? worst : base;
  const tot = calcSwing(seat, params);
  const F = 0.12;

  if ((w==='PKR'||w==='DAP'||w==='AMANAH') && tot < -F && bF >= 3) return 'BERSAMA';
  if ((w==='PKR'||w==='DAP'||w==='AMANAH') && tot < -F*1.5 && pnF >= 3) return 'PN-BERSATU';
  if (w==='BERSAMA' && tot > F && bF <= 3) return 'PKR';
  const { mS = 48 } = params;
  if ((w==='PN-PAS'||w==='PN-BERSATU') && mS > 60 && tot > F && pnF <= 2) return 'PKR';
  if (w==='BN-UMNO' && tot < -F && pnF >= 2 && (RACE[seat[0]]?.[0] || 50) > 70) return 'PN-BERSATU';
  return w;
}

// Per-seat PH win probability using sigmoid model calibrated to flip thresholds
function getPHWinProb(seat, params) {
  const { scen = 'base' } = params;
  const [,,,,,,best,base,worst,bF,pnF] = seat;
  const bw = scen === 'best' ? best : scen === 'worst' ? worst : base;
  const tot = calcSwing(seat, params);
  const F = 0.12;

  // GPS — insulated East Malaysia bloc, rarely flips to PH
  if (bw.startsWith('GPS')) {
    return +(Math.max(0.03, Math.min(0.12, 0.05 + tot * 0.3)).toFixed(3));
  }

  // WARISAN — Sabah Bumiputera bloc, partial PH alignment
  if (bw === 'WARISAN') {
    return +(Math.max(0.10, Math.min(0.52, 0.25 + tot * 1.2)).toFixed(3));
  }

  // PH defending (PKR, DAP, AMANAH)
  if (bw === 'PKR' || bw === 'DAP' || bw === 'AMANAH') {
    // Flip threshold sits at tot=-F for bF>=3 (marginal) seats,
    // deeper at -F*1.6 for bF<3 (safer) seats.
    const center = bF >= 3 ? -F : -F * 1.6;
    // Steepness decreases as bF rises (more marginal → flatter probability curve)
    const steepness = 14 - Math.min(4, bF);
    return +(Math.max(0.05, Math.min(0.97, sigmoid((tot - center) * steepness))).toFixed(3));
  }

  // BERSAMA — contested swing seat, 50% anchor at baseline tot=0
  if (bw === 'BERSAMA') {
    return +(Math.max(0.10, Math.min(0.90, sigmoid(tot * 11))).toFixed(3));
  }

  // PN seats (PAS, BERSATU) — PH needs tot > F to flip;
  // high pnF means seat is a PN fortress (center shifted further right)
  if (bw === 'PN-PAS' || bw === 'PN-BERSATU') {
    const center = pnF <= 2 ? F : F * 1.8;
    return +(Math.max(0.03, Math.min(0.82, sigmoid((tot - center) * 10))).toFixed(3));
  }

  // BN seats (UMNO, MCA) — can flip either way;
  // pnF>=2 means PN is closer rival than PH
  if (bw === 'BN-UMNO' || bw === 'BN-MCA') {
    const center = pnF >= 2 ? F * 1.5 : F;
    return +(Math.max(0.05, Math.min(0.75, sigmoid((tot - center) * 10))).toFixed(3));
  }

  return 0.05;
}

// Classify probability into readable tier
function probTier(p) {
  if (p >= 0.80) return { label: 'Stronghold',    color: '#15803D', bg: '#F0FDF4' };
  if (p >= 0.65) return { label: 'Safe',          color: '#16A34A', bg: '#DCFCE7' };
  if (p >= 0.50) return { label: 'Leaning PH',   color: '#CA8A04', bg: '#FEF9C3' };
  if (p >= 0.40) return { label: 'Battleground',  color: '#D97706', bg: '#FEF3C7' };
  if (p >= 0.25) return { label: 'Lean Away',     color: '#EA580C', bg: '#FFF7ED' };
  return                 { label: 'Unlikely',      color: '#DC2626', bg: '#FEF2F2' };
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
  if (r[0] >= 65) return { type: 'malay',   label: 'Malay-dom',    col: '#185FA5' };
  if (r[1] >= 45) return { type: 'chinese', label: 'Chinese-dom',  col: '#A32D2D' };
  if (r[2] >= 18) return { type: 'indian',  label: 'High Indian',  col: '#854F0B' };
  return                  { type: 'mixed',   label: 'Mixed',        col: '#5F5E5A' };
}

function projectSeats(params, filters = {}) {
  let seats = SEATS;
  const { state, race, search, sortBy } = filters;

  if (state)  seats = seats.filter(s => s[2] === state);
  if (race)   seats = seats.filter(s => raceProfile(s[0]).type === race);
  if (search) {
    const q = search.toLowerCase();
    seats = seats.filter(s =>
      s[0].toLowerCase().includes(q) ||
      s[1].toLowerCase().includes(q) ||
      s[2].toLowerCase().includes(q)
    );
  }

  const mapped = seats.map(s => {
    const w    = getWinner(s, params);
    const r    = RACE[s[0]] || [50, 20, 10, 20];
    const prof = raceProfile(s[0]);
    const prob = getPHWinProb(s, params);
    const tier = probTier(prob);
    return {
      code: s[0], name: s[1], state: s[2], ge15: s[3],
      voters: s[4], youth: s[5], projected: w,
      phWinProb: prob,
      tierLabel: tier.label, tierColor: tier.color, tierBg: tier.bg,
      swing: +calcSwing(s, params).toFixed(4),
      raceProfile: prof.type, raceLabel: prof.label, raceCol: prof.col,
      melayu: r[0], cina: r[1], india: r[2], lain: r[3],
    };
  });

  // Optional sort by probability
  if (sortBy === 'prob-asc')  mapped.sort((a, b) => a.phWinProb - b.phWinProb);
  if (sortBy === 'prob-desc') mapped.sort((a, b) => b.phWinProb - a.phWinProb);

  return mapped;
}

// Deep seat-level analysis — not aggregated by coalition
function getSeatAnalysis(params) {
  const all = projectSeats(params, {});

  // Distribution across 10 probability deciles
  const distribution = Array.from({ length: 10 }, (_, i) => {
    const lo = i * 10, hi = lo + 10;
    const seats = all.filter(s => {
      const pct = s.phWinProb * 100;
      return i < 9 ? (pct >= lo && pct < hi) : (pct >= lo && pct <= hi);
    });
    return { lo, hi, label: `${lo}–${hi}%`, count: seats.length, seats };
  });

  const isPH = s => s.projected === 'PKR' || s.projected === 'DAP' || s.projected === 'AMANAH';

  // PH-held seats ranked by risk (ascending probability = most at risk first)
  const atRisk = all
    .filter(s => isPH(s) && s.phWinProb < 0.65)
    .sort((a, b) => a.phWinProb - b.phWinProb)
    .slice(0, 25)
    .map(s => pick(s));

  // All battleground seats (40–65%) regardless of holder
  const battleground = all
    .filter(s => s.phWinProb >= 0.38 && s.phWinProb <= 0.65)
    .sort((a, b) => a.phWinProb - b.phWinProb)
    .map(s => pick(s));

  // Non-PH seats PH could realistically flip (prob > 30%)
  const flipOpps = all
    .filter(s => !isPH(s) && s.projected !== 'BERSAMA' && s.phWinProb > 0.28)
    .sort((a, b) => b.phWinProb - a.phWinProb)
    .slice(0, 20)
    .map(s => pick(s));

  // PH strongholds (prob >= 80%)
  const strongholds = all.filter(s => isPH(s) && s.phWinProb >= 0.80).length;

  // Tier counts for the summary strip
  const tiers = {
    stronghold: all.filter(s => isPH(s) && s.phWinProb >= 0.80).length,
    safe:       all.filter(s => isPH(s) && s.phWinProb >= 0.65 && s.phWinProb < 0.80).length,
    leaning:    all.filter(s => isPH(s) && s.phWinProb >= 0.50 && s.phWinProb < 0.65).length,
    atRisk:     all.filter(s => isPH(s) && s.phWinProb < 0.50).length,
    flipOpps:   all.filter(s => !isPH(s) && s.projected !== 'BERSAMA' && s.phWinProb > 0.28).length,
  };

  const avgProb = +(all.reduce((s, x) => s + x.phWinProb, 0) / all.length).toFixed(3);

  return { distribution, atRisk, battleground, flipOpps, tiers, avgProb, total: all.length };
}

function pick(s) {
  return {
    code: s.code, name: s.name, state: s.state,
    ge15: s.ge15, projected: s.projected,
    phWinProb: s.phWinProb, tierLabel: s.tierLabel,
    tierColor: s.tierColor, tierBg: s.tierBg,
    swing: s.swing,
    melayu: s.melayu, cina: s.cina, india: s.india, lain: s.lain,
  };
}

function getSummary(params) {
  const t = tally(params);
  const ph  = (t.PKR||0) + (t.DAP||0) + (t.AMANAH||0);
  const bm  = t.BERSAMA || 0;
  const pn  = t.PN || 0;
  const bn  = t.BN || 0;
  const gps = t.GPS || 0;
  const war = t.WARISAN || 0;
  const phBloc = ph + bm;
  const opp    = pn + bn;

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
    phBloc, opp,
    verdict: { type: verdictType, text: verdictText },
    states: [...new Set(SEATS.map(s => s[2]))],
  };
}

function getTopByRace(params, raceIdx, limit = 10) {
  return [...SEATS]
    .sort((a, b) => (RACE[b[0]]?.[raceIdx] || 0) - (RACE[a[0]]?.[raceIdx] || 0))
    .slice(0, limit)
    .map(s => ({
      code: s[0], name: s[1], state: s[2],
      pct: RACE[s[0]]?.[raceIdx] || 0,
      projected: getWinner(s, params),
      phWinProb: getPHWinProb(s, params),
    }));
}

module.exports = { getSummary, projectSeats, getTopByRace, tally, getSeatAnalysis, getPHWinProb };
