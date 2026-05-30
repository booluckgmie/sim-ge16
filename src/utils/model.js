// src/utils/model.js
// All projection logic lives here — on the server, never sent to the browser

const { SEATS } = require('../data/seats');
const { RACE } = require('../data/race');
const { GE15 } = require('../data/ge15');

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

// Per-seat PH win probability (kept for backwards compat; calls getCoalitionWinProb)
function getPHWinProb(seat, params) {
  const { scen = 'base' } = params;
  const [,,,,,,best,base,worst,bF,pnF] = seat;
  const bw = scen === 'best' ? best : scen === 'worst' ? worst : base;
  const tot = calcSwing(seat, params);
  const F = 0.12;

  if (bw.startsWith('GPS')) {
    return +(Math.max(0.03, Math.min(0.12, 0.05 + tot * 0.3)).toFixed(3));
  }
  if (bw === 'WARISAN') {
    return +(Math.max(0.10, Math.min(0.52, 0.25 + tot * 1.2)).toFixed(3));
  }
  if (bw === 'PKR' || bw === 'DAP' || bw === 'AMANAH') {
    const g15 = GE15[seat[0]];
    // Use actual GE-15 majority to set how far PH can afford to slip before seat is at risk
    const margin = g15 ? g15.majority / 100 : (bF >= 3 ? 0.08 : 0.20);
    const center = -(margin * 0.35 + F * 0.3);
    const steepness = 14 - Math.min(4, bF);
    return +(Math.max(0.05, Math.min(0.97, sigmoid((tot - center) * steepness))).toFixed(3));
  }
  if (bw === 'BERSAMA') {
    return +(Math.max(0.10, Math.min(0.90, sigmoid(tot * 11))).toFixed(3));
  }
  if (bw === 'PN-PAS' || bw === 'PN-BERSATU') {
    const g15 = GE15[seat[0]];
    // Calibrate flip difficulty using actual PN–PH gap from GE-15
    const pnPhGap = g15 ? Math.max(0, (g15.pn - g15.ph) / 100) : (pnF <= 2 ? F : F * 1.8);
    const center = F * 0.3 + pnPhGap * 0.35;
    return +(Math.max(0.03, Math.min(0.82, sigmoid((tot - center) * 10))).toFixed(3));
  }
  if (bw === 'BN-UMNO' || bw === 'BN-MCA') {
    const g15 = GE15[seat[0]];
    // Calibrate flip difficulty using actual BN–PH gap from GE-15
    const bnPhGap = g15 ? Math.max(0, (g15.bn - g15.ph) / 100) : (pnF >= 2 ? F * 1.5 : F);
    const center = F * 0.3 + bnPhGap * 0.4;
    return +(Math.max(0.05, Math.min(0.75, sigmoid((tot - center) * 10))).toFixed(3));
  }
  return 0.05;
}

