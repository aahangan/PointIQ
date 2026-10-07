// Rendering helpers: escaping, formatting, and hand-drawn SVG charts (no chart library).

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const pct = (p, d = 1) => (Number.isFinite(p) ? (100 * p).toFixed(d) + '%' : '—');
export const pts = (p, d = 1) => (Number.isFinite(p) ? (p >= 0 ? '+' : '−') + Math.abs(100 * p).toFixed(d) : '—');
export const fx = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
export const eff = (x) => (Number.isFinite(x) ? (x < 0 ? '−' : '') + Math.abs(x).toFixed(3).replace(/^0/, '') : '—');

export function toast(msg, kind = 'ok') {
  const el = document.createElement('div');
  el.className = `toast toast-${kind}`;
  el.setAttribute('role', 'status');
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3100);
}

export function lockPanel(feature, plan, label) {
  return `<div class="lock">
    <div class="lock-mark" aria-hidden="true">${ICON.lock}</div>
    <div><strong>${esc(label)}</strong> is part of the <strong>${esc(plan.name)}</strong> plan.</div>
    <button class="btn btn-primary" data-action="set-plan" data-plan="${plan.key}">Switch to ${esc(plan.name)} (demo)</button>
    <a class="link" href="#plans">Compare plans</a>
  </div>`;
}

export const ICON = {
  lock: '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>',
  ball: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="12" cy="12" r="9"/><path d="M12 3c-2 4-2 9 0 18M3.5 9c5 1 11 0 17-3M4 16c5-2 11-2 16 1"/></svg>',
};

// ---- Rotation strip: SO and BP per rotation, league reference tick ----------------------
export function rotationStrip(profile, { league = 0.6, baseline = null, highlight = -1, labels = ['R1', 'R2', 'R3', 'R4', 'R5', 'R6'] } = {}) {
  const W = 640, rowH = 34, H = rowH * 6 + 34, x0 = 44, colW = (W - x0 - 16) / 2;
  const scale = (p, lo, hi) => ((p - lo) / (hi - lo)) * (colW - 64);
  const col = (k, title, lo, hi, vals, base, ref) => {
    const cx = x0 + k * (colW + 8);
    let s = `<text x="${cx}" y="14" class="ax-title">${title}</text>`;
    const rx = cx + scale(ref, lo, hi);
    s += `<line x1="${rx}" x2="${rx}" y1="22" y2="${H - 6}" class="ref"/><text x="${rx + 3}" y="${H - 2}" class="ax">league ${pct(ref, 0)}</text>`;
    vals.forEach((v, i) => {
      const y = 26 + i * rowH, w = Math.max(2, scale(v, lo, hi));
      s += `<rect x="${cx}" y="${y}" width="${w}" height="${rowH - 14}" rx="3" class="${i === highlight ? 'bar-hl' : 'bar'}${k ? ' bar-bp' : ''}"/>`;
      s += `<text x="${cx + w + 6}" y="${y + rowH / 2 - 2}" class="val">${pct(v)}</text>`;
      if (base) { const d = v - base[i]; if (Math.abs(d) > 0.0005) s += `<text x="${cx + colW - 6}" y="${y + rowH / 2 - 2}" text-anchor="end" class="${d > 0 ? 'up' : 'down'}">${pts(d)}</text>`; }
    });
    return s;
  };
  let svg = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Side-out and point-score rates by rotation">`;
  labels.forEach((l, i) => { svg += `<text x="0" y="${26 + i * rowH + rowH / 2 - 2}" class="rl${i === highlight ? ' rl-hl' : ''}">${l}</text>`; });
  svg += col(0, 'SIDE-OUT (receiving)', 0.4, 0.8, profile.so, baseline?.so, league);
  svg += col(1, 'POINT-SCORE (serving)', 0.2, 0.6, profile.bp, baseline?.bp, 1 - league);
  return svg + '</svg>';
}

// ---- Match outcome distribution --------------------------------------------------------
export function outcomeBars(dist, bestOf) {
  const need = Math.ceil(bestOf / 2);
  const keys = [];
  for (let l = 0; l < need; l++) keys.push(`${need}-${l}`);
  for (let l = need - 1; l >= 0; l--) keys.push(`${l}-${need}`);
  const W = 360, H = 150, bw = W / keys.length;
  const max = Math.max(...keys.map((k) => dist[k] || 0), 0.01);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H + 30}" role="img" aria-label="Probability of each match score">`;
  keys.forEach((k, i) => {
    const v = dist[k] || 0, h = (v / max) * (H - 24), x = i * bw + 6, win = Number(k[0]) === need;
    s += `<rect x="${x}" y="${H - h}" width="${bw - 12}" height="${h}" rx="3" class="${win ? 'bar' : 'bar-loss'}"/>`;
    s += `<text x="${x + (bw - 12) / 2}" y="${H - h - 6}" text-anchor="middle" class="val">${pct(v, 0)}</text>`;
    s += `<text x="${x + (bw - 12) / 2}" y="${H + 18}" text-anchor="middle" class="ax">${k}</text>`;
  });
  return s + '</svg>';
}

