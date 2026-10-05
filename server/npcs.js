/* =====================================================================
 * ENEMIGOS NPC: PIRATAS Y CRIATURAS DEL VACÍO
 * ---------------------------------------------------------------------
 * Dos "naciones" NPC hostiles a todo el mundo (y amigas entre sí):
 *
 *  PIRATAS (id 'pirates'), tres clanes con estilo propio:
 *    - Cometa Negro  : enjambres de cazas rápidos (barato pero abundante)
 *    - Saqueadores de Helio: misiles y corbetas con defensa puntual
 *    - Hermandad del Vacío : fragatas y destructores, al final un acorazado
 *    Viven en GUARIDAS (estación fija en la periferia, destruible = botín
 *    grande), patrullan sistemas libres y lanzan INCURSIONES contra los
 *    sistemas peor defendidos (bloquean la economía mientras estén allí).
 *
 *  CRIATURAS (id 'monsters'):
 *    - Leviatán de roca  : guardián de cada cinturón de asteroides (yacimiento x3)
 *    - Enjambre centinela: drones antiguos que custodian ruinas (botín único)
 *    - Medusa de plasma  : merodea nebulosas; su pulso EMP apaga los escudos
 *    - Devorador estelar : JEFE de la fase de crisis, recorre la galaxia
 *
 * Todo escala con el progreso de la temporada (nivel 1-5) y respeta la
 * protección de novatos. Ver docs/ENEMIGOS.md.
 * ===================================================================== */
const GD = require('../public/shared/gamedata.js');

const PIRATES = 'pirates', MONSTERS = 'monsters';
let X = null;
function attach(ctx) { X = ctx; }

const CLAN = {
  cometa:    { name: 'Cometa Negro', flag: { layout: 'diagonal', emblem: 'triangulo', colors: ['#111111', '#7a0010', '#e63946'] }, fleets: ['Enjambre del Cometa', 'Rapaces Negros', 'Banda del Cometa Negro'] },
  helio:     { name: 'Saqueadores de Helio', flag: { layout: 'horizontal', emblem: 'circulo', colors: ['#1b1b1b', '#ff8c1a', '#ffd166'] }, fleets: ['Saqueadores de Helio', 'Misileros de Helio', 'Flota del Gas'] },
  hermandad: { name: 'Hermandad del Vacío', flag: { layout: 'cruz', emblem: 'rombo', colors: ['#0c0c14', '#5b2a86', '#c77dff'] }, fleets: ['Hermandad del Vacío', 'Los Sin Bandera', 'Corsarios Rojos'] }
};

function npcNation(id, name, motto, flag) {
  const w = X.W();
  if (w.nations[id]) return w.nations[id];
  w.nations[id] = {
    id, npc: true, userId: null, name, motto, flag, alive: true, createdAt: X.now(), capital: null, credits: 0, research: 0, resources: {}, tax: 0,
    stats: { unemployment: 0, evasion: 0, crime: 1, poverty: 0, popularity: 0, stability: 1 },
    techs: [], spec: [], alliance: null, inbox: [], betrayals: 0, flags: {}
  };
  return w.nations[id];
}
function ensureNpcNations() {
  npcNation(PIRATES, 'Piratas del Vacío', 'Nada es tuyo hasta que lo defiendes', CLAN.cometa.flag);
  npcNation(MONSTERS, 'Criaturas del Vacío', '…', { layout: 'centro', emblem: 'anillo', colors: ['#06130f', '#1fa37a', '#80ffdb'] });
}

/** Nivel de amenaza 1..5 según el avance de la temporada (+ pequeña variación) */
function threatLevel(extra) {
  const p = X.seasonProgress();
  return Math.max(1, Math.min(5, 1 + Math.floor(p * 4.4) + (extra || 0)));
}

