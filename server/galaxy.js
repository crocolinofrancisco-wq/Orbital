/* =====================================================================
 * GENERADOR DE GALAXIA
 * Crea "constelaciones" de sistemas estelares unidos por hiperrutas
 * (como el mapa "Constelación del León" de las capturas de referencia).
 * El mapa es un GRAFO: las flotas solo viajan por las hiperrutas.
 * Esto crea cuellos de botella, fronteras y rutas estratégicas.
 *
 * Además de estrellas normales crea OBJETOS ESPACIALES (docs/OBJETOS_ESPACIALES.md):
 *   - agujeros negros (en PAREJAS = portales rápidos pero arriesgados, sin planetas)
 *   - cinturones de asteroides ricos (un "planeta" tipo cinturón con yacimiento x3, custodiado por un Leviatán)
 *   - nebulosas (reducen sensores y alcance en combate; merodean medusas de plasma)
 *   - ruinas antiguas (botín único + enjambre centinela)
 *   - guaridas pirata (estación fija con clan y nivel)
 * ===================================================================== */
const GD = require('../public/shared/gamedata.js');

/** RNG con semilla (mulberry32) para que la galaxia sea reproducible */
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const STAR_NAMES = ['Leo', 'Sisenven', 'Scienza', 'Politikon', 'Algeiba', 'Sagitario A', 'Sagitario B', 'Sigma', 'Zosma', 'Regulus', 'Barnar', 'Polis',
  'Denebola', 'Vega', 'Altair', 'Kepler', 'Orion', 'Rigel', 'Cygnus', 'Nébula Roja', 'Hydra', 'Lyra', 'Draco', 'Fornax', 'Tauri', 'Kronos', 'Andrómeda', 'Perseo',
  'Áurea', 'Helix', 'Proxima', 'Atlas', 'Mira', 'Castor', 'Pólux', 'Antares', 'Capella', 'Nadir', 'Zenit', 'Eridano'];
