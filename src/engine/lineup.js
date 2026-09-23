// Player → rotation model. Turns a roster, a serving order, libero rules and a sub plan into
// per-rotation side-out (SO) and break-point (BP) rates. This is what lets PointIQ answer
// "what if" questions the raw rotation stats can't: a different libero, a serving sub, a DS
// for the opposite, or a new rotation order.
//
// Rally decomposition (vs a league-average opponent):
//   SO_r = oppServeErr + (1 − oppServeErr) · Σ_q P(pass q | passers in r) · SO_q(attack in r)
//   BP_r = ace(server) + inPlay(server) · W(block, defense, transition attack in r)
// Every player rate is shrunk toward a position prior before use (small samples don't swing lineups).

import { logit, expit, clamp, mean } from './stats.js';

export const POSITIONS = ['S', 'OH', 'MB', 'OPP', 'L', 'DS'];

export const LEAGUE = {
  so: 0.6,
  ace: 0.065, serr: 0.1,
  pass: [0.07, 0.25, 0.38, 0.3], // P(0=aced),1,2,3 over served balls that land in play
  soGivenPass: [0, 0.46, 0.6, 0.7],
  winInPlayServing: 0.401, // P(serving team wins | serve in play, not an ace)
  eff: 0.23, // hitting efficiency (K−E)/TA
  frontBlocks: 1.8, backDefense: 9.5, attackOptions: 2.9,
  // Effect sizes are informed priors; with enough .dvw rallies they should be re-fit per program.
  beta: { att: 2.0, opts: 0.08, blk: 0.25, def: 0.035, trans: 1.2 },
};

const POS_PRIOR = {
  // dps = digs per set as box scores record them (exposure-biased: middles rarely play back row);
  // bdv = back-row defensive value when actually on the floor in the back row.
  S: { kill: 0.25, aerr: 0.12, bps: 0.3, dps: 2.8, bdv: 2.8, attacker: false, passer: false },
  OH: { kill: 0.36, aerr: 0.15, bps: 0.35, dps: 2.4, bdv: 3.0, attacker: true, passer: true },
  MB: { kill: 0.42, aerr: 0.13, bps: 0.9, dps: 0.8, bdv: 1.8, attacker: true, passer: false },
  OPP: { kill: 0.37, aerr: 0.15, bps: 0.55, dps: 1.6, bdv: 2.4, attacker: true, passer: false },
  L: { kill: 0, aerr: 0, bps: 0, dps: 4.2, bdv: 4.2, attacker: false, passer: true },
  DS: { kill: 0, aerr: 0, bps: 0, dps: 3.2, bdv: 3.6, attacker: false, passer: true },
};
const K = { serve: 120, pass: 40, attack: 80, perSet: 10 };

// Shrunk, per-player ratings.
export function ratePlayer(p) {
  const pr = POS_PRIOR[p.pos] || POS_PRIOR.OH;
  const s = p.serve || {}, ps = p.pass || {}, a = p.attack || {}, b = p.block || {}, d = p.dig || {};
  const sAtt = s.att || 0;
  const ace = (LEAGUE.ace * K.serve + (s.ace || 0)) / (K.serve + sAtt);
  const serr = (LEAGUE.serr * K.serve + (s.err || 0)) / (K.serve + sAtt);
  const counts = [ps.p0 || 0, ps.p1 || 0, ps.p2 || 0, ps.p3 || 0];
  const pAtt = counts[0] + counts[1] + counts[2] + counts[3];
  const pass = counts.map((c, q) => (LEAGUE.pass[q] * K.pass + c) / (K.pass + pAtt));
  const ta = a.att || 0;
  const kill = (pr.kill * K.attack + (a.k || 0)) / (K.attack + ta);
  const aerr = (pr.aerr * K.attack + (a.e || 0)) / (K.attack + ta);
  const bps = (pr.bps * K.perSet + (b.stuffs || 0)) / (K.perSet + (b.sets || 0));
  const dps = (pr.dps * K.perSet + (d.digs || 0)) / (K.perSet + (d.sets || 0));
  return {
    ace, serr, pass, passAvg: pass[1] + 2 * pass[2] + 3 * pass[3],
    kill, aerr, eff: kill - aerr, bps, dps,
    // Dig skill relative to position, applied to the position's back-row value.
    defense: pr.bdv * clamp(dps / pr.dps, 0.6, 1.5),
    attacker: pr.attacker, passer: pr.passer,
    samples: { serve: sAtt, pass: pAtt, attack: ta },
  };
}

