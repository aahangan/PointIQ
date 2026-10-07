// Live match tracker: two buttons per rally. Rotations, serve and set changes are automatic;
// win probability updates every rally, and (optionally) the rotation rates learn from what
// is happening in this match through a beta update on top of the pre-match estimate.

import { getState, update, team, opponent, activeProfile } from '../store.js';
import { rallyMatrices, makeMatchModel, nextRot, US, THEM } from '../../engine/markov.js';
import { esc, pct, wpLine, meter, toast, ICON } from '../ui.js';
import { call, liveToRallies } from '../service.js';

// Last answer from the Python model service, if it's running (shown beside the local number).
let servicePred = null;
let serviceSeq = 0;

function askService(L) {
  const s = getState(), t = team();
  if (!s.service?.ok || !t.fitted || L.done) { servicePred = null; return; }
  const seq = ++serviceSeq;
  const tonight = L.rallies.map((r) => ({ phase: r.serving === US ? 'BP' : 'SO', rot_us: r.rotUs, won: r.weWon ? 1 : 0 }));
  call('/api/predict', {
    rates: t.fitted,
    tonight: L.learn ? tonight : [],
    state: { best_of: L.bestOf, target: L.target, deciding_target: L.decidingTarget, start_us: L.startUs, start_them: L.startThem, sets_us: L.setsUs, sets_them: L.setsThem, a: L.a, b: L.b, rot_us: L.rotUs, rot_them: L.rotThem, serving: L.serving === US ? 'us' : 'them', first_this_set: L.firstThisSet === US ? 'us' : 'them', them_so: opponent()?.so, them_bp: opponent()?.bp },
  }, { timeout: 5000 }).then((r) => { if (seq === serviceSeq) { servicePred = r; document.dispatchEvent(new Event('pointiq:rerender')); } })
    .catch(() => { if (seq === serviceSeq) servicePred = null; });
}

const KAPPA = 30; // pre-match estimate counts as 30 rallies of evidence per rotation/phase

const zeros = () => Array.from({ length: 6 }, () => ({ won: 0, n: 0 }));

function newLive(s) {
  const m = s.match;
  const first = m.firstServe === 'them' ? THEM : US;
  return {
    bestOf: m.bestOf, target: m.target, decidingTarget: m.decidingTarget,
    startUs: m.startUs, startThem: m.startThem ?? 0,
    setsUs: 0, setsThem: 0, setNo: 1, a: 0, b: 0,
    rotUs: m.startUs, rotThem: m.startThem ?? 0, serving: first, firstThisSet: first,
    learn: true, rallies: [], series: [], breaks: [], done: false,
    us: { SO: zeros(), BP: zeros() }, them: { SO: zeros(), BP: zeros() },
  };
}

function blend(prior, counts) {
  const f = (p, c) => (KAPPA * p + c.won) / (KAPPA + c.n);
  return { so: prior.so.map((p, i) => f(p, counts.SO[i])), bp: prior.bp.map((p, i) => f(p, counts.BP[i])) };
}

function liveModel(L) {
  const pre = activeProfile(team()).profile;
  const oppPre = opponent() || { so: Array(6).fill(0.6), bp: Array(6).fill(0.4) };
  const us = L.learn ? blend(pre, L.us) : pre;
  const them = L.learn ? blend(oppPre, L.them) : oppPre;
  const model = makeMatchModel(rallyMatrices(us, them), { bestOf: L.bestOf, target: L.target, decidingTarget: L.decidingTarget, starts: [{ us: L.startUs, them: L.startThem }] });
  return { us, them, model, pre };
}

function probs(L) {
  const { model } = liveModel(L);
  return model.live({ setsUs: L.setsUs, setsThem: L.setsThem, a: L.a, b: L.b, rotUs: L.rotUs, rotThem: L.rotThem, serving: L.serving, firstThisSet: L.firstThisSet });
}

