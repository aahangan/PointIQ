import { getState, update, team, can, uid, snapshotLineup } from '../store.js';
import { parseDVW, dvwRotationRecords, dvwPlayerStats, dvwStartingOrder, recordsToProfile, parseCSV, detectFormat, autoMap, boxRowsToStats, parseRotationCSV, parseMultiSeasonCSV, BOX_FIELDS, mergeStats } from '../../engine/importers.js';
import { simulateDVW } from '../../engine/dvwsim.js';
import { demoDVWTeams, demoHistory } from '../demo.js';
import { esc, pct, lockPanel, toast } from '../ui.js';
import { minPlanFor, FEATURE_LABEL } from '../../engine/plans.js';

let pending = null;

const FIELD_LABEL = {
  number: 'Jersey #', name: 'Name', pos: 'Position', sets: 'Sets played', kills: 'Kills', attErr: 'Attack errors', attAtt: 'Attack attempts', aces: 'Aces', srvErr: 'Serve errors', srvAtt: 'Serve attempts',
  recAtt: 'Receptions', recErr: 'Reception errors', passRating: 'Pass rating (0–3)', p3: '3-passes', p2: '2-passes', p1: '1-passes', digs: 'Digs', blockSolo: 'Solo blocks', blockAssist: 'Block assists', blocks: 'Total blocks', assists: 'Assists',
  grad: 'Grad year', height: 'Height', club: 'Club', school: 'School', state: 'State', level: 'Level', approach: 'Approach touch', blockTouch: 'Block touch', hudl: 'Hudl / video link',
};

const SAMPLE_BOX = `Player,#,SP,K,E,TA,SA,SE,R,RE,Pass Rating,Digs,BS,BA,A
Jordan Ellis,11,4,19,5,44,2,1,24,1,2.21,9,0,2,1
Sam Okafor,7,4,14,6,39,1,2,21,2,1.95,7,0,1,0
Riley Chen,12,4,9,2,17,0,1,0,0,,1,1,4,0
Casey Morgan,9,4,13,4,33,2,2,0,0,,4,0,3,0
Taylor Brooks,15,4,6,3,14,1,0,0,0,,2,0,3,0
Maya Lin,3,4,2,0,6,1,1,1,0,2,10,0,1,44
Alex Rivera,2,4,0,0,0,1,0,31,1,2.35,17,0,0,2
Totals,,4,63,20,153,8,7,77,4,,50,1,14,47`;

const SAMPLE_PROSPECTS = `Name,Grad,Pos,Height,Approach,Level,Club,State,SP,K,E,TA,SA,SE,Serve Att,R,RE,Pass Rating,Digs,BS,BA,Assists,Hudl
Addison Reyes,2027,OH,6'0,119,18 Open,Bay Area 17 Open,CA,44,160,52,420,14,15,190,210,9,2.15,98,4,12,3,
Brooke Adler,2027,MB,6'3,124,HS varsity,Central HS,NE,60,210,48,380,11,16,170,0,0,,35,22,60,0,
Carmen Diaz,2028,S,5'10,112,Club USA,Desert 16 USA,NV,40,30,9,80,15,9,160,30,2,2.0,85,5,9,420,`;