// zone z (1..6) holds order[(k + z − 1) % 6] when order[k] is the server.
export const zoneOf = (orderIdx, serverIdx) => ((orderIdx - serverIdx + 6) % 6) + 1;
export const isBack = (zone) => zone === 1 || zone === 5 || zone === 6;
// Rotation index r (0..5 = R1..R6, setter zone r+1) → index of the serving order slot at zone 1.
export const serverIdxFor = (r, setterIdx) => (setterIdx - r + 6) % 6;

// Who is physically on court in each zone for a phase, after subs and the libero.
function applyRules(team, baseZones, phase) {
  const zones = baseZones.slice(); // zones[z-1] = player id
  const lib = team.libero || {};
  for (const sub of team.subs || []) {
    const z = zones.indexOf(sub.outId) + 1;
    if (!z) continue;
    if (sub.mode === 'backrow' && isBack(z)) zones[z - 1] = sub.inId;
    if (sub.mode === 'serve' && phase === 'serve' && z === 1) zones[z - 1] = sub.inId;
  }
  if (lib.id) {
    for (const rid of lib.replaces || []) {
      const z = zones.indexOf(rid) + 1;
      if (!z || !isBack(z)) continue;
      if (phase === 'serve' && z === 1 && lib.servesFor !== rid) continue; // player serves own rally
      zones[z - 1] = lib.id;
    }
  }
  return zones;
}

export function buildRotations(team, opts = {}) {
  const L = { ...LEAGUE, ...(opts.league || {}) };
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]));
  const ratings = {};
  const R = (id) => (ratings[id] ||= byId[id] ? ratePlayer(byId[id]) : ratePlayer({ pos: 'OH' }));
  const order = team.order; // 6 ids in serving order
  const setterIdx = Math.max(0, order.findIndex((id) => byId[id]?.pos === 'S'));
  const cal = team.calibration || { so: 0, bp: 0 };
  const rots = [];

  for (let r = 0; r < 6; r++) {
    const k = serverIdxFor(r, setterIdx);
    const base = [1, 2, 3, 4, 5, 6].map((z) => order[(k + z - 1) % 6]);

    // --- receive phase: side-out -------------------------------------------------------
    const rz = applyRules(team, base, 'receive');
    const passW = [], attW = [];
    rz.forEach((id, zi) => {
      const z = zi + 1, pos = byId[id]?.pos, rt = R(id);
      if (rt.passer) passW.push([id, pos === 'L' ? 1.3 : isBack(z) ? 1.0 : 0.8]);
      if (rt.attacker) attW.push([id, isBack(z) ? 0.35 : 1]);
    });
    if (!passW.length) rz.forEach((id) => { if (byId[id]?.pos !== 'S') passW.push([id, 1]); });
    const pw = passW.reduce((s, [, w]) => s + w, 0);
    const passDist = [0, 1, 2, 3].map((q) => passW.reduce((s, [id, w]) => s + w * R(id).pass[q], 0) / pw);
    const aw = attW.reduce((s, [, w]) => s + w, 0) || 1;
    const attEff = attW.reduce((s, [id, w]) => s + w * R(id).eff, 0) / aw;
    const options = aw;
    const attShift = L.beta.att * (attEff - L.eff) + L.beta.opts * (options - L.attackOptions);
    const soQ = L.soGivenPass.map((s, q) => (q === 0 ? 0 : expit(logit(s) + attShift)));
    let so = L.serr + (1 - L.serr) * passDist.reduce((s, p, q) => s + p * soQ[q], 0);
    so = expit(logit(so) + cal.so);

    // --- serve phase: break point ------------------------------------------------------
    const sz = applyRules(team, base, 'serve');
    const server = sz[0];
    const srv = R(server);
    const front = [sz[1], sz[2], sz[3]], back = [sz[0], sz[4], sz[5]];
    const block = front.reduce((s, id) => s + R(id).bps, 0);
    const defense = back.reduce((s, id) => s + R(id).defense, 0);
    const tAtt = sz.filter((id) => R(id).attacker);
    const transEff = tAtt.length ? mean(tAtt.map((id) => R(id).eff)) : L.eff;
    const w = expit(logit(L.winInPlayServing) + L.beta.blk * (block - L.frontBlocks) + L.beta.def * (defense - L.backDefense) + L.beta.trans * (transEff - L.eff));
    let bp = srv.ace + (1 - srv.ace - srv.serr) * w;
    bp = expit(logit(bp) + cal.bp);

    rots.push({
      r, label: `R${r + 1}`, baseZones: base, receiveZones: rz, serveZones: sz,
      server, passers: passW.map(([id]) => id), passAvg: passDist[1] + 2 * passDist[2] + 3 * passDist[3],
      attEff, options, frontHitters: [rz[1], rz[2], rz[3]].filter((id) => R(id).attacker).length,
      block, defense, so: clamp(so, 0.01, 0.99), bp: clamp(bp, 0.01, 0.99),
    });
  }
  return { rotations: rots, ratings, profile: { so: rots.map((x) => x.so), bp: rots.map((x) => x.bp) } };
}

