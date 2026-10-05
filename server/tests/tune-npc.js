/* Herramienta de balance: enfrenta flotas tipo-jugador contra piratas y criaturas.
 * node server/tests/tune-npc.js */
const GD = require('../../public/shared/gamedata.js');
const BS = require('../../public/shared/battlesim.js');
const comps = {}; GD.BASE_COMPONENTS.forEach(c => comps[c.id] = c);
Object.assign(comps, {
  x_misil: { id: 'x_misil', type: 'misil', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } },
  x_pd: { id: 'x_pd', type: 'pd', points: { potencia: 20, fiabilidad: 10, eficiencia: 0 } },
  x_escudo: { id: 'x_escudo', type: 'escudo', points: { potencia: 20, fiabilidad: 10, eficiencia: 0 } },
  x_rail: { id: 'x_rail', type: 'railgun', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } },
  x_plasma: { id: 'x_plasma', type: 'plasma', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } }
});
const L = id => comps[id];
const st = (hull, c) => GD.designStats({ hull, components: c }, L);
const P = {
  caza: st('caza', ['bc_laser', 'bc_blind', 'bc_motor']), corb: st('corbeta', ['bc_canon', 'bc_laser', 'bc_blind', 'bc_motor']),
  frag: st('fragata', ['bc_canon', 'bc_laser', 'bc_laser', 'bc_blind', 'x_escudo', 'bc_motor']),
  dest: st('destructor', ['x_rail', 'x_rail', 'bc_laser', 'x_misil', 'bc_blind', 'x_escudo', 'bc_motor', 'bc_motor']),
  cruc: st('crucero', ['x_rail', 'x_rail', 'bc_laser', 'bc_laser', 'bc_canon', 'bc_blind', 'x_escudo', 'x_pd', 'bc_motor', 'bc_motor'])
};
const D = {}; GD.BASE_DESIGNS.forEach(d => D[d.id] = d);
const nst = id => GD.designStats(D[id], L);
const g = (name, hull, count, stats, extra) => Object.assign({ name, hull, count, stats, owner: 'x' }, extra || {});
function fight(label, A, B, seed, env) {
  const sim = new BS.BattleSim({ seed: seed || 4, env: env || 'none', maxTime: 300, sides: { A, B } });
  let n = 0; while (!sim.over && n++ < 2000) sim.step();
  const r = sim.result();
  console.log(label.padEnd(58), r.winner.padEnd(4), String(r.duration).padStart(3) + 's', 'A', r.A.map(x => x.end + '/' + x.start).join(' '), '| B', r.B.map(x => x.end + '/' + x.start).join(' '));
}
const mon = (id, n) => g(D[id].name, D[id].hull, n || 1, nst(id), { monster: true, owner: 'monsters' });
const pir = (id, n) => g(D[id].name, D[id].hull, n, nst(id), { owner: 'pirates' });
const small = [g('c', 'corbeta', 4, P.corb), g('z', 'caza', 8, P.caza)];
const mid = [g('f', 'fragata', 4, P.frag), g('c', 'corbeta', 6, P.corb), g('z', 'caza', 10, P.caza), g('d', 'destructor', 2, P.dest)];
const big = [g('k', 'crucero', 3, P.cruc), g('d', 'destructor', 3, P.dest), g('f', 'fragata', 4, P.frag), g('c', 'corbeta', 6, P.corb), g('z', 'caza', 12, P.caza)];
console.log('--- piratas ---');
fight('pequeña vs 3 raiders+1 corsario', small, [pir('pd_raider', 3), pir('pd_corsair', 1)]);
fight('pequeña vs 4 raiders+2 corsarios+1 misilera', small, [pir('pd_raider', 4), pir('pd_corsair', 2), pir('pd_missile', 1)]);
fight('media vs 6 corsarios+2 fragatas', mid, [pir('pd_corsair', 6), pir('pd_frigate', 2), pir('pd_hunter', 6)]);
fight('media vs 2 destructores+3 fragatas+misileras', mid, [pir('pd_destroyer', 2), pir('pd_frigate', 3), pir('pd_missile', 4)]);
fight('grande vs señor pirata (acorazado+escoltas)', big, [pir('pd_dread', 1), pir('pd_destroyer', 2), pir('pd_frigate', 3)]);
console.log('--- criaturas ---');
fight('media vs leviatán (sin env)', mid, [mon('md_leviatan')], 4, 'none');fight('media vs leviatán', mid, [mon('md_leviatan')], 4, 'asteroids');
fight('grande vs leviatán', big, [mon('md_leviatan')], 4, 'asteroids');
fight('pequeña vs 30 drones centinela', small, [mon('md_plaga', 30)]);
fight('media vs 40 drones centinela', mid, [mon('md_plaga', 40)]);
fight('media vs medusa', mid, [mon('md_medusa')], 4, 'nebula');
fight('grande vs medusa', big, [mon('md_medusa')], 4, 'nebula');
fight('grande vs devorador', big, [mon('md_devorador')]);
fight('2x grande vs devorador', big.concat(big.map(x => Object.assign({}, x, { owner: 'y' }))), [mon('md_devorador')]);