function rally(weWon) {
  update((s) => {
    const L = s.live;
    if (!L || L.done) return;
    const before = JSON.stringify({ ...L, rallies: undefined, series: undefined, breaks: undefined });
    // counts: our phase is BP when we serve; their phase mirrors it
    if (L.serving === US) { L.us.BP[L.rotUs].n++; L.them.SO[L.rotThem].n++; if (weWon) L.us.BP[L.rotUs].won++; else L.them.SO[L.rotThem].won++; }
    else { L.us.SO[L.rotUs].n++; L.them.BP[L.rotThem].n++; if (weWon) L.us.SO[L.rotUs].won++; else L.them.BP[L.rotThem].won++; }
    L.rallies.push({ set: L.setNo, a: L.a, b: L.b, rotUs: L.rotUs, rotThem: L.rotThem, serving: L.serving, weWon, before });
    if (weWon) { L.a++; if (L.serving === THEM) { L.rotUs = nextRot(L.rotUs); L.serving = US; } }
    else { L.b++; if (L.serving === US) { L.rotThem = nextRot(L.rotThem); L.serving = THEM; } }
    const target = L.setsUs + L.setsThem === L.bestOf - 1 ? L.decidingTarget : L.target;
    if ((L.a >= target || L.b >= target) && Math.abs(L.a - L.b) >= 2) {
      if (L.a > L.b) L.setsUs++; else L.setsThem++;
      const need = Math.ceil(L.bestOf / 2);
      L.breaks.push(L.series.length + 1);
      if (L.setsUs >= need || L.setsThem >= need) L.done = true;
      else {
        L.setNo++; L.a = 0; L.b = 0; L.rotUs = L.startUs; L.rotThem = L.startThem;
        L.firstThisSet = L.firstThisSet === US ? THEM : US;
        L.serving = L.firstThisSet;
      }
    }
    L.series.push(L.done ? (L.setsUs > L.setsThem ? 1 : 0) : probs(L).match);
  });
  askService(getState().live);
}

function undo() {
  update((s) => {
    const L = s.live;
    if (!L?.rallies.length) return;
    const r = L.rallies.pop();
    const restored = JSON.parse(r.before);
    const keep = { rallies: L.rallies, series: L.series.slice(0, -1), breaks: L.breaks.filter((b) => b <= L.series.length - 1) };
    s.live = { ...restored, ...keep };
  });
  askService(getState().live);
}

