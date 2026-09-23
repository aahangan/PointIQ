import { getState, update } from '../store.js';
import { PLANS, FEATURE_LABEL } from '../../engine/plans.js';
import { esc } from '../ui.js';

const PERIOD = { monthly: ['/ month', 'Billed monthly'], season: ['/ season', 'One 4-month season'], annual: ['/ year', 'Billed yearly'] };

export default {
  id: 'plans',
  title: 'Plans',
  render(root) {
    const s = getState();
    const bill = s.billing || 'annual';
    const allFeatures = Object.keys(FEATURE_LABEL);
    root.innerHTML = `
      <header class="page-head"><div><p class="eyebrow">PointIQ</p><h1>Plans</h1><p class="lede">Priced per team, the way programs buy software. Pay by the month, by the season, or save with a year.</p></div>
        <div class="seg" role="group" aria-label="Billing period">${Object.keys(PERIOD).map((k) => `<button class="seg-btn${bill === k ? ' on' : ''}" data-action="bill" data-b="${k}">${k === 'monthly' ? 'Monthly' : k === 'season' ? 'Season pass' : 'Annual'}</button>`).join('')}</div>
      </header>

      <section class="plans">
        ${PLANS.map((p) => {
          const price = p[bill];
          const cur = s.plan === p.key;
          return `<article class="panel plan${cur ? ' current' : ''}${p.key === 'program' ? ' featured' : ''}">
            <div class="plan-name">${esc(p.name)}</div>
            <div class="plan-who">${esc(p.who)}</div>
            <div class="plan-price">${price ? `$${price.toLocaleString()}<small>${PERIOD[bill][0]}</small>` : 'Free'}</div>
            <div class="plan-bill">${price ? PERIOD[bill][1] : 'No card needed'}${bill === 'monthly' && p.annual ? ` · $${p.annual}/yr if paid yearly` : ''}</div>
            <p>${esc(p.blurb)}</p>
            <ul class="plan-list">${p.features.filter((f) => !PLANS[Math.max(0, PLANS.indexOf(p) - 1)].features.includes(f) || p.key === 'starter').map((f) => `<li>${esc(FEATURE_LABEL[f])}</li>`).join('')}</ul>
            ${PLANS.indexOf(p) > 0 ? `<p class="plan-inc">Everything in ${esc(PLANS[PLANS.indexOf(p) - 1].name)}, plus the above.</p>` : ''}
            ${cur ? '<span class="badge ok">Current plan</span>' : `<button class="btn ${p.key === 'program' ? 'btn-primary' : ''}" data-action="set-plan" data-plan="${p.key}">Switch (demo)</button>`}
          </article>`;
        }).join('')}
      </section>

      <section class="panel">
        <h2 class="panel-title">Compare every feature</h2>
        <div class="scroll-x"><table class="tbl matrix"><thead><tr><th>Feature</th>${PLANS.map((p) => `<th class="num">${esc(p.name)}</th>`).join('')}</tr></thead><tbody>
          ${allFeatures.map((f) => `<tr><td>${esc(FEATURE_LABEL[f])}</td>${PLANS.map((p) => `<td class="num">${p.features.includes(f) ? '<span class="yes" aria-label="Included">●</span>' : '<span class="no" aria-label="Not included">—</span>'}</td>`).join('')}</tr>`).join('')}
          <tr><td>Teams</td>${PLANS.map((p) => `<td class="num">${p.limits.teams}</td>`).join('')}</tr>
          <tr><td>Staff seats</td>${PLANS.map((p) => `<td class="num">${p.limits.seats || 1}</td>`).join('')}</tr>
        </tbody></table></div>
        <p class="note">This is a working demo: plan switching unlocks features locally, and payment isn't connected yet.</p>
      </section>`;
  },
  actions: {
    bill: (el) => update((s) => { s.billing = el.dataset.b; }),
  },
};
