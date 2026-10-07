// Model lab: learn rotation rates from logged rallies with the Python model service,
// check the predictions out of sample (Brier score, calibration, score-only baseline),
// and switch PointIQ's predictions over to the learned rates.

import { getState, update, team, snapshotLineup } from '../store.js';
import { call, checkHealth, ralliesToCSV, serviceUrl, DEFAULT_URL } from '../service.js';
import { esc, pct, intervalPlot, calibrationChart, toast } from '../ui.js';

let busy = '';
let lastError = '';
let cross = null;

const MODEL_LABEL = {
  live_markov: ['Rotation model + in-match update', 'cal-live'],
  rotation_markov: ['Rotation model (pre-match)', 'cal-pre'],
  flat_markov: ['Flat Markov (no rotations)', 'cal-flat'],
  score_only: ['Score-only baseline', 'cal-score'],
};

function rerender() { document.dispatchEvent(new Event('pointiq:rerender')); }

async function run(label, fn) {
  busy = label; lastError = ''; rerender();
  try { await fn(); } catch (e) { lastError = e.message; toast(e.message, 'err'); }
  busy = ''; rerender();
}

export default {
  id: 'model',
  title: 'Model lab',
  feature: 'model-lab',
  lede: 'Rotation odds learned from your own rallies, checked against real results.',
  render(root) {
    const s = getState(), t = team();
    const rallies = t.rallies || [];
    const matches = new Set(rallies.map((r) => r.match_id)).size;
    const sets = new Set(rallies.map((r) => r.match_id + '|' + r.set)).size;
    const fit = t.fitted;
    const ev = t.evaluation;
    const svc = s.service || {};
    const ok = svc.ok;
    const btn = (action, label, primary = false, disabled = false) => `<button class="btn${primary ? ' btn-primary' : ''}" data-action="${action}"${busy || disabled ? ' disabled' : ''}>${busy === action ? 'Working…' : label}</button>`;

    root.innerHTML = `
      <header class="page-head"><div><p class="eyebrow">${esc(t.name)} · ${rallies.length.toLocaleString()} logged rallies</p><h1>Model lab</h1><p class="lede">PointIQ learns each rotation's side-out and point-scoring odds from real rallies, feeds them into the set model, and checks the predictions against real set results.</p></div></header>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Model service</h2><span><span class="dot-status ${ok ? 'on' : svc.checkedAt ? 'off' : ''}"></span>${ok ? `Connected · v${esc(svc.version || '')}` : svc.checkedAt ? 'Not reachable' : 'Not checked'}</span></div>
        <div class="svc">
          <label class="field"><span>Service address</span><input id="svc-url" value="${esc(serviceUrl())}" data-on-change="url" placeholder="${DEFAULT_URL}"></label>
          ${btn('check', 'Check connection')}
        </div>
        ${ok ? '' : `<p class="note">The model runs as a small Python service on your laptop. In a terminal, from the PointIQ folder:</p>
        <pre class="cmd">cd model &amp;&amp; .venv/bin/python -m pointiq_model serve</pre>
        <p class="note">First time? Create the environment with <code>python3 -m venv model/.venv &amp;&amp; model/.venv/bin/pip install -r model/requirements.txt</code>. The service only answers pages served from localhost, so open PointIQ locally (<code>python3 tools/serve.py 8080</code>) when you use it.</p>`}
        ${lastError ? `<div class="alert">${esc(lastError)}</div>` : ''}
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Rally log</h2><span class="badge">${matches} matches · ${sets} sets · ${rallies.length.toLocaleString()} rallies</span></div>
        <p>Every match you track in the <a href="#live">Live tracker</a> is saved here rally by rally: rotation, server, score and who won the point. DataVolley files and rally CSVs from the <a href="#data">Import</a> page add to it too.</p>
        <div class="row">
          ${btn('demo', 'Add a simulated season (demo)', !rallies.length, !ok)}
          ${btn('copy', 'Copy as CSV', false, !rallies.length)}
          ${btn('clear', 'Clear log', false, !rallies.length)}
        </div>
        ${rallies.length && rallies.length < 600 ? `<p class="note">About 10 matches (≈1,600 rallies) gives usable per-rotation estimates; proving the model beats a score-only baseline takes a full season or more.</p>` : ''}
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Learned rotation odds</h2>
          <div class="row" style="margin:0">
            <select id="fit-method" aria-label="Estimation method"><option value="hierarchical">Hierarchical Bayes (statsmodels)</option><option value="empirical_bayes">Empirical Bayes (beta-binomial)</option></select>
            ${btn('fit', 'Fit model', true, !ok || rallies.length < 30)}
          </div>
        </div>
        ${fit ? fitView(fit, t) : '<p class="note">Fit the model to see each rotation’s odds with 80% ranges. Rotations with few rallies are pulled toward the team average instead of swinging wildly.</p>'}
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Does it predict? Out-of-sample check</h2>${btn('evaluate', 'Run evaluation', !!fit, !ok || rallies.length < 300)}</div>
        ${ev ? evalView(ev) : '<p class="note">Splits your matches into five groups, fits on four, and predicts every rally state in the fifth: “we’re up 18–16 in R3 and serving — what are the odds we win this set?” It compares those odds to what actually happened and to a baseline that only looks at the score. Needs at least 300 rallies.</p>'}
      </section>

      <section class="panel">
        <div class="panel-head"><h2 class="panel-title">Exact model vs simulation</h2>${btn('cross', 'Run cross-check', false, !ok || !fit)}</div>
        ${cross ? `<div class="scroll-x"><table class="tbl"><thead><tr><th>Start</th><th>First serve</th><th class="num">Exact (Markov chain)</th><th class="num">20,000 simulated sets</th><th class="num">Gap (std. errors)</th></tr></thead><tbody>
          ${cross.map((c) => `<tr><td>R${c.start + 1}</td><td>${c.first_serve === 'us' ? 'Us' : 'Them'}</td><td class="num">${pct(c.exact, 2)}</td><td class="num">${pct(c.monte_carlo, 2)}</td><td class="num">${c.z.toFixed(2)}</td></tr>`).join('')}
        </tbody></table></div><p class="note">The set model is solved exactly; the simulation plays it out by brute force. Gaps under about 3 standard errors mean they agree.</p>`
        : '<p class="note">Plays thousands of simulated sets with the learned odds and checks they land where the exact calculation says.</p>'}
      </section>`;
  },
  actions: {
    check: () => run('check', async () => { await checkHealth(); toast('Model service connected'); }),
    demo: () => run('demo', async () => {
      const rows = await call('/api/demo-season', { matches: 30, seasons: ['2024', '2025'], seed: Math.floor(Math.random() * 1e6) });
      update(() => { const t = team(); t.rallies = [...(t.rallies || []), ...rows.map((r) => ({ ...r, demo: true }))]; });
      toast(`Added ${rows.length.toLocaleString()} simulated rallies`);
    }),
    copy: () => {
      const dlg = document.getElementById('dialog');
      dlg.innerHTML = `<form method="dialog" class="dlg"><h2>Rally log (CSV)</h2><p>Save as <code>rallies.csv</code>, then run <code>python -m pointiq_model evaluate rallies.csv</code> for a full report with a calibration chart.</p><textarea id="backup-text" readonly rows="10">${esc(ralliesToCSV(team().rallies || []))}</textarea><div class="row"><button class="btn btn-primary" type="button" data-action="copy-backup">Copy</button><button class="btn" value="close">Close</button></div></form>`;
      dlg.showModal();
    },
    clear: () => {
      const dlg = document.getElementById('dialog');
      dlg.innerHTML = `<form method="dialog" class="dlg"><h2>Clear the rally log?</h2><p>This removes all ${(team().rallies || []).length.toLocaleString()} logged rallies and the fitted model from this browser. Back up your data first if you might need them.</p><div class="row"><button class="btn btn-primary danger" type="button" data-action="clear-yes">Clear log</button><button class="btn" value="close">Cancel</button></div></form>`;
      dlg.showModal();
    },
    'clear-yes': () => {
      document.getElementById('dialog').close();
      update(() => { const t = team(); t.rallies = []; t.fitted = null; t.evaluation = null; if (t.rotationSource === 'fitted') t.rotationSource = 'hier'; });
      cross = null;
      toast('Rally log cleared');
    },
    fit: () => run('fit', async () => {
      const method = document.getElementById('fit-method').value;
      const res = await call('/api/fit', { rallies: team().rallies, method });
      update(() => { const t = team(); t.fitted = { ...res, fittedAt: new Date().toISOString() }; t.baseline ||= snapshotLineup(t); });
      cross = null;
      toast('Model fitted');
    }),
    evaluate: () => run('evaluate', async () => {
      const res = await call('/api/evaluate', { rallies: team().rallies, method: team().fitted?.method || 'hierarchical' }, { timeout: 180000 });
      update(() => { team().evaluation = { ...res, at: new Date().toISOString() }; });
    }),
    cross: () => run('cross', async () => { cross = await call('/api/crosscheck', { rates: team().fitted }); }),
    use: () => { update(() => { team().rotationSource = 'fitted'; }); toast('Predictions now use the learned rotation odds'); },
  },
  changes: {
    url: (el) => update((s) => { s.service = { ...(s.service || {}), url: el.value.trim() || DEFAULT_URL, ok: false, checkedAt: 0 }; }),
  },
};

