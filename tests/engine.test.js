// Engine test suite. Runs in the browser (tests/index.html) — and in Node via `npm test`
// once Node is installed (node:test is picked up automatically if present).

import { rallyMatrices, makeSetSolver, makeMatchModel, simulateSet, US, THEM } from '../src/engine/markov.js';
import { rng, fitBetaPrior, logit } from '../src/engine/stats.js';
import { buildRotations, calibrate, candidateOrders } from '../src/engine/lineup.js';
import { startMatrix, solveGame, searchOrders } from '../src/engine/optimize.js';
import { fitHierarchical } from '../src/engine/hier.js';
import { parseDVW, dvwRotationRecords, dvwPlayerStats, dvwRallyRows, parseRallyCSV, parseCSV, autoMap, boxRowsToStats, parseRotationCSV, detectFormat } from '../src/engine/importers.js';
import { simulateDVW } from '../src/engine/dvwsim.js';
import { evaluateProspect } from '../src/engine/scouting.js';
import { DEMO_TEAM, DEMO_OPPONENT, demoDVWTeams } from '../src/app/demo.js';

export const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const ok = (cond, msg) => { if (!cond) throw new Error(msg || 'assertion failed'); };
const near = (a, b, tol, msg) => ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b.toFixed(4)} ± ${tol}, got ${a.toFixed(4)}`);

const avg = { so: Array(6).fill(0.6), bp: Array(6).fill(0.4) };
const randProfile = (R) => ({ so: Array.from({ length: 6 }, () => 0.5 + 0.2 * R()), bp: Array.from({ length: 6 }, () => 0.3 + 0.15 * R()) });

test('league-average teams: set and match are coin flips', () => {
  const m = makeMatchModel(rallyMatrices(avg, null), { bestOf: 5 });
  near(m.setProbToss(0), 0.5, 1e-9, 'set');
  near(m.matchProb(), 0.5, 1e-9, 'match');
  const m3 = makeMatchModel(rallyMatrices(avg, avg), { bestOf: 3 });
  near(m3.matchProb(), 0.5, 1e-9, 'bo3');
});

test('exact set probability matches Monte Carlo (20k sets)', () => {
  const R = rng(42);
  const us = randProfile(R), them = randProfile(R);
  const M = rallyMatrices(us, them);
  const solver = makeSetSolver(M, 25);
  const exact = solver.fromStart(2, 4, THEM);
  let wins = 0; const N = 20000; const S = rng(9);
  for (let k = 0; k < N; k++) if (simulateSet(M, 25, 2, 4, THEM, S).won) wins++;
  near(wins / N, exact, 0.012, 'MC vs exact');
});

test('deuce: symmetric teams at 24–24 are 50/50; serving at 24–24 is worth something', () => {
  const s = makeSetSolver(rallyMatrices(avg, null), 25);
  near(0.5 * s.prob(24, 24, 0, 0, US) + 0.5 * s.prob(24, 24, 0, 0, THEM), 0.5, 1e-9);
  ok(s.prob(31, 30, 0, 0, US) > 0.5, 'ahead in extended deuce');
  ok(s.prob(26, 24, 0, 0, US) === 1 && s.prob(20, 25, 0, 0, US) === 0, 'terminal states');
});

test('improving one rotation side-out raises set win probability', () => {
  const base = makeSetSolver(rallyMatrices(avg, null), 25).fromStart(0, 0, THEM);
  const better = { so: avg.so.map((x, i) => (i === 3 ? 0.7 : x)), bp: avg.bp };
  ok(makeSetSolver(rallyMatrices(better, null), 25).fromStart(0, 0, THEM) > base);
});

test('match outcome distribution sums to 1 and agrees with matchProb', () => {
  const R = rng(3);
  for (const bestOf of [3, 5]) {
    const m = makeMatchModel(rallyMatrices(randProfile(R), randProfile(R)), { bestOf, starts: [{ us: 1, them: 3 }] });
    const d = m.outcomeDist();
    const tot = Object.values(d).reduce((s, x) => s + x, 0);
    near(tot, 1, 1e-9, 'sum');
    const need = Math.ceil(bestOf / 2);
    const win = Object.entries(d).filter(([k]) => Number(k.split('-')[0]) === need).reduce((s, [, v]) => s + v, 0);
    near(win, m.matchProb(), 1e-9, 'win mass');
  }
});

test('live match probability at 0–0 equals pre-match probability given the serve', () => {
  const R = rng(5);
  const m = makeMatchModel(rallyMatrices(randProfile(R), randProfile(R)), { bestOf: 5, firstServe: US });
  const live = m.live({ setsUs: 0, setsThem: 0, a: 0, b: 0, rotUs: 0, rotThem: 0, serving: US, firstThisSet: US });
  near(live.match, m.matchProb(), 1e-9);
});

test('bo5 amplifies an edge more than bo3', () => {
  const strong = { so: avg.so.map((x) => x + 0.03), bp: avg.bp.map((x) => x + 0.03) };
  const M = rallyMatrices(strong, null);
  const p3 = makeMatchModel(M, { bestOf: 3 }).matchProb(), p5 = makeMatchModel(M, { bestOf: 5 }).matchProb();
  ok(p5 > p3 && p3 > 0.5, `p3=${p3} p5=${p5}`);
});

test('libero: replaces the back-row MB; MB serves unless the libero serves for her', () => {
  const team = structuredClone(DEMO_TEAM);
  const built = buildRotations(team);
  const lib = team.libero.id;
  for (const r of built.rotations) {
    r.receiveZones.forEach((id, zi) => { if (team.libero.replaces.includes(id)) ok(![1, 5, 6].includes(zi + 1), 'MB left in back row on receive'); });
    const baseServer = r.baseZones[0];
    if (team.libero.replaces.includes(baseServer)) ok(r.server === (team.libero.servesFor === baseServer ? lib : baseServer), 'serve rule');
  }
});

test('libero effect: a better libero raises side-out in every rotation she passes in', () => {
  const team = structuredClone(DEMO_TEAM);
  const a = buildRotations(team).profile;
  const L = team.players.find((p) => p.id === team.libero.id);
  L.pass = { att: 400, p0: 8, p1: 40, p2: 140, p3: 212 };
  const b = buildRotations(team).profile;
  ok(b.so.every((x, i) => x > a.so[i]), 'SO should rise everywhere');
});

test('serving sub only changes break-point in the rotation she serves', () => {
  const team = structuredClone(DEMO_TEAM);
  team.subs = [];
  const before = buildRotations(team).profile;
  const target = team.order.find((id) => team.players.find((p) => p.id === id).pos === 'OPP');
  team.players.push({ id: 'ss', name: 'Sub Server', num: '30', pos: 'DS', serve: { att: 300, ace: 45, err: 18 } });
  team.subs = [{ outId: target, inId: 'ss', mode: 'serve' }];
  const after = buildRotations(team).profile;
  const changed = after.bp.map((x, i) => Math.abs(x - before.bp[i]) > 1e-9);
  ok(changed.filter(Boolean).length === 1, 'exactly one rotation changes');
  ok(after.so.every((x, i) => Math.abs(x - before.so[i]) < 1e-12), 'SO unchanged');
});

test('calibration matches observed means and preserves differences', () => {
  const team = structuredClone(DEMO_TEAM);
  const obs = { so: [0.64, 0.6, 0.58, 0.62, 0.57, 0.63], bp: [0.42, 0.38, 0.4, 0.36, 0.41, 0.39] };
  team.calibration = calibrate(team, obs);
  const p = buildRotations(team).profile;
  near(p.so.map(logit).reduce((s, x) => s + x) / 6, obs.so.map(logit).reduce((s, x) => s + x) / 6, 1e-9);
});

test('5-1 order candidates keep setter first and pairs opposite', () => {
  const team = structuredClone(DEMO_TEAM);
  const c = candidateOrders(team);
  ok(c.length === 8, `8 orders, got ${c.length}`);
  const pos = Object.fromEntries(team.players.map((p) => [p.id, p.pos]));
  for (const o of c) { ok(pos[o[0]] === 'S' && pos[o[3]] === 'OPP'); ok(pos[o[1]] === pos[o[4]] && pos[o[2]] === pos[o[5]]); }
  const res = searchOrders(team, DEMO_OPPONENT);
  ok(res.results[0].value >= res.current.value);
});

test('start-rotation game: value between maximin and maximax', () => {
  const R = rng(11);
  const M = startMatrix(randProfile(R), randProfile(R));
  const g = solveGame(M, 8000);
  const maximin = Math.max(...M.map((r) => Math.min(...r)));
  ok(g.value >= maximin - 1e-3, 'value ≥ maximin');
  near(g.us.reduce((s, x) => s + x), 1, 1e-9);
});

test('hierarchical model: recovers structural rotation ordering and shrinks small samples', () => {
  const R = rng(21);
  const trueAlpha = [0.35, -0.25, 0.1, -0.4, 0.2, 0];
  const recs = [];
  for (const [si, season] of ['2022', '2023', '2024', '2025'].entries()) {
    const beta = 0.15 * R.normal();
    for (let r = 0; r < 6; r++) {
      const p = 1 / (1 + Math.exp(-(logit(0.6) + trueAlpha[r] + beta + 0.08 * R.normal())));
      const n = si === 3 ? 25 : 180;
      let won = 0; for (let k = 0; k < n; k++) if (R() < p) won++;
      recs.push({ season, rot: r, phase: 'SO', won, n }, { season, rot: r, phase: 'BP', won: Math.round(n * 0.4), n });
    }
  }
  const fit = fitHierarchical(recs, { iters: 3000, burn: 800 });
  const st = fit.phases.SO.rots.map((x) => x.structural.mean);
  const rank = (a) => a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]).map((x) => x[1]);
  ok(rank(st)[0] === 3 && rank(st)[5] === 0, `worst R4 / best R1, got ${rank(st)}`);
  // shrinkage: current-season (n=25) estimates sit between raw and structural
  const cur = fit.phases.SO.rots;
  const moved = cur.filter((x) => Math.abs(x.current.mean - x.structural.mean) <= Math.abs(x.raw - x.structural.mean) + 1e-9).length;
  ok(moved >= 5, `shrinkage toward structure in ≥5 rotations, got ${moved}`);
  ok(fit.phases.SO.persistence.mean > 0.5, `persistence ${fit.phases.SO.persistence.mean}`);
});

test('DVW round trip: simulated match → .dvw → parser gives identical rotation counts', () => {
  const { home, visiting } = demoDVWTeams();
  const sim = simulateDVW({ home, visiting, seed: 77 });
  const parsed = parseDVW(sim.text);
  ok(parsed.meta.home === home.name && parsed.meta.visiting === visiting.name, 'team names');
  ok(parsed.rallies.length === sim.truth.length, `rallies ${parsed.rallies.length} vs ${sim.truth.length}`);
  const truthRecs = {};
  for (const t of sim.truth) { const ph = t.serving === 'home' ? 'BP' : 'SO'; const k = ph + t.homeRot; truthRecs[k] ||= { won: 0, n: 0 }; truthRecs[k].n++; if (t.winner === 'home') truthRecs[k].won++; }
  for (const rec of dvwRotationRecords(parsed, 'home')) {
    const t = truthRecs[rec.phase + rec.rot];
    ok(t && t.n === rec.n && t.won === rec.won, `mismatch ${rec.phase}${rec.rot}`);
  }
  const stats = dvwPlayerStats(parsed, 'home');
  const serves = stats.reduce((s, p) => s + p.stats.serve.att, 0);
  ok(serves === sim.truth.filter((t) => t.serving === 'home').length, 'every home serve counted');
  ok(stats.some((p) => p.name !== `#${p.number}`), 'names from [3PLAYERS-H]');
});

