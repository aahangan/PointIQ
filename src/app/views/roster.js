import { update, team, uid } from '../store.js';
import { ratePlayer, POSITIONS } from '../../engine/lineup.js';
import { esc, pct, fx, eff, toast } from '../ui.js';

// [group, label, path]
const COLS = [
  ['Serve', 'Att', 'serve.att'], ['Serve', 'Ace', 'serve.ace'], ['Serve', 'Err', 'serve.err'],
  ['Pass', '3', 'pass.p3'], ['Pass', '2', 'pass.p2'], ['Pass', '1', 'pass.p1'], ['Pass', '0', 'pass.p0'],
  ['Attack', 'TA', 'attack.att'], ['Attack', 'K', 'attack.k'], ['Attack', 'E', 'attack.e'],
  ['Def', 'Blk', 'block.stuffs'], ['Def', 'Digs', 'dig.digs'],
];
const get = (p, path) => path.split('.').reduce((o, k) => (o ? o[k] : undefined), p) ?? '';

export default {
  id: 'roster',
  title: 'Roster',
  render(root) {
    const t = team();
    const inOrder = new Set(t.order);
    const groups = [...new Set(COLS.map((c) => c[0]))];
    root.innerHTML = `
      <header class="page-head"><div><p class="eyebrow">${esc(t.name)}</p><h1>Roster</h1></div>
        <div class="row"><button class="btn btn-primary" data-action="add">Add player</button><a class="btn" href="#data">Import stats</a></div></header>
      <section class="panel">
        <p class="note">Season totals. The model shrinks every rate toward a position average until the sample is big enough to trust — the <b>Model</b> columns are what Lineup Lab uses. Faded cells mean a small sample.</p>
        <div class="scroll-x"><table class="tbl roster">
          <thead>
            <tr><th colspan="4"></th>${groups.map((g) => `<th colspan="${COLS.filter((c) => c[0] === g).length + (g === 'Def' ? 1 : 0)}" class="grp">${g}</th>`).join('')}<th colspan="5" class="grp model">Model</th><th></th></tr>
            <tr><th>#</th><th>Name</th><th>Pos</th><th class="num">Sets</th>${COLS.map((c) => `<th class="num">${c[1]}</th>`).join('')}<th class="num">Ast</th><th class="num model">Ace%</th><th class="num model">Err%</th><th class="num model">Pass</th><th class="num model">Eff.</th><th class="num model">Blk/s</th><th></th></tr>
          </thead>
          <tbody>
          ${t.players.map((p) => {
            const r = ratePlayer(p);
            const faint = (n, k) => (n < k ? ' faint' : '');
            return `<tr>
              <td><input class="cell-in xs" value="${esc(p.num)}" data-on-change="field" data-id="${p.id}" data-path="num" aria-label="Jersey number"></td>
              <td><input class="cell-in name" value="${esc(p.name)}" data-on-change="field" data-id="${p.id}" data-path="name" aria-label="Name"></td>
              <td><select data-on-change="field" data-id="${p.id}" data-path="pos" aria-label="Position">${POSITIONS.map((x) => `<option${x === p.pos ? ' selected' : ''}>${x}</option>`).join('')}</select></td>
              <td><input class="cell-in xs" type="number" min="0" value="${p.sets ?? ''}" data-on-change="num" data-id="${p.id}" data-path="sets" aria-label="Sets played"></td>
              ${COLS.map((c) => `<td><input class="cell-in xs" type="number" min="0" value="${get(p, c[2])}" data-on-change="num" data-id="${p.id}" data-path="${c[2]}" aria-label="${c[0]} ${c[1]}"></td>`).join('')}
              <td><input class="cell-in xs" type="number" min="0" value="${p.assists ?? ''}" data-on-change="num" data-id="${p.id}" data-path="assists" aria-label="Assists"></td>
              <td class="num model${faint(r.samples.serve, 100)}">${pct(r.ace)}</td>
              <td class="num model${faint(r.samples.serve, 100)}">${pct(r.serr)}</td>
              <td class="num model${faint(r.samples.pass, 80)}">${r.passer || r.samples.pass ? fx(r.passAvg) : '—'}</td>
              <td class="num model${faint(r.samples.attack, 100)}">${r.attacker || r.samples.attack ? eff(r.eff) : '—'}</td>
              <td class="num model">${fx(r.bps)}</td>
              <td>${inOrder.has(p.id) || t.libero?.id === p.id ? '<span class="badge">Starter</span>' : `<button class="btn btn-ghost btn-sm" data-action="del" data-id="${p.id}" aria-label="Remove ${esc(p.name)}">Remove</button>`}</td>
            </tr>`;
          }).join('')}
          </tbody>
        </table></div>
      </section>`;
  },
  actions: {
    add: () => { update(() => { const t = team(); t.players.push({ id: uid('p'), name: 'New player', num: '', pos: 'OH', sets: 0 }); }); toast('Player added — fill in the row'); },
    del: (el) => update(() => { const t = team(); t.players = t.players.filter((p) => p.id !== el.dataset.id); t.subs = (t.subs || []).filter((s) => s.inId !== el.dataset.id); }),
  },
  changes: {
    field: (el) => update(() => { const p = team().players.find((x) => x.id === el.dataset.id); p[el.dataset.path] = el.value.trim(); }),
    num: (el) => update(() => {
      const p = team().players.find((x) => x.id === el.dataset.id);
      const v = el.value === '' ? 0 : Math.max(0, Number(el.value) || 0);
      const keys = el.dataset.path.split('.');
      let o = p; for (const k of keys.slice(0, -1)) o = o[k] ||= {};
      o[keys[keys.length - 1]] = v;
      if (keys[0] === 'pass') p.pass.att = (p.pass.p0 || 0) + (p.pass.p1 || 0) + (p.pass.p2 || 0) + (p.pass.p3 || 0);
      if (keys[0] === 'sets' || keys[0] === 'block' || keys[0] === 'dig') { p.block = { ...(p.block || {}), sets: p.sets || 0 }; p.dig = { ...(p.dig || {}), sets: p.sets || 0 }; }
    }),
  },
};
