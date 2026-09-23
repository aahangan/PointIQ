import { rallyMatrices, makeMatchModel, US, THEM } from '../../engine/markov.js';
import { startMatrix } from '../../engine/optimize.js';
import { getState, team, opponent, activeProfile, modelProfile, SOURCE_LABEL } from '../store.js';
import { esc } from '../ui.js';

export function matchSettings() {
  const m = getState().match;
  const serve = m.firstServe === 'us' ? US : m.firstServe === 'them' ? THEM : 'toss';
  return { ...m, serve };
}

export function summarize(profile, opp = opponent(), settings = matchSettings()) {
  const M = rallyMatrices(profile, opp);
  const themStart = settings.startThem;
  const starts = themStart == null
    ? null
    : [{ us: settings.startUs, them: themStart }];
  const first = makeMatchModel(M, { bestOf: settings.bestOf, target: settings.target, decidingTarget: settings.decidingTarget, starts: starts || [{ us: settings.startUs, them: 0 }], firstServe: settings.serve });
  const solvers = { main: first.main, deciding: first.deciding };
  // Unknown opponent start: average the match over their six possible starts.
  const models = starts ? [first] : [first, ...[1, 2, 3, 4, 5].map((j) => makeMatchModel(M, { bestOf: settings.bestOf, target: settings.target, decidingTarget: settings.decidingTarget, starts: [{ us: settings.startUs, them: j }], firstServe: settings.serve, solvers }))];
  const avg = (f) => models.reduce((s, mm) => s + f(mm), 0) / models.length;
  const dist = {};
  for (const mm of models) for (const [k, v] of Object.entries(mm.outcomeDist())) dist[k] = (dist[k] || 0) + v / models.length;
  return {
    match: avg((mm) => mm.matchProb()),
    set: avg((mm) => mm.setProbToss(0)),
    dist,
  };
}

export function bestStart(profile, opp = opponent(), settings = matchSettings()) {
  const M = startMatrix(profile, opp, { target: settings.target });
  const per = M.map((row) => (settings.startThem == null ? row.reduce((s, x) => s + x, 0) / 6 : row[settings.startThem]));
  const best = per.indexOf(Math.max(...per));
  return { M, per, best };
}

// What each lineup decision is worth in match win probability (vs. not doing it).
export function decisionValues(t = team()) {
  const base = summarize(activeProfile(t).profile).match;
  const rows = [];
  const withLineup = (patch) => {
    const tt = { ...t, ...patch };
    return summarize(activeProfile(tt).profile).match;
  };
  const lib = t.libero || {};
  if (lib.id) {
    rows.push({ label: 'Using the libero at all', value: base - withLineup({ libero: {} }) });
    if (lib.servesFor) rows.push({ label: 'Libero serving in one rotation', value: base - withLineup({ libero: { ...lib, servesFor: null } }) });
  }
  (t.subs || []).forEach((sub, i) => {
    const pin = t.players.find((p) => p.id === sub.inId), pout = t.players.find((p) => p.id === sub.outId);
    rows.push({ label: `${sub.mode === 'serve' ? 'Serving sub' : 'Back-row swap'}: ${pin?.name || '?'} for ${pout?.name || '?'}`, value: base - withLineup({ subs: t.subs.filter((_, k) => k !== i) }) });
  });
  return { base, rows };
}

export function sourceChip(t = team()) {
  const src = activeProfile(t).source;
  return `<span class="chip-src src-${src}" title="Where the rotation rates come from">${esc(SOURCE_LABEL[src])}</span>`;
}

export { modelProfile };