// Shift the model's intercepts so its average SO/BP match observed team rates, keeping the
// rotation-to-rotation structure and all what-if deltas intact.
export function calibrate(team, observed) {
  const raw = buildRotations({ ...team, calibration: { so: 0, bp: 0 } }).profile;
  const shift = (m, o) => mean(o.map(logit)) - mean(m.map(logit));
  return { so: observed.so ? shift(raw.so, observed.so) : 0, bp: observed.bp ? shift(raw.bp, observed.bp) : 0 };
}

// Rough substitution budget: each planned swap costs 2 subs per trip around the rotation.
export function subBudget(team, { cyclesPerSet = 2, limit = 15 } = {}) {
  const pairs = (team.subs || []).length;
  const est = pairs * 2 * cyclesPerSet;
  return { est, limit, ok: est <= limit };
}

// Legal-ish 5-1 serving orders: setter first, opposite across from setter, OH pair and MB pair
// opposite each other. Returns id arrays. `free` mode enumerates every order (setter fixed first).
export function candidateOrders(team, { free = false } = {}) {
  const ids = team.order.slice();
  const byId = Object.fromEntries(team.players.map((p) => [p.id, p]));
  const s = ids.find((id) => byId[id]?.pos === 'S') ?? ids[0];
  const rest = ids.filter((id) => id !== s);
  const out = [];
  if (free) {
    const perm = (arr, acc) => { if (!arr.length) { out.push([s, ...acc]); return; } arr.forEach((x, i) => perm([...arr.slice(0, i), ...arr.slice(i + 1)], [...acc, x])); };
    perm(rest, []);
    return out;
  }
  const oh = rest.filter((id) => byId[id]?.pos === 'OH'), mb = rest.filter((id) => byId[id]?.pos === 'MB'), opp = rest.filter((id) => byId[id]?.pos === 'OPP');
  if (oh.length !== 2 || mb.length !== 2 || opp.length !== 1) return candidateOrders(team, { free: true });
  for (const [A, B] of [[oh, mb], [mb, oh]]) for (const a of [A, [A[1], A[0]]]) for (const b of [B, [B[1], B[0]]]) out.push([s, a[0], b[0], opp[0], a[1], b[1]]);
  return out;
}
