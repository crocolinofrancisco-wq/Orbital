/* =====================================================================
 * GESTOR DE BATALLAS EN VIVO (servidor)
 * ---------------------------------------------------------------------
 * Une el simulador compartido (public/shared/battlesim.js) con el mundo:
 *   1. scan():   detecta sistemas donde hay flotas hostiles y crea una batalla
 *   2. step():   avanza cada batalla en tiempo real (0.5 s por paso) y emite
 *                un "frame" a los espectadores (sala socket b:<id>)
 *   3. command(): órdenes del jugador (táctica / objetivo / retirada)
 *   4. finish(): aplica bajas al mundo, recompensas, informe repetible
 *
 * Reglas importantes:
 *   - Las flotas en batalla quedan BLOQUEADAS (f.battle) salvo orden de retirada.
 *   - Si llega otra flota aliada/hostil mientras se pelea, entra como REFUERZO
 *     por el borde de su bando.
 *   - Piratas y criaturas son hostiles a todo el mundo y pelean en el mismo bando.
 *   - Las batallas en curso NO se guardan: si el servidor se reinicia, las
 *     flotas vuelven al estado previo al choque.
 * Se inyecta el contexto desde game.js con attach(ctx) para evitar dependencias circulares.
 * ===================================================================== */
const BS = require('../public/shared/battlesim.js');
const GD = require('../public/shared/gamedata.js');

let X = null;            // contexto (game.js)
const live = {};         // id -> batalla
const lastEnd = {};      // systemId -> timestamp del último combate (enfriamiento)
const BATTLE_SPEED = Number(process.env.BATTLE_SPEED || 1);
const COOLDOWN_MS = 25000;

function attach(ctx) { X = ctx; }

/** Estadísticas mínimas que necesita el simulador (se guardan en el informe para repetir) */
function simStats(s) {
  const r = v => Math.round(v * 10) / 10;
  return { hp: s.hp, speed: r(s.speed), size: s.size, role: s.role, armor: r(s.armor), shield: r(s.shield), pd: r(s.pd), sensors: r(s.sensors), ecm: r(s.ecm),
    hangar: s.hangar || 0, special: s.special || [], cooling: r(s.cooling || 0),
    weapons: s.weapons.map(w => ({ type: w.type, dmgType: w.dmgType, range: w.range, dmg: r(w.dmg), rel: Math.round(w.rel * 100) / 100, antiCapital: w.antiCapital || 1 })) };
}
const isNpc = nid => nid === X.PIRATES || nid === X.MONSTERS;
const engageable = (f, t) => !f.battle && !(f.noEngageUntil && t < f.noEngageUntil);

function fleetGroups(fleets) {
  const w = X.W(), gs = [];
  for (const f of fleets) for (const d in f.units) {
    const s = X.statsOf(d);
    if (!s || s.domain !== 'space' || !(f.units[d] > 0)) continue;
    gs.push({ owner: f.owner, name: w.designs[d].name, hull: s.hull, count: f.units[d], stats: simStats(s), fleetId: f.id, designId: d, monster: f.owner === X.MONSTERS,
      fleetName: f.name });
  }
  return gs;
}
function lairStation(sy) {
  const L = sy.lair;
  return { owner: X.PIRATES, name: 'Guarida pirata', hull: 'estacion', count: 1, station: true, systemLair: true,
    stats: { hp: Math.round(L.hp), speed: 0, size: 30, role: 'line', armor: (90 + 40 * L.level) * GD.NUM_K, shield: (80 + 40 * L.level) * GD.NUM_K, pd: (30 + 15 * L.level) * GD.NUM_K, sensors: 10 * GD.NUM_K, ecm: 0, hangar: 0, special: [],
      weapons: [{ type: 'bat', dmgType: 'cinetico', range: [1, 1, 1], dmg: 70 * L.level * GD.NUM_K, rel: 0.95, antiCapital: 1 }, { type: 'misil', dmgType: 'explosivo', range: [1.2, 0.8, 0.3], dmg: 55 * L.level * GD.NUM_K, rel: 0.9, antiCapital: 1 }] } };
}

