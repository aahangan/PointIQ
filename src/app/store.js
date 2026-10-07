// App state: one JSON document, saved locally, exportable as a backup file.
// In the hosted product this document maps 1:1 onto a per-program database row.

import { DEMO_TEAM, DEMO_OPPONENT, DEMO_PROSPECTS, demoHistory } from './demo.js';
import { buildRotations } from '../engine/lineup.js';
import { fitHierarchical, profileFromFit } from '../engine/hier.js';
import { recordsToProfile } from '../engine/importers.js';
import { logit, expit } from '../engine/stats.js';
import { can as canPlan } from '../engine/plans.js';
import { DEFAULT_WEIGHTS } from '../engine/scouting.js';

const KEY = 'pointiq.v1';
const listeners = new Set();

function freshState() {
  const team = structuredClone(DEMO_TEAM);
  const history = demoHistory();
  team.history = history;
  team.observed = recordsToProfile(history.filter((r) => r.season === '2026'));
  team.baseline = snapshotLineup(team);
  team.rotationSource = 'hier';
  return {
    version: 1,
    plan: 'recruit',
    billing: 'annual',
    teams: [team],
    activeTeam: team.id,
    opponents: [{ id: 'opp-demo', source: 'demo', ...structuredClone(DEMO_OPPONENT) }],
    activeOpponent: 'opp-demo',
    match: { bestOf: 5, target: 25, decidingTarget: 15, firstServe: 'toss', startUs: 0, startThem: null },
    rules: { subLimit: 15, liberoServeOne: true },
    hier: { decay: 0.85 },
    prospects: structuredClone(DEMO_PROSPECTS),
    weights: structuredClone(DEFAULT_WEIGHTS),
    physicalWeight: 0.35,
    live: null,
    imports: [],
    service: { url: 'http://127.0.0.1:5050', ok: false },
  };
}

export function snapshotLineup(team) {
  return { order: team.order.slice(), libero: structuredClone(team.libero || {}), subs: structuredClone(team.subs || []) };
}

let state = load();
function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const s = JSON.parse(raw); if (s.version === 1) return s; }
  } catch { /* storage unavailable: run in memory */ }
  return freshState();
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ } }

export const getState = () => state;
export function update(fn, { silent = false } = {}) {
  fn(state);
  save();
  if (!silent) listeners.forEach((l) => l(state));
}
export const subscribe = (fn) => listeners.add(fn);
export function resetDemo() { state = freshState(); save(); fitCache.clear(); listeners.forEach((l) => l(state)); }
export function replaceState(s) { if (s?.version !== 1) throw new Error('Not a PointIQ backup file'); state = s; save(); fitCache.clear(); listeners.forEach((l) => l(state)); }

export const can = (feature) => canPlan(state.plan, feature);
export const team = () => state.teams.find((t) => t.id === state.activeTeam) || state.teams[0];
export const opponent = () => state.opponents.find((o) => o.id === state.activeOpponent) || null;
export const playerById = (t, id) => t.players.find((p) => p.id === id);

// ---- derived data (memoized) ------------------------------------------------------------
const fitCache = new Map();
export function hierFit(t = team()) {
  if (!t.history?.length) return null;
  const key = t.id + '|' + state.hier.decay + '|' + JSON.stringify(t.history);
  if (!fitCache.has(key)) { fitCache.clear(); fitCache.set(key, fitHierarchical(t.history, { decay: state.hier.decay })); }
  return fitCache.get(key);
}

export function modelProfile(t, lineup = null) {
  const tt = lineup ? { ...t, ...lineup } : t;
  return buildRotations(tt).profile;
}

// The rates the match model uses. Observed / hierarchical sources get the *modeled change*
// from any lineup edits made since the data was collected (the baseline), on the logit scale.
export function activeProfile(t = team()) {
  const src = t.rotationSource || 'model';
  const current = modelProfile(t);
  if (src === 'model') return { profile: current, source: 'model' };
  let base = null;
  if (src === 'fitted' && t.fitted && can('model-lab')) base = { so: t.fitted.so, bp: t.fitted.bp };
  if (src === 'hier' && can('hierarchical')) base = profileFromFit(hierFit(t));
  if (!base && t.observed) base = t.observed;
  if (!base) return { profile: current, source: 'model' };
  if (!t.baseline) return { profile: base, source: src };
  // fitted / observed / hierarchical rates were measured with the baseline lineup
  const was = modelProfile(t, t.baseline);
  const adj = (b, c, w) => b.map((x, i) => expit(logit(x) + logit(c[i]) - logit(w[i])));
  return { profile: { so: adj(base.so, current.so, was.so), bp: adj(base.bp, current.bp, was.bp) }, source: src === 'fitted' && t.fitted && can('model-lab') ? 'fitted' : src === 'hier' && can('hierarchical') ? 'hier' : 'observed' };
}

export const SOURCE_LABEL = { model: 'Player model', observed: 'Observed this season', hier: 'Hierarchical (multi-season)', fitted: 'Learned from rallies' };

export function uid(prefix = 'id') { return prefix + Math.random().toString(36).slice(2, 9); }