test('CSV: SoloStats-style box score auto-maps and converts', () => {
  const csv = 'Player,#,SP,K,E,TA,SA,SE,R,RE,Pass Rating,Digs,BS,BA\nAva Reyes,7,12,48,12,130,9,6,110,5,2.25,30,1,4\nTotals,,12,48,12,130,9,6,110,5,,30,1,4\n';
  const parsed = parseCSV(csv);
  ok(detectFormat(parsed.headers) === 'boxscore');
  const map = autoMap(parsed.headers);
  ok(map.kills === 'K' && map.attAtt === 'TA' && map.aces === 'SA' && map.recErr === 'RE' && map.number === '#', JSON.stringify(map));
  const rows = boxRowsToStats(parsed.rows, map);
  ok(rows.length === 1, 'totals row dropped');
  const p = rows[0].stats.pass;
  const avgPass = (p.p1 + 2 * p.p2 + 3 * p.p3) / p.att;
  near(avgPass, 2.25, 0.08, 'pass avg preserved');
});

test('CSV: original 3-column rotation file still works', () => {
  const r = parseRotationCSV(parseCSV('Rotation,SO%,BP%\n1,62,41\n2,58%,38%\n3,0.6,0.4\n4,55,35\n5,64,44\n6,59,39\n'));
  near(r.so[1], 0.58, 1e-9); near(r.bp[2], 0.4, 1e-9);
});

