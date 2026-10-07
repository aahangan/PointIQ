// Data importers.
//  - DataVolley .dvw scout files (what Hudl/VolleyMetrics, DataVolley, VolleyStation and
//    ovscout2 produce): rally-by-rally rotations for BOTH teams + player skill counts.
//  - Box-score CSV from SoloStats, Hudl, MaxPreps, NCAA stat sheets (header auto-mapping
//    with a manual override, because every vendor names columns differently).
//  - Rotation CSVs: the original 3-column format, a counts format, and a multi-season format.

// ---------- CSV ------------------------------------------------------------------------
export function parseCSV(text) {
  text = text.replace(/^﻿/, '');
  const delim = (text.split('\n')[0].match(/\t/g) || []).length > (text.split('\n')[0].match(/,/g) || []).length ? '\t' : ',';
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((x) => x.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((x) => x.trim() !== '')) rows.push(row);
  if (!rows.length) return { headers: [], rows: [] };
  const headers = rows[0].map((h) => h.trim());
  return { headers, rows: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [h, (r[i] ?? '').trim()]))) };
}

const norm = (h) => { const x = h.toLowerCase().trim(); return x === '#' || x === 'no.' ? 'no' : x.replace(/[^a-z0-9%]/g, ''); };
export const num = (v) => {
  if (v == null) return NaN;
  const s = String(v).replace(/[%,\s]/g, '');
  if (s === '' || s === '-' || s === '—') return NaN;
  return Number(s);
};
const rate = (v) => { const x = num(v); return Number.isFinite(x) ? (x > 1.0001 ? x / 100 : x) : NaN; };

// ---------- Box score header mapping -----------------------------------------------------
// Canonical field → header spellings seen in SoloStats, Hudl, MaxPreps and NCAA box scores.
export const BOX_FIELDS = {
  number: ['#', 'no', 'num', 'jersey', 'number', 'jersey#', 'uni'],
  name: ['name', 'player', 'athlete', 'playername', 'fullname'],
  pos: ['pos', 'position', 'role'],
  sets: ['sp', 'sets', 'setsplayed', 's'],
  kills: ['k', 'kills', 'kill'],
  attErr: ['e', 'ae', 'attackerrors', 'atterr', 'hitterr', 'attackerror', 'errors'],
  attAtt: ['ta', 'att', 'attempts', 'totalattacks', 'totatt', 'attackattempts', 'tatt'],
  aces: ['sa', 'aces', 'ace', 'serviceaces', 'srvace'],
  srvErr: ['se', 'serveerrors', 'srverr', 'serviceerrors', 'serr'],
  srvAtt: ['sat', 'serveattempts', 'srvatt', 'serves', 'totalserves', 'sva', 'srvattempts'],
  recAtt: ['r', 'ra', 'rec', 'receptions', 'recatt', 'receiveattempts', 'srvrcv', 'passatt', 'tr'],
  recErr: ['re', 'receptionerrors', 'recerr', 'receiveerrors', 'srvrcverr', 'passerr'],
  passRating: ['pr', 'passrating', 'rating', 'passavg', 'recavg', 'srvrcvavg', 'rcvrating', 'pass'],
  p3: ['3', 'r3', 'pass3', 'perfect'],
  p2: ['2', 'r2', 'pass2', 'good'],
  p1: ['1', 'r1', 'pass1', 'poor'],
  digs: ['dig', 'digs', 'd'],
  blockSolo: ['bs', 'blocksolo', 'soloblocks', 'solo'],
  blockAssist: ['ba', 'blockassist', 'blockassists', 'assistblocks'],
  blocks: ['blk', 'blocks', 'totalblocks', 'tb'],
  assists: ['ast', 'a', 'assists', 'setassists'],
  // recruiting extras
  grad: ['grad', 'gradyear', 'class', 'year', 'classof'],
  height: ['ht', 'height'],
  club: ['club', 'clubteam'],
  school: ['school', 'highschool', 'hs'],
  state: ['st', 'state'],
  level: ['level', 'competition', 'division', 'league'],
  approach: ['approach', 'approachtouch', 'touch', 'spike', 'spiketouch'],
  blockTouch: ['blocktouch', 'blockreach', 'standingblock'],
  hudl: ['hudl', 'hudlurl', 'video', 'profile', 'link', 'url'],
};