function pirateUnits(clan, L) {
  let u;
  if (clan === 'cometa') u = { pd_raider: 3 + 2 * L, pd_hunter: 1 + L, pd_corsair: Math.floor(L / 2) + (L >= 2 ? 1 : 0), pd_frigate: L >= 4 ? 1 : 0 };
  else if (clan === 'helio') u = { pd_missile: 1 + L, pd_corsair: 1 + Math.floor(L / 2), pd_raider: 2 + L, pd_frigate: L >= 3 ? Math.floor(L / 2) : 0 };
  else u = { pd_hunter: 2 + L, pd_corsair: 1 + L, pd_frigate: Math.floor(L / 2) + (L >= 2 ? 1 : 0), pd_destroyer: L >= 3 ? L - 2 : 0, pd_dread: L >= 5 ? 1 : 0 };
  for (const k in u) if (!u[k]) delete u[k];
  return u;
}
function pickClan() { return ['cometa', 'helio', 'hermandad'][Math.floor(Math.random() * 3)]; }
function clanFleetName(clan) { const l = CLAN[clan].fleets; return l[Math.floor(Math.random() * l.length)]; }

const fleetsAt = sid => Object.values(X.W().fleets).filter(f => f.system === sid);
const npcFleetsAt = (sid, owner) => fleetsAt(sid).filter(f => f.owner === owner);

/* ---------------------------------------------------------------
 * PIRATAS
 * --------------------------------------------------------------- */
/** Sistemas "corrientes" donde pueden patrullar piratas */
function plainFreeSystems() {
  const w = X.W();
  const owned = new Set(Object.values(w.planets).filter(p => p.owner).map(p => p.system));
  const capitals = new Set(Object.values(w.nations).filter(n => n.alive && n.capital && w.planets[n.capital]).map(n => w.planets[n.capital].system));
  const busy = new Set(Object.values(w.fleets).map(f => f.system));
  return Object.keys(w.systems).filter(sid => {
    const sy = w.systems[sid];
    return sy.kind === 'star' && !(sy.features && sy.features.length) && !owned.has(sid) && !busy.has(sid) && !sy.links.some(l => capitals.has(l));
  });
}
function spawnPirates() {
  const w = X.W();
  ensureNpcNations();
  const players = Object.values(w.nations).filter(n => n.alive && !n.npc).length;
  const target = Math.min(Math.max(3, Math.ceil(players * 0.9)), 9);
  const patrols = Object.values(w.fleets).filter(f => f.owner === PIRATES && f.patrol);
  if (patrols.length >= target) return false;
  const free = plainFreeSystems();
  if (!free.length) return false;
  const sid = free[Math.floor(Math.random() * free.length)];
  const clan = pickClan();
  const lvl = threatLevel(Math.random() < 0.3 ? 1 : 0) - (Math.random() < 0.4 ? 1 : 0);
  const f = X.makeFleet(PIRATES, sid, clanFleetName(clan));
  f.units = pirateUnits(clan, Math.max(1, lvl)); f.patrol = true; f.clan = clan;
  return true;
}

/** Guaridas: cada una mantiene su flota de guardia y se regenera/reaparece */
function lairsTick(t) {
  const w = X.W();
  for (const sid in w.systems) {
    const sy = w.systems[sid];
    if (!sy.lair) continue;
    const L = sy.lair;
    if (L.destroyedAt && t - L.destroyedAt > X.ms(48 * 3600000)) { L.hp = L.hpMax; L.destroyedAt = null; L.level = Math.min(4, L.level + 1); X.news(':skull: Los piratas reconstruyeron su guarida de ' + sy.name + ' (nivel ' + L.level + ')', 'war'); }
    if (L.destroyedAt) continue;
    const guards = npcFleetsAt(sid, PIRATES);
    if (!guards.length) {
      const st = (w.npcState.lair = w.npcState.lair || {});
      if (!st[sid]) st[sid] = t + X.ms(6 * 3600000);   // tarda unas horas en rearmarse
      else if (t >= st[sid]) {
        delete st[sid];
        const f = X.makeFleet(PIRATES, sid, 'Guardia de ' + CLAN[L.clan].name);
        f.units = pirateUnits(L.clan, Math.max(1, Math.min(5, threatLevel() + L.level - 2))); f.guard = true; f.clan = L.clan;
      }
    }
  }
}
function lairCycle() {
  const w = X.W();
  for (const sy of Object.values(w.systems)) if (sy.lair && !sy.lair.destroyedAt && sy.lair.hp < sy.lair.hpMax) sy.lair.hp = Math.min(sy.lair.hpMax, sy.lair.hp + sy.lair.hpMax * 0.1);
}