test('recruiting: same stats at a weaker level score lower; bigger samples → narrower range', () => {
  const base = { id: 'x', pos: 'OH', height: "6'1", approach: 119, stats: { sets: 60, attack: { att: 500, k: 210, e: 60 }, serve: { att: 250, ace: 22, err: 20 }, pass: { att: 300, p0: 12, p1: 60, p2: 110, p3: 118 }, dig: { digs: 150 }, block: { stuffs: 20 } } };
  const open = evaluateProspect({ ...base, level: 'club-open' }), hs = evaluateProspect({ ...base, level: 'hs-small' });
  ok(open.score > hs.score, `${open.score} > ${hs.score}`);
  const small = structuredClone(base); small.stats = { sets: 8, attack: { att: 60, k: 25, e: 7 }, serve: { att: 30, ace: 3, err: 2 }, pass: { att: 30, p0: 1, p1: 6, p2: 11, p3: 12 }, dig: { digs: 18 }, block: { stuffs: 2 } };
  const s = evaluateProspect({ ...small, level: 'club-open' });
  ok(s.hi - s.lo > open.hi - open.lo, 'wider range for small samples');
});

test('empirical-Bayes prior: recovers population mean', () => {
  const R = rng(4);
  const units = Array.from({ length: 200 }, () => { const p = 0.3 + 0.1 * R(); const n = 50; let y = 0; for (let k = 0; k < n; k++) if (R() < p) y++; return { y, n }; });
  near(fitBetaPrior(units).m, 0.35, 0.01);
});