const CONSTELLATIONS = ['Constelación del León', 'Brazo de Orión', 'Nube de Draco', 'Cúmulo de Hydra'];
const GREEK = ['Alfa', 'Beta', 'Gamma', 'Delta', 'Épsilon', 'Zeta'];
/** Nombres de sistema: la lista base y, si hace falta más, variantes con letra griega (así el mapa escala sin tocar nada) */
function systemNames(n) {
  const out = STAR_NAMES.slice();
  for (let k = 0; out.length < n; k++) out.push(STAR_NAMES[k % STAR_NAMES.length] + ' ' + GREEK[Math.floor(k / STAR_NAMES.length) % GREEK.length]);
  return out;
}
const STAR_TYPES = [
  { type: 'amarilla', color: '#ffb703', weight: 4 },
  { type: 'roja', color: '#ef476f', weight: 3 },
  { type: 'azul', color: '#4cc9f0', weight: 2 },
  { type: 'blanca', color: '#f1faee', weight: 1 }
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
const BH_NAMES = ['Aqueronte', 'Pozo de Lete', 'Garganta de Hades', 'Singularidad Nyx', 'Abismo de Caronte', 'Horizonte Moros'];
const CLANS = ['cometa', 'helio', 'hermandad'];
const DERELICT = ['Ruinas de la Arca Perdida', 'Necrópolis orbital', 'Cementerio de la Flota Olvidada', 'Estación Silente'];

function pickWeighted(rng, arr) {
  const tot = arr.reduce((a, b) => a + b.weight, 0);
  let r = rng() * tot;
  for (const x of arr) { r -= x.weight; if (r <= 0) return x; }
  return arr[0];
}

/**
 * Genera la galaxia.
 * @param {number} seed
 * @param {number} systemCount  cantidad de sistemas (≈ 1.3 por nación esperada)
 */
function generateGalaxy(seed, systemCount) {
  const rng = makeRng(seed);
  systemCount = Math.min(systemCount || 24, 120);
  const systems = {};
  const planets = {};
  const names = systemNames(systemCount).slice(0, STAR_NAMES.length).sort(() => rng() - 0.5).concat(systemNames(systemCount).slice(STAR_NAMES.length));

  // 1) Posiciones: muestreo con distancia mínima (Poisson simple) en 1000x1000
  const pts = [];
  let tries = 0, minDist = 125 * Math.sqrt(28 / Math.max(28, systemCount)) * 1.05;   // mapas mas grandes = sistemas mas juntos (mas saltos para cruzar)
  while (pts.length < systemCount && tries < 20000) {
    tries++;
    const x = 60 + rng() * 880, y = 60 + rng() * 880;
    if (pts.every(p => Math.hypot(p.x - x, p.y - y) > minDist)) pts.push({ x, y });
    if (tries % 2000 === 0 && pts.length < systemCount) minDist *= 0.9;     // si no caben, se acerca un poco
  }

  pts.forEach((p, i) => {
    const st = pickWeighted(rng, STAR_TYPES);
    const id = 's' + i;
    systems[id] = {
      id, name: names[i], x: Math.round(p.x), y: Math.round(p.y), kind: 'star',
      star: st.type, starColor: st.color, links: [], features: [],
      constellation: CONSTELLATIONS[(p.x > 500 ? 1 : 0) + (p.y > 500 ? 2 : 0)],
      planets: []
    };
  });

  // 2) Hiperrutas: árbol de expansión mínima + algunas conexiones extra cortas
  const ids = Object.keys(systems);
  const dist = (a, b) => Math.hypot(systems[a].x - systems[b].x, systems[a].y - systems[b].y);
  const inTree = new Set([ids[0]]);
  const link = (a, b) => { if (!systems[a].links.includes(b)) { systems[a].links.push(b); systems[b].links.push(a); } };
  while (inTree.size < ids.length) {
    let best = null;
    for (const a of inTree) for (const b of ids) if (!inTree.has(b)) {
      const d = dist(a, b);
      if (!best || d < best.d) best = { a, b, d };
    }
    link(best.a, best.b); inTree.add(best.b);
  }
  for (const a of ids) {
    const near = ids.filter(b => b !== a && !systems[a].links.includes(b)).sort((x, y) => dist(a, x) - dist(a, y));
    if (near.length && rng() < 0.45 && dist(a, near[0]) < 260) link(a, near[0]);
  }

  // 2b) Regiones (las 4 constelaciones) y SISTEMA CLAVE de cada una: el mas central y mejor conectado.
  // Quien lo controla recibe +25 % de PIB en sus planetas ahi (ver computeEconomy) y todos lo disputan.
  const regions = {};
  for (const id of ids) { const c = systems[id].constellation; (regions[c] = regions[c] || []).push(id); }
  for (const c in regions) {
    const ls = regions[c];
    if (ls.length < 4) continue;
    const cx = ls.reduce((a, id) => a + systems[id].x, 0) / ls.length, cy = ls.reduce((a, id) => a + systems[id].y, 0) / ls.length;
    ls.sort((a, b) => (Math.hypot(systems[a].x - cx, systems[a].y - cy) - systems[a].links.length * 22) - (Math.hypot(systems[b].x - cx, systems[b].y - cy) - systems[b].links.length * 22));
    const hub = systems[ls[0]];
    hub.hub = true; hub.features.push('hub');
  }
  // Pasos estrategicos: sistemas cuya caida parte el mapa en dos (si pierdes ese sistema, una parte queda aislada)
  for (const id of ids) {
    const sy = systems[id];
    if (sy.links.length < 2 || sy.links.length > 3) continue;
    const seen = new Set([id]), start = sy.links[0], q = [start]; seen.add(start);
    while (q.length) { const c = q.shift(); for (const l of systems[c].links) if (!seen.has(l)) { seen.add(l); q.push(l); } }
    if (seen.size < ids.length && ids.length - seen.size >= 3 && seen.size >= 3) { sy.choke = true; sy.features.push('choke'); }
  }

  // 3) Objetos espaciales (se reparten ANTES de crear planetas)
  const taken = new Set();
  const pick = (filter, sortFn) => {
    let pool = ids.filter(id => !taken.has(id) && !systems[id].hub && (!filter || filter(systems[id])));
    pool = sortFn ? pool.sort(sortFn) : pool.sort(() => rng() - 0.5);
    return pool[0] || null;
  };
  // 3a) Agujeros negros por parejas: dos sistemas muy alejados entre sí
  const pairs = Math.min(3, systemCount >= 34 ? Math.floor(systemCount / 20) : (systemCount >= 18 ? 1 : 0));
  const bhNames = BH_NAMES.slice().sort(() => rng() - 0.5);
  for (let k = 0; k < pairs; k++) {
    const cand = ids.filter(id => !taken.has(id) && systems[id].links.length <= 3);
    let best = null;
    for (let i = 0; i < cand.length; i++) for (let j = i + 1; j < cand.length; j++) {
      const d = dist(cand[i], cand[j]) * (0.85 + rng() * 0.15);
      if (!best || d > best.d) best = { a: cand[i], b: cand[j], d };
    }
    if (!best) break;
    for (const id of [best.a, best.b]) {
      const sy = systems[id];
      taken.add(id); sy.kind = 'blackhole'; sy.star = 'agujero'; sy.starColor = '#b388ff'; sy.features = ['blackhole']; sy.name = bhNames.pop();
    }
    systems[best.a].portal = best.b; systems[best.b].portal = best.a;
    link(best.a, best.b); // el portal también es una arista del grafo (game.js: salto por portal = rápido pero con riesgo)
  }
  // 3b) Cinturones de asteroides ricos (custodiados por un Leviatán)
  const belts = Math.max(1, Math.round(systemCount / 12));
  for (let k = 0; k < belts; k++) { const id = pick(s => s.kind === 'star'); if (!id) break; taken.add(id); systems[id].features.push('asteroids'); systems[id].guard = 'leviatan'; }
  // 3c) Nebulosas (las medusas de plasma merodean)
  const nebs = Math.max(1, Math.round(systemCount / 12));
  for (let k = 0; k < nebs; k++) { const id = pick(s => s.kind === 'star'); if (!id) break; taken.add(id); systems[id].features.push('nebula'); systems[id].guard = 'medusa'; }
  // 3d) Ruinas antiguas: botín único + enjambre centinela
  const ruins = Math.max(1, Math.round(systemCount / 12));
  const dn = DERELICT.slice().sort(() => rng() - 0.5);
  for (let k = 0; k < ruins; k++) {
    const id = pick(s => s.kind === 'star'); if (!id) break; taken.add(id);
    systems[id].features.push('ruins'); systems[id].guard = 'plaga';
    systems[id].ruin = { name: dn[k % dn.length], claimedBy: null,
      loot: { credits: (40000 + Math.floor(rng() * 30000)) * GD.NUM_K, resources: { exoticos: (40 + Math.floor(rng() * 40)) * GD.NUM_K, compuestos: (80 + Math.floor(rng() * 60)) * GD.NUM_K, cristales: 60 * GD.NUM_K }, research: (120 + Math.floor(rng() * 120)) * GD.NUM_K } };
  }
  // 3e) Guaridas pirata en la periferia (lejos del centro)
  const lairs = Math.max(2, Math.round(systemCount / 10));
  for (let k = 0; k < lairs; k++) {
    const id = pick(s => s.kind === 'star', (a, b) => Math.hypot(systems[b].x - 500, systems[b].y - 500) - Math.hypot(systems[a].x - 500, systems[a].y - 500) + (rng() - 0.5) * 220);
    if (!id) break; taken.add(id);
    systems[id].features.push('lair');
    systems[id].lair = { clan: CLANS[k % CLANS.length], level: 1 + (k % 2), hpMax: 2600 * GD.NUM_K, hp: 2600 * GD.NUM_K, destroyedAt: null };
  }

  // 4) Planetas: 3-6 por sistema (los agujeros negros no tienen)
  const biomeKeys = Object.keys(GD.BIOMES).filter(b => b !== 'ecumenopolis' && !GD.BIOMES[b].belt);
  let pc = 0;
  for (const sid of ids) {
    const sy = systems[sid];
    if (sy.kind === 'blackhole') continue;
    const n = 3 + Math.floor(rng() * 4) - (sy.features.includes('asteroids') ? 1 : 0);
    for (let k = 0; k < n; k++) {
      let biome = biomeKeys[Math.floor(rng() * biomeKeys.length)];
      if (rng() < 0.03) biome = 'ecumenopolis';
      const B = GD.BIOMES[biome];
      const size = 1 + Math.floor(rng() * 3); // 1 pequeño, 2 mediano, 3 grande
      const deposit = B.resources[Math.floor(rng() * B.resources.length)];
      const popCap = Math.round(B.popMult * size * 5 * GD.NUM_K * 10) / 10; // millones (x10 de escala, ver GD.NUM_K)
      const id = 'p' + (pc++);
      planets[id] = {
        id, name: sy.name + ' ' + ROMAN[k], system: sid, biome, size, orbit: k,
        deposit, depositRich: rng() < 0.2 ? 2 : 1,
        pop: Math.round(popCap * (0.2 + rng() * 0.3) * 10) / 10, popCap,
        owner: null, buildings: {}, stock: {}, stability: 0.6,
        seed: Math.floor(rng() * 1e9)
      };
      sy.planets.push(id);
    }
    // Cinturón de asteroides: yacimiento x3 (el Leviatán lo custodia)
    if (sy.features.includes('asteroids')) {
      const id = 'p' + (pc++);
      planets[id] = {
        id, name: 'Cinturón de ' + sy.name, system: sid, biome: 'asteroides', size: 1, orbit: sy.planets.length,
        deposit: ['aleaciones', 'cristales', 'exoticos'][Math.floor(rng() * 3)], depositRich: 3,
        pop: 0.1 * GD.NUM_K, popCap: 0.3 * GD.NUM_K, owner: null, buildings: {}, stock: {}, stability: 0.6, seed: Math.floor(rng() * 1e9), belt: true
      };
      sy.planets.push(id);
    }
  }
  return { systems, planets };
}

/** Distancia entre dos sistemas (para tiempos de viaje) */
function laneLength(systems, a, b) {
  return Math.hypot(systems[a].x - systems[b].x, systems[a].y - systems[b].y);
}

/** Peso (tiempo relativo) de una hiperruta. Un portal es rápido pero arriesgado. */
function laneWeight(systems, a, b, allowPortals) {
  if (systems[a].portal === b) return allowPortals ? 0.4 : Infinity;
  return Math.max(0.6, Math.min(2.2, laneLength(systems, a, b) / 170));
}
/** Ruta más rápida (Dijkstra) entre dos sistemas. Los portales solo se usan si allowPortals. */
function findPath(systems, from, to, allowPortals, avoid) {
  if (from === to) return [from];
  const distTo = { [from]: 0 }, prev = { [from]: null }, done = new Set();
  const open = [from];
  while (open.length) {
    open.sort((x, y) => distTo[x] - distTo[y]);
    const c = open.shift();
    if (done.has(c)) continue; done.add(c);
    if (c === to) break;
    for (const n of systems[c].links) {
      const w = laneWeight(systems, c, n, allowPortals);
      if (w === Infinity) continue;
      if (avoid && n !== to && avoid.has(n)) continue;
      const nd = distTo[c] + w;
      if (distTo[n] == null || nd < distTo[n]) { distTo[n] = nd; prev[n] = c; open.push(n); }
    }
  }
  if (distTo[to] == null) return null;
  const path = [to]; let p = prev[to];
  while (p) { path.unshift(p); p = prev[p]; }
  return path;
}
/** Duración relativa de un salto (1 = salto normal) */
function jumpFactor(systems, a, b) {
  return systems[a].portal === b ? 0.4 : Math.max(0.6, Math.min(2.2, laneLength(systems, a, b) / 170));
}

module.exports = { generateGalaxy, findPath, makeRng, laneLength, jumpFactor, laneWeight };
