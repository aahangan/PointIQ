// Simulates a full match from two rotation profiles and writes it out as a DataVolley .dvw
// file. Used for the in-app demo, and by the test suite to check the importer end to end
// (simulate → write .dvw → parse → the rotation counts must match exactly).

import { rallyMatrices, nextRot, US, THEM } from './markov.js';
import { rng } from './stats.js';
import { serverIdxFor } from './lineup.js';

const pad2 = (n) => String(n).padStart(2, '0');
const ROLE = { L: 1, OH: 2, OPP: 3, MB: 4, S: 5, DS: 1 };

export function simulateDVW({ home, visiting, bestOf = 5, seed = 1, date = '09/20/2026', homeStart = 0, visStart = 0 }) {
  const R = rng(seed);
  const M = rallyMatrices(home.profile, visiting.profile);
  const lines = [];
  const truth = []; // rallies as simulated, for tests
  const need = Math.ceil(bestOf / 2);
  let setsH = 0, setsV = 0, setNo = 1;
  let firstServe = R() < 0.5 ? US : THEM;
  let clock = 19 * 3600;

  const zones = (team, r) => {
    const s = team.order.findIndex((n) => team.roles[n] === 'S');
    const k = serverIdxFor(r, s);
    return [1, 2, 3, 4, 5, 6].map((z) => team.order[(k + z - 1) % 6]);
  };
  const pick = (arr) => arr[Math.floor(R() * arr.length)];

  while (setsH < need && setsV < need) {
    const target = setNo === bestOf ? 15 : 25;
    let a = 0, b = 0, i = homeStart, j = visStart, s = firstServe;
    lines.push(`*z${i + 1};;;;;;;;${setNo};${i + 1};${j + 1};;;;`, `az${j + 1};;;;;;;;${setNo};${i + 1};${j + 1};;;;`);
    for (;;) {
      clock += 25 + Math.floor(R() * 20);
      const hz = zones(home, i), vz = zones(visiting, j);
      const tail = () => `${fmtTime(clock)};${setNo};${i + 1};${j + 1};1;${clock - 19 * 3600};;${hz.map(pad2).join(';')};${vz.map(pad2).join(';')};`;
      const line = (code) => lines.push(`${code};;;;;;;${tail()}`);
      const servingHome = s === US;
      const srvT = servingHome ? '*' : 'a', rcvT = servingHome ? 'a' : '*';
      const srvTeam = servingHome ? home : visiting, rcvTeam = servingHome ? visiting : home;
      const srvZ = servingHome ? hz : vz, rcvZ = servingHome ? vz : hz;
      const p = servingHome ? M.pS[i][j] : M.pR[i][j]; // P(home wins rally)
      const homeWins = R() < p;
      truth.push({ set: setNo, serving: servingHome ? 'home' : 'visiting', homeRot: i, visRot: j, winner: homeWins ? 'home' : 'visiting' });
      const serverWins = homeWins === servingHome;
      const server = srvZ[0];
      const passers = rcvZ.filter((n) => ['OH', 'L', 'DS'].includes(rcvTeam.roles[n]));
      const passer = passers.length ? pick(passers) : rcvZ[5];
      const rcvHitters = [rcvZ[1], rcvZ[2], rcvZ[3]].filter((n) => rcvTeam.roles[n] !== 'S');
      const srvHitters = [srvZ[1], srvZ[2], srvZ[3]].filter((n) => srvTeam.roles[n] !== 'S');
      const u = R();
      if (serverWins) {
        if (u < 0.17) { line(`${srvT}${pad2(server)}SQ#`); line(`${rcvT}${pad2(passer)}RQ=`); }
        else {
          line(`${srvT}${pad2(server)}SQ${R() < 0.5 ? '+' : '-'}`);
          line(`${rcvT}${pad2(passer)}RQ${pick(['-', '!', '+', '/'])}`);
          const h = pick(rcvHitters);
          if (R() < 0.35) { line(`${rcvT}${pad2(h)}AH=`); }
          else if (R() < 0.45) { line(`${rcvT}${pad2(h)}AH/`); line(`${srvT}${pad2(pick(srvHitters))}BH#`); }
          else { line(`${rcvT}${pad2(h)}AH-`); line(`${srvT}${pad2(pick(srvZ))}DH+`); line(`${srvT}${pad2(pick(srvHitters))}AH#`); }
        }
      } else {
        if (u < 0.2) { line(`${srvT}${pad2(server)}SQ=`); }
        else {
          line(`${srvT}${pad2(server)}SQ${R() < 0.5 ? '+' : '-'}`);
          line(`${rcvT}${pad2(passer)}RQ${pick(['#', '#', '+', '!', '-'])}`);
          line(`${rcvT}${pad2(pick(rcvHitters))}AH#`);
        }
      }
      // score + rotation bookkeeping (same rules as the Markov chain)
      if (homeWins) a++; else b++;
      lines.push(`${homeWins ? '*' : 'a'}p${pad2(a)}:${pad2(b)};;;;;;;${tail()}`);
      if (s === US) { if (!homeWins) { j = nextRot(j); s = THEM; lines.push(`az${j + 1};;;;;;;;${setNo};${i + 1};${j + 1};;;;`); } }
      else if (homeWins) { i = nextRot(i); s = US; lines.push(`*z${i + 1};;;;;;;;${setNo};${i + 1};${j + 1};;;;`); }
      if ((a >= target || b >= target) && Math.abs(a - b) >= 2) break;
    }
    if (a > b) setsH++; else setsV++;
    lines.push(`**${setNo}set;;;;;;;;;;;;;;`);
    setNo++;
    firstServe = firstServe === US ? THEM : US;
    if (setNo === bestOf) firstServe = R() < 0.5 ? US : THEM;
  }

  const playerLines = (team, flag) => Object.keys(team.roles).map((n, idx) =>
    `${flag};${n};${idx + 1};;;;;;${team.code}-${n};${team.names[n]?.last || 'Player'};${team.names[n]?.first || n};;${ROLE[team.roles[n]] || 2};;;;`);
  const text = [
    '[3DATAVOLLEYSCOUT]', 'FILEFORMAT: 2.0', 'GENERATOR-PRG: PointIQ demo simulator',
    '[3MATCH]', `${date};19.00.00;2026/2027;NCAA;;;;;;;;`,
    '[3TEAMS]', `${home.code};${home.name};${setsH};Coach;;`, `${visiting.code};${visiting.name};${setsV};Coach;;`,
    '[3PLAYERS-H]', ...playerLines(home, 0),
    '[3PLAYERS-V]', ...playerLines(visiting, 1),
    '[3SCOUT]', ...lines, '',
  ].join('\n');
  return { text, truth, sets: [setsH, setsV] };
}

function fmtTime(sec) {
  const h = Math.floor(sec / 3600) % 24, m = Math.floor(sec / 60) % 60, s = sec % 60;
  return `${pad2(h)}.${pad2(m)}.${pad2(s)}`;
}
