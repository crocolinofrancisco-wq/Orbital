/* Prueba del combate terrestre (invasión): node server/tests/combat.test.js
 * El combate espacial se prueba en battle.test.js */
const GD = require('../../public/shared/gamedata.js');
const { resolveGroundBattle } = require('../combat.js');
const comps = {};
GD.BASE_COMPONENTS.forEach(c => comps[c.id] = c);
const st = d => GD.designStats(d, id => comps[id]);
const inf = st({ hull: 'infanteria', components: ['bc_rifle', 'bc_armad'] });
const g = resolveGroundBattle([{ name: 'Inf', count: 20, stats: inf }], [{ name: 'Inf', count: 5, stats: inf }], 30, 3);
console.log('Invasión 20 inf vs 5 inf + milicia 30:', g.winner, 'rondas', g.rounds.length);
if (g.winner !== 'A') { console.error('FALLO: el atacante con 4x debería ganar'); process.exit(1); }
const h = resolveGroundBattle([{ name: 'Inf', count: 3, stats: inf }], [{ name: 'Inf', count: 10, stats: inf }], 80, 3);
console.log('Invasión 3 inf vs 10 inf + milicia 80:', h.winner);
if (h.winner !== 'B') { console.error('FALLO: la defensa debería ganar'); process.exit(1); }
console.log('OK');