// Generalised win probability for any coalition
function getCoalitionWinProb(seat, params, coalition) {
  if (!coalition || coalition === 'PH') return getPHWinProb(seat, params);

  const { scen = 'base' } = params;
  const [,,,,,,best,base,worst,bF,pnF] = seat;
  const bw = scen === 'best' ? best : scen === 'worst' ? worst : base;
  const tot = calcSwing(seat, params);
  const F = 0.12;

  // ── PN perspective ──────────────────────────────────────────────
  if (coalition === 'PN') {
    // GPS: PN essentially absent from Sarawak
    if (bw.startsWith('GPS')) return +(Math.max(0.01, Math.min(0.06, 0.02 - tot * 0.1)).toFixed(3));
    // WARISAN: Sabah — PN has limited reach
    if (bw === 'WARISAN') return +(Math.max(0.03, Math.min(0.18, 0.07 - tot * 0.4)).toFixed(3));
    // PN defending: calibrate with actual GE-15 majority
    if (bw === 'PN-PAS' || bw === 'PN-BERSATU') {
      const g15 = GE15[seat[0]];
      const margin = g15 ? g15.majority / 100 : (pnF <= 2 ? F : F * 1.8);
      const center = margin * 0.40 + F * 0.25;
      const steepness = 11 + Math.min(3, pnF);
      return +(Math.max(0.15, Math.min(0.97, sigmoid(-(tot - center) * steepness))).toFixed(3));
    }
    // PH seats: PN can flip if swing is strongly negative and pnF is high
    if (bw === 'PKR' || bw === 'DAP' || bw === 'AMANAH') {
      const g15 = GE15[seat[0]];
      const phPnGap = g15 ? Math.max(0, (g15.ph - g15.pn) / 100) : (pnF >= 3 ? F * 0.8 : F * 1.8);
      const center = -(F * 0.3 + phPnGap * 0.35);
      return +(Math.max(0.02, Math.min(0.72, sigmoid(-(tot - center) * 10))).toFixed(3));
    }
    // BERSAMA: PN and PH compete; negative swing favours PN
    if (bw === 'BERSAMA') {
      return +(Math.max(0.10, Math.min(0.62, sigmoid(-tot * 10))).toFixed(3));
    }
    // BN seats: PN chance grows with pnF
    if (bw === 'BN-UMNO' || bw === 'BN-MCA') {
      const base_pn = pnF >= 2 ? 0.32 : 0.12;
      return +(Math.max(0.04, Math.min(0.58, base_pn - tot * 0.7)).toFixed(3));
    }
    return 0.04;
  }

  // ── BN perspective ──────────────────────────────────────────────
  if (coalition === 'BN') {
    if (bw.startsWith('GPS')) return 0.02;
    // WARISAN: some Sabah overlap with BN
    if (bw === 'WARISAN') return +(Math.max(0.06, Math.min(0.28, 0.14 + tot * 0.2)).toFixed(3));
    // BN defending: squeezed by PH (positive tot) and PN (high pnF), calibrated by GE-15 margin
    if (bw === 'BN-UMNO' || bw === 'BN-MCA') {
      const g15 = GE15[seat[0]];
      const pnPressure = pnF >= 2 ? 0.15 : 0;
      const anchor = g15 ? 0.48 + g15.majority / 100 * 0.45 : 0.68;
      return +(Math.max(0.10, Math.min(0.88, anchor - tot * 0.8 - pnPressure)).toFixed(3));
    }
    // PH seats: BN rarely the direct threat unless PN pressure is absent
    if (bw === 'PKR' || bw === 'DAP' || bw === 'AMANAH') {
      const anchor = pnF >= 2 ? 0.04 : 0.09;
      return +(Math.max(0.02, Math.min(0.28, anchor - tot * 0.4)).toFixed(3));
    }
    // BERSAMA: BN has moderate shot in mixed seats
    if (bw === 'BERSAMA') {
      return +(Math.max(0.08, Math.min(0.42, 0.22 - tot * 0.5)).toFixed(3));
    }
    // PN seats: BN very unlikely to flip PN fortresses
    if (bw === 'PN-PAS' || bw === 'PN-BERSATU') {
      return +(Math.max(0.02, Math.min(0.18, 0.06 + tot * 0.2)).toFixed(3));
    }
    return 0.04;
  }

  // ── GPS perspective ─────────────────────────────────────────────
  if (coalition === 'GPS') {
    // GPS seats are highly insulated; swing barely matters here
    if (bw.startsWith('GPS')) {
      return +(Math.max(0.80, Math.min(0.99, 0.92 + tot * 0.05)).toFixed(3));
    }
    // GPS does not contest Peninsular or Sabah seats
    return 0.02;
  }

  return 0.05;
}

// Returns true if a projected seat winner belongs to the given coalition
function isCoalitionSeat(projected, coalition) {
  if (coalition === 'PH')  return projected === 'PKR' || projected === 'DAP' || projected === 'AMANAH';
  if (coalition === 'PN')  return projected === 'PN-PAS' || projected === 'PN-BERSATU';
  if (coalition === 'BN')  return projected === 'BN-UMNO' || projected === 'BN-MCA';
  if (coalition === 'GPS') return projected.startsWith('GPS');
  return false;
}

// Classify probability into readable tier (generic — works for any coalition's perspective)
function probTier(p) {
  if (p >= 0.80) return { label: 'Stronghold',   color: '#15803D', bg: '#F0FDF4' };
  if (p >= 0.65) return { label: 'Safe',          color: '#16A34A', bg: '#DCFCE7' };
  if (p >= 0.50) return { label: 'Leaning',       color: '#CA8A04', bg: '#FEF9C3' };
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
  if (r[0] >= 65) return { type: 'malay',   label: 'Malay-dom',   col: '#185FA5' };
  if (r[1] >= 45) return { type: 'chinese', label: 'Chinese-dom', col: '#A32D2D' };
  if (r[2] >= 18) return { type: 'indian',  label: 'High Indian', col: '#854F0B' };
  return                  { type: 'mixed',   label: 'Mixed',       col: '#5F5E5A' };
}

