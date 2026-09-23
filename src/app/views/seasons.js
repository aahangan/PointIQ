import { getState, update, team, hierFit } from '../store.js';
import { esc, pct, intervalPlot, meter } from '../ui.js';

let phase = 'SO', view = 'current';

export default {
  id: 'seasons',
  title: 'Multi-season model',
  feature: 'hierarchical',
  lede: 'A Bayesian model that learns which rotation strengths are structural and which are noise.',
  render(root) {
    const s = getState(), t = team();
    const fit = hierFit(t);
    if (!fit || !fit.phases[phase]) {
      root.innerHTML = `<header class="page-head"><div><p class="eyebrow">${esc(t.name)}</p><h1>Multi-season model</h1></div></header>
        <section class="panel"><p>No rotation history yet. Import DataVolley files, track matches live, or load a <code>Season, Rotation, Phase, Won, Total</code> CSV on the <a href="#data">Import</a> page.</p></section>`;
      return;
    }
    const P = fit.phases[phase];
    const lo = phase === 'SO' ? 0.4 : 0.2, hi = phase === 'SO' ? 0.8 : 0.6;
    const rows = P.rots.map((r) => ({ label: `R${r.r + 1}${view === 'current' ? ` · n=${r.n}` : ''}`, raw: view === 'current' ? r.raw : NaN, ...r[view] }));
    const totalRallies = t.history.reduce((a, r) => a + r.n, 0);
    const pers = P.persistence.mean;

    root.innerHTML = `
      <header class="page-head"><div><p class="eyebrow">${esc(t.name)} · ${fit.seasons.length} seasons · ${totalRallies.toLocaleString()} rallies</p><h1>Multi-season model</h1></div>
        <div class="seg" role="group" aria-label="Phase">${[['SO', 'Side-out'], ['BP', 'Point-score']].map(([k, l]) => `<button class="seg-btn${phase === k ? ' on' : ''}" data-action="phase" data-p="${k}">${l}</button>`).join('')}</div>
      </header>

      <section class="cards3">
        <article class="panel stat">
          <h3>Persistence</h3>
          <div class="stat-num">${pct(pers, 0)}</div>
          ${meter(pers, { label: 'Persistence' })}
          <p class="note">${pers > 0.6 ? 'Most rotation differences carry over year to year — they come from your system and personnel. Fix them structurally.' : pers > 0.35 ? 'Rotation differences are partly structural, partly season-specific.' : 'Rotation differences mostly don’t persist — last year’s “bad rotation” was largely noise.'}</p>
        </article>
        <article class="panel stat">
          <h3>Spread, logit scale</h3>
          <dl class="kv kv-tight"><div><dt>Between rotations</dt><dd>${P.sd.rotation.toFixed(2)}</dd></div><div><dt>Between seasons</dt><dd>${P.sd.season.toFixed(2)}</dd></div><div><dt>Season × rotation noise</dt><dd>${P.sd.noise.toFixed(2)}</dd></div></dl>
          <p class="note">0.10 on the logit scale ≈ 2.4 percentage points near 60%.</p>
        </article>
        <article class="panel stat">
          <h3>Down-weight older seasons</h3>
          <div class="stat-num">${s.hier.decay.toFixed(2)}<small>× per year</small></div>
          <input type="range" min="0.5" max="1" step="0.05" value="${s.hier.decay}" data-on-change="decay" aria-label="Season decay">
          <p class="note">1.00 treats every season equally. Lower it after heavy roster turnover.</p>
        </article>
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">${phase === 'SO' ? 'Side-out' : 'Point-score'} by rotation</h2>
          <div class="seg" role="group" aria-label="Estimate">${[['current', `This season (${fit.target})`], ['next', 'Next season'], ['structural', 'Structural']].map(([k, l]) => `<button class="seg-btn${view === k ? ' on' : ''}" data-action="view" data-v="${k}">${l}</button>`).join('')}</div>
        </div>
        ${intervalPlot(rows, { lo, hi, ref: phase === 'SO' ? 0.6 : 0.4 })}
        <div class="legend"><span><i class="lg lg-dot"></i>Model estimate</span><span><i class="lg lg-raw"></i>Raw this season</span><span><i class="lg lg-ci"></i>80% range</span></div>
        <p class="note">${view === 'current' ? 'Small current-season samples are pulled toward each rotation’s long-run level — the fewer rallies, the stronger the pull.' : view === 'next' ? 'Projection for a new season, including uncertainty from roster turnover.' : 'The rotation’s long-run level, averaged over seasons.'}</p>
      </section>

      <section class="panel">
        <h2 class="panel-title">Rotation detail</h2>
        <div class="scroll-x"><table class="tbl"><thead><tr><th>Rot.</th>${fit.seasons.map((sn) => `<th class="num">${esc(sn)}</th>`).join('')}<th class="num">Estimate now</th><th class="num">80% range</th><th class="num">P(below team avg)</th></tr></thead><tbody>
          ${P.rots.map((r) => `<tr><td><b>R${r.r + 1}</b></td>${r.history.map((h) => `<td class="num">${h.n ? `${pct(h.raw, 0)} <small>${h.n}</small>` : '—'}</td>`).join('')}<td class="num"><b>${pct(r.current.mean)}</b></td><td class="num">${pct(r.current.lo, 0)}–${pct(r.current.hi, 0)}</td><td class="num"><span class="badge ${r.pBelow > 0.8 ? 'bad' : r.pBelow < 0.2 ? 'ok' : ''}">${pct(r.pBelow, 0)}</span></td></tr>`).join('')}
        </tbody></table></div>
      </section>

      <section class="panel">
        <h2 class="panel-title">Season strength</h2>
        ${intervalPlot(P.seasonEffects.map((e) => ({ label: e.season, mean: e.mean, lo: e.lo, hi: e.hi })), { lo, hi, ref: phase === 'SO' ? 0.6 : 0.4 })}
        <div class="row"><button class="btn btn-primary" data-action="use">Use this model for match predictions</button><span class="note">Currently: ${t.rotationSource === 'hier' ? 'in use' : 'not in use'}.</span></div>
        <details class="method"><summary>How the model works</summary>
          <p>Every season's rotation record is treated as a noisy measurement of an underlying rate. On the log-odds scale, each rate is the sum of a team baseline, a <b>persistent rotation effect</b>, a <b>season effect</b>, and a <b>season-specific deviation</b>. Each effect has its own variance, learned from your data by Gibbs sampling (${P.draws.toLocaleString()} posterior draws). Older seasons count less (decay above). The persistence number is the share of rotation variation that is persistent.</p>
        </details>
      </section>`;
  },
  actions: {
    phase: (el) => { phase = el.dataset.p; document.dispatchEvent(new Event('pointiq:rerender')); },
    view: (el) => { view = el.dataset.v; document.dispatchEvent(new Event('pointiq:rerender')); },
    use: () => update(() => { team().rotationSource = 'hier'; }),
  },
  changes: {
    decay: (el) => update((s) => { s.hier.decay = Number(el.value); }),
  },
};
