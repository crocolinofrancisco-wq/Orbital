/* =====================================================================
 * GUERRA TERRESTRE (v3): bloqueo, bombardeo orbital y campaña de invasión
 * ---------------------------------------------------------------------
 * Idea sacada de los videos de referencia: "quien domina la órbita casi gana
 * la guerra". Conquistar un planeta ya no es un cálculo instantáneo, sino una
 * secuencia con decisiones:
 *
 *   1. BLOQUEO     Una flota armada quieta en un sistema enemigo, sin naves
 *                  defensoras, corta el PIB de los planetas de ese sistema y
 *                  baja su estabilidad cada ciclo (se rinden "por asfixia").
 *   2. BOMBARDEO   (orden de la flota) debilita milicia y guarnición y
 *                  suprime la defensa. Dos modos:
 *                    precisión  -> lento, casi sin daños colaterales (el
 *                                  planeta conquistado conserva edificios y población)
 *                    saturación -> rápido, pero mata población y destruye edificios
 *                  No se puede bombardear con las defensas orbitales activas ni
 *                  con el escudo planetario en pie.
 *   3. ESCUDO      Si el planeta tiene Escudo planetario, solo se apaga
 *                  desembarcando tropas (la artillería de asedio pesa x3).
 *   4. CAMPAÑA     Las tropas desembarcadas pelean ronda a ronda (cada ~20 s)
 *                  hasta que alguien pierde todo. Posturas: asalto (rápido y
 *                  sangriento) o asedio (lento, cuida las tropas). Se puede
 *                  reforzar con más desembarcos o retirarse.
 *
 * Todo se avanza en tick() cada ROUND_S segundos / GAME_SPEED.
 * Datos persistentes por planeta: p.camp, p.supp, p.milFrac, p.shieldHp, p.shieldDownUntil.
 * Datos por flota: f.bombard = { planetId, mode }.
 * ===================================================================== */
const GD = require('../public/shared/gamedata.js');
const { groundRound, spreadGround } = require('./combat.js');

let X = null;
function attach(ctx) { X = ctx; }
const ROUND_S = Number(process.env.GROUND_ROUND_S || 20);       // segundos por ronda (antes de GAME_SPEED)
const SHIELD_PER_BUILDING = 400 * GD.NUM_K;                          // "puntos de generador" por Escudo planetario
const W = () => X.W();
const fail = m => { throw new X.GameError(m); };

/** Contadores para las herramientas de balance (server/tools/simulate.js) */
const stats = { landings: 0, won: 0, lost: 0, withdraw: 0, cancel: 0, rounds: 0, bombardRounds: 0 };
let nextRoundAt = 0;
let blockMap = {};                                               // planetId -> nación que lo bloquea

/* ---------------------------------------------------------------
 * UTILIDADES
 * --------------------------------------------------------------- */