/* ---------------------------------------------------------------
 * 1. DETECCIÓN
 * --------------------------------------------------------------- */
function scan(t) {
  const w = X.W();
  const bySys = {};
  for (const f of Object.values(w.fleets)) {
    if (!engageable(f, t)) continue;
    if (!(X.fleetInfo(f).space > 0)) continue;
    (bySys[f.system] = bySys[f.system] || []).push(f);
  }
  for (const sid in bySys) {
    if (battleIn(sid)) continue;
    if (lastEnd[sid] && t - lastEnd[sid] < COOLDOWN_MS) continue;
    startIn(sid, bySys[sid], t);
  }
}
function battleIn(sid) { return Object.values(live).some(b => b.system === sid); }

function startIn(sid, fleets, t) {
  const w = X.W(), sy = w.systems[sid];
  const planets = sy.planets.map(id => w.planets[id]).filter(p => p.owner && p.defenseHp !== 0 && X.planetDefenseGroup(p));
  const lair = sy.lair && sy.lair.hp > 0 ? sy.lair : null;
  const present = new Set([...fleets.map(f => f.owner), ...planets.map(p => p.owner)]);
  if (lair) present.add(X.PIRATES);
  if (present.size < 2) return false;
  const matchups = [];
  const npcSide = [...present].filter(isNpc), others = [...present].filter(x => !isNpc(x));
  if (npcSide.length && others.length) matchups.push({ A: others, B: npcSide, war: null });
  for (const war of Object.values(w.wars)) {
    if (!war.active) continue;
    matchups.push({ A: others.filter(x => war.attackers.includes(x)), B: others.filter(x => war.defenders.includes(x)), war: war.id });
  }
  for (const m of matchups) {
    if (!m.A.length || !m.B.length) continue;
    const fa = fleets.filter(f => m.A.includes(f.owner)), fb = fleets.filter(f => m.B.includes(f.owner));
    if (!fa.length && !fb.length) continue;
    const ga = fleetGroups(fa), gb = fleetGroups(fb);
    for (const p of planets) {
      const g = X.planetDefenseGroup(p); g.owner = p.owner; g.hull = 'planeta';
      if (m.A.includes(p.owner)) ga.push(g); else if (m.B.includes(p.owner)) gb.push(g);
    }
    if (lair && m.B.includes(X.PIRATES)) gb.push(lairStation(sy));
    if (!ga.length || !gb.length) continue;
    if (!ga.some(g => !g.isPlanet && !g.station) && !gb.some(g => !g.isPlanet && !g.station)) continue;
    create(sid, m, ga, gb, fa.concat(fb), t);
    return true;
  }
  return false;
}

function envOf(sy) {
  if (sy.kind === 'blackhole') return 'blackhole';
  if (sy.features && sy.features.includes('nebula')) return 'nebula';
  if (sy.features && sy.features.includes('asteroids')) return 'asteroids';
  return 'none';
}

function create(sid, m, ga, gb, fleets, t) {
  const w = X.W(), sy = w.systems[sid];
  const id = X.uid('b');
  const setup = { seed: (t % 1000003) + Object.keys(live).length, env: envOf(sy), maxTime: GD.RULES.battleMaxSeconds, sides: { A: ga, B: gb } };
  const sim = new BS.BattleSim(setup);
  const b = { id, system: sid, war: m.war, startedAt: t, last: t, acc: 0, sim, nations: { A: m.A.slice(), B: m.B.slice() }, lastGv: sim.gv, cmdAt: 0, ended: false };
  live[id] = b;
  for (const f of fleets) f.battle = id;
  const names = l => l.map(x => (w.nations[x] || {}).name).join(', ');
  X.news(':battle: ¡Batalla en ' + sy.name + '! ' + names(m.A) + ' contra ' + names(m.B), 'war');
  for (const nid of m.A.concat(m.B)) {
    const n = w.nations[nid];
    if (n && !n.npc && !n.bot) X.emit().nation(nid, { type: 'battle', phase: 'start', battleId: id, system: sid, systemName: sy.name });
  }
  X.emit().dirty();
  return b;
}