export function autoMap(headers) {
  const map = {};
  const used = new Set();
  for (const [field, aliases] of Object.entries(BOX_FIELDS)) {
    const h = headers.find((x) => !used.has(x) && aliases.includes(norm(x)));
    if (h) { map[field] = h; used.add(h); }
  }
  return map;
}

export function detectFormat(headers) {
  const n = headers.map(norm);
  if (['rotus', 'serving', 'won'].every((h) => n.includes(h))) return 'rallies';
  if (n.includes('season') && n.some((h) => h.startsWith('rot')) && n.includes('phase')) return 'multiseason';
  if (n.some((h) => h.startsWith('rot')) && n.length <= 6) return 'rotation';
  const m = autoMap(headers);
  if ((m.grad || m.level || m.approach) && m.name) return 'prospects';
  if (m.name || m.number) return 'boxscore';
  return 'unknown';
}

const g = (row, map, f) => (map[f] ? row[map[f]] : undefined);
const n0 = (v) => { const x = num(v); return Number.isFinite(x) ? x : 0; };

// Box score rows → PointIQ stat objects (same shape the lineup model reads).
export function boxRowsToStats(rows, map) {
  return rows.map((row) => {
    const name = (g(row, map, 'name') || '').trim();
    const number = (g(row, map, 'number') || '').toString().replace(/\D/g, '');
    if (!name && !number) return null;
    if (/^(totals?|team|opponent)$/i.test(name)) return null;
    const sets = n0(g(row, map, 'sets'));
    const aces = n0(g(row, map, 'aces')), srvErr = n0(g(row, map, 'srvErr'));
    let srvAtt = n0(g(row, map, 'srvAtt'));
    if (!srvAtt && (aces || srvErr)) srvAtt = Math.round(Math.max(aces + srvErr, sets * 4));
    let recAtt = n0(g(row, map, 'recAtt'));
    const recErr = n0(g(row, map, 'recErr'));
    const pr = num(g(row, map, 'passRating'));
    let p = { p0: recErr, p1: 0, p2: 0, p3: 0 };
    const p3 = num(g(row, map, 'p3')), p2 = num(g(row, map, 'p2')), p1 = num(g(row, map, 'p1'));
    if ([p3, p2, p1].every(Number.isFinite)) {
      p = { p0: recErr, p1, p2, p3 };
      if (!recAtt) recAtt = recErr + p1 + p2 + p3;
    } else if (recAtt > 0 && Number.isFinite(pr)) {
      // Only an average: spread non-error passes to match it (3-point scale).
      const ok = Math.max(0, recAtt - recErr);
      const target = ok ? Math.min(3, (pr * recAtt) / ok) : 2; // avg over non-error passes
      // Distribution over {1,2,3} with mean `target` and a realistic spread.
      let f1 = Math.max(0, 0.2 - 0.3 * (target - 2)), f3 = f1 + (target - 2);
      if (f3 < 0) { f3 = 0; f1 = 2 - target; }
      if (f3 > 1) { f3 = 1; f1 = 0; }
      p = { p0: recErr, p3: Math.round(ok * f3), p1: Math.round(ok * f1), p2: 0 };
      p.p2 = Math.max(0, ok - p.p3 - p.p1);
    } else if (recAtt > 0) {
      const ok = Math.max(0, recAtt - recErr); p = { p0: recErr, p3: Math.round(ok * 0.32), p2: Math.round(ok * 0.41), p1: 0 }; p.p1 = Math.max(0, ok - p.p3 - p.p2);
    }
    const bs = n0(g(row, map, 'blockSolo')), ba = n0(g(row, map, 'blockAssist'));
    const blocks = n0(g(row, map, 'blocks')) || bs + ba * 0.5;
    return {
      name: name || `#${number}`, number, pos: (g(row, map, 'pos') || '').toUpperCase(),
      stats: {
        sets,
        serve: { att: srvAtt, ace: aces, err: srvErr },
        pass: { att: recAtt, ...p },
        attack: { att: n0(g(row, map, 'attAtt')), k: n0(g(row, map, 'kills')), e: n0(g(row, map, 'attErr')) },
        block: { sets, stuffs: blocks },
        dig: { sets, digs: n0(g(row, map, 'digs')) },
        assists: n0(g(row, map, 'assists')),
      },
      extra: {
        grad: g(row, map, 'grad'), height: g(row, map, 'height'), club: g(row, map, 'club'), school: g(row, map, 'school'),
        state: g(row, map, 'state'), level: g(row, map, 'level'), approach: g(row, map, 'approach'), blockTouch: g(row, map, 'blockTouch'), hudl: g(row, map, 'hudl'),
      },
    };
  }).filter(Boolean);
}