export default {
  id: 'live',
  title: 'Live tracker',
  feature: 'live-tracker',
  lede: 'Tap who won each rally. PointIQ handles rotations, serve and live win probability.',
  render(root) {
    const s = getState(), t = team(), opp = opponent();
    const L = s.live;
    if (!L) {
      root.innerHTML = `
        <header class="page-head"><div><p class="eyebrow">${esc(t.name)} vs ${esc(opp?.name || 'league average')}</p><h1>Live tracker</h1></div></header>
        <section class="panel setup">
          <h2 class="panel-title">New match</h2>
          <p>Uses the format, starting rotations and first serve from <a href="#match">Match sim</a>: best of ${s.match.bestOf}, we start in R${s.match.startUs + 1}, they start in R${(s.match.startThem ?? 0) + 1}${s.match.startThem == null ? ' (set their start in Match sim)' : ''}, ${s.match.firstServe === 'them' ? 'they serve' : 'we serve'} first.</p>
          <button class="btn btn-primary btn-lg" data-action="start">Start tracking</button>
          <p class="note">Keyboard: <kbd>A</kbd> or <kbd>←</kbd> point us · <kbd>L</kbd> or <kbd>→</kbd> point them · <kbd>U</kbd> undo.</p>
        </section>`;
      return;
    }
    const { us, pre } = liveModel(L);
    const p = L.done ? { set: L.setsUs > L.setsThem ? 1 : 0, match: L.setsUs > L.setsThem ? 1 : 0 } : probs(L);
    const setStart = L.a === 0 && L.b === 0 && !L.done;
    const upcoming = [];
    let r = L.rotUs;
    for (let k = 0; k < 4; k++) { upcoming.push(r); r = nextRot(r); }
    const alert = [0, 1, 2, 3, 4, 5].map((i) => ({ i, c: L.us.SO[i], d: L.us.SO[i].n >= 5 ? L.us.SO[i].won / L.us.SO[i].n - pre.so[i] : 0 })).filter((x) => x.d < -0.15);

    root.innerHTML = `
      <header class="page-head"><div><p class="eyebrow">Set ${L.setNo} · best of ${L.bestOf}</p><h1>Live tracker</h1></div>
        <div class="row"><label class="toggle"><input type="checkbox" data-on-change="learn"${L.learn ? ' checked' : ''}> Learn from this match</label><button class="btn btn-ghost btn-sm" data-action="end">End &amp; clear</button></div>
      </header>

      <section class="scoreboard panel">
        <div class="sb-team ${L.serving === US && !L.done ? 'serving' : ''}">
          <div class="sb-name">${esc(t.short || t.name)} ${L.serving === US && !L.done ? `<span class="sb-serve" title="Serving">${ICON.ball}</span>` : ''}</div>
          <div class="sb-score">${L.a}</div>
          <div class="sb-meta">Sets ${L.setsUs} · <b>R${L.rotUs + 1}</b></div>
          <button class="btn btn-primary btn-xl" data-action="us"${L.done ? ' disabled' : ''}>Point us</button>
        </div>
        <div class="sb-mid">
          <div class="sb-wp-label">Match win</div>
          <div class="sb-wp">${pct(p.match)}</div>
          ${meter(p.match, { label: 'Match win probability' })}
          <div class="sb-wp-label">This set ${pct(p.set)}</div>
          ${servicePred && !L.done ? `<div class="sb-wp-label" title="From the Python model service (rally-learned rates, in-match update)">Model service: <b>${pct(servicePred.match)}</b> match · ${pct(servicePred.set)} set</div>` : ''}
          <button class="btn btn-ghost btn-sm" data-action="undo"${L.rallies.length ? '' : ' disabled'}>Undo last rally</button>
        </div>
        <div class="sb-team ${L.serving === THEM && !L.done ? 'serving' : ''}">
          <div class="sb-name">${esc(opp?.name?.replace(/^Opponent:\s*/, '') || 'Opponent')} ${L.serving === THEM && !L.done ? `<span class="sb-serve" title="Serving">${ICON.ball}</span>` : ''}</div>
          <div class="sb-score">${L.b}</div>
          <div class="sb-meta">Sets ${L.setsThem} · <b>R${L.rotThem + 1}</b></div>
          <button class="btn btn-xl" data-action="them"${L.done ? ' disabled' : ''}>Point them</button>
        </div>
      </section>

      ${L.done ? `<section class="panel insight ${L.setsUs > L.setsThem ? 'good' : 'bad'}"><h3>Match over: ${L.setsUs}–${L.setsThem}</h3><p>Save this match’s rotation results to your season history so the multi-season model learns from it.</p><div class="row"><label class="field"><span>Season</span><input id="save-season" value="${new Date().getFullYear()}"></label><button class="btn btn-primary" data-action="save">Save to history</button></div></section>` : ''}

      ${setStart ? `<section class="panel"><h2 class="panel-title">Before the first serve of set ${L.setNo}</h2><div class="form-grid">
        <label class="field"><span>Our rotation</span><select data-on-change="rot-us">${[0, 1, 2, 3, 4, 5].map((i) => `<option value="${i}"${i === L.rotUs ? ' selected' : ''}>R${i + 1}</option>`).join('')}</select></label>
        <label class="field"><span>Their rotation</span><select data-on-change="rot-them">${[0, 1, 2, 3, 4, 5].map((i) => `<option value="${i}"${i === L.rotThem ? ' selected' : ''}>R${i + 1}</option>`).join('')}</select></label>
        <label class="field"><span>Serving first</span><select data-on-change="first">${[[US, 'Us'], [THEM, 'Them']].map(([v, l]) => `<option value="${v}"${v === L.serving ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
      </div></section>` : ''}

      <section class="panel">
        <h2 class="panel-title">Match win probability, rally by rally</h2>
        ${wpLine([liveStartProb(L), ...L.series], { setBreaks: L.breaks })}
      </section>

      <section class="split">
        <div class="panel">
          <h2 class="panel-title">Next rotations</h2>
          <table class="tbl"><thead><tr><th></th><th class="num">Side-out</th><th class="num">Point-score</th><th class="num">Tonight</th></tr></thead><tbody>
            ${upcoming.map((i, k) => `<tr class="${k === 0 ? 'hl' : ''}"><td><b>R${i + 1}</b>${k === 0 ? ' <small>now</small>' : ''}</td><td class="num">${pct(us.so[i])}</td><td class="num">${pct(us.bp[i])}</td><td class="num">${L.us.SO[i].n + L.us.BP[i].n ? `${L.us.SO[i].won + L.us.BP[i].won}/${L.us.SO[i].n + L.us.BP[i].n}` : '—'}</td></tr>`).join('')}
          </tbody></table>
          ${L.learn ? '<p class="note">Rates blend the pre-match estimate with tonight’s rallies (the estimate counts as 30 rallies).</p>' : ''}
        </div>
        <div class="panel">
          <h2 class="panel-title">Alerts</h2>
          ${alert.length ? alert.map((x) => `<div class="alert"><b>R${x.i + 1} side-out</b> is ${x.c.won}/${x.c.n} tonight, ${Math.round(-100 * x.d)} pts under expectation. Consider a serve-receive adjustment or a timeout when you rotate into it.</div>`).join('') : '<p class="note">No rotation is running 15+ points below expectation yet (needs 5+ receptions).</p>'}
        </div>
      </section>`;
  },
  actions: {
    start: () => { servicePred = null; update((s) => { s.live = newLive(s); }); askService(getState().live); },
    us: () => rally(true),
    them: () => rally(false),
    undo: () => undo(),
    end: () => { servicePred = null; update((s) => { s.live = null; }); },
    save: () => {
      const season = document.getElementById('save-season').value.trim() || String(new Date().getFullYear());
      update((s) => {
        const t = team(), L = s.live;
        for (const ph of ['SO', 'BP']) L.us[ph].forEach((c, rot) => { if (c.n) t.history.push({ season, rot, phase: ph, won: c.won, n: c.n }); });
        // Rally-by-rally log for the predictive model (Model lab).
        const date = new Date().toISOString().slice(0, 10);
        const rows = liveToRallies(L, { matchId: `${date}-${(opponent()?.name || 'opponent').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${Date.now().toString(36)}`, opponent: opponent()?.name || '', date });
        t.rallies = [...(t.rallies || []), ...rows.map((r) => ({ ...r, season }))];
        s.live = null;
      });
      servicePred = null;
      toast(`Saved to ${season} history and the rally log`);
    },
  },
  changes: {
    learn: (el) => update((s) => { s.live.learn = el.checked; }),
    'rot-us': (el) => update((s) => { s.live.rotUs = Number(el.value); if (s.live.setNo === 1) s.live.startUs = Number(el.value); }),
    'rot-them': (el) => update((s) => { s.live.rotThem = Number(el.value); if (s.live.setNo === 1) s.live.startThem = Number(el.value); }),
    first: (el) => update((s) => { s.live.serving = Number(el.value); s.live.firstThisSet = Number(el.value); }),
  },
  onKey(ev) {
    if (!getState().live || getState().live.done) return;
    if (ev.target.closest('input,select,textarea')) return;
    const k = ev.key.toLowerCase();
    if (k === 'a' || k === 'arrowleft') { ev.preventDefault(); rally(true); }
    else if (k === 'l' || k === 'arrowright') { ev.preventDefault(); rally(false); }
    else if (k === 'u') { ev.preventDefault(); undo(); }
  },
};

function liveStartProb(L) {
  const fresh = { ...L, setsUs: 0, setsThem: 0, a: 0, b: 0, rotUs: L.startUs, rotThem: L.startThem, us: { SO: zeros(), BP: zeros() }, them: { SO: zeros(), BP: zeros() } };
  const first = L.rallies[0] ? JSON.parse(L.rallies[0].before) : L;
  return probs({ ...fresh, serving: first.serving, firstThisSet: first.firstThisSet }).match;
}