/* ---------------------------------------------------------------
 * 2. AVANCE EN TIEMPO REAL
 * --------------------------------------------------------------- */
function step(t) {
  for (const id in live) {
    const b = live[id];
    if (b.ended) continue;
    b.acc += (t - b.last) * BATTLE_SPEED; b.last = t;
    let n = 0;
    while (b.acc >= BS.DT * 1000 && n < 8 && !b.sim.over) { b.acc -= BS.DT * 1000; n++; stepOnce(b, t); }
    if (b.sim.over && !b.ended) finish(b, t);
  }
}
function stepOnce(b, t) {
  const sim = b.sim;
  if (sim.tick % 2 === 0) joinReinforcements(b, t);
  if (sim.tick % 10 === 0) autoCommand(b);
  sim.step();
  const snap = sim.snapshot();
  const em = X.emit();
  if (sim.gv !== b.lastGv) { b.lastGv = sim.gv; em.battle(b.id, 'groups', { groups: sim.groupsMeta() }); }
  em.battle(b.id, 'frame', snap);
}

/** Flotas que llegan a un sistema en combate entran como refuerzo del bando al que son afines */
function joinReinforcements(b, t) {
  const w = X.W();
  for (const f of Object.values(w.fleets)) {
    if (f.system !== b.system || !engageable(f, t)) continue;
    if (!(X.fleetInfo(f).space > 0)) continue;
    let side = null;
    if (b.nations.A.includes(f.owner)) side = 'A'; else if (b.nations.B.includes(f.owner)) side = 'B';
    else {
      const hostA = b.nations.A.some(n => X.atWar(f.owner, n)), hostB = b.nations.B.some(n => X.atWar(f.owner, n));
      if (hostA && !hostB) side = 'B'; else if (hostB && !hostA) side = 'A';
      else if (isNpc(f.owner)) side = 'B';
      else if (b.nations.B.every(isNpc) && !hostA) side = 'A';   // contra criaturas y piratas todos ayudan
    }
    if (!side) continue;
    const gs = fleetGroups([f]);
    if (!gs.length) continue;
    f.battle = b.id;
    if (!b.nations[side].includes(f.owner)) b.nations[side].push(f.owner);
    b.sim.addReinforcements(side, gs, 5);
    X.notify(f.owner, ':fleet: ' + f.name + ' entra en la batalla de ' + w.systems[b.system].name, 'warn');
    if (!w.nations[f.owner].npc && !w.nations[f.owner].bot) X.emit().nation(f.owner, { type: 'battle', phase: 'start', battleId: b.id, system: b.system, systemName: w.systems[b.system].name });
  }
}

/** Piloto automático para NPC y bots (los humanos mandan con command()) */
function autoCommand(b) {
  const sim = b.sim, w = X.W();
  for (const side of ['A', 'B']) {
    const mine = sim.hpFrac(side), theirs = sim.hpFrac(side === 'A' ? 'B' : 'A');
    const ratio = theirs > 0 ? mine / theirs : 9;
    for (const g of sim.groups) {
      if (g.side !== side || g.isPlanet || g.station) continue;
      const n = w.nations[g.owner];
      if (!n || (!n.npc && !n.bot)) continue;
      if (g.monster) continue;                             // las criaturas luchan hasta el final
      if (n.id === X.PIRATES) { if (ratio < 0.22 && g.tactic !== 'retreat') sim.order(g.gid, { tactic: 'retreat' }); continue; }
      // bots: se retiran si van perdiendo claramente; si no, atacan y concentran fuego en el enemigo más peligroso
      const th = (n.ai && n.ai.retreatAt) || 0.35;
      if (mine < th && ratio < 0.6 && g.tactic !== 'retreat') { sim.order(g.gid, { tactic: 'retreat' }); continue; }
      if (g.tactic === 'retreat' && ratio > 1.1) sim.order(g.gid, { tactic: 'attack' });
    }
  }
}

/* ---------------------------------------------------------------
 * 3. ÓRDENES DEL JUGADOR
 * o = { fleetId?, gid?, all?, tactic?, focus? }
 * --------------------------------------------------------------- */