const allied = (a, b) => { if (a === b) return true; const w = W(), na = w.nations[a], nb = w.nations[b]; return !!(na && nb && na.alliance && na.alliance === nb.alliance); };
const isArmed = f => { for (const d in f.units) { const s = X.statsOf(d); if (s && s.domain === 'space' && s.weapons.length && f.units[d] > 0) return true; } return false; };
const militiaMax = p => p.pop * 4;
const militiaFrac = p => (p.milFrac == null ? 1 : p.milFrac);
function shieldMax(p) { return (p.buildings.escudo || 0) * SHIELD_PER_BUILDING; }
/** Estado del escudo planetario: { max, hp, up } (se reactiva a media potencia pasadas unas horas) */
function shieldState(p) {
  const max = shieldMax(p);
  if (!max) return { max: 0, hp: 0, up: false };
  const t = X.now();
  if (p.shieldDownUntil && t > p.shieldDownUntil) { p.shieldDownUntil = null; p.shieldHp = max * 0.5; }
  if (p.shieldHp == null || p.shieldHp > max) p.shieldHp = max;
  const down = !!(p.shieldDownUntil && t <= p.shieldDownUntil);
  return { max, hp: down ? 0 : p.shieldHp, up: !down && p.shieldHp > 0 };
}
/** Grupos terrestres a partir de un mapa { designId: n } */
function groupsOfUnits(map, extra, dmg) {
  const w = W(), out = [];
  for (const d in map) {
    const s = X.statsOf(d); const des = w.designs[d];
    if (s && s.domain === 'ground' && map[d] > 0) out.push(Object.assign({ designId: d, name: des.name, count: map[d], stats: s, siege: !!GD.HULLS[des.hull].siege, damage: (dmg && dmg[d]) || 0 }, extra || {}));
  }
  return out;
}
/** Tropas terrestres defensoras: las guarniciones quietas del dueño en el sistema */
function defenders(p) {
  const w = W();
  const fleets = Object.values(w.fleets).filter(o => o.system === p.system && o.owner === p.owner && !o.path);
  const groups = [].concat(...fleets.map(f => groupsOfUnits(f.units, { fleetId: f.id }, f.gdmg)));
  return { fleets, groups };
}
/** Aplica bajas a las guarniciones defensoras y guarda el daño fraccionario (para que no se pierda entre rondas) */
function commitDefenders(D) {
  D.fleets.forEach(df => {
    const gs = D.groups.filter(g => g.fleetId === df.id);
    X.applyGroundLosses(df, gs);
    df.gdmg = {}; for (const g of gs) if (g.count > 0 && g.damage > 0) df.gdmg[g.designId] = g.damage;
  });
}
const countGround = gs => gs.reduce((a, g) => a + Math.max(0, g.count), 0);

/* ---------------------------------------------------------------
 * BLOQUEO
 * --------------------------------------------------------------- */
function refreshBlockades() {
  const w = W(), bySys = {};
  for (const f of Object.values(w.fleets)) {
    if (f.path || f.owner === X.PIRATES || f.owner === X.MONSTERS) { if (f.battle && bySys[f.system]) bySys[f.system].battle = true; continue; }
    const e = bySys[f.system] || (bySys[f.system] = { owners: new Set(), battle: false });
    if (f.battle) e.battle = true;
    if (X.fleetInfo(f).space > 0 && isArmed(f)) e.owners.add(f.owner);
  }
  const map = {};
  for (const p of Object.values(w.planets)) {
    if (!p.owner) continue;
    const e = bySys[p.system]; if (!e || e.battle) continue;
    const owners = [...e.owners];
    if (owners.some(o => allied(o, p.owner))) continue;          // hay defensores en órbita: no hay bloqueo
    const att = owners.find(o => X.atWar(o, p.owner));
    if (att) map[p.id] = att;
  }
  blockMap = map;
}
const blockaderOf = p => blockMap[p.id] || null;

/* ---------------------------------------------------------------
 * ACCIONES
 * --------------------------------------------------------------- */
