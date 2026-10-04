/* =====================================================================
 * SIMULADOR DE COMBATE (reemplaza al "rol hecho por un humano")
 * ---------------------------------------------------------------------
 * Inspirado en el combate espacial "realista" (The Expanse, videos de
 * referencia): las batallas se deciden por DISTANCIA, SENSORES y por la
 * relación entre tipos de daño y defensas, no por reflejos.
 *
 * Una batalla tiene 6 rondas en 3 fases de distancia:
 *   LARGA (rondas 1-2): misiles y cañones de riel dominan.
 *   MEDIA (rondas 3-4): láseres y torpedos.
 *   CORTA (rondas 5-6): plasma, cañones automáticos y cazas.
 *
 * Piedra-papel-tijera fácil de entender para adolescentes:
 *   ENERGÍA (láser/plasma)     -> la frenan los ESCUDOS
 *   CINÉTICO (cañón/riel)      -> lo frena el BLINDAJE
 *   EXPLOSIVO (misil/torpedo)  -> lo intercepta la DEFENSA PUNTUAL
 *   CAZAS: difíciles de acertar para naves grandes, pero la defensa
 *          puntual los destroza.
 *
 * Es una función PURA: mismo input + misma semilla = mismo resultado.
 * Así se puede testear (server/tests/combat.test.js) y re-simular.
 * ===================================================================== */
const { makeRng } = require('./galaxy.js');

const PHASES = ['larga', 'larga', 'media', 'media', 'corta', 'corta'];
const PHASE_IDX = { larga: 0, media: 1, corta: 2 };

/**
 * group = { key, designId, name, nation, count, stats (de GD.designStats), damage (acumulado) }
 * Un "lado" es una lista de grupos.
 */
function sideTotals(groups) {
  const t = { pd: 0, sensors: 0, ecm: 0, alive: 0 };
  for (const g of groups) {
    if (g.count <= 0) continue;
    t.pd += g.stats.pd * g.count;
    t.sensors = Math.max(t.sensors, g.stats.sensors);
    t.ecm = Math.max(t.ecm, g.stats.ecm);
    t.alive += g.count;
  }
  return t;
}

function pickTarget(groups, rng, preferFighters) {
  const alive = groups.filter(g => g.count > 0);
  if (!alive.length) return null;
  // Peso por tamaño: las naves grandes son blancos más fáciles de encontrar
  const weights = alive.map(g => g.count * Math.sqrt(g.stats.size) * (preferFighters && g.stats.role === 'fighter' ? 4 : 1));
  const tot = weights.reduce((a, b) => a + b, 0);
  let r = rng() * tot;
  for (let i = 0; i < alive.length; i++) { r -= weights[i]; if (r <= 0) return alive[i]; }
  return alive[alive.length - 1];
}

/** Aplica daño a un grupo, devuelve unidades destruidas */
function applyDamage(g, dmg) {
  if (g.count <= 0) return 0;
  g.damage = (g.damage || 0) + dmg;
  const hp = g.stats.hp;
  const kills = Math.min(g.count, Math.floor(g.damage / hp));
  g.count -= kills;
  g.damage -= kills * hp;
  if (g.count <= 0) g.damage = 0;
  return kills;
}

function fireSide(attackers, defenders, phaseIdx, rng, log) {
  const atk = sideTotals(attackers), def = sideTotals(defenders);
  // Precisión base 75%, sensores propios suben, guerra electrónica enemiga baja
  const baseHit = Math.max(0.25, Math.min(0.95, 0.75 + (atk.sensors - def.ecm) * 0.01));
  const shots = [];
  for (const g of attackers) {
    if (g.count <= 0) continue;
    for (const w of g.stats.weapons) {
      const eff = w.range[phaseIdx];
      if (eff <= 0) continue;
      // Fiabilidad: % de armas que funcionan esta ronda (con variación)
      const working = g.count * w.rel * (0.85 + rng() * 0.3);
      shots.push({ from: g, w, raw: w.dmg * eff * working });
    }
    // Portanaves: sus escuadrones atacan en fase media y corta
    if (g.stats.hangar && phaseIdx >= 1) {
      shots.push({ from: g, w: { dmgType: 'cinetico', antiCapital: 1.2 }, raw: g.stats.hangar * 6 * g.count, fighter: true });
    }
  }
  // Defensa puntual: intercepta un % de los explosivos
  const explosiveTotal = shots.filter(s => s.w.dmgType === 'explosivo').reduce((a, s) => a + s.raw, 0);
  const intercept = explosiveTotal > 0 ? Math.min(0.8, def.pd / (def.pd + explosiveTotal * 0.5 + 1)) : 0;
  let dealt = 0, intercepted = 0;
  const kills = {};
  for (const s of shots) {
    let raw = s.raw * baseHit;
    if (s.w.dmgType === 'explosivo') { intercepted += raw * intercept; raw *= (1 - intercept); }
    const isFighter = s.from.stats.role === 'fighter' || s.fighter;
    const target = pickTarget(defenders, rng, s.w.dmgType === 'cinetico' && s.from.stats.role === 'fighter');
    if (!target) break;
    const ts = target.stats;
    // Cazas son evasivos ante armas de naves grandes
    if (ts.role === 'fighter' && !isFighter) raw *= 0.45;
    // Torpedos y portanaves hacen más daño a naves capitales
    if (ts.size >= 14) raw *= (s.w.antiCapital || 1);
    // Mitigación según tipo de daño
    const K = 10 * ts.size + 20;
    const defense = s.w.dmgType === 'energia' ? ts.shield : (s.w.dmgType === 'cinetico' ? ts.armor : ts.armor * 0.5);
    raw = raw * K / (K + defense);
    dealt += raw;
    const k = applyDamage(target, raw);
    if (k) kills[target.name] = (kills[target.name] || 0) + k;
  }
  // La defensa puntual también derriba cazas enemigos en fase corta/media
  if (phaseIdx >= 1 && atk.pd > 0) {
    const ftrs = defenders.filter(g => g.count > 0 && g.stats.role === 'fighter');
    for (const f of ftrs) {
      const k = applyDamage(f, atk.pd * 0.6 * baseHit / ftrs.length);
      if (k) kills[f.name] = (kills[f.name] || 0) + k;
    }
  }
  log.dealt = Math.round(dealt); log.intercepted = Math.round(intercepted); log.kills = kills;
}

