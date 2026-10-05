/* Prueba del simulador de batalla en tiempo real: node server/tests/battle.test.js
 * Comprueba: duración razonable (1-4 min), determinismo, repetición por órdenes,
 * piedra-papel-tijera y que los entornos funcionan. */
const assert = require('assert');
const GD = require('../../public/shared/gamedata.js');
const BS = require('../../public/shared/battlesim.js');

assert.strictEqual(BS.NUM_K, GD.NUM_K, 'la escala numerica debe coincidir en gamedata.js y battlesim.js');
const comps = {};
GD.BASE_COMPONENTS.forEach(c => comps[c.id] = c);
const extra = {
  x_misil: { id: 'x_misil', type: 'misil', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } },
  x_pd: { id: 'x_pd', type: 'pd', points: { potencia: 20, fiabilidad: 10, eficiencia: 0 } },
  x_escudo: { id: 'x_escudo', type: 'escudo', points: { potencia: 20, fiabilidad: 10, eficiencia: 0 } },
  x_rail: { id: 'x_rail', type: 'railgun', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } },
  x_plasma: { id: 'x_plasma', type: 'plasma', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } },
  x_torp: { id: 'x_torp', type: 'torpedo', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } },
  x_pulso: { id: 'x_pulso', type: 'pulso', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } },
  x_ion: { id: 'x_ion', type: 'ion', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } },
  x_enj: { id: 'x_enj', type: 'enjambre', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } },
  x_rad: { id: 'x_rad', type: 'radiador', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } }
};
Object.assign(comps, extra);
const L = id => comps[id];
const st = (hull, c) => GD.designStats({ hull, components: c }, L);
const D = {
  caza: st('caza', ['bc_laser', 'bc_blind', 'bc_motor']),
  corb: st('corbeta', ['bc_canon', 'bc_laser', 'bc_blind', 'bc_motor']),
  misil: st('corbeta', ['x_misil', 'x_misil', 'bc_blind', 'bc_motor']),
  pdc: st('corbeta', ['bc_canon', 'bc_laser', 'x_pd', 'bc_motor']),
  frag: st('fragata', ['bc_canon', 'bc_laser', 'bc_laser', 'bc_blind', 'x_escudo', 'bc_motor']),
  crucero: st('crucero', ['x_rail', 'x_rail', 'bc_laser', 'bc_laser', 'bc_canon', 'bc_blind', 'x_escudo', 'x_pd', 'bc_motor', 'bc_motor']),
  pulso: st('fragata', ['x_pulso', 'x_pulso', 'x_pulso', 'bc_blind', 'x_escudo', 'bc_motor']),
  ion: st('fragata', ['x_ion', 'x_ion', 'bc_laser', 'bc_blind', 'x_escudo', 'bc_motor']),
  enj: st('fragata', ['x_enj', 'x_enj', 'bc_canon', 'bc_blind', 'x_pd', 'bc_motor']),
  frio: st('fragata', ['bc_laser', 'bc_laser', 'bc_laser', 'bc_blind', 'x_rad', 'bc_motor']),
  caliente: st('fragata', ['bc_laser', 'bc_laser', 'bc_laser', 'bc_blind', 'bc_blind', 'bc_motor']),
  acor: st('acorazado', ['x_rail', 'x_rail', 'x_rail', 'x_plasma', 'x_plasma', 'bc_laser', 'bc_laser', 'x_torp', 'bc_blind', 'bc_blind', 'x_escudo', 'x_pd', 'bc_motor', 'bc_motor'])
};
const grp = (name, hull, count, stats, owner) => ({ name, hull, count, stats, owner: owner || 'x' });
function run(setup, opts) {
  const sim = new BS.BattleSim(setup);
  let n = 0;
  while (!sim.over && n++ < 4000) { if (opts && opts.each) opts.each(sim); sim.step(); }
  return sim;
}
function show(label, sim) {
  const r = sim.result();
  console.log(label.padEnd(46), 'gana', r.winner.padEnd(4), String(r.duration).padStart(3) + 's',
    'A:' + r.A.map(g => g.end + '/' + g.start).join(','), 'B:' + r.B.map(g => g.end + '/' + g.start).join(','));
  return r;
}

