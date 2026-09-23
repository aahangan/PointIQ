import { getState, update, team, opponent, activeProfile, hierFit, can } from '../store.js';
import { esc, pct, pts, rotationStrip, outcomeBars, meter } from '../ui.js';
import { summarize, bestStart, decisionValues, sourceChip, matchSettings } from './common.js';

export default {
  id: 'overview',
  title: 'Match day',
  render(root) {
    const s = getState(), t = team(), opp = opponent();
    const settings = matchSettings();
    const { profile } = activeProfile(t);
    const sum = summarize(profile, opp, settings);
    const bs = bestStart(profile, opp, settings);
    const weakSO = profile.so.indexOf(Math.min(...profile.so));
    const weakBP = profile.bp.indexOf(Math.min(...profile.bp));
    const fit = can('hierarchical') ? hierFit(t) : null;
    const pBelow = fit?.phases?.SO?.rots[weakSO]?.pBelow;
    const persistence = fit?.phases?.SO?.persistence?.mean;
    const dv = can('libero-subs') ? decisionValues(t) : null;
    const startGain = bs.per[bs.best] - bs.per[settings.startUs];

    root.innerHTML = `
      <header class="page-head">
        <div>
          <p class="eyebrow">${esc(t.name)} vs ${esc(opp?.name || 'league-average opponent')}</p>
          <h1>Match day</h1>
        </div>
        <div class="seg" role="group" aria-label="Match format">
          ${[5, 3].map((b) => `<button class="seg-btn${settings.bestOf === b ? ' on' : ''}" data-action="bo" data-b="${b}" aria-pressed="${settings.bestOf === b}">Best of ${b}</button>`).join('')}
        </div>
      </header>

      <section class="hero-grid">
        <div class="panel hero">
          <div class="hero-label">Match win probability ${sourceChip(t)}</div>
          <div class="hero-num">${pct(sum.match)}</div>
          ${meter(sum.match, { label: 'Match win probability', big: true })}
          <dl class="kv">
            <div><dt>Any single set</dt><dd>${pct(sum.set)}</dd></div>
            <div><dt>Starting rotation</dt><dd>R${settings.startUs + 1}${settings.startThem == null ? ' vs any' : ` vs R${settings.startThem + 1}`}</dd></div>
            <div><dt>First serve</dt><dd>${settings.firstServe === 'toss' ? 'Coin toss' : settings.firstServe === 'us' ? 'Us' : 'Them'}</dd></div>
          </dl>
        </div>
        <div class="panel">
          <h2 class="panel-title">How the match ends</h2>
          ${outcomeBars(sum.dist, settings.bestOf)}
          <p class="note">Exact Markov-chain probabilities, sets to ${settings.target} with a deciding set to ${settings.decidingTarget}.</p>
        </div>
      </section>

      <section class="cards3">
        <article class="panel insight ${startGain > 0.004 ? 'warn' : 'good'}">
          <h3>Starting rotation</h3>
          ${startGain > 0.004
            ? `<p>Start in <b>R${bs.best + 1}</b> instead of R${settings.startUs + 1}: set win probability <b>${pts(startGain)}</b> pts.</p><button class="btn btn-sm" data-action="use-start" data-r="${bs.best}">Start in R${bs.best + 1}</button>`
            : bs.best === settings.startUs
              ? `<p>R${settings.startUs + 1} is already your best start${settings.startThem == null ? ' against an unknown opponent start' : ''}.</p>`
              : `<p>R${settings.startUs + 1} is within half a point of the best start (R${bs.best + 1}, ${pts(startGain, 2)} per set). Starting rotation isn't a lever in this matchup.</p>`}
        </article>
        <article class="panel insight ${pBelow > 0.8 ? 'bad' : 'warn'}">
          <h3>Weakest rotation</h3>
          <p><b>R${weakSO + 1}</b> sides out at ${pct(profile.so[weakSO])}${Number.isFinite(pBelow) ? ` — <b>${pct(pBelow, 0)}</b> likely to be a real weakness, not noise` : ''}. Serving is weakest in <b>R${weakBP + 1}</b> (${pct(profile.bp[weakBP])}).</p>
          ${Number.isFinite(persistence) ? `<p class="note">${pct(persistence, 0)} of rotation-to-rotation differences carry over season to season.</p>` : ''}
        </article>
        <article class="panel insight">
          <h3>What your decisions are worth</h3>
          ${dv && dv.rows.length ? `<ul class="dv">${dv.rows.map((r) => `<li><span>${esc(r.label)}</span><b class="${r.value >= 0 ? 'up' : 'down'}">${pts(r.value)}</b></li>`).join('')}</ul><p class="note">Change in match win probability, in percentage points.</p>` : `<p>Set a libero and substitutions in <a href="#lineup">Lineup Lab</a> to see what each one is worth.</p>`}
        </article>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Rotation profile</h2><a class="link" href="#lineup">Edit lineup →</a></div>
        ${rotationStrip(profile, { highlight: weakSO })}
        <p class="note">Side-out: we win the rally when receiving. Point-score: we win it when serving. Rotations are named by the setter's zone.</p>
      </section>`;
  },
  actions: {
    bo: (el) => update((s) => { s.match.bestOf = Number(el.dataset.b); }),
    'use-start': (el) => update((s) => { s.match.startUs = Number(el.dataset.r); }),
  },
};