// ---------- Rotation CSVs ----------------------------------------------------------------
// Accepts: rotation,so,bp (fractions or %) | rotation,so_won,so_total,bp_won,bp_total
// Rotation cells: 1..6, "R1", "Rotation 1".
const rotIdx = (v) => { const m = String(v).match(/([1-6])/); return m ? Number(m[1]) - 1 : -1; };

export function parseRotationCSV({ headers, rows }) {
  const n = headers.map(norm);
  const col = (pred) => headers[n.findIndex(pred)];
  const rc = col((h) => h.startsWith('rot'));
  const soW = col((h) => /^(so|sideout)(won|w|wins)$/.test(h)), soT = col((h) => /^(so|sideout)(total|n|att|opps|opportunities)$/.test(h));
  const bpW = col((h) => /^(bp|pointscore|ps|breakpoint)(won|w|wins)$/.test(h)), bpT = col((h) => /^(bp|pointscore|ps|breakpoint)(total|n|att|opps|opportunities)$/.test(h));
  const so = new Array(6).fill(NaN), bp = new Array(6).fill(NaN), counts = [];
  for (const row of rows) {
    const r = rotIdx(row[rc]);
    if (r < 0) continue;
    if (soW && soT) {
      const a = num(row[soW]), b = num(row[soT]), c = num(row[bpW]), d = num(row[bpT]);
      so[r] = a / b; bp[r] = c / d;
      counts.push({ rot: r, phase: 'SO', won: a, n: b }, { rot: r, phase: 'BP', won: c, n: d });
    } else {
      const soc = col((h) => h.startsWith('so') || h.includes('sideout') || h.includes('receiv'));
      const bpc = col((h) => h.startsWith('bp') || h.includes('pointscor') || h.includes('break') || h.includes('serv'));
      so[r] = rate(row[soc]); bp[r] = rate(row[bpc]);
    }
  }
  return { so, bp, counts };
}

export function parseMultiSeasonCSV({ headers, rows }) {
  const n = headers.map(norm);
  const col = (pred) => headers[n.findIndex(pred)];
  const cs = col((h) => h === 'season'), cr = col((h) => h.startsWith('rot')), cp = col((h) => h === 'phase');
  const cw = col((h) => /^(won|wins|w|points)$/.test(h)), cn = col((h) => /^(total|n|att|opps|opportunities|rallies)$/.test(h));
  return rows.map((row) => ({ season: row[cs], rot: rotIdx(row[cr]), phase: /^b|^p/i.test(row[cp]) ? 'BP' : 'SO', won: num(row[cw]), n: num(row[cn]) }))
    .filter((r) => r.rot >= 0 && Number.isFinite(r.won) && r.n > 0);
}

