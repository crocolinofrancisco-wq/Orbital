/* Test de guerra completo en memoria (no necesita servidor): node server/tests/war.test.js */
process.env.SYSTEMS = 10;
const path = require('path'), fs = require('fs');
const S = require('../state.js');
const GD = require('../../public/shared/gamedata.js');
GD.RULES.jumpSeconds = 0.01; // saltos instantáneos para el test
const G = require('../game.js');
S.reset = S.reset; const w = S.reset();
w.users.u1 = { id: 'u1', username: 'a' }; w.users.u2 = { id: 'u2', username: 'b' };
const A = G.createNation('u1', { name: 'Atacantes' }), B = G.createNation('u2', { name: 'Defensores' });
const act = (n, t, d) => { const r = G.handleAction(n.id, t, d); if (!r.ok) console.log('  ✖', t, r.error); return r; };
// A fabrica una gran flota con transportes y la junta con sus tropas
const capA = w.planets[A.capital], capB = w.planets[B.capital];
const fA = Object.values(w.fleets).find(f => f.owner === A.id && f.units.bd_corb);
const gA = Object.values(w.fleets).find(f => f.owner === A.id && f.units.bd_inf);
fA.units.bd_corb = 12; fA.units.bd_trans = 2; fA.units.bd_inf = 20; delete w.fleets[gA.id];
act(A, 'declareWar', { targetId: B.id });
act(A, 'moveFleet', { fleetId: fA.id, to: capB.system });
const realNow = Date.now; let t = realNow();
Date.now = () => t;
for (let i = 0; i < 400 && (fA.path || !Object.values(w.reports).length); i++) { t += 1000; G.tick(); }
for (let i = 0; i < 200; i++) { t += 1000; G.tick(); if (!Object.values(w.fleets).some(f => f.owner === B.id && f.system === capB.system && G.fleetInfo(f).space)) break; }
const reps = Object.values(w.reports);
console.log('Informes de batalla:', reps.length, reps.map(r => r.winner));
console.log('Flota A:', w.fleets[fA.id] && w.fleets[fA.id].units);
const r = act(A, 'invade', { fleetId: fA.id, planetId: capB.id });
console.log('Invasión:', r.msg || r.error, '| dueño de la capital B:', w.planets[capB.id].owner === A.id ? 'A' : 'B', '| B viva:', B.alive);
console.log('Noticias:', w.news.slice(0, 4).map(n => n.text));
Date.now = realNow;
fs.unlinkSync(path.join(__dirname, '..', '..', 'data', 'world.json'));