/** Incursiones: una flota sale de una guarida contra el sistema peor defendido de una nación sin protección */
function defensePower(sid) {
  const w = X.W();
  let pw = 0;
  for (const f of fleetsAt(sid)) if (f.owner !== PIRATES && f.owner !== MONSTERS) pw += X.fleetInfo(f).power;
  for (const pid of w.systems[sid].planets) { const p = w.planets[pid]; if (p.owner && p.buildings) pw += ((p.buildings.bateria || 0) * 60 + (p.buildings.escudo || 0) * 80) * GD.NUM_K; }
  return pw;
}
function raidTick(t) {
  const w = X.W(), st = w.npcState;
  if (!st.nextRaidAt) st.nextRaidAt = t + X.ms(10 * 3600000);
  if (t < st.nextRaidAt) return;
  const day = X.seasonDay();
  st.nextRaidAt = t + X.ms((8 + Math.random() * 8) * 3600000) / Math.max(1, 1 + day * 0.08);
  const lairs = Object.values(w.systems).filter(sy => sy.lair && !sy.lair.destroyedAt);
  if (!lairs.length || day < 2) return;
  // objetivos: sistemas con planetas de naciones sin protección (humanas o IA)
  const cand = Object.values(w.systems).filter(sy => sy.planets.some(pid => { const o = w.planets[pid].owner; return o && !X.isProtected(w.nations[o]); }));
  if (!cand.length) return;
  cand.sort((a, b) => defensePower(a.id) - defensePower(b.id));
  const target = cand[Math.floor(Math.random() * Math.min(3, cand.length))];
  const lair = lairs[Math.floor(Math.random() * lairs.length)];
  const L = Math.max(1, Math.min(5, threatLevel() + (Math.random() < 0.4 ? 1 : 0)));
  const f = X.makeFleet(PIRATES, lair.id, 'Incursión: ' + clanFleetName(lair.lair.clan));
  f.units = pirateUnits(lair.lair.clan, L); f.raid = true; f.clan = lair.lair.clan; f.expiresAt = t + X.ms(14 * 3600000);
  const path = X.findPath(w.systems, lair.id, target.id, false);
  if (path && path.length > 1) {
    f.path = path.slice(1); f.mission = { type: 'attack' }; f.jumpStartAt = t; f.nextJumpAt = t + X.jumpMs(w.nations[PIRATES], X.fleetInfo(f).speed || 5, path[0], path[1]);
    const owners = [...new Set(target.planets.map(pid => w.planets[pid].owner).filter(Boolean))];
    for (const o of owners) X.notify(o, ':alert: ¡Incursión pirata en camino a ' + target.name + '! (' + CLAN[lair.lair.clan].name + ')', 'bad');
    X.news(':skull: Los piratas lanzan una incursión hacia ' + target.name, 'war');
  }
}
/** Las incursiones se dispersan solas pasado un tiempo (no bloquean para siempre) */
function expireTick(t) {
  const w = X.W();
  for (const f of Object.values(w.fleets)) if (f.expiresAt && t > f.expiresAt && !f.battle) delete w.fleets[f.id];
}

/* ---------------------------------------------------------------
 * CRIATURAS
 * --------------------------------------------------------------- */