// ---- Win-probability line (live tracker) ------------------------------------------------
export function wpLine(series, { setBreaks = [] } = {}) {
  const W = 640, H = 170, pad = 26;
  const n = Math.max(series.length - 1, 1);
  const X = (i) => pad + (i / n) * (W - pad * 2), Y = (p) => 10 + (1 - p) * (H - 30);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Match win probability over the match">`;
  [0, 0.25, 0.5, 0.75, 1].forEach((g) => { s += `<line x1="${pad}" x2="${W - pad}" y1="${Y(g)}" y2="${Y(g)}" class="${g === 0.5 ? 'ref' : 'grid'}"/><text x="${pad - 4}" y="${Y(g) + 4}" text-anchor="end" class="ax">${g * 100}</text>`; });
  setBreaks.forEach((i) => { s += `<line x1="${X(i)}" x2="${X(i)}" y1="10" y2="${H - 20}" class="grid"/>`; });
  if (series.length > 1) {
    const d = series.map((p, i) => `${i ? 'L' : 'M'}${X(i).toFixed(1)},${Y(p).toFixed(1)}`).join('');
    s += `<path d="${d} L${X(series.length - 1)},${Y(0.5)} L${X(0)},${Y(0.5)}Z" class="area"/><path d="${d}" class="line"/>`;
  }
  const last = series[series.length - 1];
  if (last != null) s += `<circle cx="${X(series.length - 1)}" cy="${Y(last)}" r="4.5" class="dot"/>`;
  return s + '</svg>';
}

// ---- 6×6 start-rotation heatmap ----------------------------------------------------------
export function heatmap(M, { best = -1, themCol = null } = {}) {
  const c = 52, x0 = 44, y0 = 30;
  const W = x0 + 6 * c + 4, H = y0 + 6 * c + 4;
  const lo = Math.min(...M.flat()), hi = Math.max(...M.flat());
  let s = `<svg class="chart heat" viewBox="0 0 ${W} ${H}" role="img" aria-label="Set win probability by our and their starting rotation">`;
  for (let j = 0; j < 6; j++) s += `<text x="${x0 + j * c + c / 2}" y="${y0 - 10}" text-anchor="middle" class="ax${themCol === j ? ' rl-hl' : ''}">R${j + 1}</text>`;
  for (let i = 0; i < 6; i++) {
    s += `<text x="${x0 - 10}" y="${y0 + i * c + c / 2 + 4}" text-anchor="end" class="rl${best === i ? ' rl-hl' : ''}">R${i + 1}</text>`;
    for (let j = 0; j < 6; j++) {
      const t = hi > lo ? (M[i][j] - lo) / (hi - lo) : 0.5;
      s += `<rect x="${x0 + j * c + 1}" y="${y0 + i * c + 1}" width="${c - 2}" height="${c - 2}" rx="4" fill="var(--accent)" fill-opacity="${(0.12 + 0.78 * t).toFixed(2)}" class="${best === i ? 'cell-best' : ''}"/>`;
      s += `<text x="${x0 + j * c + c / 2}" y="${y0 + i * c + c / 2 + 4}" text-anchor="middle" class="cell${t > 0.55 ? ' cell-inv' : ''}">${(100 * M[i][j]).toFixed(1)}</text>`;
    }
  }
  return s + '</svg>';
}

// ---- Interval dot plot: raw vs posterior with 80% range ----------------------------------
export function intervalPlot(rows, { lo = 0.3, hi = 0.8, ref = null, fmt = (v) => pct(v, 0) } = {}) {
  const W = 640, rowH = 30, x0 = 120, x1 = W - 20, H = rows.length * rowH + 34;
  const X = (v) => x0 + ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (x1 - x0);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Estimates with 80 percent ranges">`;
  const ticks = 5;
  for (let k = 0; k <= ticks; k++) { const v = lo + (k / ticks) * (hi - lo); s += `<line x1="${X(v)}" x2="${X(v)}" y1="4" y2="${H - 24}" class="grid"/><text x="${X(v)}" y="${H - 8}" text-anchor="middle" class="ax">${fmt(v)}</text>`; }
  if (ref != null) s += `<line x1="${X(ref)}" x2="${X(ref)}" y1="4" y2="${H - 24}" class="ref"/>`;
  rows.forEach((r, i) => {
    const y = 16 + i * rowH;
    s += `<text x="0" y="${y + 4}" class="rl">${esc(r.label)}</text>`;
    if (Number.isFinite(r.lo)) s += `<line x1="${X(r.lo)}" x2="${X(r.hi)}" y1="${y}" y2="${y}" class="ci"/>`;
    if (Number.isFinite(r.raw)) s += `<circle cx="${X(r.raw)}" cy="${y}" r="4" class="raw"><title>raw ${fmt(r.raw)}</title></circle>`;
    if (Number.isFinite(r.mean)) s += `<circle cx="${X(r.mean)}" cy="${y}" r="5.5" class="dot"><title>estimate ${fmt(r.mean)}</title></circle>`;
  });
  return s + '</svg>';
}

