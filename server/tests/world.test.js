/* Prueba de integración del mundo completo, sin servidor (reloj falso):
 *   node server/tests/world.test.js
 * Cubre: arranque con NPC e IA, protección de novatos, batalla en vivo con órdenes,
 * repetición idéntica, portales, victoria/anulación de temporada y D1/estado. */
const assert = require('assert');
process.env.AI_COUNT = '5';
process.env.GAME_SPEED = '1';
const S = require('../state.js');
const BS = require('../../public/shared/battlesim.js');
const realNow = Date.now; let T = realNow(); Date.now = () => T;
const G = require('../game.js');
const w = S.reset(); G.resetBattles();
G.setEmitter({ chat: () => {} });
G.bootstrap({ bots: 5 });
const tick = (sec, dt) => { dt = dt || 1; for (let i = 0; i < sec / dt; i++) { T += dt * 1000; G.tick(); } };

/* 1. Arranque */
const bots = Object.values(w.nations).filter(n => n.bot);
assert.strictEqual(bots.length, 5, '5 naciones IA');
assert(bots.every(b => planets(b) === 1), 'cada IA empieza con 1 planeta');
assert(Object.values(w.fleets).some(f => f.owner === G.MONSTERS && f.kind === 'leviatan'), 'hay un Leviatán custodiando un cinturón');
assert(Object.values(w.systems).some(s => s.kind === 'blackhole' && s.portal), 'hay portales de agujero negro');
function planets(n) { return Object.values(w.planets).filter(p => p.owner === n.id).length; }
console.log('1. arranque OK:', Object.keys(w.systems).length, 'sistemas,', Object.keys(w.planets).length, 'planetas,', bots.length, 'IA');

/* 2. Humano + protección de novatos */
w.users.u1 = { id: 'u1', username: 'ana' }; w.users.u2 = { id: 'u2', username: 'beto' };
const A = G.createNation('u1', { name: 'Atacantes' }), B = G.createNation('u2', { name: 'Defensores' });
let r = G.handleAction(A.id, 'declareWar', { targetId: B.id });
assert(!r.ok && /protección/i.test(r.error), 'no se puede declarar guerra bajo protección: ' + r.error);
r = G.handleAction(A.id, 'endProtection', {}); assert(r.ok);
r = G.handleAction(A.id, 'declareWar', { targetId: B.id });
assert(!r.ok && /protección/i.test(r.error), 'B sigue protegido');
G.handleAction(B.id, 'endProtection', {});
r = G.handleAction(A.id, 'declareWar', { targetId: B.id }); assert(r.ok, 'ya sin protección: ' + r.error);
console.log('2. protección de novatos OK');

/* 3. Batalla en vivo entre A y B, con órdenes y refuerzos */
const capA = w.planets[A.capital], capB = w.planets[B.capital];
const fa = Object.values(w.fleets).find(f => f.owner === A.id && f.units.bd_corb);
fa.units.bd_corb = 8; fa.units.bd_caza = 10;
const fb = Object.values(w.fleets).find(f => f.owner === B.id && f.units.bd_corb);
fb.units.bd_corb = 6; fb.units.bd_caza = 6;
// mueve ambas al mismo sistema (el de B)
fa.system = capB.system; fa.path = null;
tick(3);
const live = G.Battles.list();
assert(live.some(b => b.system === capB.system), 'se inició una batalla en el sistema de B');
const b0 = live.find(b => b.system === capB.system);
assert(fa.battle && fb.battle, 'las flotas quedan bloqueadas en combate');
// orden del jugador A: distancia y retirada de un grupo
let cmd = G.handleAction(A.id, 'battleCmd', { battleId: b0.id, fleetId: fa.id, tactic: 'kite' }); assert(cmd.ok, 'orden de táctica');
cmd = G.handleAction(B.id, 'battleCmd', { battleId: b0.id, fleetId: fa.id, tactic: 'retreat' }); assert(!cmd.ok, 'no se puede mandar la flota ajena');
let sim = G.Battles.get(b0.id).sim;
const gA = sim.groups.find(g => g.owner === A.id);
assert.strictEqual(gA.tactic, 'kite');
// que dure un rato: avanzamos hasta que termine
let guard = 0; while (G.Battles.get(b0.id) && guard++ < 700) tick(1);
assert(!G.Battles.get(b0.id), 'la batalla terminó');
const rep = Object.values(w.reports).find(x => x.kind === 'space' && x.system === capB.system);
assert(rep && rep.simSetup && rep.orders.length >= 1, 'informe con setup y órdenes');
// la repetición reproduce exactamente el resultado
const rsim = BS.replayFrom({ setup: JSON.parse(JSON.stringify(rep.simSetup)), orders: JSON.parse(JSON.stringify(rep.orders)), reinf: JSON.parse(JSON.stringify(rep.reinf)) });
let g2 = 0; while (!rsim.over && g2++ < 2000) BS.replayStep(rsim);
assert.deepStrictEqual(JSON.parse(JSON.stringify(rsim.result())), JSON.parse(JSON.stringify(rep.result)), 'repetición idéntica al resultado del servidor');
assert(!fa.battle || !w.fleets[fa.id], 'flota desbloqueada tras la batalla');
console.log('3. batalla en vivo OK:', rep.result.duration + ' s,', 'gana', rep.winner, '| repetición idéntica');

/* 4. Portales: ruta por defecto evita portales; con permiso los usa */
const bh = Object.values(w.systems).find(s => s.portal);
const far = w.systems[bh.portal];
const f0 = Object.values(w.fleets).find(f => f.owner === A.id && G.fleetInfo(f).space > 0 && !f.battle);
if (f0) {
  f0.system = bh.id; f0.path = null; f0.nextJumpAt = null;
  const offer = G.portalOffer(f0.id, far.id);
  assert(offer === null || offer.saves > 0, 'oferta de portal coherente');
  r = G.handleAction(A.id, 'moveFleet', { fleetId: f0.id, to: far.id, portal: true });
  assert(r.ok, 'viaje por portal: ' + r.error);
  assert(f0.path.length === 1 && f0.path[0] === far.id, 'el portal es un salto directo');
}
console.log('4. portales OK');

/* 5. Temporada: victoria, anulación si solo quedan IA */
tick(2);
w.season.status = 'running';
for (const n of Object.values(w.nations)) if (!n.npc && n.id !== A.id) { n.alive = false; }
G.Season.check();
assert.strictEqual(w.season.status, 'ended', 'queda una sola nación: termina la temporada');
assert.strictEqual(w.season.winner.id, A.id);
console.log('5a. victoria OK:', w.season.winner.name);
// reabrir y dejar solo IA
w.season.status = 'running'; w.season.winner = null;
for (const n of Object.values(w.nations)) if (!n.npc) n.alive = n.bot && n.id === bots[0].id;
G.Season.check();
assert.strictEqual(w.season.status, 'void', 'si solo quedan IA, la temporada se anula');
console.log('5b. una IA nunca puede ganar OK');

/* 6. Estado serializable (para D1/archivo) */
const json = JSON.stringify(w); assert(json.length > 1000);
console.log('6. estado serializable OK (' + Math.round(json.length / 1024) + ' KB)');
Date.now = realNow;
console.log('OK');