const GUARD = {
  leviatan: { design: 'md_leviatan', name: 'Leviatán de roca', respawnH: 40, count: () => 1 },
  medusa:   { design: 'md_medusa',   name: 'Medusa de plasma', respawnH: 24, count: () => 1 },
  plaga:    { design: 'md_plaga',    name: 'Enjambre centinela', respawnH: 20, count: lvl => 22 + 8 * lvl }
};
function spawnGuard(sy, kind) {
  const G = GUARD[kind];
  const f = X.makeFleet(MONSTERS, sy.id, G.name);
  f.units = { [G.design]: G.count(threatLevel()) }; f.guard = true; f.kind = kind;
  return f;
}
function monstersTick(t) {
  const w = X.W();
  const st = (w.npcState.guard = w.npcState.guard || {});
  for (const sid in w.systems) {
    const sy = w.systems[sid];
    if (!sy.guard) continue;
    const kind = sy.guard;
    const has = npcFleetsAt(sid, MONSTERS).some(f => f.kind === kind || f.guard);
    if (has) { delete st[sid]; continue; }
    // Una medusa que se fue a merodear no reaparece mientras siga viva en otro sistema
    if (kind === 'medusa' && Object.values(w.fleets).some(f => f.owner === MONSTERS && f.kind === 'medusa')) continue;
    if (st[sid] == null) { st[sid] = t + (w.cycle === 0 ? 0 : X.ms(GUARD[kind].respawnH * 3600000)); }
    if (t >= st[sid]) { delete st[sid]; spawnGuard(sy, kind); }
  }
  // Medusas: merodean entre sistemas libres vecinos
  if (!w.npcState.nextRoamAt) w.npcState.nextRoamAt = t + X.ms(6 * 3600000);
  if (t >= w.npcState.nextRoamAt) {
    w.npcState.nextRoamAt = t + X.ms((6 + Math.random() * 6) * 3600000);
    for (const f of Object.values(w.fleets)) {
      if (f.owner !== MONSTERS || f.kind !== 'medusa' || f.path || f.battle) continue;
      const sy = w.systems[f.system];
      const owned = new Set(Object.values(w.planets).filter(p => p.owner).map(p => p.system));
      const opts = sy.links.filter(l => w.systems[l].kind === 'star' && !owned.has(l) && !w.systems[l].lair && !(w.systems[l].ruin) && w.systems[l].guard !== 'leviatan' && w.systems[l].portal !== f.system);
      if (!opts.length) continue;
      const to = opts[Math.floor(Math.random() * opts.length)];
      f.path = [to]; f.jumpStartAt = t; f.nextJumpAt = t + X.jumpMs(w.nations[MONSTERS], X.fleetInfo(f).speed || 3, f.system, to);
      f.guard = false;     // ya no es guardián de su nebulosa original
    }
  }
  devoradorTick(t);
}

/** Jefe de la fase de crisis */
function devoradorTick(t) {
  const w = X.W(), se = w.season;
  if (se.status !== 'running') return;
  const crisisAt = se.startedAt + X.ms(GD.RULES.seasonDays * 86400000 * 0.62);
  se.crisis = se.crisis || { at: crisisAt, awake: false };
  const has = Object.values(w.fleets).find(f => f.owner === MONSTERS && f.kind === 'devorador');
  if (!se.crisis.awake && t >= se.crisis.at) {
    se.crisis.awake = true;
    // aparece en el sistema libre más alejado de todas las capitales
    const caps = Object.values(w.nations).filter(n => n.alive && n.capital && w.planets[n.capital]).map(n => w.systems[w.planets[n.capital].system]);
    const pool = Object.values(w.systems).filter(sy => sy.kind === 'star' && !sy.planets.some(pid => w.planets[pid].owner));
    pool.sort((a, b) => Math.min(...caps.map(c => Math.hypot(b.x - c.x, b.y - c.y)), 9999) - Math.min(...caps.map(c => Math.hypot(a.x - c.x, a.y - c.y)), 9999));
    const sy = pool[0] || Object.values(w.systems)[0];
    const f = X.makeFleet(MONSTERS, sy.id, 'Devorador estelar');
    f.units = { md_devorador: 1 }; f.kind = 'devorador'; f.roamAt = t + X.ms(3 * 3600000);
    X.news(':alert: ¡CRISIS! Un Devorador estelar ha despertado cerca de ' + sy.name + '. Todas las naciones están en peligro: ¡unidad o ruina!', 'victory');
    for (const n of Object.values(w.nations)) if (n.alive && !n.npc && !n.bot) X.notify(n.id, ':alert: ¡Un Devorador estelar despertó en ' + sy.name + '! Recompensa enorme a quien lo destruya.', 'bad');
    return;
  }
  if (has && !has.path && !has.battle && t >= (has.roamAt || 0)) {
    // elige como objetivo el sistema habitado más cercano a él que NO esté bajo protección
    const cand = Object.values(w.systems).filter(sy => sy.planets.some(pid => { const o = w.planets[pid].owner; return o && !X.isProtected(w.nations[o]); }));
    if (!cand.length) return;
    cand.sort((a, b) => { const ca = w.systems[has.system]; return Math.hypot(a.x - ca.x, a.y - ca.y) - Math.hypot(b.x - ca.x, b.y - ca.y); });
    const pick = cand[Math.floor(Math.random() * Math.min(2, cand.length))];
    const path = X.findPath(w.systems, has.system, pick.id, false);
    if (path && path.length > 1) {
      has.path = path.slice(1); has.mission = { type: 'attack' }; has.jumpStartAt = t;
      has.nextJumpAt = t + X.jumpMs(w.nations[MONSTERS], X.fleetInfo(has).speed || 2, path[0], path[1]); has.roamAt = t + X.ms(5 * 3600000);
      X.news(':alert: El Devorador estelar avanza hacia ' + pick.name, 'war');
    }
  }
}