/**
 * Resuelve una batalla espacial.
 * @returns {{winner:'A'|'B'|'draw', rounds:[], A, B}}  los grupos quedan mutados con count final
 */
function resolveSpaceBattle(sideA, sideB, seed) {
  const rng = makeRng(seed || 1);
  const startA = sideA.map(g => ({ name: g.name, count: g.count }));
  const startB = sideB.map(g => ({ name: g.name, count: g.count }));
  const rounds = [];
  for (let r = 0; r < PHASES.length; r++) {
    const pi = PHASE_IDX[PHASES[r]];
    if (sideTotals(sideA).alive === 0 || sideTotals(sideB).alive === 0) break;
    const la = {}, lb = {};
    // Disparo simultáneo: copiamos snapshot para que ambos disparen con la flota al inicio de la ronda
    const snapA = sideA.map(g => Object.assign({}, g)), snapB = sideB.map(g => Object.assign({}, g));
    fireSide(snapA, sideB, pi, rng, la);
    fireSide(snapB, sideA, pi, rng, lb);
    rounds.push({ round: r + 1, phase: PHASES[r], A: la, B: lb });
  }
  const aliveA = sideTotals(sideA).alive, aliveB = sideTotals(sideB).alive;
  const winner = aliveA > 0 && aliveB === 0 ? 'A' : (aliveB > 0 && aliveA === 0 ? 'B' : 'draw');
  return {
    winner, rounds,
    A: startA.map((s, i) => ({ name: s.name, start: s.count, end: sideA[i].count })),
    B: startB.map((s, i) => ({ name: s.name, start: s.count, end: sideB[i].count }))
  };
}

/**
 * Combate terrestre (invasión). Modelo de desgaste tipo Lanchester simplificado.
 * atk/def: grupos con stats.groundAttack / groundDefense. militia: defensa extra de la población.
 */
function resolveGroundBattle(attackers, defenders, militia, seed) {
  const rng = makeRng(seed || 7);
  const power = (gs, key) => gs.reduce((a, g) => a + Math.max(1, g.stats[key]) * g.count, 0);
  const rounds = [];
  for (let r = 0; r < 8; r++) {
    const aAtk = power(attackers, 'groundAttack') * (0.85 + rng() * 0.3);
    const dAtk = (power(defenders, 'groundAttack') + militia * 0.5) * (0.85 + rng() * 0.3) * 1.15; // +15% ventaja defensiva
    if (attackers.every(g => g.count <= 0)) break;
    const defAlive = defenders.some(g => g.count > 0);
    if (!defAlive && militia <= 0) break;
    // Daño del atacante: primero a la milicia, luego a las tropas
    let dmg = aAtk * 0.35;
    if (militia > 0) { const m = Math.min(militia, dmg); militia -= m; dmg -= m; }
    spreadGround(defenders, dmg);
    spreadGround(attackers, dAtk * 0.35);
    rounds.push({ round: r + 1, militia: Math.round(militia), atk: Math.round(aAtk), def: Math.round(dAtk) });
  }
  const aAlive = attackers.some(g => g.count > 0);
  const dAlive = defenders.some(g => g.count > 0) || militia > 0;
  return { winner: aAlive && !dAlive ? 'A' : 'B', rounds, militiaLeft: Math.round(militia) };
}
function spreadGround(groups, dmg) {
  const alive = groups.filter(g => g.count > 0);
  const tot = alive.reduce((a, g) => a + g.count, 0);
  for (const g of alive) {
    const share = dmg * g.count / tot;
    const hpEff = Math.max(5, g.stats.groundDefense) * 1.5;
    g.damage = (g.damage || 0) + share;
    const k = Math.min(g.count, Math.floor(g.damage / hpEff));
    g.count -= k; g.damage -= k * hpEff;
  }
}

module.exports = { resolveSpaceBattle, resolveGroundBattle, PHASES };