// ---------- DataVolley .dvw --------------------------------------------------------------
const DV_ROLE = { 1: 'L', 2: 'OH', 3: 'OPP', 4: 'MB', 5: 'S' };
const SKILL_RE = /^([*a])(\d{2})([SREABDF])([HMQTUNO~])([#+!\-/=~])/;

export function parseDVW(text) {
  const lines = text.replace(/\r/g, '').split('\n');
  let section = '';
  const meta = { date: '', teams: [], warnings: [] };
  const players = { home: [], visiting: [] };
  const rallies = [], touches = [];
  let setNo = 1, hz = 1, vz = 1, rally = null, lastScore = [0, 0], scoutLines = 0;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('[3')) { section = line; continue; }
    const f = line.split(';');
    if (section === '[3MATCH]' && !meta.date) meta.date = f[0];
    else if (section === '[3TEAMS]') meta.teams.push({ id: f[0], name: f[1] });
    else if (section === '[3PLAYERS-H]' || section === '[3PLAYERS-V]') {
      const side = section.endsWith('H]') ? 'home' : 'visiting';
      players[side].push({ number: String(Number(f[1])), last: f[9] || '', first: f[10] || '', pos: DV_ROLE[f[12]] || '' });
    } else if (section === '[3SCOUT]') {
      scoutLines++;
      const code = f[0];
      if (/^\*\*\dset/i.test(code)) { const m = code.match(/\*\*(\d)set/i); if (m) setNo = Number(m[1]) + 1; lastScore = [0, 0]; continue; }
      const side = code[0] === '*' ? 'home' : code[0] === 'a' ? 'visiting' : null;
      if (!side) continue;
      const z = code.match(/^[*a]z(\d)/);
      if (z) { if (side === 'home') hz = Number(z[1]); else vz = Number(z[1]); continue; }
      const p = code.match(/^[*a]p(\d+):(\d+)/);
      if (p) {
        lastScore = [Number(p[1]), Number(p[2])];
        if (rally) { rally.winner = side; rally.homeScore = lastScore[0]; rally.visScore = lastScore[1]; rallies.push(rally); rally = null; }
        continue;
      }
      const s = code.match(SKILL_RE);
      if (!s) continue;
      const set = Number(f[8]) || setNo;
      const hsp = Number(f[9]) || hz, vsp = Number(f[10]) || vz;
      const pos = { home: f.slice(14, 20).map((x) => String(Number(x))), visiting: f.slice(20, 26).map((x) => String(Number(x))) };
      const t = { side, number: String(Number(s[2])), skill: s[3], type: s[4], ev: s[5], set, rallyIdx: rallies.length };
      if (t.skill === 'S') {
        if (rally) meta.warnings.push(`Rally without a point code before serve in set ${set}`);
        if (rallies.length && rallies[rallies.length - 1].set !== set && !rally) lastScore = [0, 0]; // new set without a marker line
        rally = { set, serving: side, homeRot: hsp - 1, visRot: vsp - 1, homeScoreBefore: lastScore[0], visScoreBefore: lastScore[1], positions: pos.home[0] !== 'NaN' ? pos : null };
        if (set !== setNo) { setNo = set; }
      }
      touches.push(t);
    }
  }
  if (!scoutLines) meta.warnings.push('No [3SCOUT] section found — is this a DataVolley file?');
  meta.home = meta.teams[0]?.name || 'Home';
  meta.visiting = meta.teams[1]?.name || 'Visiting';
  return { meta, players, rallies, touches };
}

// Rally-log rows (the predictive model's input) for one side of a parsed match.
export function dvwRallyRows(parsed, side, { matchId, opponent = '', season = '' } = {}) {
  const ours = side === 'home';
  return parsed.rallies.filter((r) => Number.isFinite(r.homeRot) && r.homeRot >= 0 && r.homeRot <= 5).map((r) => ({
    match_id: matchId, opponent, season, set: r.set,
    score_us: ours ? r.homeScoreBefore : r.visScoreBefore, score_them: ours ? r.visScoreBefore : r.homeScoreBefore,
    rot_us: ours ? r.homeRot : r.visRot, rot_them: ours ? r.visRot : r.homeRot,
    serving: r.serving === side ? 'us' : 'them', won: r.winner === side ? 1 : 0, server: '',
  }));
}

export function parseRallyCSV({ rows }) {
  return rows.map((r) => ({
    match_id: r.match_id, date: r.date || '', opponent: r.opponent || '', season: r.season || '', set: Number(r.set),
    score_us: Number(r.score_us), score_them: Number(r.score_them), rot_us: Number(r.rot_us), rot_them: r.rot_them === '' || r.rot_them == null ? -1 : Number(r.rot_them),
    serving: /^(us|0|home|true)$/i.test(String(r.serving).trim()) ? 'us' : 'them', won: Number(r.won), server: r.server || '',
    ...(r.target ? { target: Number(r.target) } : {}),
  })).filter((r) => r.match_id && r.rot_us >= 0 && r.rot_us <= 5 && (r.won === 0 || r.won === 1) && Number.isFinite(r.score_us));
}