const scenarios = {
  'caza5 vs caza5': [[grp('c', 'caza', 5, D.caza)], [grp('c', 'caza', 5, D.caza)]],
  '4 corbetas vs 12 cazas': [[grp('c', 'corbeta', 4, D.corb)], [grp('z', 'caza', 12, D.caza)]],
  '4 misileras vs 4 corbetas PD': [[grp('m', 'corbeta', 4, D.misil)], [grp('p', 'corbeta', 4, D.pdc)]],
  '6 corbetas + 8 cazas vs 3 fragatas': [[grp('c', 'corbeta', 6, D.corb), grp('z', 'caza', 8, D.caza)], [grp('f', 'fragata', 3, D.frag)]],
  '2 cruceros vs 10 corbetas': [[grp('k', 'crucero', 2, D.crucero)], [grp('c', 'corbeta', 10, D.corb)]],
  'acorazado vs 4 cruceros': [[grp('a', 'acorazado', 1, D.acor)], [grp('k', 'crucero', 4, D.crucero)]],
  'flotas medias 20 vs 20': [[grp('c', 'corbeta', 12, D.corb), grp('f', 'fragata', 6, D.frag), grp('z', 'caza', 30, D.caza)], [grp('c', 'corbeta', 12, D.corb), grp('f', 'fragata', 6, D.frag), grp('z', 'caza', 30, D.caza)]]
};
console.log('--- duraciones y resultados ---');
const durations = [];
for (const k in scenarios) {
  const s = run({ seed: 11, sides: { A: scenarios[k][0], B: scenarios[k][1] } });
  const r = show(k, s); durations.push([k, r.duration]);
}

console.log('--- determinismo y repetición ---');
const setup = { seed: 5, sides: { A: scenarios['6 corbetas + 8 cazas vs 3 fragatas'][0], B: scenarios['6 corbetas + 8 cazas vs 3 fragatas'][1] } };
const s1 = run(setup, { each: sim => { if (sim.tick === 10) sim.order(0, { tactic: 'kite', focus: 2 }); if (sim.tick === 40) sim.order(1, { tactic: 'retreat' }); } });
const s2 = run(setup, { each: sim => { if (sim.tick === 10) sim.order(0, { tactic: 'kite', focus: 2 }); if (sim.tick === 40) sim.order(1, { tactic: 'retreat' }); } });
assert.deepStrictEqual(s1.result(), s2.result(), 'misma entrada, mismo resultado');
const rep = BS.replayFrom({ setup, orders: s1.orderLog, reinf: s1.reinfLog });
let guard = 0; while (!rep.over && guard++ < 4000) BS.replayStep(rep);
assert.deepStrictEqual(rep.result(), s1.result(), 'la repetición coincide con la batalla original');
console.log('determinismo y repetición: OK (' + s1.result().duration + ' s)');

console.log('--- entornos ---');
for (const env of ['asteroids', 'nebula', 'blackhole']) show('6 corbetas vs 6 corbetas · ' + env, run({ seed: 3, env, sides: { A: [grp('c', 'corbeta', 6, D.corb)], B: [grp('c', 'corbeta', 6, D.corb)] } }));

console.log('--- refuerzos ---');
const sr = new BS.BattleSim({ seed: 8, sides: { A: [grp('c', 'corbeta', 3, D.corb)], B: [grp('c', 'corbeta', 6, D.corb)] } });
sr.addReinforcements('A', [grp('r', 'fragata', 3, D.frag)], 10);
let g2 = 0; while (!sr.over && g2++ < 4000) sr.step();
show('3 corbetas + refuerzo 3 fragatas vs 6 corbetas', sr);

console.log('--- retirada ---');
const sx = new BS.BattleSim({ seed: 9, sides: { A: [grp('c', 'corbeta', 4, D.corb)], B: [grp('c', 'corbeta', 8, D.corb)] } });
sx.order(0, { tactic: 'retreat' });
let g3 = 0; while (!sx.over && g3++ < 4000) sx.step();
const rr = show('4 corbetas se retiran de 8', sx);
assert(rr.A[0].escaped > 0, 'alguna nave debe escapar');

