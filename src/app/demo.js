// Demo data — fictional team, opponent, history and prospects, clearly labeled in the UI.

import { rng, logit, expit } from '../engine/stats.js';
import { buildRotations } from '../engine/lineup.js';

const P = (id, name, num, pos, sets, s = {}) => ({ id, name, num, pos, sets, ...s });

export const DEMO_TEAM = {
  id: 'demo', name: 'Demo University', short: 'DEMO', demo: true,
  players: [
    P('s1', 'Maya Lin', '3', 'S', 104, { serve: { att: 380, ace: 30, err: 34 }, attack: { att: 120, k: 40, e: 15 }, block: { sets: 104, stuffs: 25 }, dig: { sets: 104, digs: 250 }, assists: 1050 }),
    P('oh1', 'Jordan Ellis', '11', 'OH', 104, { serve: { att: 350, ace: 28, err: 40 }, pass: { att: 520, p0: 25, p1: 110, p2: 205, p3: 180 }, attack: { att: 1100, k: 420, e: 150 }, block: { sets: 104, stuffs: 35 }, dig: { sets: 104, digs: 230 } }),
    P('mb1', 'Riley Chen', '12', 'MB', 102, { serve: { att: 300, ace: 15, err: 38 }, attack: { att: 520, k: 230, e: 60 }, block: { sets: 102, stuffs: 95 }, dig: { sets: 102, digs: 60 } }),
    P('opp', 'Casey Morgan', '9', 'OPP', 100, { serve: { att: 330, ace: 30, err: 45 }, attack: { att: 800, k: 300, e: 110 }, block: { sets: 100, stuffs: 55 }, dig: { sets: 100, digs: 120 } }),
    P('oh2', 'Sam Okafor', '7', 'OH', 101, { serve: { att: 340, ace: 22, err: 30 }, pass: { att: 480, p0: 34, p1: 120, p2: 190, p3: 136 }, attack: { att: 950, k: 330, e: 140 }, block: { sets: 101, stuffs: 30 }, dig: { sets: 101, digs: 200 } }),
    P('mb2', 'Taylor Brooks', '15', 'MB', 98, { serve: { att: 290, ace: 20, err: 25 }, attack: { att: 480, k: 190, e: 70 }, block: { sets: 98, stuffs: 80 }, dig: { sets: 98, digs: 50 } }),
    P('lib', 'Alex Rivera', '2', 'L', 104, { serve: { att: 150, ace: 10, err: 12 }, pass: { att: 700, p0: 21, p1: 110, p2: 270, p3: 299 }, dig: { sets: 104, digs: 420 } }),
    P('ds1', 'Jamie Park', '5', 'DS', 60, { serve: { att: 200, ace: 22, err: 14 }, pass: { att: 150, p0: 8, p1: 30, p2: 60, p3: 52 }, dig: { sets: 60, digs: 150 } }),
    P('ds2', 'Kai Nakamura', '6', 'DS', 40, { serve: { att: 150, ace: 20, err: 20 }, pass: { att: 40, p0: 3, p1: 10, p2: 15, p3: 12 }, dig: { sets: 40, digs: 70 } }),
    P('oh3', 'Morgan Diaz', '14', 'OH', 35, { serve: { att: 90, ace: 6, err: 11 }, pass: { att: 120, p0: 9, p1: 32, p2: 45, p3: 34 }, attack: { att: 200, k: 65, e: 30 }, block: { sets: 35, stuffs: 8 }, dig: { sets: 35, digs: 60 } }),
    P('mb3', 'Quinn Adams', '18', 'MB', 30, { serve: { att: 60, ace: 3, err: 8 }, attack: { att: 100, k: 38, e: 14 }, block: { sets: 30, stuffs: 20 }, dig: { sets: 30, digs: 12 } }),
    P('s2', 'Drew Patel', '1', 'S', 20, { serve: { att: 50, ace: 4, err: 5 }, dig: { sets: 20, digs: 40 }, assists: 150 }),
  ],
  order: ['s1', 'oh1', 'mb1', 'opp', 'oh2', 'mb2'],
  libero: { id: 'lib', replaces: ['mb1', 'mb2'], servesFor: 'mb1' },
  subs: [{ outId: 'opp', inId: 'ds1', mode: 'backrow' }],
  calibration: { so: 0, bp: 0 },
  rotationSource: 'model',
};

export const DEMO_OPPONENT = { name: 'Opponent: Coastal State (demo)', so: [0.63, 0.57, 0.6, 0.55, 0.61, 0.59], bp: [0.41, 0.36, 0.43, 0.38, 0.4, 0.37] };