/** Desembarca todas las tropas de una flota sobre un planeta enemigo: empieza (o refuerza) la campaña */
function land(n, p, f) {
  const w = W();
  const take = {};
  for (const d in f.units) { const s = X.statsOf(d); if (s && s.domain === 'ground' && f.units[d] > 0) take[d] = f.units[d]; }
  if (!Object.keys(take).length) fail('La flota no lleva tropas');
  let c = p.camp;
  if (c && c.attacker !== n.id) fail('Otro ejército ya está combatiendo por ese planeta');
  const fresh = !c;
  if (!c) c = p.camp = { id: X.uid('g'), attacker: n.id, atk: {}, start: {}, stance: 'assault', round: 0, startedAt: X.now(), nextAt: X.now(), log: [], events: [] };
  let total = 0;
  for (const d in take) { c.atk[d] = (c.atk[d] || 0) + take[d]; c.start[d] = (c.start[d] || 0) + take[d]; total += take[d]; delete f.units[d]; }
  if (!Object.keys(f.units).length) delete w.fleets[f.id];
  if (fresh) {
    stats.landings++;
    X.notify(p.owner, ':invade: ¡' + n.name + ' desembarcó ' + total + ' tropas en ' + p.name + '! Defiéndelo con tus guarniciones.', 'bad');
    X.news(':invade: ' + n.name + ' desembarca en ' + p.name + ' (' + (w.nations[p.owner] || {}).name + ')', 'war');
  }
  return { ok: true, msg: ':invade: ' + total + ' tropas desembarcan en ' + p.name + '. La campaña avanza por rondas: míralá en el planeta.' };
}
function actGroundStance(n, { planetId, stance }) {
  const p = W().planets[planetId];
  if (!p || !p.camp || p.camp.attacker !== n.id) fail('No tienes una campaña en ese planeta');
  if (!['assault', 'siege'].includes(stance)) fail('Postura inválida');
  p.camp.stance = stance;
  return { ok: true, msg: stance === 'assault' ? 'Postura: asalto (más daño, más bajas)' : 'Postura: asedio (menos bajas, más lento)' };
}
function actGroundWithdraw(n, { planetId }) {
  const p = W().planets[planetId];
  if (!p || !p.camp || p.camp.attacker !== n.id) fail('No tienes una campaña en ese planeta');
  endCamp(p, 'withdraw');
  return { ok: true, msg: 'Tus tropas se retiran a la órbita (necesitan transporte para moverse)' };
}
function actBombard(n, { fleetId, planetId, mode }) {
  const w = W();
  const f = w.fleets[fleetId], p = w.planets[planetId];
  if (!f || f.owner !== n.id) fail('Flota inválida');
  if (!p || !p.owner || p.system !== f.system) fail('El planeta debe estar en el sistema de la flota');
  if (!X.atWar(n.id, p.owner)) fail('Debes estar en guerra con ' + (w.nations[p.owner] || {}).name);
  if (X.isProtected(w.nations[p.owner])) fail('Esa nación está bajo protección de novatos');
  if (!isArmed(f)) fail('La flota no tiene armas');
  if (!['precision', 'saturation'].includes(mode)) mode = 'precision';
  f.bombard = { planetId: p.id, mode };
  return { ok: true, msg: ':war: Bombardeo ' + (mode === 'precision' ? 'de precisión' : 'de saturación') + ' ordenado sobre ' + p.name + (shieldState(p).up ? ' (el escudo planetario lo bloquea: apágalo con tropas)' : '') };
}
function actStopBombard(n, { fleetId }) {
  const f = W().fleets[fleetId];
  if (!f || f.owner !== n.id) fail('Flota inválida');
  f.bombard = null; delete f.bombard;
  return { ok: true, msg: 'Bombardeo detenido' };
}

/* ---------------------------------------------------------------
 * RONDAS
 * --------------------------------------------------------------- */
function tick(t) {
  if (!nextRoundAt) nextRoundAt = t + X.ms(ROUND_S * 1000);
  if (t < nextRoundAt) return false;
  nextRoundAt = t + X.ms(ROUND_S * 1000);
  const w = W();
  refreshBlockades();
  const bombarded = new Set();
  for (const f of Object.values(w.fleets)) if (f.bombard) bombardStep(f, bombarded);
  let changed = false;
  for (const p of Object.values(w.planets)) if (p.camp) { stepCamp(p); changed = true; }
  // Recuperación: la milicia, la supresión y el escudo se recuperan si nadie los castiga
  for (const p of Object.values(w.planets)) {
    if (!p.owner) continue;
    const hit = bombarded.has(p.id) || p.camp;
    if (p.supp > 0 && !hit) p.supp = Math.max(0, p.supp - 0.03);
    if (p.milFrac != null && p.milFrac < 1 && !hit) p.milFrac = Math.min(1, p.milFrac + 0.03);
    const sh = shieldMax(p);
    if (sh && !p.camp && p.shieldHp != null && p.shieldHp < sh && !(p.shieldDownUntil && X.now() < p.shieldDownUntil)) p.shieldHp = Math.min(sh, p.shieldHp + sh * 0.05);
  }
  return changed || bombarded.size > 0;
}

/** Potencia de fuego de una flota (para bombardear) */
function firepower(f) {
  let fp = 0;
  for (const d in f.units) {
    const s = X.statsOf(d); if (!s || s.domain !== 'space') continue;
    for (const wp of s.weapons) fp += wp.dmg * wp.rel * f.units[d];
  }
  return fp;
}
const hardness = p => (1500 + Object.values(p.buildings).reduce((a, b) => a + b, 0) * 200) * GD.NUM_K + p.pop * 500;   // la poblacion ya viene x10