function fitView(fit, t) {
  const rows = (ph) => fit[ph].map((m, r) => ({ label: `R${r + 1} · n=${fit['n_' + ph][r]}`, mean: m, lo: fit[ph + '_lo'][r], hi: fit[ph + '_hi'][r], raw: fit['raw_' + ph][r] ?? NaN }));
  const c = fit.components;
  const cv = fit.rally_cv;
  return `
    <div class="stack">
      <div><h3 class="panel-title">Side-out (receiving)</h3>${intervalPlot(rows('so'), { lo: 0.4, hi: 0.8, ref: 0.6 })}</div>
      <div><h3 class="panel-title">Point-score (serving)</h3>${intervalPlot(rows('bp'), { lo: 0.2, hi: 0.6, ref: 0.4 })}</div>
    </div>
    <div class="legend"><span><i class="lg lg-dot"></i>Learned estimate</span><span><i class="lg lg-raw"></i>Raw rate</span><span><i class="lg lg-ci"></i>80% range</span></div>
    <p class="note">${fit.method === 'hierarchical' ? `Hierarchical logistic model on ${fit.rallies?.toLocaleString() || ''} rallies from ${fit.matches || ''} matches: rotations share strength with each other, and a per-match effect absorbs opponent strength. Spread between rotations: ${c?.SO?.rotation_sd?.toFixed(2)} (side-out), ${c?.BP?.rotation_sd?.toFixed(2)} (serving) on the log-odds scale; between opponents: ${c?.SO?.match_sd?.toFixed(2)} / ${c?.BP?.match_sd?.toFixed(2)}.` : 'Empirical Bayes: each rotation is shrunk toward the phase average by an amount estimated from the spread between rotations.'}
    ${cv?.improvement != null ? ` Knowing the rotation ${cv.improvement > 0 ? 'improves' : 'does not improve'} rally-by-rally prediction (cross-validated log loss ${cv.serve_only.toFixed(4)} → ${cv.rotation.toFixed(4)}).` : ''}</p>
    <div class="row">${t.rotationSource === 'fitted' ? '<span class="badge ok">In use for predictions</span>' : '<button class="btn btn-primary" data-action="use">Use learned odds for predictions</button>'}<span class="note">Fitted ${new Date(fit.fittedAt).toLocaleString()}. Lineup edits made after fitting are applied on top as modeled changes.</span></div>`;
}

