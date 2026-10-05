/* =====================================================================
 * COMBATE TERRESTRE (invasión de planetas)
 * ---------------------------------------------------------------------
 * El combate ESPACIAL ya no está aquí: ahora es una simulación en tiempo
 * real compartida entre servidor y cliente (public/shared/battlesim.js,
 * gestionada por server/battles.js). Este módulo solo resuelve el combate
 * terrestre, que sigue siendo por rondas (desgaste tipo Lanchester).
 * Es una función PURA: mismo input + misma semilla = mismo resultado.
 * ===================================================================== */
const { makeRng } = require('./galaxy.js');

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

/* ---------------------------------------------------------------
 * CAMPAÑA TERRESTRE (v3): una ronda cada ~20 s durante varios minutos.
 * groundRound es pura: mismo input + misma semilla = mismo resultado.
 *   a, d: grupos { count, stats:{groundAttack, groundDefense}, siege? }  militia: poder de la milicia
 *   o: { stance:'assault'|'siege', supp: supresion por bombardeo 0..1, shieldUp, rng }
 * Devuelve { aPower, dPower, shieldDmg, militia }. Los grupos se modifican (bajas).
 * --------------------------------------------------------------- */
const GROUND_RF = 0.04;                 // fraccion de poder que se convierte en dano por ronda (baja = campañas largas)
const STANCE = { assault: { atk: 1.35, taken: 1.35 }, siege: { atk: 0.75, taken: 0.6 } };
function groundRound(a, d, militia, o) {
  const rng = o.rng, st = STANCE[o.stance] || STANCE.assault;
  const power = (gs, key) => gs.reduce((x, g) => x + Math.max(1, g.stats[key]) * Math.max(0, g.count), 0);
  const aRaw = power(a, 'groundAttack') * st.atk * (0.85 + rng() * 0.3);
  const dPower = (power(d, 'groundAttack') + militia * 0.5) * (1 - 0.6 * (o.supp || 0)) * (0.85 + rng() * 0.3) * 1.15;   // +15 % defensa en casa
  const shieldShare = o.shieldUp ? 0.5 : 0;
  // la artilleria de asedio pesa x3 contra el generador del escudo
  const aSiege = a.reduce((x, g) => x + Math.max(1, g.stats.groundAttack) * Math.max(0, g.count) * (g.siege ? 3 : 1), 0) * st.atk * (0.85 + rng() * 0.3);
  let dmg = aRaw * (1 - shieldShare) * GROUND_RF;
  if (militia > 0) { const m = Math.min(militia, dmg); militia -= m; dmg -= m; }
  spreadGround(d, dmg);
  spreadGround(a, dPower * GROUND_RF * st.taken);
  return { aPower: Math.round(aRaw), dPower: Math.round(dPower), shieldDmg: o.shieldUp ? aSiege * shieldShare * 0.25 : 0, militia };
}

module.exports = { resolveGroundBattle, groundRound, spreadGround, GROUND_RF, STANCE };
