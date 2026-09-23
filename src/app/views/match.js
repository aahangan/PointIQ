import { getState, update, team, opponent, activeProfile, can, uid } from '../store.js';
import { esc, pct, pts, heatmap, outcomeBars, lockPanel, toast } from '../ui.js';
import { summarize, bestStart, sourceChip, matchSettings } from './common.js';
import { solveGame } from '../../engine/optimize.js';
import { minPlanFor, FEATURE_LABEL } from '../../engine/plans.js';

export default {
  id: 'match',
  title: 'Match sim',
  feature: 'match-prob',
  render(root) {
    const s = getState(), t = team(), opp = opponent();
    const st = matchSettings();
    const { profile } = activeProfile(t);
    const sum = summarize(profile, opp, st);
    const bs = bestStart(profile, opp, st);
    const game = can('game-theory') ? solveGame(bs.M, 20000) : null;
    const pri = priorities(profile, opp, st, sum.match);
    const sel = (name, opts, cur) => `<select data-on-change="${name}">${opts.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
    const rots = [0, 1, 2, 3, 4, 5].map((i) => [i, `R${i + 1}`]);

    root.innerHTML = `
      <header class="page-head">
        <div><p class="eyebrow">${esc(t.name)} vs ${esc(opp?.name || 'league average')}</p><h1>Match sim</h1></div>
        <div class="head-stats"><div><span class="hs-label">Match win ${sourceChip(t)}</span><span class="hs-num">${pct(sum.match)}</span></div><div><span class="hs-label">Per set</span><span class="hs-num sm">${pct(sum.set)}</span></div></div>
      </header>

      <section class="split">
        <div class="panel">
          <h2 class="panel-title">Format</h2>
          <div class="form-grid">
            <label class="field"><span>Match</span>${sel('bestOf', [[5, 'Best of 5 (NCAA)'], [3, 'Best of 3 (HS / club)']], st.bestOf)}</label>
            <label class="field"><span>Sets to</span><input type="number" min="15" max="30" value="${st.target}" data-on-change="target"></label>
            <label class="field"><span>Deciding set to</span><input type="number" min="10" max="30" value="${st.decidingTarget}" data-on-change="decidingTarget"></label>
            <label class="field"><span>First serve, set 1</span>${sel('firstServe', [['toss', 'Coin toss'], ['us', 'We serve'], ['them', 'They serve']], st.firstServe)}</label>
            <label class="field"><span>Our start</span>${sel('startUs', rots, st.startUs)}</label>
            <label class="field"><span>Their start</span>${sel('startThem', [['', 'Unknown'], ...rots], st.startThem ?? '')}</label>
          </div>
          <p class="note">Serve alternates each set; the deciding set is a new coin toss. Win by two, no cap.</p>
        </div>
        <div class="panel">
          <h2 class="panel-title">How the match ends</h2>
          ${outcomeBars(sum.dist, st.bestOf)}
        </div>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Opponent</h2>
          <div class="row">
            <select data-on-change="pick-opp" aria-label="Opponent">${[['', 'League-average opponent'], ...s.opponents.map((o) => [o.id, o.name])].map(([v, l]) => `<option value="${v}"${(s.activeOpponent || '') === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>
            <button class="btn btn-sm" data-action="new-opp">New opponent</button>
            ${opp ? `<button class="btn btn-ghost btn-sm" data-action="del-opp">Delete</button>` : ''}
          </div>
        </div>
        ${opp ? `
          <label class="field wide"><span>Name</span><input value="${esc(opp.name)}" data-on-change="opp-name"></label>
          <div class="scroll-x"><table class="tbl opp-tbl"><thead><tr><th></th>${[1, 2, 3, 4, 5, 6].map((r) => `<th class="num">R${r}</th>`).join('')}</tr></thead><tbody>
            ${['so', 'bp'].map((k) => `<tr><th>${k === 'so' ? 'Side-out %' : 'Point-score %'}</th>${opp[k].map((v, i) => `<td><input class="cell-in" type="number" step="0.5" min="10" max="90" value="${(100 * v).toFixed(1)}" data-on-change="opp-rate" data-k="${k}" data-i="${i}" aria-label="${k} R${i + 1}"></td>`).join('')}</tr>`).join('')}
          </tbody></table></div>
          <p class="note">${opp.source === 'dvw' ? 'Built from an imported DataVolley file.' : 'Enter from scouting, or import their DataVolley file on the Import page to fill this in automatically.'}</p>`
        : '<p class="note">No opponent selected — using league-average rates (60% side-out). Import an opponent’s .dvw to scout them rotation by rotation.</p>'}
      </section>

      <section class="split">
        <div class="panel">
          <h2 class="panel-title">Starting rotation vs theirs</h2>
          ${can('start-optimizer') ? `
            <p class="note">Set win probability. Rows: our start. Columns: their start. Outlined row = best against ${st.startThem == null ? 'an unknown start' : `their R${st.startThem + 1}`}.</p>
            <div class="scroll-x">${heatmap(bs.M, { best: bs.best, themCol: st.startThem })}</div>
            <button class="btn btn-sm" data-action="use-start" data-r="${bs.best}">Start in R${bs.best + 1}</button>`
          : lockPanel('start-optimizer', minPlanFor('start-optimizer'), FEATURE_LABEL['start-optimizer'])}
        </div>
        <div class="panel">
          <h2 class="panel-title">If they choose their start to beat yours</h2>
          ${game ? `
            <p>Safest pure start: <b>R${game.safest + 1}</b> — guarantees at least <b>${pct(game.safestValue)}</b> per set whatever they do.</p>
            ${Math.max(...game.us) > 0.95
              ? `<p>No need to mix: <b>R${game.us.indexOf(Math.max(...game.us)) + 1}</b> is your best start whatever they choose (game value ${pct(game.value)}).</p>`
              : `<p>Game value with mixing: <b>${pct(game.value)}</b>. Mix your starts across sets like this to stay unreadable:</p>`}
            <ul class="mix">${game.us.map((x, i) => (x > 0.02 ? `<li><span>R${i + 1}</span><div class="mix-bar"><i style="width:${(100 * x).toFixed(0)}%"></i></div><b>${pct(x, 0)}</b></li>` : '')).join('')}</ul>
            <p class="note">Zero-sum game over the 6×6 start matrix, solved by fictitious play. Useful against coaches who scout your starts.</p>`
          : lockPanel('game-theory', minPlanFor('game-theory'), FEATURE_LABEL['game-theory'])}
        </div>
      </section>

      <section class="panel">
        <h2 class="panel-title">Practice priorities</h2>
        <p class="note">Match win probability gained by improving one rotation by 3 percentage points. Spend gym time where it moves the match most.</p>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>Rotation</th><th class="num">+3 pts side-out</th><th class="num">+3 pts point-score</th></tr></thead><tbody>
          ${pri.map((r, i) => `<tr><td><b>R${i + 1}</b></td><td class="num"><span class="bar-cell" style="--w:${(r.so / pri.max) * 100}%">${pts(r.so, 2)}</span></td><td class="num"><span class="bar-cell" style="--w:${(r.bp / pri.max) * 100}%">${pts(r.bp, 2)}</span></td></tr>`).join('')}
        </tbody></table></div>
      </section>`;
  },
  actions: {
    'use-start': (el) => update((s) => { s.match.startUs = Number(el.dataset.r); }),
    'new-opp': () => update((s) => { const o = { id: uid('opp'), name: 'New opponent', source: 'manual', so: Array(6).fill(0.6), bp: Array(6).fill(0.4) }; s.opponents.push(o); s.activeOpponent = o.id; }),
    'del-opp': () => update((s) => { s.opponents = s.opponents.filter((o) => o.id !== s.activeOpponent); s.activeOpponent = ''; }),
  },
  changes: {
    bestOf: (el) => update((s) => { s.match.bestOf = Number(el.value); }),
    target: (el) => update((s) => { s.match.target = clampInt(el.value, 15, 30, 25); }),
    decidingTarget: (el) => update((s) => { s.match.decidingTarget = clampInt(el.value, 10, 30, 15); }),
    firstServe: (el) => update((s) => { s.match.firstServe = el.value; }),
    startUs: (el) => update((s) => { s.match.startUs = Number(el.value); }),
    startThem: (el) => update((s) => { s.match.startThem = el.value === '' ? null : Number(el.value); }),
    'pick-opp': (el) => update((s) => { s.activeOpponent = el.value; }),
    'opp-name': (el) => update(() => { opponent().name = el.value.trim() || 'Opponent'; }),
    'opp-rate': (el) => {
      const v = Number(el.value);
      if (!(v > 5 && v < 95)) return toast('Enter a percentage between 5 and 95', 'warn');
      update(() => { opponent()[el.dataset.k][Number(el.dataset.i)] = v / 100; });
    },
  },
};

const clampInt = (v, lo, hi, d) => { const x = Math.round(Number(v)); return Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : d; };

function priorities(profile, opp, st, base) {
  const bump = (arr, i) => arr.map((x, k) => (k === i ? Math.min(0.97, x + 0.03) : x));
  const rows = [0, 1, 2, 3, 4, 5].map((i) => ({
    so: summarize({ so: bump(profile.so, i), bp: profile.bp }, opp, st).match - base,
    bp: summarize({ so: profile.so, bp: bump(profile.bp, i) }, opp, st).match - base,
  }));
  rows.max = Math.max(...rows.flatMap((r) => [r.so, r.bp]), 1e-6);
  return rows;
}