function evalView(ev) {
  const names = Object.keys(ev.models);
  const best = names.reduce((a, b) => (ev.models[a].brier <= ev.models[b].brier ? a : b));
  const live = ev.models.live_markov?.brier_improvement_vs_score_only;
  const verdict = live ? (live.ci95[0] > 0 ? `<b>The model beats the score-only baseline</b> — Brier improvement ${live.mean.toFixed(4)} (95% interval ${live.ci95[0].toFixed(4)} to ${live.ci95[1].toFixed(4)}).` : `<b>Not yet distinguishable from the score-only baseline</b> — the 95% interval for the improvement (${live.ci95[0].toFixed(4)} to ${live.ci95[1].toFixed(4)}) includes zero. More matches will settle it.`) : '';
  return `
    <p>${ev.matches} matches · ${ev.sets} sets · ${ev.rallies.toLocaleString()} rally states, ${ev.folds}-fold cross-validation by match. ${verdict}</p>
    <div class="stack">
      <div class="scroll-x"><table class="tbl"><thead><tr><th>Model</th><th class="num">Brier ↓</th><th class="num">Log loss ↓</th><th class="num">Calib. error ↓</th><th class="num">Skill vs score-only</th></tr></thead><tbody>
        ${names.map((n) => { const m = ev.models[n]; return `<tr class="${n === best ? 'metric-best' : ''}"><td><i class="lg ${MODEL_LABEL[n][1].replace('cal', 'lg')}"></i>${MODEL_LABEL[n][0]}</td><td class="num">${m.brier.toFixed(4)}</td><td class="num">${m.log_loss.toFixed(4)}</td><td class="num">${m.ece.toFixed(4)}</td><td class="num">${(100 * m.brier_skill_vs_score_only).toFixed(1)}%</td></tr>`; }).join('')}
      </tbody></table>
      <p class="note">Brier score: average squared gap between the predicted chance and what happened (0 is perfect, 0.25 is a coin flip). Skill: how much of the score-only baseline’s error the model removes.</p></div>
      <div>${calibrationChart(names.map((n) => ({ label: MODEL_LABEL[n][0], cls: MODEL_LABEL[n][1], points: ev.models[n].calibration })))}
      <div class="legend">${names.map((n) => `<span><i class="lg ${MODEL_LABEL[n][1].replace('cal', 'lg')}"></i>${MODEL_LABEL[n][0]}</span>`).join('')}<span>Dashed diagonal: perfect calibration</span></div>
      <p class="note">Each dot groups rally states by predicted chance; a well-calibrated model sits on the diagonal. Bigger dots hold more states.</p></div>
    </div>`;
}