function command(nid, battleId, o) {
  const b = live[battleId];
  if (!b || b.ended) return { ok: false, error: 'La batalla ya terminó' };
  const sim = b.sim;
  let n = 0;
  for (const g of sim.groups) {
    if (g.owner !== nid || g.isPlanet || g.station) continue;
    if (!o.all && o.gid !== g.gid && !(o.fleetId && o.fleetId === g.fleetId)) continue;
    const ord = {}; if (o.tactic) ord.tactic = o.tactic; if ('focus' in o) ord.focus = o.focus;
    if (sim.order(g.gid, ord)) n++;
  }
  if (n) { const nat = X.W().nations[nid]; nat.flags = nat.flags || {}; nat.flags.commanded = true; }
  return n ? { ok: true, n } : { ok: false, error: 'No mandas ninguna unidad ahí' };
}

/* ---------------------------------------------------------------
 * 4. FIN DE BATALLA
 * --------------------------------------------------------------- */
function retreatSystem(f) {
  const w = X.W(), sy = w.systems[f.system];
  const bad = sid => Object.values(w.fleets).some(o => o.system === sid && isNpc(o.owner));
  if (f.prev && sy.links.includes(f.prev) && !bad(f.prev)) return f.prev;
  const opts = sy.links.filter(l => !bad(l) && w.systems[l].portal !== f.system && sy.portal !== l);
  return opts[0] || null;
}

function finish(b, t) {
  b.ended = true;
  const w = X.W(), sim = b.sim, sy = w.systems[b.system];
  const res = sim.result();
  // Si se agotó el tiempo, el bando que no gana (o ambos si hay empate) rompe contacto y se retira
  if (res.timeout) for (const side of ['A', 'B']) {
    if (res.winner === side) continue;
    for (const g of res[side]) if (!g.isPlanet && !g.station && !g.monster) g.escaped = g.end;
  }
  const touched = new Set();
  const escapes = [];
  for (const side of ['A', 'B']) for (const g of res[side]) {
    if (g.isPlanet) {
      const p = w.planets[g.planetId];
      if (p) { p.defenseHp = g.end > 0 ? 1 : 0; if (!g.end) p.defenseDownUntil = t + X.ms(5 * 60000); }
      continue;
    }
    if (g.station) {
      const e = sim.groups[g.gid].ents[0];
      if (sy.lair) { sy.lair.hp = e && !e.dead ? Math.max(1, Math.round(e.hp)) : 0; if (sy.lair.hp === 0) sy.lair.destroyedAt = t; }
      continue;
    }
    const f = w.fleets[g.fleetId]; if (!f) continue;
    touched.add(f.id);
    const alive = g.end - g.escaped;
    if (alive > 0) f.units[g.designId] = alive; else delete f.units[g.designId];
    if (g.escaped > 0) escapes.push({ f, designId: g.designId, n: g.escaped });
  }
  // Retirada: las unidades que escaparon forman una flota nueva que salta al sistema vecino
  const made = {};
  for (const e of escapes) {
    const dest = retreatSystem(e.f);
    let nf = made[e.f.id];
    if (!nf) {
      nf = made[e.f.id] = X.makeFleet(e.f.owner, e.f.system, 'Retirada de ' + e.f.name.slice(0, 16));
      nf.noEngageUntil = t + X.ms(120000);
      if (dest) { nf.path = [dest]; nf.jumpStartAt = t; nf.nextJumpAt = t + X.jumpMs(w.nations[e.f.owner], 5, e.f.system, dest); nf.prev = e.f.system; }
    }
    nf.units[e.designId] = (nf.units[e.designId] || 0) + e.n;
    X.notify(e.f.owner, ':fleet: Retirada exitosa de ' + sy.name + (dest ? '. La flota salta a ' + w.systems[dest].name : ''), 'warn');
  }
  // Tropas sin transporte suficiente mueren con sus naves
  for (const id of touched) {
    const f = w.fleets[id]; if (!f) continue;
    f.battle = null; delete f.battle;
    const info = X.fleetInfo(f);
    if (info.space > 0 && info.groundSize > info.capacity) {
      for (const d of Object.keys(f.units)) {
        const s = X.statsOf(d);
        if (!s || s.domain !== 'ground') continue;
        while (f.units[d] > 0 && X.fleetInfo(f).groundSize > X.fleetInfo(f).capacity) f.units[d]--;
        if (!f.units[d]) delete f.units[d];
      }
      X.notify(f.owner, ':skull: Perdiste tropas: sus transportes fueron destruidos', 'bad');
    }
    if (!Object.keys(f.units).length) delete w.fleets[id];
  }
  for (const f of Object.values(w.fleets)) if (f.battle === b.id) { f.battle = null; delete f.battle; }
  lastEnd[b.system] = t;

  // Recompensas por NPC derrotados y botin por barcos rendidos
  const loot = rewards(b, res, sy);
  salvage(b, res, sy, loot);

  // Informe repetible: simSetup + órdenes + refuerzos bastan para re-simular la batalla idéntica en el cliente
  const id = X.uid('r');
  const attackers = b.nations.A.slice(), defenders = b.nations.B.slice();
  w.reports[id] = { id, t, kind: 'space', system: b.system, war: b.war, attackers, defenders, winner: res.winner, result: res, env: sim.env,
    simSetup: sim.setup, orders: sim.orderLog, reinf: sim.reinfLog, loot };
  const names = l => l.map(x => (w.nations[x] || {}).name).join(', ');
  const verdict = res.winner === 'A' ? 'gana ' + names(attackers) : res.winner === 'B' ? 'gana ' + names(defenders) : 'sin vencedor';
  X.news(':battle: Batalla de ' + sy.name + ' (' + res.duration + ' s): ' + names(attackers) + ' vs ' + names(defenders) + ' → ' + verdict, 'war');
  for (const nid of attackers.concat(defenders)) {
    const n = w.nations[nid]; if (!n) continue;
    const won = (res.winner === 'A' && attackers.includes(nid)) || (res.winner === 'B' && defenders.includes(nid));
    if (won) { n.flags = n.flags || {}; n.flags.battleWon = true; }
    if (!n.npc && !n.bot) X.emit().nation(nid, { type: 'battle', phase: 'end', battleId: b.id, reportId: id, won, draw: res.winner === 'draw' });
  }
  X.emit().battle(b.id, 'over', { reportId: id, result: res, loot });
  X.trimReports();
  delete live[b.id];
  X.emit().dirty();
}