test('DVW → rally log: every set starts 0–0 and scores follow the rallies', () => {
  const { home, visiting } = demoDVWTeams();
  const parsed = parseDVW(simulateDVW({ home, visiting, seed: 5 }).text);
  for (const side of ['home', 'visiting']) {
    const rows = dvwRallyRows(parsed, side, { matchId: 'm' });
    ok(rows.length === parsed.rallies.length, 'one row per rally');
    let a = 0, b = 0, set = 0;
    for (const r of rows) {
      if (r.set !== set) { set = r.set; a = 0; b = 0; }
      ok(r.score_us === a && r.score_them === b, `score mismatch in set ${r.set}: ${r.score_us}-${r.score_them} vs ${a}-${b}`);
      if (r.won) a++; else b++;
    }
  }
});

test('rally-log CSV is detected and parsed', () => {
  const csv = parseCSV('match_id,set,score_us,score_them,rot_us,rot_them,serving,won\nm1,1,0,0,0,2,us,1\nm1,1,1,0,0,2,us,0\nm1,1,1,1,0,3,them,9\n');
  ok(detectFormat(csv.headers) === 'rallies');
  const rows = parseRallyCSV(csv);
  ok(rows.length === 2, 'invalid won value dropped');
  ok(rows[0].serving === 'us' && rows[1].won === 0 && rows[0].rot_them === 2);
});