/* ---------------------------------------------------------------
 * RUINAS: botín único al que llega primero y se queda un rato
 * --------------------------------------------------------------- */
function ruinsTick(t) {
  const w = X.W();
  const st = (w.npcState.ruin = w.npcState.ruin || {});
  for (const sid in w.systems) {
    const sy = w.systems[sid];
    if (!sy.ruin || sy.ruin.claimedBy) continue;
    const here = fleetsAt(sid);
    const hostile = here.some(f => (f.owner === MONSTERS || f.owner === PIRATES));
    const idle = here.filter(f => !f.path && !f.battle && X.fleetInfo(f).space > 0 && f.owner !== PIRATES && f.owner !== MONSTERS);
    if (hostile || !idle.length) { delete st[sid]; continue; }
    const owner = idle[0].owner;
    if (!st[sid] || st[sid].nid !== owner) { st[sid] = { nid: owner, since: t }; X.notify(owner, ':search: Explorando ' + sy.ruin.name + ' en ' + sy.name + '… mantén la flota aquí', 'info'); continue; }
    if (t - st[sid].since >= X.ms(20 * 60000)) {
      const n = w.nations[owner], L = sy.ruin.loot;
      n.credits += L.credits; n.research += L.research;
      for (const r in L.resources) n.resources[r] = (n.resources[r] || 0) + L.resources[r];
      sy.ruin.claimedBy = owner; delete st[sid]; n.flags = n.flags || {}; n.flags.ruins = true;
      X.notify(owner, ':ruins: ¡Botín de ' + sy.ruin.name + '! ₡' + L.credits + ' · :research: ' + L.research + ' · recursos raros', 'good');
      X.news(':ruins: ' + n.name + ' saqueó ' + sy.ruin.name + ' en ' + sy.name, 'nation');
    }
  }
}

/** Bloqueo: una flota hostil NPC en un sistema paraliza el PIB de los planetas de ese sistema */
function blockaded(sid) {
  for (const f of Object.values(X.W().fleets)) if (f.system === sid && (f.owner === PIRATES || f.owner === MONSTERS) && !f.path && !f.guard) return true;
  return false;
}

function tick(t) {
  lairsTick(t); raidTick(t); monstersTick(t); ruinsTick(t); expireTick(t);
}
function cycle() { lairCycle(); }

/** Siembra inicial del mundo: criaturas y guaridas ya presentes */
function seedWorld() {
  const w = X.W();
  ensureNpcNations();
  for (const sy of Object.values(w.systems)) {
    if (sy.guard && !npcFleetsAt(sy.id, MONSTERS).length) spawnGuard(sy, sy.guard);
    if (sy.lair && !npcFleetsAt(sy.id, PIRATES).length) { const f = X.makeFleet(PIRATES, sy.id, 'Guardia de ' + CLAN[sy.lair.clan].name); f.units = pirateUnits(sy.lair.clan, sy.lair.level); f.guard = true; f.clan = sy.lair.clan; }
  }
  for (let i = 0; i < 5; i++) spawnPirates();
}

module.exports = { PIRATES, MONSTERS, CLAN, attach, ensureNpcNations, spawnPirates, tick, cycle, seedWorld, blockaded, threatLevel, pirateUnits };