export default {
  id: 'data',
  title: 'Import',
  render(root) {
    const t = team();
    root.innerHTML = `
      <header class="page-head"><div><p class="eyebrow">${esc(t.name)}</p><h1>Import data</h1></div></header>

      <section class="panel drop" id="drop">
        <div class="drop-inner">
          <p class="drop-title">Drop a DataVolley <code>.dvw</code> file or a CSV export</p>
          <p class="note">From Hudl (VolleyMetrics), DataVolley, VolleyStation, SoloStats, MaxPreps, or your own spreadsheet. PointIQ detects the format.</p>
          <label class="btn btn-primary">Choose files<input type="file" multiple accept=".dvw,.csv,.tsv,.txt" data-on-change="files" hidden></label>
        </div>
        <div class="samples"><span class="note">No file handy? Try:</span>
          <button class="btn btn-sm" data-action="sample-dvw">Sample DataVolley match</button>
          <button class="btn btn-sm" data-action="sample-box">Sample SoloStats box score</button>
          <button class="btn btn-sm" data-action="sample-hist">Sample 5-season history</button>
          <button class="btn btn-sm" data-action="sample-prospects">Sample prospect list</button>
        </div>
      </section>

      ${pending ? review(pending) : ''}

      <section class="split">
        <div class="panel guide">
          <h2 class="panel-title">Getting your data out of Hudl</h2>
          <ol>
            <li><b>College teams on VolleyMetrics (Hudl):</b> download the match's DataVolley <code>.dvw</code> file from Hudl and drop it here. You get every rally, both teams' rotations and every player's skill counts — and your opponent's rotation report for free.</li>
            <li><b>Hudl stats reports:</b> export the box score as CSV, drop it here, and confirm the column mapping.</li>
            <li><b>Scouting an opponent:</b> drop their <code>.dvw</code> from a shared exchange file; PointIQ saves their six-rotation profile for Match sim.</li>
          </ol>
          <p class="note">Hudl doesn't offer a public volleyball stats API, so a live one-click sync needs a Hudl partner integration. That's on the roadmap. Until then, file import works with every Hudl volleyball export that exists.</p>
        </div>
        <div class="panel guide">
          <h2 class="panel-title">SoloStats and everything else</h2>
          <ol>
            <li><b>SoloStats 123 / Live:</b> export your season or match report to CSV (Excel), then drop it here. Headers like <code>K, E, TA, SA, SE, R, RE, Digs, BS, BA</code> map automatically.</li>
            <li><b>Rotation sheets:</b> a CSV with <code>Rotation, SO%, BP%</code> — or counts like <code>so_won, so_total, bp_won, bp_total</code>.</li>
            <li><b>Several seasons:</b> <code>Season, Rotation, Phase, Won, Total</code> feeds the multi-season model.</li>
          </ol>
          <p class="note">Recent imports: ${getState().imports.slice(-4).reverse().map((i) => `${esc(i.name)} <small>(${esc(i.kind)})</small>`).join(' · ') || 'none yet'}</p>
        </div>
      </section>`;
    const drop = root.querySelector('#drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('over'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('over'); handleFiles([...e.dataTransfer.files]); });
  },
  actions: {
    'sample-dvw': () => {
      const { home, visiting } = demoDVWTeams();
      const sim = simulateDVW({ home, visiting, seed: Math.floor(Math.random() * 1e6) });
      ingest('demo-match.dvw', sim.text);
    },
    'sample-box': () => ingest('solostats-export.csv', SAMPLE_BOX),
    'sample-hist': () => ingest('rotation-history.csv', 'Season,Rotation,Phase,Won,Total\n' + demoHistory().map((r) => `${r.season},R${r.rot + 1},${r.phase},${r.won},${r.n}`).join('\n')),
    'sample-prospects': () => ingest('prospects.csv', SAMPLE_PROSPECTS),
    cancel: () => { pending = null; rerender(); },
    'apply-dvw': () => applyDVW(),
    'apply-box': () => applyBox(),
    'apply-rot': () => applyRot(),
    'apply-hist': () => applyHist(),
  },
  changes: {
    files: (el) => handleFiles([...el.files]),
    side: (el) => { pending.side = el.value; rerender(); },
    map: (el) => { if (el.value) pending.map[el.dataset.f] = el.value; else delete pending.map[el.dataset.f]; rerender(); },
    target: (el) => { pending.target = el.value; rerender(); },
  },
};

function rerender() { document.dispatchEvent(new Event('pointiq:rerender')); }

async function handleFiles(files) {
  for (const f of files) ingest(f.name, await f.text());
}

function ingest(name, text) {
  const isDVW = /\.dvw$/i.test(name) || text.includes('[3SCOUT]');
  if (isDVW) {
    if (!can('import-dvw')) { pending = { kind: 'locked', feature: 'import-dvw', name }; rerender(); return; }
    const parsed = parseDVW(text);
    const t = team();
    const guess = [parsed.meta.home, parsed.meta.visiting].findIndex((n) => n && t.name && n.toLowerCase().includes(t.name.toLowerCase().split(' ')[0]));
    const year = (parsed.meta.date.match(/(\d{4})/) || [])[1] || String(new Date().getFullYear());
    pending = { kind: 'dvw', name, parsed, side: guess === 1 ? 'visiting' : 'home', season: year };
  } else {
    const csv = parseCSV(text);
    const fmt = detectFormat(csv.headers);
    if (fmt === 'rotation') pending = { kind: 'rotation', name, csv, rot: parseRotationCSV(csv) };
    else if (fmt === 'multiseason') pending = { kind: 'history', name, csv, recs: parseMultiSeasonCSV(csv) };
    else if (fmt === 'boxscore' || fmt === 'prospects') {
      const feature = fmt === 'prospects' ? 'recruiting' : 'import-boxscore';
      if (!can(feature)) { pending = { kind: 'locked', feature, name }; rerender(); return; }
      pending = { kind: 'box', name, csv, map: autoMap(csv.headers), target: fmt === 'prospects' ? 'prospects' : 'roster' };
    } else pending = { kind: 'unknown', name, csv };
  }
  rerender();
  setTimeout(() => document.getElementById('review')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
}

function review(p) {
  if (p.kind === 'locked') return `<section class="panel" id="review">${lockPanel(p.feature, minPlanFor(p.feature), FEATURE_LABEL[p.feature])}</section>`;
  if (p.kind === 'unknown') return `<section class="panel err" id="review"><h2 class="panel-title">Couldn't recognise ${esc(p.name)}</h2><p>Found columns: <code>${esc(p.csv.headers.join(', ') || 'none')}</code>. PointIQ needs a player name or jersey column for box scores, or a Rotation column for rotation sheets.</p><button class="btn" data-action="cancel">Dismiss</button></section>`;
  if (p.kind === 'dvw') return reviewDVW(p);
  if (p.kind === 'box') return reviewBox(p);
  if (p.kind === 'rotation') return `<section class="panel" id="review"><h2 class="panel-title">Rotation sheet · ${esc(p.name)}</h2>${rotTable({ us: p.rot })}
    <label class="field"><span>Season (only used if the file has counts)</span><input id="rot-season" value="${new Date().getFullYear()}"></label>
    <div class="row"><button class="btn btn-primary" data-action="apply-rot">Use as this season's observed rates</button><button class="btn btn-ghost" data-action="cancel">Cancel</button></div></section>`;
  if (p.kind === 'history') {
    const seasons = [...new Set(p.recs.map((r) => r.season))];
    return `<section class="panel" id="review"><h2 class="panel-title">Multi-season history · ${esc(p.name)}</h2><p>${p.recs.length} rotation rows across ${seasons.length} seasons (${esc(seasons.join(', '))}), ${p.recs.reduce((s, r) => s + r.n, 0).toLocaleString()} rallies.</p>
      <label class="toggle"><input type="checkbox" id="hist-replace" checked> Replace existing history (otherwise add to it)</label>
      <div class="row"><button class="btn btn-primary" data-action="apply-hist">Import history</button><button class="btn btn-ghost" data-action="cancel">Cancel</button></div></section>`;
  }
  return '';
}

function reviewDVW(p) {
  const { meta, rallies } = p.parsed;
  const us = p.side, them = us === 'home' ? 'visiting' : 'home';
  const usRecs = dvwRotationRecords(p.parsed, us), themRecs = dvwRotationRecords(p.parsed, them);
  const players = dvwPlayerStats(p.parsed, us);
  const sets = [...new Set(rallies.map((r) => r.set))].length;
  return `<section class="panel" id="review">
    <h2 class="panel-title">DataVolley match · ${esc(meta.home)} vs ${esc(meta.visiting)}</h2>
    <p>${esc(meta.date || 'No date')} · ${sets} sets · ${rallies.length} rallies · ${players.length} of your players with touches.</p>
    ${meta.warnings.length ? `<div class="alert">${meta.warnings.slice(0, 3).map(esc).join('<br>')}</div>` : ''}
    <div class="form-grid">
      <label class="field"><span>Your team in this file</span><select data-on-change="side"><option value="home"${us === 'home' ? ' selected' : ''}>${esc(meta.home)} (home)</option><option value="visiting"${us === 'visiting' ? ' selected' : ''}>${esc(meta.visiting)} (visiting)</option></select></label>
      <label class="field"><span>Season</span><input id="dvw-season" value="${esc(p.season)}"></label>
    </div>
    <fieldset class="checks">
      <legend>What to import</legend>
      <label><input type="checkbox" id="dvw-hist" checked> Add rotation results to season history</label>
      <label><input type="checkbox" id="dvw-players" checked> Add player skill counts to the roster (matched by jersey number)</label>
      <label><input type="checkbox" id="dvw-opp" checked> Save ${esc(meta[them])}'s rotation profile as an opponent</label>
      <label><input type="checkbox" id="dvw-order"> Set our serving order from this match's first rotation</label>
    </fieldset>
    ${rotTable({ us: recordsToProfile(usRecs), usN: usRecs, them: recordsToProfile(themRecs), themN: themRecs, usName: meta[us], themName: meta[them] })}
    <div class="row"><button class="btn btn-primary" data-action="apply-dvw">Import match</button><button class="btn btn-ghost" data-action="cancel">Cancel</button></div>
  </section>`;
}

function rotTable({ us, usN, them, themN, usName = 'Us', themName = 'Them' }) {
  const n = (recs, ph, i) => { const r = recs?.find((x) => x.phase === ph && x.rot === i); return r ? ` <small>${r.won}/${r.n}</small>` : ''; };
  const row = (label, prof, recs) => `<tr><th>${esc(label)} side-out</th>${prof.so.map((v, i) => `<td class="num">${pct(v, 0)}${n(recs, 'SO', i)}</td>`).join('')}</tr><tr><th>${esc(label)} point-score</th>${prof.bp.map((v, i) => `<td class="num">${pct(v, 0)}${n(recs, 'BP', i)}</td>`).join('')}</tr>`;
  return `<div class="scroll-x"><table class="tbl"><thead><tr><th></th>${[1, 2, 3, 4, 5, 6].map((r) => `<th class="num">R${r}</th>`).join('')}</tr></thead><tbody>${row(usName, us, usN)}${them ? row(themName, them, themN) : ''}</tbody></table></div>`;
}

function reviewBox(p) {
  const rows = boxRowsToStats(p.csv.rows, p.map);
  const options = (f) => `<option value="">—</option>` + p.csv.headers.map((h) => `<option${p.map[f] === h ? ' selected' : ''}>${esc(h)}</option>`).join('');
  const fields = Object.keys(BOX_FIELDS).filter((f) => p.target === 'prospects' || !['grad', 'height', 'club', 'school', 'state', 'level', 'approach', 'blockTouch', 'hudl'].includes(f));
  return `<section class="panel" id="review">
    <h2 class="panel-title">Box score · ${esc(p.name)}</h2>
    <div class="form-grid">
      <label class="field"><span>Import into</span><select data-on-change="target"><option value="roster"${p.target === 'roster' ? ' selected' : ''}>Team roster — add to season totals</option><option value="roster-replace"${p.target === 'roster-replace' ? ' selected' : ''}>Team roster — replace season totals</option>${can('recruiting') ? `<option value="prospects"${p.target === 'prospects' ? ' selected' : ''}>Recruiting board — prospects</option>` : ''}</select></label>
    </div>
    <details open><summary>Column mapping <small>(${Object.keys(p.map).length} matched automatically)</small></summary>
      <div class="map-grid">${fields.map((f) => `<label class="field"><span>${FIELD_LABEL[f]}</span><select data-on-change="map" data-f="${f}">${options(f)}</select></label>`).join('')}</div>
    </details>
    <div class="scroll-x"><table class="tbl"><thead><tr><th>#</th><th>Name</th><th class="num">Sets</th><th class="num">K–E / TA</th><th class="num">Aces / SE / Att</th><th class="num">Pass (3/2/1/0)</th><th class="num">Digs</th><th class="num">Blk</th></tr></thead><tbody>
      ${rows.slice(0, 8).map((r) => `<tr><td>${esc(r.number)}</td><td>${esc(r.name)}</td><td class="num">${r.stats.sets}</td><td class="num">${r.stats.attack.k}–${r.stats.attack.e} / ${r.stats.attack.att}</td><td class="num">${r.stats.serve.ace} / ${r.stats.serve.err} / ${r.stats.serve.att}</td><td class="num">${r.stats.pass.p3}/${r.stats.pass.p2}/${r.stats.pass.p1}/${r.stats.pass.p0}</td><td class="num">${r.stats.dig.digs}</td><td class="num">${r.stats.block.stuffs}</td></tr>`).join('')}
    </tbody></table></div>
    <p class="note">${rows.length} players read. Serve attempts are estimated when the file has none; pass ratings are converted to a 3/2/1/0 split with the same average.</p>
    <div class="row"><button class="btn btn-primary" data-action="apply-box">Import ${rows.length} players</button><button class="btn btn-ghost" data-action="cancel">Cancel</button></div>
  </section>`;
}

function applyStats(p, stats, replace) {
  if (replace) { Object.assign(p, structuredClone(stats)); return; }
  const cur = { sets: p.sets || 0, serve: p.serve, pass: p.pass, attack: p.attack, block: p.block, dig: p.dig, assists: p.assists || 0 };
  Object.assign(p, mergeStats(cur, stats));
}

function logImport(s, name, kind) { s.imports.push({ name, kind, at: new Date().toISOString() }); }

function applyDVW() {
  const p = pending;
  const season = document.getElementById('dvw-season').value.trim() || p.season;
  const opts = { hist: document.getElementById('dvw-hist').checked, players: document.getElementById('dvw-players').checked, opp: document.getElementById('dvw-opp').checked, order: document.getElementById('dvw-order').checked };
  const us = p.side, them = us === 'home' ? 'visiting' : 'home';
  update((s) => {
    const t = team();
    if (opts.hist) {
      const recs = dvwRotationRecords(p.parsed, us, season);
      t.history = [...(t.history || []), ...recs];
      const cur = t.history.filter((r) => r.season === season);
      t.observed = recordsToProfile(cur);
    }
    if (opts.players) {
      for (const ps of dvwPlayerStats(p.parsed, us)) {
        let pl = t.players.find((x) => String(x.num) === ps.number);
        if (!pl) { pl = { id: uid('p'), name: ps.name, num: ps.number, pos: ps.pos || 'OH', sets: 0 }; t.players.push(pl); }
        applyStats(pl, ps.stats, false);
      }
    }
    if (opts.order) {
      const nums = dvwStartingOrder(p.parsed, us);
      const ids = nums?.map((n) => t.players.find((x) => String(x.num) === n)?.id);
      if (ids && ids.every(Boolean)) {
        const sIdx = ids.findIndex((id) => t.players.find((x) => x.id === id).pos === 'S');
        t.order = ids.slice(Math.max(0, sIdx)).concat(ids.slice(0, Math.max(0, sIdx)));
      }
    }
    // Stats collected with this lineup → it is the baseline for what-if adjustments.
    t.baseline = snapshotLineup(t);
    if (opts.opp) {
      const recs = dvwRotationRecords(p.parsed, them);
      const k = 25, L = 0.6; // ~10 rallies per rotation per match: shrink hard toward league average
      const agg = (ph, i) => recs.find((r) => r.phase === ph && r.rot === i) || { won: 0, n: 0 };
      const so = [0, 1, 2, 3, 4, 5].map((i) => { const r = agg('SO', i); return (r.won + k * L) / (r.n + k); });
      const bp = [0, 1, 2, 3, 4, 5].map((i) => { const r = agg('BP', i); return (r.won + k * (1 - L)) / (r.n + k); });
      const name = p.parsed.meta[them];
      const existing = s.opponents.find((o) => o.name === name);
      if (existing) Object.assign(existing, { so, bp, source: 'dvw' });
      else { const o = { id: uid('opp'), name, source: 'dvw', so, bp }; s.opponents.push(o); s.activeOpponent = o.id; }
    }
    logImport(s, p.name, 'DataVolley');
  });
  pending = null;
  toast('Match imported');
  rerender();
}

function applyBox() {
  const p = pending;
  const rows = boxRowsToStats(p.csv.rows, p.map);
  update((s) => {
    if (p.target === 'prospects') {
      for (const r of rows) {
        s.prospects.push({ id: uid('pr'), name: r.name, grad: r.extra.grad || '', pos: normPos(r.pos), height: r.extra.height || '', approach: Number(r.extra.approach) || '', level: r.extra.level || 'hs-varsity', club: r.extra.club || r.extra.school || '', state: r.extra.state || '', hudl: r.extra.hudl || '', status: 'Watching', notes: '', tags: [], stats: r.stats });
      }
    } else {
      const t = team();
      for (const r of rows) {
        let pl = t.players.find((x) => (r.number && String(x.num) === r.number) || x.name.toLowerCase() === r.name.toLowerCase());
        if (!pl) { pl = { id: uid('p'), name: r.name, num: r.number, pos: normPos(r.pos), sets: 0 }; t.players.push(pl); }
        applyStats(pl, r.stats, p.target === 'roster-replace');
      }
    }
    logImport(s, p.name, p.target === 'prospects' ? 'Prospects' : 'Box score');
  });
  pending = null;
  toast(`Imported ${rows.length} players`);
  if (p.target === 'prospects') location.hash = '#recruit'; else rerender();
}

function applyRot() {
  const p = pending;
  const season = document.getElementById('rot-season').value.trim();
  update((s) => {
    const t = team();
    const fill = (arr, d) => arr.map((x) => (Number.isFinite(x) ? x : d));
    t.observed = { so: fill(p.rot.so, 0.6), bp: fill(p.rot.bp, 0.4) };
    if (p.rot.counts.length) t.history = [...(t.history || []), ...p.rot.counts.map((c) => ({ ...c, season }))];
    t.baseline = snapshotLineup(t);
    if (t.rotationSource === 'model') t.rotationSource = 'observed';
    logImport(s, p.name, 'Rotation sheet');
  });
  pending = null;
  toast('Rotation rates imported');
  rerender();
}

function applyHist() {
  const p = pending;
  const replace = document.getElementById('hist-replace').checked;
  update((s) => {
    const t = team();
    t.history = replace ? p.recs : [...(t.history || []), ...p.recs];
    const last = [...new Set(t.history.map((r) => r.season))].sort().pop();
    t.observed = recordsToProfile(t.history.filter((r) => r.season === last));
    logImport(s, p.name, 'History');
  });
  pending = null;
  toast('History imported');
  location.hash = '#seasons';
}

function normPos(p = '') {
  const x = p.toUpperCase().replace(/[^A-Z/]/g, '');
  if (/^(OH|OUTSIDE|LH|L\/OH)/.test(x)) return 'OH';
  if (/^(MB|MH|MIDDLE)/.test(x)) return 'MB';
  if (/^(OPP|RS|RH|RIGHT)/.test(x)) return 'OPP';
  if (/^(S|SET)/.test(x)) return 'S';
  if (/^(L|LIB)/.test(x)) return 'L';
  if (/^DS/.test(x)) return 'DS';
  return 'OH';
}