// Rotation SO/BP counts for one side of a parsed match (also works for the opponent: free scouting report).
export function dvwRotationRecords(parsed, side, season = '') {
  const rot = side === 'home' ? 'homeRot' : 'visRot';
  const agg = {};
  for (const r of parsed.rallies) {
    if (r[rot] < 0 || r[rot] > 5 || !Number.isFinite(r[rot])) continue;
    const phase = r.serving === side ? 'BP' : 'SO';
    const key = phase + r[rot];
    agg[key] ||= { season, rot: r[rot], phase, won: 0, n: 0 };
    agg[key].n++;
    if (r.winner === side) agg[key].won++;
  }
  return Object.values(agg);
}

export function recordsToProfile(records, fallback = 0.6) {
  const so = new Array(6).fill(NaN), bp = new Array(6).fill(NaN);
  const acc = {};
  for (const r of records) { const k = r.phase + r.rot; acc[k] ||= { won: 0, n: 0 }; acc[k].won += r.won; acc[k].n += r.n; }
  for (let i = 0; i < 6; i++) {
    so[i] = acc['SO' + i]?.n ? acc['SO' + i].won / acc['SO' + i].n : fallback;
    bp[i] = acc['BP' + i]?.n ? acc['BP' + i].won / acc['BP' + i].n : 1 - fallback;
  }
  return { so, bp };
}

const PASS_Q = { '#': 3, '+': 2, '!': 2, '-': 1, '/': 1, '=': 0 };
export function dvwPlayerStats(parsed, side) {
  const out = {};
  const get = (n) => (out[n] ||= { number: n, sets: new Set(), serve: { att: 0, ace: 0, err: 0 }, pass: { att: 0, p0: 0, p1: 0, p2: 0, p3: 0 }, attack: { att: 0, k: 0, e: 0 }, block: { stuffs: 0 }, dig: { digs: 0 } });
  for (const r of parsed.rallies) if (r.positions) for (const n of r.positions[side]) if (n !== 'NaN') get(n).sets.add(r.set);
  for (const t of parsed.touches) {
    if (t.side !== side) continue;
    const p = get(t.number);
    p.sets.add(t.set);
    if (t.skill === 'S') { p.serve.att++; if (t.ev === '#') p.serve.ace++; if (t.ev === '=') p.serve.err++; }
    if (t.skill === 'R') { p.pass.att++; p.pass['p' + (PASS_Q[t.ev] ?? 2)]++; }
    if (t.skill === 'A') { p.attack.att++; if (t.ev === '#') p.attack.k++; if (t.ev === '=' || t.ev === '/') p.attack.e++; }
    if (t.skill === 'B' && t.ev === '#') p.block.stuffs++;
    if (t.skill === 'D' && t.ev !== '=') p.dig.digs++;
  }
  const roster = Object.fromEntries(parsed.players[side].map((p) => [p.number, p]));
  return Object.values(out).map((p) => {
    const sets = p.sets.size;
    const info = roster[p.number] || {};
    return { number: p.number, name: [info.first, info.last].filter(Boolean).join(' ') || `#${p.number}`, pos: info.pos || '', stats: { sets, serve: p.serve, pass: p.pass, attack: p.attack, block: { sets, stuffs: p.block.stuffs }, dig: { sets, digs: p.dig.digs } } };
  });
}

// Serving order as it actually appeared in the first rally of the match (zone 1..6 → order).
export function dvwStartingOrder(parsed, side) {
  const r = parsed.rallies.find((x) => x.positions);
  return r ? r.positions[side] : null;
}

// Merge stat lines from several matches into one per player number.
export function mergeStats(a, b) {
  if (!a) return structuredClone(b);
  const add = (x = {}, y = {}) => Object.fromEntries([...new Set([...Object.keys(x), ...Object.keys(y)])].map((k) => [k, (x[k] || 0) + (y[k] || 0)]));
  return { sets: (a.sets || 0) + (b.sets || 0), serve: add(a.serve, b.serve), pass: add(a.pass, b.pass), attack: add(a.attack, b.attack), block: add(a.block, b.block), dig: add(a.dig, b.dig), assists: (a.assists || 0) + (b.assists || 0) };
}