// Rosters in the shape the .dvw simulator wants (jersey numbers, roles, names).
export function demoDVWTeams() {
  const built = buildRotations(DEMO_TEAM);
  const byId = Object.fromEntries(DEMO_TEAM.players.map((p) => [p.id, p]));
  const home = {
    code: 'DEM', name: DEMO_TEAM.name, profile: built.profile,
    order: DEMO_TEAM.order.map((id) => byId[id].num),
    roles: Object.fromEntries(DEMO_TEAM.players.map((p) => [p.num, p.pos])),
    names: Object.fromEntries(DEMO_TEAM.players.map((p) => [p.num, { first: p.name.split(' ')[0], last: p.name.split(' ').slice(1).join(' ') }])),
  };
  const vr = { 4: 'S', 10: 'OH', 21: 'MB', 8: 'OPP', 13: 'OH', 22: 'MB', 1: 'L' };
  const visiting = {
    code: 'CST', name: 'Coastal State', profile: DEMO_OPPONENT,
    order: ['4', '10', '21', '8', '13', '22'], roles: vr,
    names: Object.fromEntries(Object.keys(vr).map((n) => [n, { first: 'Player', last: n }])),
  };
  return { home, visiting };
}

// Four seasons of rotation counts with a persistent weak R4 (setter front row, weakest
// passer in the seam) and a noisy, short current season.
export function demoHistory() {
  const R = rng(2026);
  const alpha = { SO: [0.22, -0.05, 0.08, -0.3, 0.12, -0.07], BP: [0.1, -0.12, 0.05, -0.2, 0.15, 0.02] };
  const seasons = ['2022', '2023', '2024', '2025', '2026'];
  const beta = [-0.08, 0.05, 0.1, 0.02, 0.06];
  const out = [];
  seasons.forEach((season, si) => {
    for (const phase of ['SO', 'BP']) for (let r = 0; r < 6; r++) {
      const base = phase === 'SO' ? 0.6 : 0.4;
      const p = expit(logit(base) + alpha[phase][r] + beta[si] + 0.09 * R.normal());
      const n = si === seasons.length - 1 ? 30 + Math.floor(R() * 15) : 150 + Math.floor(R() * 60);
      let won = 0; for (let k = 0; k < n; k++) if (R() < p) won++;
      out.push({ season, rot: r, phase, won, n });
    }
  });
  return out;
}

const pr = (id, name, grad, pos, height, approach, level, club, state, s) => ({ id, name, grad, pos, height, approach, level, club, state, status: 'Watching', notes: '', tags: [], hudl: '', demo: true, stats: s });
const st = (sets, att, k, e, sAtt, ace, serr, pAtt, p0, p1, p2, p3, digs, blocks, assists = 0) => ({ sets, attack: { att, k, e }, serve: { att: sAtt, ace, err: serr }, pass: { att: pAtt, p0, p1, p2, p3 }, dig: { digs }, block: { stuffs: blocks }, assists });

export const DEMO_PROSPECTS = [
  pr('p1', 'Harper Quinn', 2027, 'OH', "6'1", 120, 'club-open', 'Coast VBC 17 Open', 'CA', st(58, 610, 245, 70, 240, 21, 22, 330, 14, 62, 128, 126, 150, 18)),
  pr('p2', 'Nia Thompson', 2027, 'OH', "5'11", 116, 'hs-small', 'Valley Christian HS', 'TX', st(70, 720, 390, 60, 300, 48, 18, 260, 8, 40, 92, 120, 210, 25)),
  pr('p3', 'Lena Park', 2027, 'MB', "6'3", 123, 'club-usa', 'Summit 17 USA', 'IL', st(50, 300, 140, 28, 150, 10, 14, 0, 0, 0, 0, 0, 30, 52)),
  pr('p4', 'Sofia Alvarez', 2028, 'S', "5'10", 113, 'club-open', 'Mesa 16 Open', 'AZ', st(55, 70, 28, 8, 230, 20, 14, 40, 2, 9, 16, 13, 120, 16, 520)),
  pr('p5', 'Ella Brooks', 2027, 'L', "5'6", 107, 'club-open', 'Coast VBC 17 Open', 'CA', st(60, 0, 0, 0, 200, 14, 10, 420, 10, 58, 160, 192, 260, 0)),
  pr('p6', 'Grace Kim', 2027, 'OPP', "6'2", 121, 'hs-varsity', 'Lincoln HS', 'WA', st(64, 540, 230, 80, 220, 25, 30, 20, 2, 6, 8, 4, 90, 40)),
  pr('p7', 'Ava Martinez', 2028, 'OH', "6'0", 118, 'club-regional', 'Northside 16 Regional', 'FL', st(22, 180, 80, 20, 90, 12, 8, 90, 5, 20, 35, 30, 50, 6)),
  pr('p8', 'Mia Johnson', 2027, 'MB', "6'2", 119, 'hs-top', 'St. Mary HS', 'OH', st(66, 420, 200, 60, 200, 14, 20, 0, 0, 0, 0, 0, 40, 70)),
  pr('p9', 'Zoe Carter', 2027, 'DS', "5'7", 109, 'hs-varsity', 'Eastview HS', 'MN', st(62, 0, 0, 0, 260, 30, 16, 280, 12, 50, 110, 108, 240, 0)),
  pr('p10', 'Riley Evans', 2028, 'OH', "6'2", 121, 'club-open', 'Rocky Mtn 16 Open', 'CO', st(48, 480, 180, 72, 200, 16, 24, 210, 13, 50, 82, 65, 110, 20)),
];
