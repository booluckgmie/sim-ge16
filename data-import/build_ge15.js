const fs = require('fs');

// Headers (we grepped out the actual header row, so hardcode indices)
// stats:   date,election,state,seat,voters_total,ballots_issued,ballots_not_returned,
//          votes_rejected,votes_valid,majority,n_candidates,voter_turnout,majority_perc,...
// ballots: date,election,state,seat,ballot_order,candidate_uid,name_on_ballot,name,
//          sex,ethnicity,age,coalition_on_ballot,party_uid,party,coalition_uid,coalition,
//          votes,votes_perc,rank,result

function rows(file) {
  return fs.readFileSync(file, 'utf8').trim().split('\n').map(l => l.split(','));
}

function normCode(seat) {
  const m = seat ? seat.match(/P\.(\d+)/) : null;
  return m ? 'P' + m[1].padStart(3, '0') : seat;
}

function groupCoalition(c) {
  if (!c) return 'OTHER';
  const u = c.trim().toUpperCase();
  if (u === 'PH')  return 'PH';
  if (u === 'PN')  return 'PN';
  if (u === 'BN')  return 'BN';
  if (u === 'GPS') return 'GPS';
  if (u === 'GRS') return 'BN';
  if (u === 'WARISAN' || u === 'WARISAN-PLUS') return 'WARISAN';
  return 'OTHER';
}

// stats: seat=3, n_cand=10, turnout=11, majority_perc=12
const statsData = {};
rows('/home/user/sim-ge16/data-import/ge15_stats.csv').forEach(r => {
  const code = normCode(r[3]);
  if (!code) return;
  statsData[code] = {
    majority: +(parseFloat(r[12]) || 0).toFixed(2),
    turnout:  +(parseFloat(r[11]) || 75).toFixed(1),
    n_cand:   parseInt(r[10]) || 3,
    state:    (r[2] || '').trim(),
  };
});

// ballots: seat=3, coalition=15, votes_perc=17
const coalData = {};
rows('/home/user/sim-ge16/data-import/ge15_ballots.csv').forEach(r => {
  const code = normCode(r[3]);
  if (!code) return;
  const grp = groupCoalition(r[15]);
  const pct = parseFloat(r[17]) || 0;
  if (!coalData[code]) coalData[code] = {};
  coalData[code][grp] = (coalData[code][grp] || 0) + pct;
});

// merge & output
const result = {};
Object.keys(statsData).forEach(code => {
  const s = statsData[code];
  const c = coalData[code] || {};
  result[code] = {
    code,
    state:    s.state,
    majority: s.majority,
    turnout:  s.turnout,
    n_cand:   s.n_cand,
    ph:  +(c.PH      || 0).toFixed(2),
    pn:  +(c.PN      || 0).toFixed(2),
    bn:  +(c.BN      || 0).toFixed(2),
    gps: +(c.GPS     || 0).toFixed(2),
    war: +(c.WARISAN || 0).toFixed(2),
    oth: +(c.OTHER   || 0).toFixed(2),
  };
});

const sorted = Object.values(result).sort((a,b) => a.code.localeCompare(b.code));
const lines  = sorted.map(r => `  ${JSON.stringify(r.code)}:${JSON.stringify(r)}`);

console.log('// GE-15 actual results per parliamentary seat');
console.log('// Source: Thevesh/paper-meco-results — majority%, turnout, coalition vote-shares');
console.log('const GE15 = {');
console.log(lines.join(',\n'));
console.log('};');
console.log('module.exports = { GE15 };');