function projectSeats(params, filters = {}, coalition = 'PH') {
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
    const prob = getCoalitionWinProb(s, params, coalition);
    const tier = probTier(prob);
    const g15  = GE15[s[0]];
    return {
      code: s[0], name: s[1], state: s[2], ge15: s[3],
      voters: s[4], youth: s[5], projected: w,
      winProb: prob,
      tierLabel: tier.label, tierColor: tier.color, tierBg: tier.bg,
      swing: +calcSwing(s, params).toFixed(4),
      raceProfile: prof.type, raceLabel: prof.label, raceCol: prof.col,
      melayu: r[0], cina: r[1], india: r[2], lain: r[3],
      ge15Majority: g15 ? g15.majority : null,
      ge15Turnout:  g15 ? g15.turnout  : null,
      ge15Ph:  g15 ? g15.ph  : null,
      ge15Pn:  g15 ? g15.pn  : null,
      ge15Bn:  g15 ? g15.bn  : null,
      ge15Gps: g15 ? g15.gps : null,
    };
  });

  if (sortBy === 'prob-asc')  mapped.sort((a, b) => a.winProb - b.winProb);
  if (sortBy === 'prob-desc') mapped.sort((a, b) => b.winProb - a.winProb);

  return mapped;
}

function getSeatAnalysis(params, coalition = 'PH') {
  const all = projectSeats(params, {}, coalition);

  const distribution = Array.from({ length: 10 }, (_, i) => {
    const lo = i * 10, hi = lo + 10;
    const seats = all.filter(s => {
      const pct = s.winProb * 100;
      return i < 9 ? (pct >= lo && pct < hi) : (pct >= lo && pct <= hi);
    });
    return { lo, hi, label: `${lo}–${hi}%`, count: seats.length, seats };
  });

  const isTarget = s => isCoalitionSeat(s.projected, coalition);

  const atRisk = all
    .filter(s => isTarget(s) && s.winProb < 0.65)
    .sort((a, b) => a.winProb - b.winProb)
    .slice(0, 25)
    .map(s => pick(s));

  const battleground = all
    .filter(s => s.winProb >= 0.38 && s.winProb <= 0.65)
    .sort((a, b) => a.winProb - b.winProb)
    .map(s => pick(s));

  const flipOpps = all
    .filter(s => !isTarget(s) && s.projected !== 'BERSAMA' && s.winProb > 0.28)
    .sort((a, b) => b.winProb - a.winProb)
    .slice(0, 20)
    .map(s => pick(s));

  const tiers = {
    stronghold: all.filter(s => isTarget(s) && s.winProb >= 0.80).length,
    safe:       all.filter(s => isTarget(s) && s.winProb >= 0.65 && s.winProb < 0.80).length,
    leaning:    all.filter(s => isTarget(s) && s.winProb >= 0.50 && s.winProb < 0.65).length,
    atRisk:     all.filter(s => isTarget(s) && s.winProb < 0.50).length,
    flipOpps:   all.filter(s => !isTarget(s) && s.projected !== 'BERSAMA' && s.winProb > 0.28).length,
  };

  const avgProb = +(all.reduce((s, x) => s + x.winProb, 0) / all.length).toFixed(3);

  return { distribution, atRisk, battleground, flipOpps, tiers, avgProb, total: all.length, coalition };
}

function pick(s) {
  return {
    code: s.code, name: s.name, state: s.state,
    ge15: s.ge15, projected: s.projected,
    winProb: s.winProb, tierLabel: s.tierLabel,
    tierColor: s.tierColor, tierBg: s.tierBg,
    swing: s.swing,
    melayu: s.melayu, cina: s.cina, india: s.india, lain: s.lain,
    ge15Majority: s.ge15Majority, ge15Ph: s.ge15Ph, ge15Pn: s.ge15Pn,
    ge15Bn: s.ge15Bn, ge15Gps: s.ge15Gps,
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

  // Per-state projected winner breakdown — returned once with summary, no extra API call needed
  const byState = {};
  SEATS.forEach(seat => {
    const state = seat[2];
    const w = getWinner(seat, params);
    const grp = w.startsWith('GPS') ? 'GPS' : w.startsWith('BN') ? 'BN' : w.startsWith('PN') ? 'PN' : w;
    if (!byState[state]) byState[state] = { total: 0 };
    byState[state][grp] = (byState[state][grp] || 0) + 1;
    byState[state].total++;
  });

  return {
    coalitions: { ph, bm, pn, bn, gps, war },
    phBloc, opp,
    verdict: { type: verdictType, text: verdictText },
    states: [...new Set(SEATS.map(s => s[2]))],
    byState,
  };
}

function getTopByRace(params, raceIdx, limit = 10, coalition = 'PH') {
  return [...SEATS]
    .sort((a, b) => (RACE[b[0]]?.[raceIdx] || 0) - (RACE[a[0]]?.[raceIdx] || 0))
    .slice(0, limit)
    .map(s => ({
      code: s[0], name: s[1], state: s[2],
      pct: RACE[s[0]]?.[raceIdx] || 0,
      projected: getWinner(s, params),
      winProb: getCoalitionWinProb(s, params, coalition),
    }));
}

module.exports = { getSummary, projectSeats, getTopByRace, tally, getSeatAnalysis, getPHWinProb, getCoalitionWinProb };