// ---- Court diagram ------------------------------------------------------------------------
// zones: 6 player ids for zones 1..6. Net at top; front row 4-3-2, back row 5-6-1.
export function court(zones, { players, liberoId = null, subIds = [], server = null, passers = [] } = {}) {
  const W = 330, H = 300, pos = { 4: [55, 70], 3: [165, 70], 2: [275, 70], 5: [55, 200], 6: [165, 200], 1: [275, 200] };
  const byId = Object.fromEntries(players.map((p) => [p.id, p]));
  let s = `<svg class="court" viewBox="0 0 ${W} ${H + 20}" role="img" aria-label="Court positions">`;
  s += `<rect x="4" y="12" width="${W - 8}" height="${H - 24}" rx="6" class="court-floor"/>`;
  s += `<line x1="4" x2="${W - 4}" y1="12" y2="12" class="court-net"/><text x="${W / 2}" y="9" text-anchor="middle" class="ax">NET</text>`;
  s += `<line x1="4" x2="${W - 4}" y1="${12 + (H - 24) / 3}" y2="${12 + (H - 24) / 3}" class="court-attack"/>`;
  for (let z = 1; z <= 6; z++) {
    const id = zones[z - 1], p = byId[id] || { num: '?', pos: '', name: '' };
    const [x, y] = pos[z];
    const cls = id === liberoId ? 'chip chip-lib' : subIds.includes(id) ? 'chip chip-sub' : 'chip';
    s += `<g class="${cls}${passers.includes(id) ? ' chip-pass' : ''}"><circle cx="${x}" cy="${y}" r="27"/>`;
    s += `<text x="${x}" y="${y - 2}" text-anchor="middle" class="chip-num">${esc(p.num)}</text><text x="${x}" y="${y + 13}" text-anchor="middle" class="chip-pos">${esc(p.pos)}</text></g>`;
    s += `<text x="${x}" y="${y + 44}" text-anchor="middle" class="chip-name">${esc((p.name || '').split(' ').slice(-1)[0])}</text>`;
    s += `<text x="${x - 30}" y="${y - 22}" class="zone">${z}</text>`;
  }
  if (server) s += `<g class="serve-mark" transform="translate(${pos[1][0] + 18},${H - 6})"><circle r="8"/><text y="4" text-anchor="middle">S</text></g>`;
  return s + '</svg>';
}

export function meter(p, { label = '', big = false } = {}) {
  return `<div class="meter${big ? ' meter-big' : ''}" role="img" aria-label="${esc(label)} ${pct(p)}"><div class="meter-fill" style="width:${(100 * p).toFixed(1)}%"></div><div class="meter-mid"></div></div>`;
}

// ---- Calibration chart: predicted vs observed set-win frequency ---------------------------
// series: [{ label, cls, points: [{ predicted, observed, n }] }]
export function calibrationChart(series) {
  const W = 420, H = 420, p0 = 44, p1 = 14;
  const X = (v) => p0 + v * (W - p0 - p1), Y = (v) => H - p0 + -v * (H - p0 - p1);
  const maxN = Math.max(1, ...series.flatMap((s) => s.points.map((q) => q.n)));
  let s = `<svg class="chart calib" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calibration: predicted probability against observed frequency">`;
  for (let k = 0; k <= 5; k++) {
    const v = k / 5;
    s += `<line x1="${X(0)}" x2="${X(1)}" y1="${Y(v)}" y2="${Y(v)}" class="grid"/><line x1="${X(v)}" x2="${X(v)}" y1="${Y(0)}" y2="${Y(1)}" class="grid"/>`;
    s += `<text x="${X(v)}" y="${H - p0 + 16}" text-anchor="middle" class="ax">${v * 100}%</text><text x="${p0 - 6}" y="${Y(v) + 4}" text-anchor="end" class="ax">${v * 100}%</text>`;
  }
  s += `<line x1="${X(0)}" y1="${Y(0)}" x2="${X(1)}" y2="${Y(1)}" class="ref"/>`;
  s += `<text x="${(X(0) + X(1)) / 2}" y="${H - 6}" text-anchor="middle" class="ax">Predicted chance of winning the set</text>`;
  s += `<text x="12" y="${(Y(0) + Y(1)) / 2}" text-anchor="middle" class="ax" transform="rotate(-90 12 ${(Y(0) + Y(1)) / 2})">How often it happened</text>`;
  for (const ser of series) {
    const pts = ser.points.map((q) => `${X(q.predicted).toFixed(1)},${Y(q.observed).toFixed(1)}`);
    s += `<polyline points="${pts.join(' ')}" class="cal-line ${ser.cls}"/>`;
    for (const q of ser.points) s += `<circle cx="${X(q.predicted)}" cy="${Y(q.observed)}" r="${(2.5 + 6 * Math.sqrt(q.n / maxN)).toFixed(1)}" class="cal-dot ${ser.cls}"><title>${esc(ser.label)}: predicted ${pct(q.predicted, 0)}, happened ${pct(q.observed, 0)} (${q.n} states)</title></circle>`;
  }
  return s + '</svg>';
}
