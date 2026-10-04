/* Prueba rápida del simulador de combate: node server/tests/combat.test.js */
const GD = require('../../public/shared/gamedata.js');
const { resolveSpaceBattle, resolveGroundBattle } = require('../combat.js');
const comps = {};
GD.BASE_COMPONENTS.forEach(c => comps[c.id] = c);
comps.x_misil = { id: 'x_misil', type: 'misil', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } };
comps.x_pd = { id: 'x_pd', type: 'pd', points: { potencia: 20, fiabilidad: 10, eficiencia: 0 } };
const L = id => comps[id];
const st = d => GD.designStats(d, L);
const corb = st({ hull: 'corbeta', components: ['bc_canon', 'bc_laser', 'bc_blind', 'bc_motor'] });
const caza = st({ hull: 'caza', components: ['bc_laser', 'bc_blind', 'bc_motor'] });
const misilera = st({ hull: 'corbeta', components: ['x_misil', 'x_misil', 'bc_blind', 'bc_motor'] });
const pdCorb = st({ hull: 'corbeta', components: ['bc_canon', 'bc_laser', 'x_pd', 'bc_motor'] });
console.log('Corbeta base:', { hp: corb.hp, power: corb.power, cost: corb.unitCost, upkeep: corb.upkeep });
console.log('Caza base:', { hp: caza.hp, power: caza.power, cost: caza.unitCost });
let wins = { A: 0, B: 0, draw: 0 };
for (let s = 1; s <= 50; s++) {
  const r = resolveSpaceBattle([{ name: 'Corbetas', count: 4, stats: corb }], [{ name: 'Cazas', count: 12, stats: caza }], s);
  wins[r.winner]++;
}
console.log('4 corbetas vs 12 cazas (50 sims):', wins);
wins = { A: 0, B: 0, draw: 0 };
for (let s = 1; s <= 50; s++) wins[resolveSpaceBattle([{ name: 'Misileras', count: 4, stats: misilera }], [{ name: 'PD', count: 4, stats: pdCorb }], s).winner]++;
console.log('4 misileras vs 4 corbetas con defensa puntual:', wins);
const inf = st({ hull: 'infanteria', components: ['bc_rifle', 'bc_armad'] });
const g = resolveGroundBattle([{ name: 'Inf', count: 20, stats: inf }], [{ name: 'Inf', count: 5, stats: inf }], 30, 3);
console.log('Invasión 20 inf vs 5 inf + milicia 30:', g.winner, 'rondas', g.rounds.length);
console.log('OK');