/** Reparte botín/recompensa entre quienes derrotaron a piratas, criaturas o guaridas */
function rewards(b, res, sy) {
  const w = X.W();
  const out = { credits: 0, resources: {}, research: 0, what: [] };
  for (const side of ['A', 'B']) {
    const foe = side === 'A' ? 'B' : 'A';
    const dealers = res[foe].filter(g => !isNpc(g.owner) && g.dealt > 0);
    const npcGroups = res[side].filter(g => isNpc(g.owner));
    if (!npcGroups.length || !dealers.length) continue;
    let credits = 0, research = 0; const resources = {};
    for (const g of npcGroups) {
      const lost = g.start - g.end;
      if (g.station) {
        if (g.end === 0) { const L = sy.lair; credits += 22000 * L.level * GD.NUM_K; resources.cristales = (resources.cristales || 0) + 40 * L.level * GD.NUM_K; resources.compuestos = (resources.compuestos || 0) + 60 * L.level * GD.NUM_K; out.what.push('guarida'); X.news(':skull: ¡La guarida pirata de ' + sy.name + ' fue destruida!', 'war'); }
        continue;
      }
      if (lost <= 0) continue;
      const H = GD.HULLS[g.hull];
      if (H && H.bounty) {
        credits += H.bounty.credits * lost; research += (H.bounty.research || 0) * lost;
        for (const r in H.bounty.resources) resources[r] = (resources[r] || 0) + H.bounty.resources[r] * lost;
        if (g.monster || g.owner === X.MONSTERS) { out.what.push(H.name); for (const d of dealers) { const nn = w.nations[d.owner]; if (nn) { nn.flags = nn.flags || {}; nn.flags.monsterKill = true; } } if (lost >= 1 && H.role === 'monster') X.news(':trophy: ¡' + H.name + ' abatido en ' + sy.name + '!', 'victory'); }
      } else {
        const s = X.statsOf(g.designId);
        credits += lost * ((s && s.unitCost.credits) || 500 * GD.NUM_K) * 0.6;
      }
    }
    if (!credits && !research && !Object.keys(resources).length) continue;
    const total = dealers.reduce((a, g) => a + g.dealt, 0) || 1;
    const byNation = {};
    for (const g of dealers) byNation[g.owner] = (byNation[g.owner] || 0) + g.dealt / total;
    for (const nid in byNation) {
      const n = w.nations[nid]; if (!n) continue;
      const k = byNation[nid], c = Math.round(credits * k), rs = Math.round(research * k);
      n.credits += c; n.research += rs;
      const parts = ['₡' + c];
      for (const r in resources) { const v = Math.round(resources[r] * k); if (v) { n.resources[r] = (n.resources[r] || 0) + v; parts.push(GD.RESOURCES[r].icon + v); } }
      if (rs) parts.push(':research: ' + rs);
      n.flags = n.flags || {}; n.flags.pirateKill = true;
      X.notify(nid, ':credits: Botín de batalla: ' + parts.join(' '), 'good');
    }
    out.credits += Math.round(credits); out.research += Math.round(research);
    for (const r in resources) out.resources[r] = (out.resources[r] || 0) + Math.round(resources[r]);
  }
  return out;
}