function bombardStep(f, bombarded) {
  const w = W(), b = f.bombard, p = w.planets[b.planetId];
  const stop = why => { f.bombard = null; delete f.bombard; X.notify(f.owner, ':war: ' + f.name + ': bombardeo cancelado (' + why + ')', 'warn'); };
  if (!p || !p.owner || p.system !== f.system || !X.atWar(f.owner, p.owner)) return stop('objetivo no válido');
  if (f.path || f.battle) return;                                                // en combate o viajando: en pausa
  const enemySpace = Object.values(w.fleets).some(o => o.system === f.system && !o.path && X.atWar(f.owner, o.owner) && X.fleetInfo(o).space > 0);
  if (enemySpace) return;
  if ((p.defenseHp == null || p.defenseHp > 0) && X.planetDefenseGroup(p)) return;   // las defensas orbitales aún disparan
  if (shieldState(p).up) return;                                                  // el escudo planetario protege al planeta
  const fp = firepower(f); if (fp <= 0) return stop('la flota ya no tiene armas');
  const ratio = fp / (fp + hardness(p));
  const sat = b.mode === 'saturation', supMul = sat ? 1 : 0.6, collat = sat ? 1 : 0.2;
  p.supp = Math.min(1, (p.supp || 0) + ratio * 0.10 * supMul);
  p.milFrac = Math.max(0, militiaFrac(p) - ratio * 0.06 * supMul);
  const def = defenders(p);
  if (def.groups.length) { spreadGround(def.groups, fp * 0.002 * supMul); commitDefenders(def); }
  // daños colaterales (la gracia del modo precisión es que casi no hay)
  p.pop = Math.round(Math.max(0.1, p.pop * (1 - ratio * 0.015 * collat)) * 100) / 100;
  p.stability = Math.max(0.05, p.stability - 0.01 * collat * ratio * 4);
  if (Math.random() < 0.12 * ratio * collat * 4) {
    const keys = Object.keys(p.buildings).filter(k => !['escudo', 'bateria'].includes(k));
    if (keys.length) { const k = keys[Math.floor(Math.random() * keys.length)]; p.buildings[k]--; if (!p.buildings[k]) delete p.buildings[k]; X.notify(p.owner, ':alert: El bombardeo destruyó un edificio en ' + p.name, 'bad'); }
  }
  stats.bombardRounds++;
  b.n = (b.n || 0) + 1;                                                           // rondas efectivas de bombardeo
  bombarded.add(p.id);
}

