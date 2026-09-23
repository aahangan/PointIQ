import { getState, update, team, opponent, activeProfile, snapshotLineup, can, playerById, SOURCE_LABEL } from '../store.js';
import { buildRotations, subBudget } from '../../engine/lineup.js';
import { searchOrders } from '../../engine/optimize.js';
import { esc, pct, pts, eff, fx, court, rotationStrip, lockPanel, toast } from '../ui.js';
import { summarize, sourceChip, matchSettings } from './common.js';
import { minPlanFor, FEATURE_LABEL } from '../../engine/plans.js';

let sel = 0, phase = 'receive', search = null;

export default {
  id: 'lineup',
  title: 'Lineup Lab',
  feature: 'lineup-lab',
  lede: 'Model any serving order, libero plan or substitution before you run it.',
  render(root) {
    const s = getState(), t = team();
    const built = buildRotations(t);
    const rot = built.rotations[sel];
    const active = activeProfile(t);
    const baseForStrip = t.baseline ? activeProfile({ ...t, ...t.baseline }).profile : null;
    const sum = summarize(active.profile);
    const baseSum = baseForStrip ? summarize(baseForStrip) : null;
    const budget = subBudget(t, { limit: s.rules.subLimit });
    const inOrder = new Set(t.order);
    const lib = t.libero || {};
    const opt = (list, cur, allowNone = false) => (allowNone ? `<option value="">— none —</option>` : '') + list.map((p) => `<option value="${p.id}"${p.id === cur ? ' selected' : ''}>#${esc(p.num)} ${esc(p.name)} · ${p.pos}</option>`).join('');
    const bench = t.players.filter((p) => !inOrder.has(p.id));
    const zones = phase === 'receive' ? rot.receiveZones : rot.serveZones;
    const subIn = (t.subs || []).map((x) => x.inId);
    const libAllowed = can('libero-subs');

    root.innerHTML = `
      <header class="page-head">
        <div><p class="eyebrow">${esc(t.name)}</p><h1>Lineup Lab</h1></div>
        <div class="head-stats">
          <div><span class="hs-label">Match win ${sourceChip(t)}</span><span class="hs-num">${pct(sum.match)}</span>${baseSum && Math.abs(sum.match - baseSum.match) >= 0.0005 ? `<span class="${sum.match - baseSum.match >= 0 ? 'up' : 'down'}">${pts(sum.match - baseSum.match)} vs baseline</span>` : ''}</div>
        </div>
      </header>

      <section class="lab-grid">
        <div class="panel">
          <div class="panel-head"><h2 class="panel-title">Court</h2>
            <div class="seg" role="group" aria-label="Phase">
              <button class="seg-btn${phase === 'receive' ? ' on' : ''}" data-action="phase" data-p="receive">Receiving</button>
              <button class="seg-btn${phase === 'serve' ? ' on' : ''}" data-action="phase" data-p="serve">Serving</button>
            </div>
          </div>
          <div class="rot-tabs" role="tablist" aria-label="Rotation">${built.rotations.map((r, i) => `<button role="tab" aria-selected="${i === sel}" class="rot-tab${i === sel ? ' on' : ''}" data-action="rot" data-r="${i}"><b>${r.label}</b><span>${pct(phase === 'receive' ? active.profile.so[i] : active.profile.bp[i], 0)}</span></button>`).join('')}</div>
          ${court(zones, { players: t.players, liberoId: lib.id, subIds: subIn, server: phase === 'serve', passers: phase === 'receive' ? rot.passers : [] })}
          <div class="legend"><span><i class="lg lg-lib"></i>Libero</span><span><i class="lg lg-sub"></i>Substitute</span>${phase === 'receive' ? '<span><i class="lg lg-pass"></i>In serve receive</span>' : `<span>Server: <b>${esc(playerById(t, rot.server)?.name || '?')}</b></span>`}</div>
        </div>

        <div class="stack">
          <div class="panel">
            <h2 class="panel-title">Serving order</h2>
            <p class="note">Slot 1 serves first when you start in the rotation where the setter serves (R1). Opposite pairs sit three slots apart.</p>
            <div class="order-grid">${t.order.map((id, k) => `<label class="field"><span>Slot ${k + 1}</span><select data-on-change="slot" data-k="${k}">${opt(t.players.filter((p) => p.pos !== 'L'), id)}</select></label>`).join('')}</div>
          </div>
          <div class="panel">
            <h2 class="panel-title">Libero</h2>
            ${libAllowed ? `
            <div class="form-row">
              <label class="field"><span>Libero</span><select data-on-change="lib-id">${opt(t.players.filter((p) => ['L', 'DS'].includes(p.pos)), lib.id, true)}</select></label>
              <label class="field"><span>Serves for</span><select data-on-change="lib-serves">${opt(t.players.filter((p) => (lib.replaces || []).includes(p.id)), lib.servesFor, true)}</select></label>
            </div>
            <fieldset class="checks"><legend>Replaces in the back row</legend>${t.order.map((id) => { const p = playerById(t, id); return `<label><input type="checkbox" data-on-change="lib-rep" value="${id}"${(lib.replaces || []).includes(id) ? ' checked' : ''}> #${esc(p?.num)} ${esc(p?.name)} <small>${p?.pos}</small></label>`; }).join('')}</fieldset>
            <p class="note">NCAA lets the libero serve in one rotation. The player she replaces still serves in every other rotation.</p>`
            : lockPanel('libero-subs', minPlanFor('libero-subs'), FEATURE_LABEL['libero-subs'])}
          </div>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Substitution plan</h2><span class="badge ${budget.ok ? 'ok' : 'bad'}">≈${budget.est} of ${budget.limit} subs per set</span></div>
        ${libAllowed ? `
        <table class="tbl"><thead><tr><th>Type</th><th>Coming in</th><th>Going out</th><th class="num">Worth</th><th></th></tr></thead><tbody>
        ${(t.subs || []).map((x, i) => `<tr><td>${x.mode === 'serve' ? 'Serving sub' : 'Back-row swap'}</td><td>${esc(playerById(t, x.inId)?.name || '?')}</td><td>${esc(playerById(t, x.outId)?.name || '?')}</td><td class="num">${subWorth(t, i)}</td><td><button class="btn btn-ghost btn-sm" data-action="del-sub" data-i="${i}">Remove</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">No planned substitutions.</td></tr>'}
        </tbody></table>
        <div class="form-row add-sub">
          <label class="field"><span>Type</span><select id="sub-mode"><option value="backrow">Back-row swap (DS for a front-row player)</option><option value="serve">Serving sub (serves, then leaves)</option></select></label>
          <label class="field"><span>Going out</span><select id="sub-out">${opt(t.order.map((id) => playerById(t, id)).filter(Boolean))}</select></label>
          <label class="field"><span>Coming in</span><select id="sub-in">${opt(bench)}</select></label>
          <button class="btn btn-primary" data-action="add-sub">Add</button>
        </div>
        <p class="note">Sub limit is set per rule book — NCAA 15 per set by default. Change it here: <input class="inline-num" type="number" min="6" max="30" value="${s.rules.subLimit}" data-on-change="sub-limit" aria-label="Substitution limit per set"></p>`
        : lockPanel('libero-subs', minPlanFor('libero-subs'), FEATURE_LABEL['libero-subs'])}
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Rotation by rotation</h2>
          <div class="seg" role="group" aria-label="Rate source">${['model', 'observed', 'hier'].map((k) => `<button class="seg-btn${(t.rotationSource || 'model') === k ? ' on' : ''}" data-action="source" data-src="${k}"${k === 'hier' && !can('hierarchical') ? ' disabled title="Program plan"' : ''}${k === 'observed' && !t.observed ? ' disabled title="Import match data first"' : ''}>${SOURCE_LABEL[k]}</button>`).join('')}</div>
        </div>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>Rot.</th><th>Server</th><th>Passers</th><th class="num">Pass avg</th><th class="num">Attack eff.</th><th class="num">Front hitters</th><th class="num">Side-out</th><th class="num">Point-score</th></tr></thead><tbody>
          ${built.rotations.map((r, i) => `<tr class="${i === sel ? 'hl' : ''}"><td><b>${r.label}</b></td><td>${esc(playerById(t, r.server)?.name || '?')}</td><td>${r.passers.map((id) => esc(playerById(t, id)?.name.split(' ').slice(-1)[0] || '?')).join(', ')}</td><td class="num">${fx(r.passAvg)}</td><td class="num">${eff(r.attEff)}</td><td class="num">${r.frontHitters}</td><td class="num">${pct(active.profile.so[i])}</td><td class="num">${pct(active.profile.bp[i])}</td></tr>`).join('')}
        </tbody></table></div>
        ${rotationStrip(active.profile, { baseline: baseForStrip, highlight: sel })}
        <div class="row">
          <button class="btn" data-action="baseline">Mark this lineup as baseline</button>
          <span class="note">${t.baseline ? 'Deltas compare against your baseline lineup — the one your imported stats were collected with.' : 'No baseline yet.'} Observed and multi-season rates are adjusted by the modeled change from the baseline.</span>
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Serving-order search</h2></div>
        ${can('order-search') ? `
          <p class="note">Scores every legal 5-1 order (setter opposite the opposite, pairs opposite each other), each at its best starting rotation against ${esc(opponent()?.name || 'a league-average opponent')}.</p>
          <div class="row"><button class="btn btn-primary" data-action="search">Search 8 standard orders</button><button class="btn" data-action="search-all">Search all 120 orders</button></div>
          ${search ? searchTable(t, search) : ''}`
        : lockPanel('order-search', minPlanFor('order-search'), FEATURE_LABEL['order-search'])}
      </section>`;
  },
  actions: {
    rot: (el) => { sel = Number(el.dataset.r); rerender(); },
    phase: (el) => { phase = el.dataset.p; rerender(); },
    source: (el) => update((s) => { team().rotationSource = el.dataset.src; }),
    baseline: () => { update(() => { const t = team(); t.baseline = snapshotLineup(t); }); toast('Baseline saved'); },
    'del-sub': (el) => update(() => { team().subs.splice(Number(el.dataset.i), 1); }),
    'add-sub': () => {
      const mode = document.getElementById('sub-mode').value, outId = document.getElementById('sub-out').value, inId = document.getElementById('sub-in').value;
      if (!inId || !outId) return toast('Choose both players', 'warn');
      update(() => { const t = team(); (t.subs ||= []).push({ mode, outId, inId }); });
      toast('Substitution added');
    },
    search: () => runSearch(false),
    'search-all': () => runSearch(true),
    'apply-order': (el) => { update(() => { team().order = el.dataset.order.split(','); }); search = null; toast('Serving order applied'); },
  },
  changes: {
    slot: (el) => update(() => {
      const t = team(), k = Number(el.dataset.k), id = el.value;
      const other = t.order.indexOf(id);
      if (other >= 0) t.order[other] = t.order[k]; // swap to keep six distinct players
      t.order[k] = id;
    }),
    'lib-id': (el) => update(() => { const t = team(); t.libero = { ...(t.libero || {}), id: el.value || null }; }),
    'lib-serves': (el) => update(() => { const t = team(); t.libero.servesFor = el.value || null; }),
    'lib-rep': (el) => update(() => {
      const t = team(); const rep = new Set(t.libero?.replaces || []);
      if (el.checked) rep.add(el.value); else rep.delete(el.value);
      t.libero = { ...(t.libero || {}), replaces: [...rep] };
      if (!rep.has(t.libero.servesFor)) t.libero.servesFor = null;
    }),
    'sub-limit': (el) => update((s) => { s.rules.subLimit = Math.max(1, Number(el.value) || 15); }),
  },
};

function rerender() { document.dispatchEvent(new Event('pointiq:rerender')); }

function subWorth(t, i) {
  const with_ = summarize(activeProfile(t).profile).match;
  const without = summarize(activeProfile({ ...t, subs: t.subs.filter((_, k) => k !== i) }).profile).match;
  const d = with_ - without;
  return `<span class="${d >= 0 ? 'up' : 'down'}">${pts(d)}</span>`;
}

function runSearch(free) {
  const t = team();
  const btn = document.querySelector(free ? '[data-action="search-all"]' : '[data-action="search"]');
  if (btn) { btn.disabled = true; btn.textContent = 'Searching…'; }
  setTimeout(() => {
    const st = matchSettings();
    search = searchOrders(t, opponent(), { target: st.target, free, themStart: st.startThem });
    rerender();
  }, 30);
}

function searchTable(t, res) {
  const name = (id) => esc(playerById(t, id)?.name.split(' ').slice(-1)[0] || '?');
  const cur = res.current?.value;
  return `<div class="scroll-x"><table class="tbl"><thead><tr><th>#</th><th>Order (slot 1 → 6)</th><th class="num">Best start</th><th class="num">Set win</th><th class="num">vs current</th><th></th></tr></thead><tbody>
    ${res.results.slice(0, 8).map((r, i) => `<tr class="${r.order.join() === t.order.join() ? 'hl' : ''}"><td>${i + 1}</td><td>${r.order.map(name).join(' · ')}</td><td class="num">R${r.bestStart + 1}</td><td class="num">${pct(r.value)}</td><td class="num">${cur != null ? `<span class="${r.value - cur >= 0 ? 'up' : 'down'}">${pts(r.value - cur)}</span>` : '—'}</td><td>${r.order.join() === t.order.join() ? '<span class="badge">Current</span>' : `<button class="btn btn-sm" data-action="apply-order" data-order="${r.order.join(',')}">Use</button>`}</td></tr>`).join('')}
  </tbody></table></div><p class="note">Order search uses the player model; libero and substitution rules are applied to every candidate.</p>`;
}
