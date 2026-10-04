/* =====================================================================
 * GENERADOR DE GALAXIA
 * Crea "constelaciones" de sistemas estelares unidos por hiperrutas
 * (como el mapa "Constelación del León" de las capturas de referencia).
 * El mapa es un GRAFO: las flotas solo viajan por las hiperrutas.
 * Esto crea cuellos de botella, fronteras y rutas estratégicas.
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
const STAR_TYPES = [
  { type: 'amarilla', color: '#ffb703', weight: 4 },
  { type: 'roja', color: '#ef476f', weight: 3 },
  { type: 'azul', color: '#4cc9f0', weight: 2 },
  { type: 'blanca', color: '#f1faee', weight: 1 }
];
const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];

function pickWeighted(rng, arr) {
  const tot = arr.reduce((a, b) => a + b.weight, 0);
  let r = rng() * tot;
  for (const x of arr) { r -= x.weight; if (r <= 0) return x; }
  return arr[0];
}

/**
 * Genera la galaxia.
 * @param {number} seed
 * @param {number} systemCount  cantidad de sistemas (≈ 2 por jugador esperado)
 */
function generateGalaxy(seed, systemCount) {
  const rng = makeRng(seed);
  systemCount = Math.min(systemCount || 24, STAR_NAMES.length);
  const systems = {};
  const planets = {};
  const names = STAR_NAMES.slice().sort(() => rng() - 0.5);

  // 1) Posiciones: muestreo con distancia mínima (Poisson simple) en 1000x1000
  const pts = [];
  let tries = 0;
  while (pts.length < systemCount && tries < 5000) {
    tries++;
    const x = 60 + rng() * 880, y = 60 + rng() * 880;
    if (pts.every(p => Math.hypot(p.x - x, p.y - y) > 140)) pts.push({ x, y });
  }

  pts.forEach((p, i) => {
    const st = pickWeighted(rng, STAR_TYPES);
    const id = 's' + i;
    systems[id] = {
      id, name: names[i], x: Math.round(p.x), y: Math.round(p.y),
      star: st.type, starColor: st.color, links: [],
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

  // 3) Planetas: 3-6 por sistema
  const biomeKeys = Object.keys(GD.BIOMES).filter(b => b !== 'ecumenopolis');
  let pc = 0;
  for (const sid of ids) {
    const n = 3 + Math.floor(rng() * 4);
    for (let k = 0; k < n; k++) {
      let biome = biomeKeys[Math.floor(rng() * biomeKeys.length)];
      if (rng() < 0.03) biome = 'ecumenopolis';
      const B = GD.BIOMES[biome];
      const size = 1 + Math.floor(rng() * 3); // 1 pequeño, 2 mediano, 3 grande
      const deposit = B.resources[Math.floor(rng() * B.resources.length)];
      const popCap = Math.round(B.popMult * size * 5 * 10) / 10; // millones
      const id = 'p' + (pc++);
      planets[id] = {
        id, name: systems[sid].name + ' ' + ROMAN[k], system: sid, biome, size, orbit: k,
        deposit, depositRich: rng() < 0.2 ? 2 : 1,
        pop: Math.round(popCap * (0.2 + rng() * 0.3) * 10) / 10, popCap,
        owner: null, buildings: {}, stock: {}, stability: 0.6,
        seed: Math.floor(rng() * 1e9)
      };
      systems[sid].planets.push(id);
    }
  }
  return { systems, planets };
}

/** BFS sobre hiperrutas: devuelve lista de sistemas desde 'from' hasta 'to' */
function findPath(systems, from, to) {
  if (from === to) return [from];
  const prev = { [from]: null };
  const q = [from];
  while (q.length) {
    const c = q.shift();
    for (const n of systems[c].links) if (!(n in prev)) {
      prev[n] = c;
      if (n === to) {
        const path = [to]; let p = c;
        while (p) { path.unshift(p); p = prev[p]; }
        return path;
      }
      q.push(n);
    }
  }
  return null;
}

module.exports = { generateGalaxy, findPath, makeRng };