function stepCamp(p) {
  const w = W(), c = p.camp;
  const att = w.nations[c.attacker], def = w.nations[p.owner];
  if (!att || !att.alive || !def || !def.alive || !p.owner || !X.atWar(c.attacker, p.owner)) return endCamp(p, 'cancel');
  const atk = groupsOfUnits(c.atk, null, c.dmg);
  if (!countGround(atk)) return endCamp(p, 'lost');
  const D = defenders(p);
  const sh = shieldState(p);
  const mmax = militiaMax(p), militia = mmax * militiaFrac(p);
  const rng = rngFor(p, c.round);
  const r = groundRound(atk, D.groups, militia, { rng, stance: c.stance, supp: p.supp || 0, shieldUp: sh.up });
  p.milFrac = mmax > 0 ? Math.max(0, r.militia / mmax) : 0;
  c.atk = {}; c.dmg = {}; for (const g of atk) if (g.count > 0) { c.atk[g.designId] = g.count; if (g.damage > 0) c.dmg[g.designId] = g.damage; }
  commitDefenders(D);
  if (sh.up) {
    p.shieldHp = Math.max(0, sh.hp - r.shieldDmg);
    if (p.shieldHp <= 0) { p.shieldHp = 0; p.shieldDownUntil = X.now() + X.ms(6 * 3600000); X.notify(c.attacker, ':ok: ¡Generador del escudo de ' + p.name + ' destruido! Ya puedes bombardear (6 h).', 'good'); X.notify(p.owner, ':alert: ¡Cayó el escudo planetario de ' + p.name + '!', 'bad'); }
  }
  c.round++;
  const au = countGround(groupsOfUnits(c.atk)), du = countGround(D.groups);
  const shNow = shieldState(p);
  c.log.push({ round: c.round, atk: r.aPower, def: r.dPower, militia: Math.round(militiaFrac(p) * 100), shield: shNow.max ? Math.round(shNow.hp / shNow.max * 100) : null, au, du });
  if (c.log.length > 90) c.log.splice(0, c.log.length - 90);
  // victoria: sin tropas defensoras y con la milicia rota
  if (du <= 0 && p.milFrac * mmax < Math.max(0.5, mmax * 0.04)) return endCamp(p, 'won');
  if (au <= 0) return endCamp(p, 'lost');
}
function rngFor(p, round) {
  let a = ((p.seed || 1) ^ (round * 2654435761)) >>> 0;
  return function () { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function endCamp(p, outcome) {
  const w = W(), c = p.camp;
  if (!c) return;
  stats[outcome] = (stats[outcome] || 0) + 1; stats.rounds += c.round;
  const att = w.nations[c.attacker], defId = p.owner;
  const startN = Object.values(c.start).reduce((a, b) => a + b, 0), endN = Object.values(c.atk).reduce((a, b) => a + b, 0);
  const repId = X.uid('r');
  const winner = outcome === 'won' ? c.attacker : defId;
  w.reports[repId] = { id: repId, t: X.now(), kind: 'ground', planet: p.name, system: p.system, attacker: c.attacker, defender: defId, winner, outcome,
    rounds: c.log, start: startN, end: endN, duration: Math.round((X.now() - c.startedAt) * X.TS / 1000) };
  const survivors = c.atk;
  p.camp = null; delete p.camp;
  if (outcome === 'won' && att && att.alive) {
    X.conquer(att, p, survivors, repId);
  } else {
    // retirada o cancelación: los supervivientes quedan como guarnición en el sistema (necesitan transporte para irse)
    if (att && att.alive && Object.keys(survivors).length) {
      const g = X.makeFleet(c.attacker, p.system, 'Guarnición ' + w.systems[p.system].name);
      for (const d in survivors) g.units[d] = survivors[d];
    }
    if (outcome === 'lost') {
      X.notify(defId, ':shield: ¡Repelimos la invasión de ' + (att || {}).name + ' en ' + p.name + '!', 'good');
      X.notify(c.attacker, ':x: La invasión de ' + p.name + ' fracasó: perdimos a todas las tropas.', 'bad');
      X.news(':shield: ' + (w.nations[defId] || {}).name + ' repele la invasión de ' + (att || {}).name + ' en ' + p.name, 'war');
    } else if (outcome === 'withdraw') X.notify(defId, ':shield: ' + (att || {}).name + ' retiró sus tropas de ' + p.name, 'good');
  }
  X.emit().dirty();
}

/* ---------------------------------------------------------------
 * VISTA PARA LA UI (se añade a cada planeta visible como p.g)
 * --------------------------------------------------------------- */
function info(p) {
  if (!p.owner) return null;
  const sh = shieldState(p), c = p.camp;
  const out = { blockade: blockaderOf(p), supp: Math.round((p.supp || 0) * 100), militia: Math.round(militiaFrac(p) * 100), shield: sh.max ? { pct: Math.round(sh.hp / sh.max * 100), up: sh.up } : null, camp: null };
  if (c) {
    const atk = groupsOfUnits(c.atk), D = defenders(p);
    out.camp = { attacker: c.attacker, stance: c.stance, round: c.round, au: countGround(atk), du: countGround(D.groups), start: Object.values(c.start).reduce((a, b) => a + b, 0), log: c.log.slice(-14) };
  }
  return out;
}

module.exports = { stats, attach, tick, land, info, blockaderOf, refreshBlockades, shieldState, actGroundStance, actGroundWithdraw, actBombard, actStopBombard, firepower, endCamp };