/** Barcos que arriaron bandera: se pierden para su dueno y el vencedor se queda con parte de su valor (50 %) */
function salvage(b, res, sy, loot) {
  const w = X.W();
  for (const side of ['A', 'B']) {
    const foe = side === 'A' ? 'B' : 'A';
    const dealers = res[foe].filter(g => !isNpc(g.owner) && g.dealt > 0);
    let credits = 0, ships = 0;
    for (const g of res[side]) {
      if (!g.surrendered || g.isPlanet || g.station) continue;
      const s = X.statsOf(g.designId);
      credits += g.surrendered * ((s && s.unitCost.credits) || 500 * GD.NUM_K) * 0.5; ships += g.surrendered;
    }
    if (!ships) continue;
    loot.surrendered = (loot.surrendered || 0) + ships;
    if (!dealers.length) continue;
    const total = dealers.reduce((a, g) => a + g.dealt, 0) || 1, by = {};
    for (const g of dealers) by[g.owner] = (by[g.owner] || 0) + g.dealt / total;
    for (const nid in by) {
      const n = w.nations[nid]; if (!n) continue;
      const c = Math.round(credits * by[nid]);
      n.credits += c; loot.credits = (loot.credits || 0) + c;
      X.notify(nid, ':credits: ' + ships + ' naves enemigas se rindieron en ' + sy.name + ': botín ₡' + c, 'good');
    }
  }
}

/* ---------------------------------------------------------------
 * 5. CONSULTAS (para la UI)
 * --------------------------------------------------------------- */
function summary(b) {
  const w = X.W();
  return { id: b.id, system: b.system, t: b.sim.t, startedAt: b.startedAt, A: b.nations.A, B: b.nations.B, hp: { A: Math.round(b.sim.hpFrac('A') * 100), B: Math.round(b.sim.hpFrac('B') * 100) },
    owners: [...new Set(b.sim.groups.map(g => g.owner))], env: b.sim.env };
}
function list() { return Object.values(live).map(summary); }
function get(id) { return live[id] || null; }
/** Datos para empezar a ver una batalla en vivo */
function watch(id) {
  const b = live[id]; if (!b) return null;
  return { id, system: b.system, meta: b.sim.meta(), frame: b.sim.snapshot(), nations: b.nations };
}
function inBattle(f) { return !!(f.battle && live[f.battle]); }
function reset() { for (const k in live) delete live[k]; for (const k in lastEnd) delete lastEnd[k]; }

module.exports = { attach, scan, step, command, list, get, watch, inBattle, reset, live, isNpc, simStats, envOf };
