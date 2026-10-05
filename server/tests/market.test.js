/* Prueba de especialidades de investigación y del mercado de UNIDADES (no hay licencias):
 *   node server/tests/market.test.js */
const assert = require('assert');
process.env.AI_COUNT = '0';
process.env.GAME_SPEED = '1';
const S = require('../state.js');
const GD = require('../../public/shared/gamedata.js');
const realNow = Date.now; let T = realNow(); Date.now = () => T;
const G = require('../game.js');
const w = S.reset(); G.resetBattles();
G.setEmitter({ chat: () => {} });
G.bootstrap({ bots: 0 });
const tick = (sec, dt) => { dt = dt || 5; for (let i = 0; i < sec / dt; i++) { T += dt * 1000; G.tick(); } };

w.users.u1 = { id: 'u1', username: 'ana' }; w.users.u2 = { id: 'u2', username: 'beto' };
const A = G.createNation('u1', { name: 'Fabricantes' }), B = G.createNation('u2', { name: 'Compradores' });

/* 1. Especialidades: sin elegir no se investiga nada de rama especializada */
A.research = 1e6; B.research = 1e6;
let r = G.handleAction(A.id, 'research', { techId: 'w_misil' });
assert(!r.ok && /especialidades/i.test(r.error), 'sin elegir: ' + r.error);
r = G.handleAction(A.id, 'research', { techId: 'e_mineria' }); assert(r.ok, 'la economía es abierta: ' + r.error);
r = G.handleAction(A.id, 'chooseSpec', { branches: ['misiles'] }); assert(!r.ok, 'hay que elegir exactamente 2');
r = G.handleAction(A.id, 'chooseSpec', { branches: ['misiles', 'naves'] }); assert(r.ok, r.error);
r = G.handleAction(A.id, 'research', { techId: 'w_misil' }); assert(r.ok, r.error);
r = G.handleAction(A.id, 'research', { techId: 'w_ion' }); assert(!r.ok && /No eres especialista/i.test(r.error), 'rama ajena: ' + r.error);
r = G.handleAction(A.id, 'chooseSpec', { branches: ['energia', 'naves'] }); assert(!r.ok, 'ya investigó en misiles: no se puede cambiar');
G.handleAction(B.id, 'chooseSpec', { branches: ['energia', 'balistica'] });
r = G.handleAction(B.id, 'research', { techId: 'w_misil' }); assert(!r.ok, 'B no puede investigar misiles');
console.log('1. especialidades OK');

/* 2. A diseña un componente y una nave con misiles y fabrica; B no puede fabricarla */
A.credits = 1e9; B.credits = 1e9;
for (const k of Object.keys(A.resources)) { A.resources[k] = 1e6; B.resources[k] = 1e6; }
A.techs.push('n_fragata'); A.techs.push('n_destructor');
r = G.handleAction(A.id, 'designComponent', { type: 'misil', name: 'Misil Fabricantes', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } }); assert(r.ok, r.error);
tick(3600 * 30, 600);                                  // termina el desarrollo (x10 de tiempos de proyecto)
const comp = Object.values(w.components).find(c => c.owner === A.id && c.type === 'misil'); assert(comp && comp.status === 'ready', 'componente listo');
r = G.handleAction(A.id, 'designShip', { hull: 'destructor', name: 'Destructor Misilero', components: [comp.id, comp.id, 'bc_blind', 'bc_motor'] }); assert(r.ok, r.error);
tick(3600 * 40, 600);
const des = Object.values(w.designs).find(d => d.owner === A.id && d.hull === 'destructor'); assert(des && des.status === 'ready', 'diseño listo');
r = G.handleAction(B.id, 'produce', { designId: des.id, planetId: B.capital, count: 1 }); assert(!r.ok && /acceso/i.test(r.error), 'B no puede fabricar el diseño de A (no hay licencias): ' + r.error);
r = G.handleAction(A.id, 'produce', { designId: des.id, planetId: A.capital, count: 6 }); assert(r.ok, r.error);
tick(3600 * 10, 600);
const fleetA = Object.values(w.fleets).find(f => f.owner === A.id && f.units[des.id] >= 6); assert(fleetA, 'A fabricó 6 destructores');
console.log('2. nadie fabrica el diseño ajeno OK');

/* 3. A vende 4 destructores ya hechos; B los compra y llegan a su capital tras el viaje */
const pre = A.credits;
r = G.handleAction(A.id, 'marketPost', { kind: 'units', fleetId: fleetA.id, designId: des.id, count: 4, price: 500000 }); assert(r.ok, r.error);
assert.strictEqual(fleetA.units[des.id], 2, 'las unidades salen de la flota (depósito)');
const offer = Object.values(w.market).find(m => m.kind === 'units'); assert(offer && offer.count === 4);
r = G.handleAction(A.id, 'marketBuy', { id: offer.id }); assert(!r.ok, 'no puedes comprarte a ti mismo');
const bPre = B.credits, aPre = A.credits;
r = G.handleAction(B.id, 'marketBuy', { id: offer.id, planetId: B.capital }); assert(r.ok, r.error);
assert.strictEqual(B.credits, bPre - 500000, 'B pagó');
assert.strictEqual(A.credits, aPre + 500000, 'A cobró');
assert.strictEqual(w.deliveries.length, 1, 'la entrega está en camino');
assert(!Object.values(w.fleets).some(f => f.owner === B.id && f.units[des.id]), 'todavía no llegó');
tick(3600 * 4, 60);
const got = Object.values(w.fleets).find(f => f.owner === B.id && f.units[des.id] === 4);
assert(got, 'B recibió 4 destructores (hechos por A)');
assert.strictEqual(w.deliveries.length, 0, 'entrega completada');
assert.strictEqual(G.statsOf(des.id).hull, 'destructor', 'B puede usar la unidad aunque no la sabe fabricar');
// y puede revenderla
r = G.handleAction(B.id, 'marketPost', { kind: 'units', fleetId: got.id, designId: des.id, count: 1, price: 100000 }); assert(r.ok, r.error);
const o2 = Object.values(w.market).find(m => m.kind === 'units');
r = G.handleAction(B.id, 'marketCancel', { id: o2.id }); assert(r.ok, r.error);
assert(Object.values(w.fleets).some(f => f.owner === B.id && f.units[des.id] === 4), 'retirar la oferta devuelve las unidades');
console.log('3. venta, entrega y reventa OK');
console.log('OK');
