import { getState, update, uid } from '../store.js';
import { evaluateProspect, LEVELS, levelOf, STATUSES, METRIC_LABEL, fmtHeight, DEFAULT_WEIGHTS } from '../../engine/scouting.js';
import { esc, pct, fx, eff, toast } from '../ui.js';

let filter = { pos: '', grad: '', status: '', q: '' };
let selected = null;
let compare = new Set();

const fmtMetric = (k, v) => (!Number.isFinite(v) ? '—' : k === 'eff' ? eff(v) : ['ace', 'serr'].includes(k) ? pct(v) : fx(v, k === 'pass' ? 2 : 1));

function scoreBar(e) {
  const X = (v) => ((Math.min(80, Math.max(20, v)) - 20) / 60) * 100;
  return `<div class="sbar" role="img" aria-label="Score ${e.score.toFixed(0)}, range ${e.lo.toFixed(0)} to ${e.hi.toFixed(0)}"><div class="sbar-ci" style="left:${X(e.lo)}%;width:${X(e.hi) - X(e.lo)}%"></div><div class="sbar-mid"></div><div class="sbar-dot" style="left:${X(e.score)}%"></div></div>`;
}

export default {
  id: 'recruit',
  title: 'Recruiting board',
  feature: 'recruiting',
  lede: 'Level-adjusted prospect ratings with honest uncertainty, for college staffs.',
  render(root) {
    const s = getState();
    const evals = s.prospects.map((p) => ({ p, e: evaluateProspect(p, { weights: s.weights, physicalWeight: s.physicalWeight }) }));
    const grads = [...new Set(s.prospects.map((p) => String(p.grad)).filter(Boolean))].sort();
    const shown = evals.filter(({ p }) => (!filter.pos || p.pos === filter.pos) && (!filter.grad || String(p.grad) === filter.grad) && (!filter.status || p.status === filter.status) && (!filter.q || `${p.name} ${p.club} ${p.state}`.toLowerCase().includes(filter.q.toLowerCase())))
      .sort((a, b) => b.e.score - a.e.score);
    const sel = evals.find((x) => x.p.id === selected);
    const cmp = evals.filter((x) => compare.has(x.p.id));
    const opt = (list, cur, all) => `<option value="">${all}</option>` + list.map((v) => `<option${String(v) === String(cur) ? ' selected' : ''}>${esc(v)}</option>`).join('');

    root.innerHTML = `
      <header class="page-head"><div><p class="eyebrow">${s.prospects.length} prospects${s.prospects.some((p) => p.demo) ? ' · includes fictional demo prospects' : ''}</p><h1>Recruiting board</h1></div>
        <div class="row"><button class="btn btn-primary" data-action="add">Add prospect</button><a class="btn" href="#data">Import CSV</a></div></header>

      <section class="panel">
        <div class="filters">
          <label class="field"><span>Position</span><select data-on-change="f-pos">${opt(['OH', 'OPP', 'MB', 'S', 'L', 'DS'], filter.pos, 'All')}</select></label>
          <label class="field"><span>Class</span><select data-on-change="f-grad">${opt(grads, filter.grad, 'All')}</select></label>
          <label class="field"><span>Status</span><select data-on-change="f-status">${opt(STATUSES, filter.status, 'All')}</select></label>
          <label class="field grow"><span>Search</span><input type="search" value="${esc(filter.q)}" placeholder="Name, club, state" data-on-change="f-q"></label>
        </div>
        <div class="scroll-x"><table class="tbl board">
          <thead><tr><th><span class="sr">Compare</span></th><th>#</th><th>Prospect</th><th>Class</th><th>Pos</th><th class="num">Ht</th><th>Level</th><th class="score-col">Score <small>(20–80, 80% range)</small></th><th class="num">Score</th><th>Flags</th><th>Status</th></tr></thead>
          <tbody>
          ${shown.map(({ p, e }, i) => `<tr class="${p.id === selected ? 'hl' : ''}">
            <td><input type="checkbox" data-on-change="cmp" data-id="${p.id}"${compare.has(p.id) ? ' checked' : ''} aria-label="Compare ${esc(p.name)}"></td>
            <td>${i + 1}</td>
            <td><button class="linkish" data-action="open" data-id="${p.id}">${esc(p.name)}</button><div class="sub">${esc(p.club || '')}${p.state ? ` · ${esc(p.state)}` : ''}</div></td>
            <td>${esc(p.grad)}</td><td>${esc(e.pos)}</td><td class="num">${fmtHeight(e.height)}</td>
            <td><small>${esc(e.level.label.replace(/^(Club|High school) — /, ''))}</small></td>
            <td class="score-col">${scoreBar(e)}</td>
            <td class="num"><b>${e.score.toFixed(0)}</b> <small>${e.lo.toFixed(0)}–${e.hi.toFixed(0)}</small></td>
            <td>${e.flags.map((f) => `<span class="flag ${/Elite/.test(f) ? 'ok' : /inflated/.test(f) ? 'bad' : ''}">${esc(f)}</span>`).join('')}</td>
            <td><select data-on-change="status" data-id="${p.id}" aria-label="Status">${STATUSES.map((x) => `<option${x === p.status ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
          </tr>`).join('') || '<tr><td colspan="11" class="empty">No prospects match these filters.</td></tr>'}
          </tbody>
        </table></div>
        <p class="note">50 = typical 18-Open-level starter at the position. Stats are translated to an 18-Open equivalent by competition level and shrunk for sample size, so a wide range means “go watch her live”.</p>
      </section>

      ${cmp.length >= 2 ? compareTable(cmp) : cmp.length === 1 ? '<p class="note">Tick one more prospect to compare side by side.</p>' : ''}
      ${sel ? detail(sel.p, sel.e) : ''}

      <section class="panel">
        <details><summary><b>Your staff's weights</b> — what matters at each position</summary>
          <div class="weights">
            <label class="field"><span>Measurables vs stats: ${pct(s.physicalWeight, 0)} measurables</span><input type="range" min="0" max="0.7" step="0.05" value="${s.physicalWeight}" data-on-change="phys" aria-label="Measurables weight"></label>
            ${Object.entries(s.weights).map(([pos, w]) => `<fieldset><legend>${pos}</legend>${Object.entries(w).map(([k, v]) => `<label class="field"><span>${METRIC_LABEL[k]} <b>${v.toFixed(2)}</b></span><input type="range" min="0" max="0.6" step="0.01" value="${v}" data-on-change="w" data-pos="${pos}" data-k="${k}"></label>`).join('')}</fieldset>`).join('')}
          </div>
          <button class="btn btn-ghost btn-sm" data-action="reset-w">Reset weights</button>
        </details>
      </section>`;
  },
  actions: {
    open: (el) => { selected = el.dataset.id === selected ? null : el.dataset.id; rerender(); setTimeout(() => document.getElementById('detail')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30); },
    close: () => { selected = null; rerender(); },
    add: () => {
      const id = uid('pr');
      update((s) => { s.prospects.push({ id, name: 'New prospect', grad: new Date().getFullYear() + 2, pos: 'OH', height: '', approach: '', level: 'hs-varsity', club: '', state: '', hudl: '', status: 'Watching', notes: '', tags: [], stats: { sets: 0 } }); });
      selected = id; rerender();
    },
    del: (el) => { update((s) => { s.prospects = s.prospects.filter((p) => p.id !== el.dataset.id); }); selected = null; compare.delete(el.dataset.id); toast('Prospect removed'); },
    'reset-w': () => update((s) => { s.weights = structuredClone(DEFAULT_WEIGHTS); s.physicalWeight = 0.35; }),
  },
  changes: {
    'f-pos': (el) => { filter.pos = el.value; rerender(); },
    'f-grad': (el) => { filter.grad = el.value; rerender(); },
    'f-status': (el) => { filter.status = el.value; rerender(); },
    'f-q': (el) => { filter.q = el.value; rerender(); },
    cmp: (el) => { if (el.checked) { if (compare.size >= 3) { el.checked = false; return toast('Compare up to 3 at a time', 'warn'); } compare.add(el.dataset.id); } else compare.delete(el.dataset.id); rerender(); },
    status: (el) => update((s) => { s.prospects.find((p) => p.id === el.dataset.id).status = el.value; }),
    phys: (el) => update((s) => { s.physicalWeight = Number(el.value); }),
    w: (el) => update((s) => { s.weights[el.dataset.pos][el.dataset.k] = Number(el.value); }),
    pf: (el) => update((s) => {
      const p = s.prospects.find((x) => x.id === el.dataset.id);
      const path = el.dataset.path.split('.');
      const v = el.type === 'number' ? (el.value === '' ? 0 : Math.max(0, Number(el.value))) : el.value;
      let o = p; for (const k of path.slice(0, -1)) o = o[k] ||= {};
      o[path[path.length - 1]] = v;
    }),
  },
};

function rerender() { document.dispatchEvent(new Event('pointiq:rerender')); }

function detail(p, e) {
  const f = (label, path, type = 'text', extra = '') => {
    const v = path.split('.').reduce((o, k) => (o ? o[k] : undefined), p) ?? '';
    return `<label class="field"><span>${label}</span><input type="${type}" value="${esc(v)}" data-on-change="pf" data-id="${p.id}" data-path="${path}" ${extra}></label>`;
  };
  const link = /^https?:\/\//.test(p.hudl || '') ? `<a class="link" href="${esc(p.hudl)}" target="_blank" rel="noopener">Open video profile ↗</a>` : '';
  return `<section class="panel detail" id="detail">
    <div class="panel-head"><h2 class="panel-title">${esc(p.name)} <small>${esc(e.pos)} · ${esc(p.grad)}</small></h2><button class="btn btn-ghost btn-sm" data-action="close">Close</button></div>
    <div class="detail-grid">
      <div>
        <div class="big-score"><span>${e.score.toFixed(0)}</span><small>80% range ${e.lo.toFixed(0)}–${e.hi.toFixed(0)}${e.physical != null ? ` · measurables ${e.physical.toFixed(0)}` : ''}</small></div>
        <table class="tbl"><thead><tr><th>Metric</th><th class="num">Raw</th><th class="num">18-Open equiv.</th><th class="num">Sample</th><th class="num">vs position</th><th class="num">Weight</th></tr></thead><tbody>
          ${e.components.map((c) => `<tr><td>${c.label}</td><td class="num">${fmtMetric(c.key, c.raw)}</td><td class="num">${fmtMetric(c.key, c.adjusted)}</td><td class="num">${c.n || 0}</td><td class="num"><span class="${c.z >= 0 ? 'up' : 'down'}">${c.z >= 0 ? '+' : '−'}${Math.abs(c.z).toFixed(1)} sd</span></td><td class="num">${pct(c.weight, 0)}</td></tr>`).join('')}
        </tbody></table>
      </div>
      <div class="stack">
        <div class="form-grid">
          ${f('Name', 'name')}${f('Class', 'grad', 'number')}
          <label class="field"><span>Position</span><select data-on-change="pf" data-id="${p.id}" data-path="pos">${['OH', 'OPP', 'MB', 'S', 'L', 'DS'].map((x) => `<option${x === p.pos ? ' selected' : ''}>${x}</option>`).join('')}</select></label>
          <label class="field"><span>Level</span><select data-on-change="pf" data-id="${p.id}" data-path="level">${LEVELS.map((l) => `<option value="${l.key}"${l.key === levelOf(p.level).key ? ' selected' : ''}>${l.label}</option>`).join('')}</select></label>
          ${f('Height', 'height', 'text', 'placeholder="6\'1"')}${f('Approach touch (in)', 'approach', 'number')}
          ${f('Club / school', 'club')}${f('State', 'state')}
        </div>
        ${f('Hudl or video link', 'hudl', 'url', 'placeholder="https://www.hudl.com/profile/…"')}${link}
        <details><summary>Stats (season totals)</summary><div class="form-grid">
          ${f('Sets', 'stats.sets', 'number')}${f('Kills', 'stats.attack.k', 'number')}${f('Attack errors', 'stats.attack.e', 'number')}${f('Attempts', 'stats.attack.att', 'number')}
          ${f('Aces', 'stats.serve.ace', 'number')}${f('Serve errors', 'stats.serve.err', 'number')}${f('Serve attempts', 'stats.serve.att', 'number')}${f('Digs', 'stats.dig.digs', 'number')}
          ${f('Blocks', 'stats.block.stuffs', 'number')}${f('Assists', 'stats.assists', 'number')}${f('Receptions', 'stats.pass.att', 'number')}${f('3-passes', 'stats.pass.p3', 'number')}
          ${f('2-passes', 'stats.pass.p2', 'number')}${f('1-passes', 'stats.pass.p1', 'number')}${f('Reception errors', 'stats.pass.p0', 'number')}
        </div></details>
        <label class="field"><span>Staff notes</span><textarea rows="4" data-on-change="pf" data-id="${p.id}" data-path="notes" placeholder="Live eval, character, academics, contact log…">${esc(p.notes || '')}</textarea></label>
        <div class="row"><button class="btn btn-ghost btn-sm danger" data-action="del" data-id="${p.id}">Remove prospect</button></div>
      </div>
    </div>
    <p class="note">Recruiting contact must follow NCAA calendars for your division. PointIQ stores evaluations only and never contacts athletes.</p>
  </section>`;
}

function compareTable(list) {
  const keys = [...new Set(list.flatMap((x) => x.e.components.map((c) => c.key)))];
  return `<section class="panel"><h2 class="panel-title">Side by side</h2><div class="scroll-x"><table class="tbl"><thead><tr><th></th>${list.map((x) => `<th class="num">${esc(x.p.name)}<div class="sub">${x.e.pos} · ${esc(x.p.grad)}</div></th>`).join('')}</tr></thead><tbody>
    <tr><th>Score</th>${list.map((x) => `<td class="num"><b>${x.e.score.toFixed(0)}</b> <small>${x.e.lo.toFixed(0)}–${x.e.hi.toFixed(0)}</small></td>`).join('')}</tr>
    <tr><th>Height / approach</th>${list.map((x) => `<td class="num">${fmtHeight(x.e.height)} / ${Number.isFinite(x.e.approach) && x.e.approach ? x.e.approach + '"' : '—'}</td>`).join('')}</tr>
    <tr><th>Level</th>${list.map((x) => `<td class="num"><small>${esc(x.e.level.label)}</small></td>`).join('')}</tr>
    ${keys.map((k) => `<tr><th>${METRIC_LABEL[k]} <small>18-Open equiv.</small></th>${list.map((x) => { const c = x.e.components.find((cc) => cc.key === k); return `<td class="num">${c ? fmtMetric(k, c.adjusted) : '—'}</td>`; }).join('')}</tr>`).join('')}
  </tbody></table></div></section>`;
}