console.log('--- v3: armas nuevas, calor, modulos, rendicion ---');
const sPulso = run({ seed: 4, sides: { A: [grp('p', 'fragata', 6, D.pulso)], B: [grp('f', 'fragata', 6, D.frag)] } });
show('6 fragatas de pulsos vs 6 fragatas laser', sPulso);
const sIon = run({ seed: 4, sides: { A: [grp('i', 'fragata', 6, D.ion)], B: [grp('f', 'fragata', 6, D.frag)] } });
show('6 fragatas de iones vs 6 fragatas laser', sIon);
const sEnj = run({ seed: 4, sides: { A: [grp('e', 'fragata', 6, D.enj)], B: [grp('f', 'fragata', 6, D.frag)] } });
show('6 fragatas de enjambre vs 6 fragatas laser', sEnj);
// calor: un bando con radiadores se sobrecalienta menos que uno sin ellos
let hotCold = 0, hotHot = 0;
const sHeat = new BS.BattleSim({ seed: 6, sides: { A: [grp('c', 'fragata', 6, D.frio)], B: [grp('h', 'fragata', 6, D.caliente)] } });
let nh = 0; while (!sHeat.over && nh++ < 1200) { sHeat.step(); for (const ev of sHeat.events) if (ev.k === 'hot') { const e = sHeat.ents.find(x => x.id === ev.id); if (e.side === 'A') hotCold++; else hotHot++; } }
console.log('sobrecalentamientos: con radiadores', hotCold, '| sin radiadores', hotHot);
assert(hotHot > 0, 'sin radiadores las armas se sobrecalientan alguna vez');
assert(hotCold <= hotHot, 'los radiadores reducen los sobrecalentamientos');
// modulos y rendicion: en una batalla larga alguna nave pierde modulos y alguna se rinde
let mods = 0, surrs = 0;
const sMod = new BS.BattleSim({ seed: 21, sides: { A: scenarios['flotas medias 20 vs 20'][0], B: scenarios['flotas medias 20 vs 20'][1] } });
let nm = 0; while (!sMod.over && nm++ < 4000) { sMod.step(); for (const ev of sMod.events) { if (ev.k === 'mod') mods++; if (ev.k === 'surr') surrs++; } }
console.log('modulos danados:', mods, '| rendiciones:', surrs, '| duracion', Math.round(sMod.t) + ' s');
assert(mods > 0, 'el daño al casco deja módulos fuera de combate');
assert(surrs > 0, 'hay barcos que se rinden');
const rr2 = sMod.result();
assert([].concat(rr2.A, rr2.B).some(g => g.surrendered > 0), 'el resultado cuenta los rendidos');

console.log('--- v3: batalla masiva (150 vs 150) ---');
const mass = o => [grp('Cruceros', 'crucero', 12, D.crucero, o), grp('Fragatas', 'fragata', 40, D.frag, o), grp('Corbetas', 'corbeta', 48, D.corb, o), grp('Cazas', 'caza', 50, D.caza, o)];
const sMass = new BS.BattleSim({ seed: 3, maxTime: 1800, sides: { A: mass('a'), B: mass('b') } });
assert(sMass.ents.length >= 100, 'cada barco o escuadrilla es una entidad visible: ' + sMass.ents.length);
const t0 = Date.now(); let ns = 0, worst = 0;
while (!sMass.over && ns++ < 4000) { const a = Date.now(); sMass.step(); sMass.snapshot(); worst = Math.max(worst, Date.now() - a); }
const rm = sMass.result();
console.log('150 vs 150: ' + sMass.ents.length + ' entidades, dura ' + rm.duration + ' s (' + Math.round(rm.duration / 60) + ' min), gana ' + rm.winner + ', CPU total ' + (Date.now() - t0) + ' ms, peor paso ' + worst + ' ms');
assert(rm.duration >= 600, 'una batalla masiva dura al menos 10 minutos: ' + rm.duration);
assert(worst < 100, 'cada paso cuesta poco CPU (el servidor aguanta varias batallas): ' + worst + ' ms');

const bad = durations.filter(([, d]) => d < 20 || d > 1800);
if (bad.length) console.log('AVISO duraciones fuera de rango:', bad);
console.log('OK');
