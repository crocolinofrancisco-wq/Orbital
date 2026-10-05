/* Prueba de la guerra terrestre v3 (bloqueo, bombardeo, escudo y campaña por rondas), reloj falso:
 *   node server/tests/ground.test.js */
const assert = require('assert');
process.env.AI_COUNT = '0';
process.env.GAME_SPEED = '1';
const S = require('../state.js');
const realNow = Date.now; let T = realNow(); Date.now = () => T;
const G = require('../game.js');
const w = S.reset(); G.resetBattles();
G.setEmitter({ chat: () => {} });
G.bootstrap({ bots: 0 });
const tick = (sec, dt) => { dt = dt || 5; for (let i = 0; i < sec / dt; i++) { T += dt * 1000; G.tick(); } };

w.users.u1 = { id: 'u1', username: 'ana' }; w.users.u2 = { id: 'u2', username: 'beto' };
const A = G.createNation('u1', { name: 'Atacantes' }), B = G.createNation('u2', { name: 'Defensores' });
G.handleAction(A.id, 'endProtection', {}); G.handleAction(B.id, 'endProtection', {});
let r = G.handleAction(A.id, 'declareWar', { targetId: B.id }); assert(r.ok, r.error);
const capB = w.planets[B.capital];
// Se mueve la flota de A al sistema de B y se retiran las naves de B: órbita despejada para A
for (const f of Object.values(w.fleets)) if (f.owner === B.id && G.fleetInfo(f).space > 0) delete w.fleets[f.id];
for (const f of Object.values(w.fleets)) if (f.owner === A.id) delete w.fleets[f.id];
const fa = G.Battles && require('../game.js').fleetInfo ? null : null;
const mk = (units) => { const f = { id: 'fx' + Math.random().toString(36).slice(2, 6), owner: A.id, system: capB.system, name: 'Flota de prueba', units, path: null, nextJumpAt: null, stance: 'agresiva' }; w.fleets[f.id] = f; return f; };
const navy = mk({ bd_corb: 12, bd_caza: 20 });
navy.units.bd_trans = 6; navy.units.bd_inf = 40;
capB.buildings.bateria = 0; delete capB.buildings.escudo; capB.defenseHp = 1;

/* 1. Bloqueo: sin PIB y estabilidad cayendo */
tick(25);
assert(G.Ground.blockaderOf(capB) === A.id, 'la flota enemiga bloquea el planeta');
assert.strictEqual(G.computeEconomy(B).gdp < G.computeEconomy(A).gdp, true, 'el planeta bloqueado deja de dar PIB');
console.log('1. bloqueo OK');

/* 2. Bombardeo de saturación: suprime, mata milicia y causa daños colaterales */
const pop0 = capB.pop;
r = G.handleAction(A.id, 'bombard', { fleetId: navy.id, planetId: capB.id, mode: 'saturation' }); assert(r.ok, r.error);
tick(300);
assert(capB.supp > 0.05, 'el bombardeo suprime la defensa: ' + capB.supp);
assert(capB.milFrac < 1, 'la milicia se debilita');
assert(capB.pop < pop0, 'la saturación mata población');
console.log('2. bombardeo OK: supresión', Math.round(capB.supp * 100) + '%', 'milicia', Math.round(capB.milFrac * 100) + '%', 'pob', pop0, '->', capB.pop);
r = G.handleAction(A.id, 'stopBombard', { fleetId: navy.id }); assert(r.ok);

/* 3. Escudo planetario: bloquea el bombardeo hasta que las tropas apagan el generador */
const pop1 = capB.pop, supp1 = capB.supp;
capB.buildings.escudo = 1; capB.shieldHp = null; capB.shieldDownUntil = null;
G.handleAction(A.id, 'bombard', { fleetId: navy.id, planetId: capB.id, mode: 'saturation' });
tick(100);
assert(capB.pop === pop1, 'con el escudo en pie el bombardeo no hace nada');
G.handleAction(A.id, 'stopBombard', { fleetId: navy.id });

/* 4. Campaña: desembarco, posturas, escudo caído y conquista por rondas */
r = G.handleAction(A.id, 'invade', { fleetId: navy.id, planetId: capB.id }); assert(r.ok, r.error);
assert(capB.camp && capB.camp.attacker === A.id, 'campaña iniciada');
r = G.handleAction(A.id, 'groundStance', { planetId: capB.id, stance: 'siege' }); assert(r.ok);
r = G.handleAction(B.id, 'groundStance', { planetId: capB.id, stance: 'siege' }); assert(!r.ok, 'el defensor no manda sobre el atacante');
let rounds = 0, shieldDown = false;
while (capB.camp && rounds++ < 200) { tick(20); if (capB.shieldDownUntil) shieldDown = true; if (rounds === 3) G.handleAction(A.id, 'groundStance', { planetId: capB.id, stance: 'assault' }); }
assert(shieldDown, 'las tropas apagaron el generador del escudo');
const rep = Object.values(w.reports).find(x => x.kind === 'ground');
assert(rep && rep.rounds.length >= 3, 'informe con varias rondas (' + (rep && rep.rounds.length) + ')');
assert(rep.duration >= 60, 'la campaña dura minutos, no es instantánea: ' + rep.duration + ' s');
console.log('4. campaña OK:', rep.rounds.length, 'rondas,', rep.duration + ' s, resultado:', rep.outcome, '| tropas', rep.start, '->', rep.end);
assert.strictEqual(rep.outcome, 'won', 'con 40 inf y escudo apagado el atacante gana');
assert.strictEqual(capB.owner, A.id, 'el planeta cambió de dueño');
assert(B.govFallen || Object.values(w.planets).filter(p => p.owner === B.id).length === 0, 'cayó la capital del defensor');

/* 5. Retirada: otra campaña que se abandona */
const capA = w.planets[A.capital];
w.fleets && Object.values(w.fleets).forEach(f => { if (f.owner === B.id) delete w.fleets[f.id]; });
const planetsB = Object.values(w.planets).filter(p => p.owner === B.id);
if (planetsB.length) {
  const pb = planetsB[0];
  const f2 = mk({ bd_trans: 2, bd_inf: 10, bd_corb: 2 }); f2.system = pb.system;
  const defOrbit = Object.values(w.fleets).some(o => o.system === pb.system && o.owner === B.id && G.fleetInfo(o).space > 0);
  if (!defOrbit) {
    r = G.handleAction(A.id, 'invade', { fleetId: f2.id, planetId: pb.id });
    if (r.ok) { tick(40); r = G.handleAction(A.id, 'groundWithdraw', { planetId: pb.id }); assert(r.ok, r.error); assert(!pb.camp, 'campaña cerrada'); console.log('5. retirada OK'); }
  }
}
console.log('OK');
