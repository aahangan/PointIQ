import { getState, update, subscribe, team, can, resetDemo, replaceState } from './store.js';
import { planByKey, minPlanFor, FEATURE_LABEL } from '../engine/plans.js';
import { esc, lockPanel, toast } from './ui.js';
import overview from './views/overview.js';
import lineup from './views/lineup.js';
import match from './views/match.js';
import live from './views/live.js';
import roster from './views/roster.js';
import data from './views/data.js';
import seasons from './views/seasons.js';
import recruit from './views/recruit.js';
import plans from './views/plans.js';
import model from './views/model.js';

const VIEWS = [overview, lineup, match, live, roster, data, seasons, model, recruit, plans];
const GROUPS = [
  ['Game plan', ['overview', 'lineup', 'match', 'live']],
  ['Team data', ['roster', 'data', 'seasons', 'model']],
  ['Recruiting', ['recruit']],
  ['Account', ['plans']],
];
const byId = Object.fromEntries(VIEWS.map((v) => [v.id, v]));
let current = 'overview';

function nav() {
  const s = getState();
  const plan = planByKey(s.plan);
  const links = GROUPS.map(([g, ids]) => `<div class="nav-group"><div class="nav-label">${g}</div>${ids.map((id) => {
    const v = byId[id];
    const locked = v.feature && !can(v.feature);
    return `<a href="#${id}" class="nav-link${current === id ? ' active' : ''}" ${current === id ? 'aria-current="page"' : ''}>${esc(v.title)}${locked ? '<span class="nav-lock" title="Upgrade to unlock">PRO</span>' : ''}</a>`;
  }).join('')}</div>`).join('');
  const t = team();
  document.getElementById('rail').innerHTML = `
    <a class="brand" href="#overview" aria-label="PointIQ home"><span class="brand-mark" aria-hidden="true"></span><span class="brand-word">Point<b>IQ</b></span></a>
    <div class="team-pill"><span class="team-dot" aria-hidden="true"></span><div><div class="team-name">${esc(t.name)}</div><div class="team-sub">${t.demo ? 'Demo data' : 'Your team'} · <a href="#plans" class="plan-chip plan-${plan.key}">${esc(plan.name)}</a></div></div></div>
    <nav aria-label="Main">${links}</nav>
    <div class="rail-foot">
      <button class="btn btn-ghost btn-sm" data-action="export-backup">Back up data</button>
      <label class="btn btn-ghost btn-sm">Restore<input type="file" accept=".json" data-on-change="restore-backup" hidden></label>
      <button class="btn btn-ghost btn-sm" data-action="reset-demo">Reset demo</button>
    </div>`;
}

function render() {
  const v = byId[current] || overview;
  nav();
  const main = document.getElementById('main');
  document.title = `PointIQ`;
  if (v.feature && !can(v.feature)) {
    const plan = minPlanFor(v.feature);
    main.innerHTML = `<header class="page-head"><h1>${esc(v.title)}</h1><p class="lede">${esc(v.lede || '')}</p></header>${lockPanel(v.feature, plan, FEATURE_LABEL[v.feature])}`;
    return;
  }
  try { v.render(main); }
  catch (e) { console.error(e); main.innerHTML = `<div class="panel err"><strong>Couldn't draw this page.</strong><pre>${esc(e.stack || e.message)}</pre><button class="btn" data-action="reset-demo">Reset demo data</button></div>`; }
}

function route() {
  const id = (location.hash || '#overview').slice(1);
  current = byId[id] ? id : 'overview';
  render();
  document.getElementById('main').focus({ preventScroll: true });
  window.scrollTo(0, 0);
}

const GLOBAL = {
  'set-plan': (el) => { update((s) => { s.plan = el.dataset.plan; }); toast(`Switched to ${planByKey(el.dataset.plan).name} (demo — billing not connected)`); },
  'reset-demo': () => { resetDemo(); toast('Demo data restored'); },
  'export-backup': () => {
    const blob = JSON.stringify(getState(), null, 1);
    const dlg = document.getElementById('dialog');
    dlg.innerHTML = `<form method="dialog" class="dlg"><h2>Back up your data</h2><p>Copy this text into a file named <code>pointiq-backup.json</code>. Restore it later with <b>Restore</b>.</p><textarea id="backup-text" readonly rows="10">${esc(blob)}</textarea><div class="row"><button class="btn btn-primary" type="button" data-action="copy-backup">Copy</button><button class="btn" value="close">Close</button></div></form>`;
    dlg.showModal();
  },
  'copy-backup': () => {
    const ta = document.getElementById('backup-text');
    navigator.clipboard?.writeText(ta.value).then(() => toast('Copied backup'), () => { ta.select(); toast('Select-all done — press Ctrl/⌘+C', 'warn'); });
  },
};
const GLOBAL_CHANGE = {
  'restore-backup': async (el) => {
    const f = el.files[0]; if (!f) return;
    try { replaceState(JSON.parse(await f.text())); toast('Backup restored'); } catch (e) { toast(e.message, 'err'); }
  },
};

document.addEventListener('click', (ev) => {
  const el = ev.target.closest('[data-action]');
  if (!el) return;
  const name = el.dataset.action;
  const v = byId[current];
  const fn = v?.actions?.[name] || GLOBAL[name];
  if (fn) { ev.preventDefault(); fn(el, ev); }
});
for (const type of ['change', 'input']) {
  document.addEventListener(type, (ev) => {
    const el = ev.target.closest(type === 'change' ? '[data-on-change]' : '[data-on-input]');
    if (!el) return;
    const name = type === 'change' ? el.dataset.onChange : el.dataset.onInput;
    const v = byId[current];
    const fn = (type === 'change' ? v?.changes : v?.inputs)?.[name] || (type === 'change' ? GLOBAL_CHANGE[name] : null);
    if (fn) fn(el, ev);
  });
}
document.addEventListener('keydown', (ev) => { const v = byId[current]; v?.onKey?.(ev); });

subscribe(() => render());
document.addEventListener('pointiq:rerender', () => render());
window.addEventListener('hashchange', route);
route();
