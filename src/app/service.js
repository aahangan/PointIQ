// Client for the Python model service (model/pointiq_model/server.py).
// Runs on the coach's laptop next to PointIQ: `python -m pointiq_model serve`.

import { getState, update, team } from './store.js';
import { buildRotations } from '../engine/lineup.js';

export const DEFAULT_URL = 'http://127.0.0.1:5050';
export const serviceUrl = () => (getState().service?.url || DEFAULT_URL).replace(/\/+$/, '');

export async function call(path, body, { timeout = 60000 } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(serviceUrl() + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Service returned ${res.status}`);
    return data;
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('The model service took too long to answer.');
    if (e instanceof TypeError) throw new Error(`Can't reach the model service at ${serviceUrl()}. Start it with: python -m pointiq_model serve`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

export async function checkHealth() {
  try {
    const h = await call('/api/health', undefined, { timeout: 4000 });
    update((s) => { s.service = { ...(s.service || {}), ok: true, version: h.version, checkedAt: Date.now() }; });
    return h;
  } catch (e) {
    update((s) => { s.service = { ...(s.service || {}), ok: false, error: e.message, checkedAt: Date.now() }; });
    throw e;
  }
}

// Live-tracker rallies → rally-log rows (the schema the Python package reads).
export function liveToRallies(L, { matchId, opponent, date }) {
  const t = team();
  const rots = buildRotations(t).rotations;
  const name = (id) => t.players.find((p) => p.id === id)?.name || '';
  return L.rallies.map((r) => ({
    match_id: matchId, date, opponent, set: r.set, score_us: r.a, score_them: r.b,
    rot_us: r.rotUs, rot_them: r.rotThem, serving: r.serving === 0 ? 'us' : 'them',
    server: r.serving === 0 ? name(rots[r.rotUs].server) : '', won: r.weWon ? 1 : 0,
    target: r.set === L.bestOf ? L.decidingTarget : L.target,
  }));
}

export const RALLY_COLUMNS = ['match_id', 'date', 'opponent', 'set', 'score_us', 'score_them', 'rot_us', 'rot_them', 'serving', 'server', 'won', 'target'];

export function ralliesToCSV(rows) {
  const q = (v) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  return [RALLY_COLUMNS.join(','), ...rows.map((r) => RALLY_COLUMNS.map((c) => q(r[c])).join(','))].join('\n');
}
