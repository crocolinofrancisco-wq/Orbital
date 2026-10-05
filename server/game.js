/* =====================================================================
 * LÓGICA DEL JUEGO (autoritativa en el servidor)
 * ---------------------------------------------------------------------
 * Todas las acciones del cliente llegan a `handleAction(nationId, type, data)`.
 * El cliente NUNCA calcula resultados: solo pide acciones y dibuja el estado.
 * Esto evita trampas (importante en un juego social/competitivo).
 *
 * Secciones:
 *   1. Utilidades
 *   2. Creación de nación
 *   3. Ciclo económico (el "PIB diario" del original)
 *   4. TYCOON: edificios, impuestos, mercado
 *   5. PROYECTOS: investigación (con especialidades), componentes, diseños, producción
 *   6. BÉLICO: flotas, movimiento, batallas, invasiones
 *   7. DIPLOMACIA: guerras, paz, alianzas, ofertas
 *   8. Bucle de juego (tick)
 * ===================================================================== */
const GD = require('../public/shared/gamedata.js');
const S = require('./state.js');
const { findPath, jumpFactor } = require('./galaxy.js');
const { resolveGroundBattle } = require('./combat.js');
const Battles = require('./battles.js');
const NPC = require('./npcs.js');
const Season = require('./season.js');
const AI = require('./ai.js');
const Ground = require('./ground.js');

/** Velocidad del juego (solo para pruebas): GAME_SPEED=60 hace que todo vaya 60 veces más rápido */
const TS = Number(process.env.GAME_SPEED || 1);
const TICK_SECONDS = Number(process.env.TICK_SECONDS || GD.RULES.cycleSeconds / TS); // duración de un ciclo económico (1 h por defecto)
const PIRATES = NPC.PIRATES, MONSTERS = NPC.MONSTERS;
let emit = { nation() {}, news() {}, dirty() {}, battle() {}, chat() {} };            // inyectado por index.js
function setEmitter(e) { emit = Object.assign({ nation() {}, news() {}, dirty() {}, battle() {}, chat() {} }, e); }
/** Escala un tiempo en ms según GAME_SPEED */
const ms = v => v / TS;

/* ---------------------------------------------------------------
 * 1. UTILIDADES
 * --------------------------------------------------------------- */
const W = () => S.get();
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const now = () => Date.now();
class GameError extends Error {}
function fail(msg) { throw new GameError(msg); }

function canAfford(n, cost, mult) {
  mult = mult || 1;
  for (const k in cost) {
    const need = cost[k] * mult;
    if (k === 'credits') { if (n.credits < need) return false; }
    else if ((n.resources[k] || 0) < need) return false;
  }
  return true;
}
function pay(n, cost, mult) {
  mult = mult || 1;
  if (!canAfford(n, cost, mult)) fail('Recursos insuficientes: ' + costText(cost, mult));
  for (const k in cost) {
    if (k === 'credits') n.credits -= cost[k] * mult;
    else n.resources[k] -= cost[k] * mult;
  }
}
function costText(cost, mult) {
  mult = mult || 1;
  return Object.keys(cost).map(k => (k === 'credits' ? '₡' : (GD.RESOURCES[k] ? GD.RESOURCES[k].icon : k)) + ' ' + Math.ceil(cost[k] * mult)).join(', ');
}
function notify(nationId, text, kind) {
  const n = W().nations[nationId];
  if (!n) return;
  n.inbox.unshift({ t: now(), text, kind: kind || 'info' });
  n.inbox.length = Math.min(n.inbox.length, 60);
  emit.nation(nationId, { type: 'notify', text, kind });
}
function news(text, kind) {
  const w = W();
  w.news.unshift({ t: now(), text, kind: kind || 'info' });
  w.news.length = Math.min(w.news.length, 80);
  emit.news(text, kind);
}
function compLookup(id) { return W().components[id]; }
function statsOf(designId) {
  const d = W().designs[designId];
  return d ? GD.designStats(d, compLookup) : null;
}
function nationTechBonus(n, key) {
  let v = 0;
  for (const tid of n.techs) { const t = GD.techById(tid); if (t && t.unlocks.bonus && t.unlocks.bonus[key]) v += t.unlocks.bonus[key]; }
  return v;
}
function hasUnlocked(n, kind, id) {
  return n.techs.some(tid => { const t = GD.techById(tid); return t && t.unlocks[kind] === id; });
}
function planetsOf(nid) { return Object.values(W().planets).filter(p => p.owner === nid); }
function fleetsOf(nid) { return Object.values(W().fleets).filter(f => f.owner === nid); }

/* ---------------------------------------------------------------
 * 2. CREACIÓN DE NACIÓN
 * --------------------------------------------------------------- */
function createNation(userId, data, opts) {
  opts = opts || {};
  const w = W();
  const name = String(data.name || '').trim().slice(0, 24);
  if (name.length < 3) fail('El nombre debe tener al menos 3 letras');
  if (Object.values(w.nations).some(n => n.alive && n.name.toLowerCase() === name.toLowerCase())) fail('Ese nombre ya existe');
  if (w.season.status !== 'running') fail('La temporada terminó. Espera a la siguiente.');
  const flag = sanitizeFlag(data.flag);
  // Hay un tope de naciones: si hace falta sitio para un humano, se retira la IA más débil
  if (!opts.bot) makeRoomForHuman();
  // Planeta capital: el pedido si es libre; si no, uno libre lejos de otras naciones y de objetos peligrosos
  const special = sid => { const f = w.systems[sid].features || []; return w.systems[sid].kind !== 'star' || f.some(x => x === 'lair' || x === 'ruins' || x === 'asteroids' || x === 'nebula' || x === 'hub'); };
  let capital = data.planetId && w.planets[data.planetId] && !w.planets[data.planetId].owner ? w.planets[data.planetId] : null;
  if (!capital) {
    const free = Object.values(w.planets).filter(p => !p.owner && p.biome !== 'gaseoso' && !p.belt && !special(p.system));
    const occupiedSystems = new Set(Object.values(w.planets).filter(p => p.owner).map(p => p.system));
    const good = free.filter(p => !occupiedSystems.has(p.system) && !w.systems[p.system].links.some(l => occupiedSystems.has(l)));
    const ok2 = free.filter(p => !occupiedSystems.has(p.system));
    if (!ok2.length && !free.length) fail('No quedan planetas libres');
    const pool = good.length ? good : (ok2.length ? ok2 : free);
    // los candidatos más habitables, con algo de azar para que no todos caigan en el mismo sitio
    pool.sort((a, b) => b.popCap - a.popCap);
    capital = pool[Math.floor(Math.random() * Math.min(5, pool.length))];
  }
  if (capital.biome === 'gaseoso') fail('No se puede fundar una capital en un gigante gaseoso');
  if (capital.belt) fail('No se puede fundar una capital en un cinturón de asteroides');
  const id = S.uid('n');
  const n = {
    id, userId, name, flag, motto: String(data.motto || '').slice(0, 60),
    alive: true, createdAt: now(), capital: capital.id,
    credits: GD.RULES.startCredits, research: GD.RULES.startResearch,
    resources: Object.assign({}, GD.RULES.startResources),
    tax: 0.25, stats: { unemployment: 0.1, evasion: 0.1, crime: 0.1, poverty: 0.2, popularity: 0.6, stability: 0.7 },
    techs: GD.TECHS.filter(t => t.cost === 0).map(t => t.id),
    spec: [],      // especialidades de investigacion elegidas (ver GD.TECH_BRANCHES y actChooseSpec)
    alliance: null, inbox: [], lastIncome: null, betrayals: 0,
    flags: {}      // logros/objetivos: pirateKill, annexed, invaded, battleWon...
  };
  if (opts.bot) n.bot = true;
  w.nations[id] = n;
  if (!opts.bot) w.users[userId].nationId = id;
  capital.owner = id;
  capital.pop = Math.max(capital.pop, GD.RULES.startPopulation);
  capital.popCap = Math.max(capital.popCap, GD.RULES.startPopulation * 1.6);
  capital.stability = 0.8;
  capital.buildings = { extractor: 1, fabrica: 1, astillero: 1, cuartel: 1, laboratorio: 1 };
  // Zona segura: las patrullas pirata se retiran del sistema natal y de sus vecinos
  const safe = new Set([capital.system].concat(w.systems[capital.system].links));
  for (const pf of Object.values(w.fleets)) if (pf.owner === PIRATES && pf.patrol && safe.has(pf.system)) delete w.fleets[pf.id];
  // Flota inicial
  const f = makeFleet(id, capital.system, 'Flota Nacional');
  f.units = { bd_corb: 2, bd_caza: 6, bd_trans: 1 };
  makeFleet(id, capital.system, 'Guarnición ' + capital.name).units = { bd_inf: 10 };
  if (!opts.silent) news(':star: Nace una nueva nación: ' + name + ' en ' + capital.name + (opts.bot ? ' (IA)' : ''), 'nation');
  if (!opts.bot) notify(id, '¡Bienvenido, líder de ' + name + '! Tu capital es ' + capital.name + '. Elige tus 2 especialidades en Proyectos (no puedes investigarlo todo: lo demás se compra a otras naciones). Tienes ' + GD.RULES.protectionHours + ' h de protección de novatos: nadie puede declararte la guerra. Construye, investiga y forja alianzas.', 'good');
  return n;
}
/** Si se alcanzó el tope de naciones, retira la IA más débil (sus planetas quedan independientes) */
function makeRoomForHuman() {
  const w = W();
  const alive = Object.values(w.nations).filter(n => n.alive && !n.npc);
  if (alive.length < GD.RULES.maxNations) return;
  const bots = alive.filter(n => n.bot).map(n => ({ n, pl: planetsOf(n.id).length })).sort((a, b) => a.pl - b.pl);
  if (!bots.length) fail('La galaxia está llena (' + GD.RULES.maxNations + ' naciones)');
  const b = bots[0].n;
  b.alive = false;
  for (const p of planetsOf(b.id)) { p.owner = null; p.buildings = {}; }
  for (const f of fleetsOf(b.id)) delete w.fleets[f.id];
  for (const m of Object.values(w.market)) if (m.seller === b.id) delete w.market[m.id];
  if (b.alliance) leaveAlliance(b);
  for (const war of Object.values(w.wars)) if (war.active && (war.attackers.includes(b.id) || war.defenders.includes(b.id))) leaveWarSide(b, war);
  news(':robot: ' + b.name + ' (IA) abandonó la galaxia para dejar sitio a un nuevo jugador.', 'nation');
}
function sanitizeFlag(f) {
  f = f || {};
  const hex = c => /^#[0-9a-fA-F]{6}$/.test(c) ? c : '#888888';
  return {
    layout: GD.FLAG_LAYOUTS.includes(f.layout) ? f.layout : 'horizontal',
    emblem: GD.FLAG_EMBLEMS.includes(f.emblem) ? f.emblem : 'ninguno',
    colors: [0, 1, 2].map(i => hex((f.colors || [])[i]))
  };
}

/* ---------------------------------------------------------------
 * 3. CICLO ECONÓMICO
 * Equivale al "PIB que recibías todos los días". Fórmulas en docs/BALANCE.md
 * --------------------------------------------------------------- */
function computeEconomy(n) {
  const planets = planetsOf(n.id);
  const gdpBonus = nationTechBonus(n, 'gdp');
  const extrBonus = nationTechBonus(n, 'extraction');
  const resBonus = nationTechBonus(n, 'research');
  let pop = 0, gdp = 0, jobs = 0, research = 2 * GD.NUM_K, buildUpkeep = 0;
  const prod = {};
  for (const p of planets) {
    pop += p.pop;
    let pGdpMult = 1 + gdpBonus + (W().systems[p.system].hub ? 0.25 : 0);   // sistema clave de la region
    for (const b in p.buildings) {
      const B = GD.BUILDINGS[b], c = p.buildings[b];
      if (!B || !c) continue;
      buildUpkeep += B.upkeep * c;
      if (B.gdp) pGdpMult += B.gdp * c;
      if (B.jobs) jobs += B.jobs * c * p.pop;
      if (B.research) research += B.research * c;
      if (b === 'extractor') prod[p.deposit] = (prod[p.deposit] || 0) + B.produces * c * p.depositRich * (1 + extrBonus);
      if (B.produceRes) prod[B.produceRes] = (prod[B.produceRes] || 0) + B.produces * c;
    }
    // Bloqueo: piratas, criaturas o una flota enemiga en órbita paralizan el PIB del planeta (ver server/npcs.js y server/ground.js)
    gdp += (NPC.blockaded(p.system) || Ground.blockaderOf(p)) ? 0 : p.pop * GD.RULES.gdpPerMillion * pGdpMult * (0.6 + p.stability * 0.4);
  }
  research *= (1 + resBonus);
  const st = n.stats;
  const unemployment = clamp(0.16 - (pop > 0 ? jobs / pop : 0), 0.02, 0.4);
  const evasion = clamp(0.04 + n.tax * 0.3 + st.crime * 0.2 + nationTechBonus(n, 'evasion'), 0.01, 0.6);
  const poverty = clamp(0.05 + unemployment * 1.2 + n.tax * 0.4, 0, 0.9);
  const crime = clamp(poverty * 0.45 + (1 - st.stability) * 0.25, 0, 0.9);
  const popularity = clamp(1.05 - n.tax * 1.3 - unemployment - crime * 0.4 - n.betrayals * 0.02, 0, 1);
  const stability = clamp(st.stability + (popularity - st.stability) * 0.3 + nationTechBonus(n, 'stability'), 0.05, 1);
  const taxIncome = gdp * (1 - unemployment) * n.tax * (1 - evasion);
  let unitUpkeep = 0;
  for (const f of fleetsOf(n.id)) for (const d in f.units) { const s = statsOf(d); if (s) unitUpkeep += s.upkeep * f.units[d]; }
  return {
    pop, gdp: Math.round(gdp), taxIncome: Math.round(taxIncome), buildUpkeep: Math.round(buildUpkeep), unitUpkeep: Math.round(unitUpkeep),
    net: Math.round(taxIncome - buildUpkeep - unitUpkeep), research: Math.round(research * 10) / 10, prod,
    stats: { unemployment, evasion, poverty, crime, popularity, stability }
  };
}

function runCycle() {
  const w = W();
  w.cycle++;
  NPC.cycle();
  for (const n of Object.values(w.nations)) {
    if (!n.alive || n.npc) continue;
    const e = computeEconomy(n);
    n.credits += e.net;
    n.research += e.research;
    for (const r in e.prod) n.resources[r] = (n.resources[r] || 0) + Math.round(e.prod[r]);
    n.stats = e.stats;
    n.lastIncome = { cycle: w.cycle, net: e.net, tax: e.taxIncome, upkeep: e.buildUpkeep + e.unitUpkeep, research: e.research, prod: e.prod };
    // Población y estabilidad por planeta
    for (const p of planetsOf(n.id)) {
      const cap = p.popCap * (1 + (p.buildings.vivienda || 0) * GD.BUILDINGS.vivienda.popCap);
      const growth = 0.03 * e.stats.stability * (1 - p.pop / cap);
      p.pop = Math.round(clamp(p.pop * (1 + growth), 0.1 * GD.NUM_K, cap) * 100) / 100;
      p.stability = clamp(p.stability + (e.stats.stability - p.stability) * 0.25, 0.05, 1);
      if (Ground.blockaderOf(p)) { p.stability = clamp(p.stability - 0.05, 0.05, 1); notify(n.id, ':alert: ' + p.name + ' está bloqueado por una flota enemiga: sin PIB y con la estabilidad cayendo. ¡Rompe el bloqueo!', 'bad'); }
    }
    // Colapso del gobierno: las colonias se rebelan (pasan a ser planetas independientes)
    if (n.govFallen) {
      if (now() > n.govFallen.until) n.govFallen = null;
      else for (const p of planetsOf(n.id)) if (Math.random() < GD.RULES.govCollapseChance && planetsOf(n.id).length > 1) {
        p.owner = null; p.buildings = {}; p.stability = 0.3;
        notify(n.id, ':alert: ¡' + p.name + ' se rebeló y se declaró independiente!', 'bad');
        news(':alert: ' + p.name + ' se independizó de ' + n.name, 'war');
      }
    }
    // Bancarrota: si los créditos son negativos, cae la estabilidad
    if (n.credits < 0) { n.stats.stability = clamp(n.stats.stability - 0.08, 0.05, 1); notify(n.id, ':warn: ¡Tesoro en negativo! La estabilidad cae. Baja gastos o sube impuestos.', 'bad'); }
    if (!n.bot) emit.nation(n.id, { type: 'cycle', text: 'Ciclo ' + w.cycle + ': ' + (e.net >= 0 ? '+' : '') + e.net.toLocaleString('es') + ' ₡' });
  }
  // Planetas independientes crecen lento
  for (const p of Object.values(w.planets)) if (!p.owner) p.pop = Math.round(Math.min(p.popCap, p.pop * 1.01) * 100) / 100;
  // El Consorcio ajusta precios hacia su valor base (recupera 10% por ciclo)
  const base = { aleaciones: 40, energia: 35, helio3: 50, cristales: 90, exoticos: 160, compuestos: 70 };
  for (const r in w.npcPrices) w.npcPrices[r] = Math.round(w.npcPrices[r] + (base[r] - w.npcPrices[r]) * 0.1);
  w.nextCycleAt = now() + TICK_SECONDS * 1000;
  Season.check();
  emit.dirty();
}

/* ---------------------------------------------------------------
 * 4. TYCOON
 * --------------------------------------------------------------- */
function actBuild(n, { planetId, building }) {
  const p = W().planets[planetId];
  const B = GD.BUILDINGS[building];
  if (!p || p.owner !== n.id) fail('Ese planeta no es tuyo');
  if (!B) fail('Edificio inválido');
  if (B.requiresTech && !n.techs.includes(B.requiresTech)) fail('Necesitas investigar ' + GD.techById(B.requiresTech).name);
  const have = p.buildings[building] || 0;
  if (B.max && have >= B.max) fail('Máximo ' + B.max + ' por planeta');
  const total = Object.values(p.buildings).reduce((a, b) => a + b, 0);
  const slots = p.size * 4 + 2;
  if (total >= slots) fail('Planeta lleno (' + slots + ' espacios)');
  if (p.belt && !['extractor', 'planta', 'bateria'].includes(building)) fail('En un cinturón de asteroides solo caben extractores, plantas y baterías');
  const maxExtr = p.belt ? 5 : p.size * 2;
  if (building === 'extractor' && have >= maxExtr) fail('Máximo ' + maxExtr + ' extractores en este planeta');
  // El coste sube un 15% por cada edificio igual ya construido
  pay(n, B.cost, Math.pow(1.15, have));
  p.buildings[building] = have + 1;
  return { ok: true, msg: B.icon + ' ' + B.name + ' construido en ' + p.name };
}
function actDemolish(n, { planetId, building }) {
  const p = W().planets[planetId];
  if (!p || p.owner !== n.id || !p.buildings[building]) fail('Nada que demoler');
  p.buildings[building]--;
  if (!p.buildings[building]) delete p.buildings[building];
  return { ok: true, msg: 'Demolido' };
}
function actSetTax(n, { tax }) {
  n.tax = clamp(Number(tax) || 0, 0, GD.RULES.maxTax);
  return { ok: true };
}
function actRenameCapital(n, { planetId }) {
  const p = W().planets[planetId];
  if (!p || p.owner !== n.id) fail('Ese planeta no es tuyo');
  n.capital = p.id;
  if (n.govFallen) { n.govFallen = null; notify(n.id, ':ok: Gobierno restablecido en ' + p.name + '. Las colonias vuelven a estar en calma.', 'good'); }
  return { ok: true, msg: 'Nueva capital: ' + p.name };
}
function actAnnex(n, { planetId }) {
  const w = W();
  const p = w.planets[planetId];
  if (!p || p.owner) fail('Ese planeta no está disponible');
  const present = planetsOf(n.id).some(q => q.system === p.system) || fleetsOf(n.id).some(f => f.system === p.system && !f.path);
  if (!present) fail('Necesitas una flota en el sistema o un planeta propio en él');
  if (Object.values(w.fleets).some(f => f.system === p.system && (f.owner === PIRATES || f.owner === MONSTERS))) fail('Hay piratas o criaturas en el sistema: destrúyelos primero');
  const cost = { credits: GD.annexCost(p, planetsOf(n.id).length) };
  pay(n, cost);
  p.owner = n.id; p.stability = 0.5;
  n.flags = n.flags || {}; n.flags.annexed = true;
  news(':planet: ' + n.name + ' anexó pacíficamente ' + p.name, 'nation');
  return { ok: true, msg: p.name + ' se unió a tu nación' };
}

/** Mercado del Consorcio (NPC): compra/venta de recursos con precio dinámico */
function actNpcTrade(n, { resource, amount, side }) {
  const w = W();
  amount = Math.floor(Number(amount));
  if (!GD.RESOURCES[resource] || !(amount > 0) || amount > 10000 * GD.NUM_K) fail('Cantidad inválida');
  const price = w.npcPrices[resource];
  if (side === 'buy') {
    const total = Math.round(price * 1.1 * amount);
    pay(n, { credits: total });
    n.resources[resource] = (n.resources[resource] || 0) + amount;
    w.npcPrices[resource] = Math.round(price * (1 + amount / (4000 * GD.NUM_K)));
    return { ok: true, msg: 'Compraste ' + amount + ' ' + GD.RESOURCES[resource].name + ' por ₡' + total };
  } else {
    if ((n.resources[resource] || 0) < amount) fail('No tienes tanto');
    const total = Math.round(price * 0.8 * amount);
    n.resources[resource] -= amount; n.credits += total;
    w.npcPrices[resource] = Math.max(5, Math.round(price * (1 - amount / (4000 * GD.NUM_K))));
    return { ok: true, msg: 'Vendiste ' + amount + ' ' + GD.RESOURCES[resource].name + ' por ₡' + total };
  }
}

/** Mercado entre jugadores: recursos y UNIDADES YA FABRICADAS (no hay licencias: fabrica el otro y te vende) */
function actMarketPost(n, { kind, resource, amount, price, fleetId, designId, count }) {
  const w = W();
  price = Math.round(Number(price));
  if (!(price > 0) || price > 1e9) fail('Precio inválido');
  const id = S.uid('m');
  if (kind === 'resource') {
    amount = Math.floor(Number(amount));
    if (!GD.RESOURCES[resource] || !(amount > 0) || (n.resources[resource] || 0) < amount) fail('No tienes ese recurso');
    n.resources[resource] -= amount; // queda en depósito (escrow)
    w.market[id] = { id, kind, seller: n.id, resource, amount, price, t: now() };
  } else if (kind === 'units') {
    const f = w.fleets[fleetId], d = w.designs[designId];
    count = Math.floor(Number(count));
    if (!f || f.owner !== n.id || f.path || f.battle) fail('La flota debe estar quieta y fuera de combate');
    if (!d || d.status !== 'ready' || d.npc) fail('Diseño inválido');
    if (!(count > 0) || (f.units[designId] || 0) < count) fail('No tienes tantas unidades en esa flota');
    f.units[designId] -= count; if (!f.units[designId]) delete f.units[designId];
    if (!Object.keys(f.units).length) delete w.fleets[f.id];
    // el precio es TOTAL por el lote; las unidades quedan en depósito hasta que alguien compre (o retires la oferta)
    w.market[id] = { id, kind, seller: n.id, designId, count, price, system: f.system, t: now() };
    n.flags = n.flags || {}; n.flags.soldUnits = true;
  } else fail('Tipo inválido');
  news(':market: ' + n.name + ' publicó una oferta en el mercado', 'trade');
  return { ok: true, msg: 'Publicado en el mercado' };
}
/** Tiempo de entrega de una compra de unidades: suma de los saltos entre el sistema del vendedor y el planeta destino */
function deliveryMs(n, from, to) {
  const w = W();
  const path = findPath(w.systems, from, to, false) || findPath(w.systems, from, to, true);
  if (!path) return null;
  let t = 0;
  for (let i = 0; i < path.length - 1; i++) t += jumpMs(n, 5, path[i], path[i + 1]);
  return Math.max(Math.round(30000 / TS), Math.round(t * GD.RULES.deliveryJumpFactor));
}
function actMarketBuy(n, { id, planetId }) {
  const w = W();
  const m = w.market[id];
  if (!m) fail('La oferta ya no existe');
  if (m.seller === n.id) fail('Es tu propia oferta');
  const seller = w.nations[m.seller];
  if (m.kind === 'resource') {
    pay(n, { credits: m.price });
    n.resources[m.resource] = (n.resources[m.resource] || 0) + m.amount;
    if (seller) seller.credits += m.price;
    delete w.market[id];
    if (seller) notify(seller.id, ':credits: ' + n.name + ' compró tus ' + m.amount + ' ' + GD.RESOURCES[m.resource].name + ' por ₡' + m.price, 'good');
    return { ok: true, msg: 'Compra realizada' };
  }
  // Unidades: el vendedor ya las fabricó; llegan a uno de tus planetas tras el viaje
  const d = w.designs[m.designId];
  if (!d) { delete w.market[id]; fail('El diseño ya no existe'); }
  let pl = planetId ? w.planets[planetId] : null;
  if (!pl || pl.owner !== n.id) pl = w.planets[n.capital];
  if (!pl || pl.owner !== n.id) fail('Necesitas un planeta de destino');
  const dom = GD.HULLS[d.hull].domain;
  const delay = deliveryMs(n, m.system, pl.system);
  if (delay == null) fail('No hay ruta de entrega hasta ' + pl.name);
  pay(n, { credits: m.price });
  w.deliveries = w.deliveries || [];
  n.flags = n.flags || {}; n.flags.boughtUnits = true;
  w.deliveries.push({ id: S.uid('e'), nation: n.id, planetId: pl.id, designId: m.designId, count: m.count, domain: dom, readyAt: now() + delay, from: m.seller, price: m.price });
  if (seller) { seller.credits += m.price; notify(seller.id, ':credits: ' + n.name + ' compró tus ' + m.count + 'x "' + d.name + '" por ₡' + m.price, 'good'); }
  news(':market: ' + n.name + ' compró ' + m.count + 'x ' + d.name + ' a ' + (seller ? seller.name : '?'), 'trade');
  delete w.market[id];
  return { ok: true, msg: ':fleet: Compra hecha: ' + m.count + 'x "' + d.name + '" llegan a ' + pl.name + ' en ' + fmtTime(Math.round(delay / 1000 * TS)) };
}
function actMarketCancel(n, { id }) {
  const w = W();
  const m = w.market[id];
  if (!m || m.seller !== n.id) fail('No es tu oferta');
  if (m.kind === 'resource') n.resources[m.resource] = (n.resources[m.resource] || 0) + m.amount;
  else if (m.kind === 'units') returnUnits(n.id, m.system, m.designId, m.count);
  delete w.market[id];
  return { ok: true, msg: 'Oferta retirada' };
}
/** Deja unidades en un sistema, en la flota quieta del dueño que corresponda (o en una nueva) */
function dropUnits(nid, sid, designId, count, domain, label) {
  const w = W();
  const pref = domain === 'ground' ? 'Guarnición' : 'Flota';
  let f = Object.values(w.fleets).find(f => f.owner === nid && f.system === sid && !f.path && !f.battle && f.name.startsWith(pref));
  if (!f) f = makeFleet(nid, sid, label || (pref + ' ' + w.systems[sid].name));
  f.units[designId] = (f.units[designId] || 0) + count;
  return f;
}
function returnUnits(nid, sid, designId, count) {
  const d = W().designs[designId];
  dropUnits(nid, sid, designId, count, d ? GD.HULLS[d.hull].domain : 'space', 'Flota devuelta');
}

/* ---------------------------------------------------------------
 * 5. PROYECTOS Y TECNOLOGÍA
 * --------------------------------------------------------------- */
function actResearch(n, { techId }) {
  const t = GD.techById(techId);
  if (!t) fail('Tecnología inválida');
  if (n.techs.includes(techId)) fail('Ya investigada');
  const br = GD.TECH_BRANCHES[t.branch];
  if (br.spec && !n.spec.includes(t.branch)) {
    fail(n.spec.length < GD.RULES.specSlots ? 'Primero elige tus ' + GD.RULES.specSlots + ' especialidades (Proyectos > Investigación)' : 'No eres especialista en ' + br.name + ': compra esas unidades a otra nación en el Mercado');
  }
  for (const r of t.req) if (!n.techs.includes(r)) fail('Requiere: ' + GD.techById(r).name);
  if (n.research < t.cost) fail('Te faltan Puntos de Investigación (PI)');
  n.research -= t.cost;
  n.techs.push(techId);
  return { ok: true, msg: ':research: Investigado: ' + t.name };
}
/** Elige las especialidades (una vez; solo se puede corregir mientras no hayas investigado nada en ellas) */
function actChooseSpec(n, { branches }) {
  const list = Array.isArray(branches) ? [...new Set(branches)] : [];
  if (list.length !== GD.RULES.specSlots) fail('Elige exactamente ' + GD.RULES.specSlots + ' ramas');
  for (const b of list) if (!GD.TECH_BRANCHES[b] || !GD.TECH_BRANCHES[b].spec) fail('Rama inválida');
  const invested = n.techs.some(id => { const t = GD.techById(id); return t && t.cost > 0 && GD.TECH_BRANCHES[t.branch].spec; });
  if (n.spec.length && invested) fail('Ya investigaste en tu especialidad: no se puede cambiar');
  n.spec = list;
  news(':research: ' + n.name + ' se especializa en ' + list.map(b => GD.TECH_BRANCHES[b].name).join(' y '), 'nation');
  return { ok: true, msg: 'Especialidades: ' + list.map(b => GD.TECH_BRANCHES[b].name).join(' y ') };
}
function componentCap(n) { return GD.COMPONENT_BASE_CAP + nationTechBonus(n, 'componentCap'); }

function actDesignComponent(n, { type, name, points }) {
  const w = W();
  const T = GD.COMPONENT_TYPES[type];
  if (!T) fail('Tipo inválido');
  if (!hasUnlocked(n, 'component', type)) fail('Necesitas la tecnología para ' + T.name);
  name = String(name || '').trim().slice(0, 32);
  if (name.length < 2) fail('Ponle un nombre a tu componente');
  const p = { potencia: Math.floor(+points.potencia || 0), fiabilidad: Math.floor(+points.fiabilidad || 0), eficiencia: Math.floor(+points.eficiencia || 0) };
  if (p.potencia < 1 || p.fiabilidad < 0 || p.eficiencia < 0) fail('Puntos inválidos');
  if (p.potencia + p.fiabilidad + p.eficiencia > componentCap(n)) fail('Máximo ' + componentCap(n) + ' puntos');
  const comp = { type, name, points: p };
  const dev = GD.componentDevCost(comp);
  pay(n, { credits: dev.credits });
  const id = S.uid('c');
  w.components[id] = Object.assign(comp, { id, owner: n.id, status: 'developing', readyAt: now() + ms(dev.minutes * 60000), createdAt: now() });
  return { ok: true, msg: ':lab: Proyecto iniciado: ' + name + ' (' + dev.minutes + ' min)' };
}

function canUseComponent(n, c) {
  if (!c || c.status !== 'ready') return false;
  return !!(c.public || c.owner === n.id);
}
function actDesignShip(n, { hull, name, components, description }) {
  const w = W();
  const H = GD.HULLS[hull];
  if (!H) fail('Casco inválido');
  if (!hasUnlocked(n, 'hull', hull)) fail('Necesitas investigar ' + H.name);
  name = String(name || '').trim().slice(0, 32);
  if (name.length < 2) fail('Ponle un nombre a tu diseño');
  components = (components || []).slice(0, 20);
  for (const cid of components) if (!canUseComponent(n, w.components[cid])) fail('No puedes usar uno de los componentes');
  const design = { hull, name, components, description: String(description || '').slice(0, 200) };
  const err = GD.validateDesign(design, compLookup);
  if (err) fail(err);
  const dev = GD.designDevCost(design);
  pay(n, { credits: dev.credits });
  const id = S.uid('d');
  w.designs[id] = Object.assign(design, { id, owner: n.id, status: 'developing', readyAt: now() + ms(dev.minutes * 60000), createdAt: now() });
  return { ok: true, msg: ':build: Proyecto de ' + H.name + ' iniciado: ' + name + ' (' + dev.minutes + ' min)' };
}
/** Solo puedes FABRICAR tus propios diseños y los públicos del Consorcio. Lo demás se compra ya hecho en el Mercado. */
function canBuildDesign(n, d) {
  return !!d && d.status === 'ready' && (d.public || d.owner === n.id);
}
function actProduce(n, { designId, planetId, count }) {
  const w = W();
  const d = w.designs[designId];
  const p = w.planets[planetId];
  count = Math.floor(Number(count));
  if (!(count >= 1 && count <= 200)) fail('Cantidad inválida (1-200)');
  if (!canBuildDesign(n, d)) fail('No tienes acceso a ese diseño');
  if (!p || p.owner !== n.id) fail('Planeta inválido');
  const H = GD.HULLS[d.hull];
  if (H.domain === 'space' && !p.buildings.astillero) fail('Ese planeta necesita un Astillero orbital');
  if (H.domain === 'ground' && !p.buildings.cuartel) fail('Ese planeta necesita una Academia militar');
  const s = statsOf(designId);
  pay(n, s.unitCost, count);
  const last = w.buildQueue.filter(q => q.planetId === planetId && q.domain === H.domain).reduce((a, q) => Math.max(a, q.readyAt), now());
  const secs = Math.round(H.build * Math.pow(count, 0.75) / TS);
  w.buildQueue.push({ id: S.uid('q'), nation: n.id, designId, planetId, count, domain: H.domain, readyAt: last + secs * 1000 });
  return { ok: true, msg: ':b_fabrica: Fabricando ' + count + 'x ' + d.name + ' (' + fmtTime(secs) + ')' };
}
function fmtTime(s) { return s >= 60 ? Math.floor(s / 60) + 'm ' + (s % 60) + 's' : s + 's'; }

/* ---------------------------------------------------------------
 * 6. BÉLICO: FLOTAS
 * --------------------------------------------------------------- */
function makeFleet(owner, system, name) {
  const id = S.uid('f');
  const f = { id, owner, system, name: name || 'Flota', units: {}, path: null, nextJumpAt: null, stance: 'agresiva' };
  W().fleets[id] = f;
  return f;
}
function fleetInfo(f) {
  let speed = 99, space = 0, ground = 0, capacity = 0, groundSize = 0, power = 0, count = 0;
  for (const d in f.units) {
    const s = statsOf(d), c = f.units[d];
    if (!s || !c) continue;
    count += c; power += s.power * c;
    if (s.domain === 'space') { space += c; speed = Math.min(speed, s.speed); capacity += s.capacity * c; }
    else { ground += c; groundSize += s.size * c; }
  }
  return { speed: space ? speed : 0, space, ground, capacity, groundSize, power, count };
}
function actMoveFleet(n, { fleetId, to, mission, portal }) {
  const w = W();
  const f = w.fleets[fleetId];
  if (!f || f.owner !== n.id) fail('Flota inválida');
  if (f.battle) fail('La flota está en combate: usa la orden de retirada en la batalla');
  if (!w.systems[to]) fail('Destino inválido');
  const info = fleetInfo(f);
  if (!info.space) fail('Las tropas necesitan naves para moverse');
  if (info.groundSize > info.capacity) fail('Faltan transportes: capacidad ' + info.capacity + ', tropas ' + info.groundSize);
  const from = f.path ? f.path[0] : f.system;
  // Los portales de agujero negro son rápidos pero arriesgados: solo se usan si el jugador lo permite
  // Ruta segura: rodea los sistemas con piratas/criaturas (o una guarida) si hay alternativa
  const hazards = hazardSystems();
  let path = findPath(w.systems, from, to, !!portal, hazards);
  let risky = false;
  if (!path) { path = findPath(w.systems, from, to, !!portal); risky = !!path && path.slice(1, -1).some(x => hazards.has(x)); }
  if (!path && !portal) { path = findPath(w.systems, from, to, true); risky = !!path; }
  if (path && path.length < 2) fail('La flota ya está en ese sistema');
  if (!path) fail('No hay ruta');
  f.path = path.slice(1);
  f.bombard = null; delete f.bombard;
  if (!f.nextJumpAt) { f.jumpStartAt = now(); f.nextJumpAt = now() + jumpMs(n, info.speed, f.system, f.path[0]); }
  f.mission = sanitizeMission(n, f, mission);
  const what = f.mission ? (f.mission.type === 'invade' ? ' para invadir ' + W().planets[f.mission.planetId].name : ' para atacar') : '';
  const viaPortal = pathUsesPortal(path);
  return { ok: true, msg: ':fleet: ' + f.name + ' en camino' + what + ' (' + f.path.length + ' saltos' + (viaPortal ? ', por portal :blackhole:' : '') + (risky ? ', ¡ruta peligrosa!' : '') + ')', risky };
}
/** Sistemas con enemigos NPC o guaridas: las rutas automáticas los evitan */
function hazardSystems() {
  const w = W(), h = new Set();
  for (const f of Object.values(w.fleets)) if ((f.owner === PIRATES || f.owner === MONSTERS) && !f.raid) h.add(f.system);
  for (const sy of Object.values(w.systems)) if (sy.lair && sy.lair.hp > 0) h.add(sy.id);
  return h;
}
function pathUsesPortal(path) {
  const sy = W().systems;
  for (let i = 0; i < path.length - 1; i++) if (sy[path[i]].portal === path[i + 1]) return true;
  return false;
}
/** ¿Cuánto se acortaría el viaje usando portales? (para que la UI pregunte al jugador) */
function portalOffer(fleetId, to) {
  const w = W(), f = w.fleets[fleetId]; if (!f) return null;
  const from = f.path ? f.path[0] : f.system;
  const safe = findPath(w.systems, from, to, false), fast = findPath(w.systems, from, to, true);
  if (!safe || !fast || !pathUsesPortal(fast)) return null;
  const t = p => { let x = 0; for (let i = 0; i < p.length - 1; i++) x += jumpFactor(w.systems, p[i], p[i + 1]); return x; };
  return { safe: safe.length - 1, fast: fast.length - 1, saves: Math.round((1 - t(fast) / t(safe)) * 100) };
}
/** Misiones: 'attack' (ir y combatir) o 'invade' (ir, ganar la órbita y desembarcar solo) */
function sanitizeMission(n, f, m) {
  if (!m || !m.type) return null;
  if (m.type === 'invade') {
    const p = W().planets[m.planetId];
    if (!p) fail('Planeta inválido');
    if (!fleetInfo(f).ground) fail('La flota no lleva tropas. Usa "Embarcar tropas" primero.');
    return { type: 'invade', planetId: p.id };
  }
  if (m.type === 'attack') return { type: 'attack' };
  return null;
}
/** Duración de un salto: velocidad de la flota, tecnología, distancia de la ruta y GAME_SPEED. Los portales son 2.5x más rápidos. */
function jumpMs(n, speed, from, to) {
  const k = from && to && W().systems[from] && W().systems[to] ? jumpFactor(W().systems, from, to) : 1;
  return Math.round(GD.RULES.jumpSeconds * 1000 * 5 / Math.max(1, speed) / (1 + nationTechBonus(n, 'fleetSpeed')) * k / TS);
}
function actStopFleet(n, { fleetId }) {
  const f = W().fleets[fleetId];
  if (!f || f.owner !== n.id) fail('Flota inválida');
  if (f.battle) fail('La flota está en combate');
  f.path = null; f.nextJumpAt = null; f.mission = null;
  return { ok: true, msg: 'Flota detenida' };
}
/** Divide/une flotas: mueve unidades de una flota a otra (o a una nueva) en el mismo sistema */
function actTransferUnits(n, { fromId, toId, designId, count, newName }) {
  const w = W();
  const a = w.fleets[fromId];
  if (!a || a.owner !== n.id || a.path || a.battle) fail('Flota de origen inválida (debe estar quieta y fuera de combate)');
  count = Math.floor(Number(count));
  if (!(count > 0) || (a.units[designId] || 0) < count) fail('No hay tantas unidades');
  let b = toId ? w.fleets[toId] : null;
  if (toId && (!b || b.owner !== n.id || b.system !== a.system || b.path)) fail('Flota destino inválida');
  if (!b) b = makeFleet(n.id, a.system, String(newName || 'Nueva flota').slice(0, 24));
  a.units[designId] -= count; if (!a.units[designId]) delete a.units[designId];
  b.units[designId] = (b.units[designId] || 0) + count;
  if (!Object.keys(a.units).length) delete w.fleets[a.id];
  return { ok: true, msg: 'Unidades transferidas a ' + b.name };
}
/** Embarca en la flota todas las tropas de otras flotas propias del mismo sistema (hasta llenar transportes) */
function actEmbark(n, { fleetId }) {
  const w = W();
  const f = w.fleets[fleetId];
  if (!f || f.owner !== n.id || f.path || f.battle) fail('Flota inválida (debe estar quieta y fuera de combate)');
  let info = fleetInfo(f);
  if (!info.capacity) fail('Esta flota no tiene transportes. Fabrica un "Transporte de tropas" y añádelo.');
  let free = info.capacity - info.groundSize, moved = 0;
  for (const o of Object.values(w.fleets)) {
    if (o.id === f.id || o.owner !== n.id || o.system !== f.system || o.path) continue;
    for (const d in o.units) {
      const s = statsOf(d);
      if (!s || s.domain !== 'ground' || free < s.size) continue;
      const k = Math.min(o.units[d], Math.floor(free / s.size));
      o.units[d] -= k; if (!o.units[d]) delete o.units[d];
      f.units[d] = (f.units[d] || 0) + k; free -= k * s.size; moved += k;
    }
    if (!Object.keys(o.units).length) delete w.fleets[o.id];
  }
  if (!moved) fail(free <= 0 ? 'Los transportes ya están llenos' : 'No hay tropas propias en este sistema');
  return { ok: true, msg: ':troops: ' + moved + ' tropas embarcadas en ' + f.name };
}
/** Desembarca las tropas en una guarnición del sistema */
function actDisembark(n, { fleetId }) {
  const w = W();
  const f = w.fleets[fleetId];
  if (!f || f.owner !== n.id || f.path) fail('Flota inválida');
  const ground = Object.keys(f.units).filter(d => (statsOf(d) || {}).domain === 'ground');
  if (!ground.length) fail('No hay tropas a bordo');
  const g = makeFleet(n.id, f.system, 'Guarnición ' + w.systems[f.system].name);
  for (const d of ground) { g.units[d] = f.units[d]; delete f.units[d]; }
  return { ok: true, msg: 'Tropas desembarcadas' };
}
function actRenameFleet(n, { fleetId, name }) {
  const f = W().fleets[fleetId];
  if (!f || f.owner !== n.id) fail('Flota inválida');
  f.name = String(name || '').trim().slice(0, 24) || f.name;
  return { ok: true };
}
function actScrap(n, { fleetId, designId, count }) {
  const f = W().fleets[fleetId];
  count = Math.floor(Number(count));
  if (!f || f.owner !== n.id || f.battle || !(count > 0) || (f.units[designId] || 0) < count) fail('Inválido');
  f.units[designId] -= count; if (!f.units[designId]) delete f.units[designId];
  if (!Object.keys(f.units).length) delete W().fleets[f.id];
  return { ok: true, msg: 'Unidades desmanteladas' };
}

/** Desembarco sobre un planeta enemigo (requiere guerra y superioridad orbital). Empieza la CAMPAÑA TERRESTRE (ver ground.js) */
function actInvade(n, { fleetId, planetId }) {
  const w = W();
  const f = w.fleets[fleetId], p = w.planets[planetId];
  if (!f || f.owner !== n.id || f.path || f.battle) fail('Flota inválida (quieta y fuera de combate)');
  if (!p || p.system !== f.system) fail('El planeta debe estar en el sistema de la flota');
  if (!p.owner) fail('Planeta independiente: usa "Anexar"');
  if (p.owner === n.id) fail('Ya es tuyo');
  if (!atWar(n.id, p.owner)) fail('Debes estar en guerra con ' + w.nations[p.owner].name);
  // Superioridad orbital: no debe haber naves espaciales enemigas ni defensas en pie
  const enemySpace = Object.values(w.fleets).some(o => o.system === f.system && !o.path && atWar(n.id, o.owner) && fleetInfo(o).space > 0);
  if (enemySpace) fail('Primero destruye las naves enemigas del sistema');
  if (isProtected(defenderOf(p))) fail('Esa nación está bajo protección de novatos');
  if ((p.defenseHp || 0) > 0 && planetDefenseGroup(p)) fail('Las defensas orbitales siguen activas');
  if (!groundGroups(f).length) fail('La flota no lleva tropas');
  return Ground.land(n, p, f);
}
/** El planeta cae: pasa al atacante con sus tropas supervivientes como guarnición (lo llama ground.js) */
function conquerPlanet(n, p, survivors, repId) {
  const w = W();
  const prevOwner = p.owner, defender = w.nations[prevOwner];
  p.owner = n.id; p.stability = 0.3; p.pop = Math.round(p.pop * 0.85 * 100) / 100; p.milFrac = 1; p.supp = 0; p.shieldHp = null; p.shieldDownUntil = null;
  const gar = makeFleet(n.id, p.system, 'Guarnición ' + p.name);
  for (const d in survivors) gar.units[d] = survivors[d];
  if (!Object.keys(gar.units).length) delete w.fleets[gar.id];
  // las guarniciones del antiguo dueño que quedaban se rinden (se pierden)
  for (const f of Object.values(w.fleets)) if (f.owner === prevOwner && f.system === p.system && !f.path && !fleetInfo(f).space) delete w.fleets[f.id];
  n.flags = n.flags || {}; n.flags.invaded = true;
  news(':conquest: ' + n.name + ' conquistó ' + p.name + ' de ' + defender.name + '!', 'war');
  notify(prevOwner, ':engine: ¡Perdimos ' + p.name + ' ante ' + n.name + '!', 'bad');
  notify(n.id, ':conquest: ¡' + p.name + ' es nuestro!', 'good');
  // Si cae la CAPITAL, el gobierno se hunde: durante unas horas las colonias pueden rebelarse (acelera el final de la temporada)
  if (defender.capital === p.id && planetsOf(prevOwner).length > 1) {
    defender.govFallen = { at: now(), until: now() + ms(GD.RULES.govCollapseHours * 3600000) };
    notify(prevOwner, ':alert: ¡CAYÓ TU CAPITAL! Tus colonias pueden rebelarse durante ' + GD.RULES.govCollapseHours + ' h. Nombra una nueva capital YA (Imperio > Planetas).', 'bad');
    news(':alert: ¡El gobierno de ' + defender.name + ' se tambalea tras perder su capital!', 'war');
  }
  checkElimination(prevOwner, n.id);
}
function groundGroups(f) {
  const out = [];
  for (const d in f.units) { const s = statsOf(d); if (s && s.domain === 'ground' && f.units[d] > 0) out.push({ fleetId: f.id, designId: d, name: W().designs[d].name, count: f.units[d], stats: s }); }
  return out;
}
function applyGroundLosses(f, groups) {
  for (const g of groups) { if (g.count > 0) f.units[g.designId] = g.count; else delete f.units[g.designId]; }
  if (!Object.keys(f.units).length) delete W().fleets[f.id];
}
function defenderOf(p) { return W().nations[p.owner]; }
function checkElimination(nid, byId) {
  const w = W();
  const n = w.nations[nid];
  const left = planetsOf(nid);
  if (left.length) { if (!left.some(p => p.id === n.capital)) n.capital = left.sort((a, b) => b.pop - a.pop)[0].id; return; }
  n.alive = false;
  for (const f of fleetsOf(nid)) delete w.fleets[f.id];
  for (const m of Object.values(w.market)) if (m.seller === nid) delete w.market[m.id];
  if (n.alliance) leaveAlliance(n);
  for (const war of Object.values(w.wars)) if (war.active && (war.attackers.includes(nid) || war.defenders.includes(nid))) {
    war.attackers = war.attackers.filter(x => x !== nid); war.defenders = war.defenders.filter(x => x !== nid);
    if (!war.attackers.length || !war.defenders.length) { war.active = false; war.endedAt = now(); }
  }
  news(':skull: ' + n.name + ' ha caído' + (byId ? ' ante ' + w.nations[byId].name : '') + '. Quedan ' + Object.values(w.nations).filter(x => x.alive && !x.npc).length + ' naciones.', 'war');
  if (!n.bot) emit.nation(nid, { type: 'eliminated' });
  Season.check();
}

/** Defensa planetaria como "grupo" de combate */
function planetDefenseGroup(p) {
  const bat = p.buildings.bateria || 0, esc = p.buildings.escudo || 0;
  if (!bat && !esc) return null;
  const hp = bat * GD.BUILDINGS.bateria.defense.hp + esc * GD.BUILDINGS.escudo.defense.hp;
  return {
    name: 'Defensas de ' + p.name, planetId: p.id, count: 1, isPlanet: true,
    stats: { hp, size: 30, role: 'line', armor: bat * 15 * GD.NUM_K, shield: esc * GD.BUILDINGS.escudo.defense.shield, pd: bat * 10 * GD.NUM_K, sensors: 10 * GD.NUM_K, ecm: 0,
      weapons: bat ? [{ type: 'bat', dmgType: 'cinetico', range: [1, 1, 1], dmg: bat * GD.BUILDINGS.bateria.defense.kinetic * 3, rel: 0.95, antiCapital: 1 }] : [] }
  };
}

/* ---------------------------------------------------------------
 * 7. DIPLOMACIA
 * --------------------------------------------------------------- */
function atWar(a, b) {
  if (!a || !b || a === b) return false;
  // Piratas y criaturas son hostiles con todo el mundo (y amigos entre sí)
  const na = a === PIRATES || a === MONSTERS, nb = b === PIRATES || b === MONSTERS;
  if (na && nb) return false;
  if (na || nb) return true;
  return Object.values(W().wars).some(w => w.active && ((w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a))));
}
function actDeclareWar(n, { targetId, name }) {
  const w = W();
  const t = w.nations[targetId];
  if (!t || !t.alive || t.id === n.id || t.npc) fail('Objetivo inválido');
  if (atWar(n.id, t.id)) fail('Ya están en guerra');
  if (isProtected(n)) fail('Estás bajo protección de novatos: podrás declarar guerras en ' + Math.ceil((Season.protectedUntil(n) - now()) * TS / 3600000) + ' h (o renuncia a la protección en Imperio).');
  if (isProtected(t)) fail(t.name + ' está bajo protección de novatos (' + Math.ceil((Season.protectedUntil(t) - now()) * TS / 3600000) + ' h).');
  if (n.alliance && n.alliance === t.alliance) fail('Es tu aliado. Sal de la alianza primero (será una traición pública)');
  const id = S.uid('w');
  w.wars[id] = { id, name: String(name || ('Guerra ' + n.name + '-' + t.name)).slice(0, 40), attackers: [n.id], defenders: [t.id], active: true, startedAt: now() };
  news(':war: ¡' + n.name + ' declaró la guerra a ' + t.name + '!', 'war');
  notify(t.id, ':war: ' + n.name + ' nos declaró la guerra. ¡Prepara las defensas y llama a tus aliados!', 'bad');
  if (t.alliance) for (const mid of w.alliances[t.alliance].members) if (mid !== t.id) notify(mid, ':megaphone: Tu aliado ' + t.name + ' fue atacado por ' + n.name + '. Puedes unirte a la guerra desde Diplomacia.', 'warn');
  return { ok: true, msg: 'Guerra declarada' };
}
function actJoinWar(n, { warId, side }) {
  const war = W().wars[warId];
  if (!war || !war.active) fail('Guerra inválida');
  if (war.attackers.includes(n.id) || war.defenders.includes(n.id)) fail('Ya participas');
  const list = side === 'attackers' ? war.attackers : war.defenders;
  list.push(n.id);
  news(':shield: ' + n.name + ' se unió a "' + war.name + '" del lado ' + (side === 'attackers' ? 'atacante' : 'defensor'), 'war');
  return { ok: true, msg: 'Te uniste a la guerra' };
}
function actProposePeace(n, { warId }) {
  const w = W();
  const war = w.wars[warId];
  if (!war || !war.active) fail('Guerra inválida');
  const mySide = war.attackers.includes(n.id) ? 'attackers' : (war.defenders.includes(n.id) ? 'defenders' : null);
  if (!mySide) fail('No participas en esa guerra');
  const other = mySide === 'attackers' ? war.defenders : war.attackers;
  const id = S.uid('o');
  w.offers[id] = { id, kind: 'peace', from: n.id, to: other[0], warId, t: now() };
  notify(other[0], ':peace: ' + n.name + ' propone la paz en "' + war.name + '". Revisa Diplomacia > Ofertas.', 'warn');
  return { ok: true, msg: 'Propuesta de paz enviada' };
}
function leaveWarSide(n, war) {
  war.attackers = war.attackers.filter(x => x !== n.id); war.defenders = war.defenders.filter(x => x !== n.id);
  if (!war.attackers.length || !war.defenders.length) { war.active = false; war.endedAt = now(); }
}

/** Ofertas privadas: intercambio de créditos y recursos entre dos naciones (las unidades se venden en el Mercado) */
function actOffer(n, { to, give, want, message }) {
  const w = W();
  const t = w.nations[to];
  if (!t || !t.alive || t.id === n.id || t.npc) fail('Destino inválido');
  const clean = o => {
    const r = {};
    for (const k in (o || {})) if (k === 'credits' || GD.RESOURCES[k]) { const v = Math.floor(+o[k]); if (v > 0) r[k] = v; }
    return r;
  };
  const g = clean(give), wt = clean(want);
  if (!Object.keys(g).length && !Object.keys(wt).length) fail('Oferta vacía');
  const id = S.uid('o');
  w.offers[id] = { id, kind: 'trade', from: n.id, to, give: g, want: wt, message: String(message || '').slice(0, 140), t: now() };
  notify(to, ':ally: ' + n.name + ' te envió una oferta comercial', 'warn');
  return { ok: true, msg: 'Oferta enviada' };
}
function transfer(from, to, bundle) {
  pay(from, bundle);
  for (const k in bundle) { if (k === 'credits') to.credits += bundle[k]; else to.resources[k] = (to.resources[k] || 0) + bundle[k]; }
}
function actRespondOffer(n, { id, accept }) {
  const w = W();
  const o = w.offers[id];
  if (!o || (o.to !== n.id && o.from !== n.id)) fail('Oferta inválida');
  delete w.offers[id];
  if (!accept || o.from === n.id) { if (o.from !== n.id) notify(o.from, ':x: ' + n.name + ' rechazó tu oferta', 'bad'); return { ok: true, msg: 'Oferta cerrada' }; }
  const from = w.nations[o.from];
  if (!from || !from.alive) fail('La otra nación ya no existe');
  if (o.kind === 'peace') {
    const war = w.wars[o.warId];
    if (war && war.active) { war.active = false; war.endedAt = now(); news(':peace: Paz firmada: fin de "' + war.name + '"', 'peace'); }
    return { ok: true, msg: 'Paz firmada' };
  }
  if (o.kind === 'alliance_invite') {
    const a = w.alliances[o.allianceId];
    if (!a) fail('La alianza ya no existe');
    if (n.alliance) fail('Ya estás en una alianza');
    a.members.push(n.id); n.alliance = a.id;
    news(':ally: ' + n.name + ' se unió a la alianza [' + a.tag + '] ' + a.name, 'alliance');
    return { ok: true, msg: 'Te uniste a ' + a.name };
  }
  // Comercio: validar ambos lados antes de mover nada (atómico)
  if (!canAfford(from, o.give)) fail(from.name + ' ya no tiene lo que ofreció');
  if (!canAfford(n, o.want)) fail('No tienes lo que te piden');
  transfer(from, n, o.give);
  transfer(n, from, o.want);
  notify(from.id, ':ok: ' + n.name + ' aceptó tu oferta', 'good');
  return { ok: true, msg: 'Intercambio completado' };
}

function actCreateAlliance(n, { name, tag, color }) {
  const w = W();
  if (n.alliance) fail('Ya estás en una alianza');
  name = String(name || '').trim().slice(0, 30); tag = String(tag || '').trim().toUpperCase().slice(0, 4);
  if (name.length < 3 || tag.length < 2) fail('Nombre (3+) y etiqueta (2-4 letras) requeridos');
  if (Object.values(w.alliances).some(a => a.tag === tag)) fail('Etiqueta en uso');
  const id = S.uid('a');
  w.alliances[id] = { id, name, tag, color: /^#[0-9a-f]{6}$/i.test(color) ? color : '#4cc9f0', leader: n.id, members: [n.id], createdAt: now() };
  n.alliance = id;
  news(':ally: Se fundó la alianza [' + tag + '] ' + name + ' liderada por ' + n.name, 'alliance');
  return { ok: true, msg: 'Alianza creada' };
}
function actInviteAlliance(n, { targetId }) {
  const w = W();
  const a = w.alliances[n.alliance];
  const t = w.nations[targetId];
  if (!a) fail('No estás en una alianza');
  if (!t || t.alliance) fail('Esa nación no puede ser invitada');
  if (atWar(n.id, t.id)) fail('Están en guerra');
  const id = S.uid('o');
  w.offers[id] = { id, kind: 'alliance_invite', from: n.id, to: t.id, allianceId: a.id, t: now() };
  notify(t.id, ':mail: ' + n.name + ' te invita a la alianza [' + a.tag + '] ' + a.name, 'warn');
  return { ok: true, msg: 'Invitación enviada' };
}
function leaveAlliance(n) {
  const w = W();
  const a = w.alliances[n.alliance];
  n.alliance = null;
  if (!a) return;
  a.members = a.members.filter(m => m !== n.id);
  if (!a.members.length) { delete w.alliances[a.id]; news(':ruin: La alianza [' + a.tag + '] se disolvió', 'alliance'); }
  else if (a.leader === n.id) a.leader = a.members[0];
}
function actLeaveAlliance(n, { betray }) {
  const a = W().alliances[n.alliance];
  if (!a) fail('No estás en una alianza');
  news((betray ? ':dagger: ¡TRAICIÓN! ' : ':exit: ') + n.name + ' abandonó la alianza [' + a.tag + ']', betray ? 'war' : 'alliance');
  if (betray) { n.betrayals++; n.stats.stability = clamp(n.stats.stability - GD.RULES.betrayalStabilityHit, 0.05, 1); }
  leaveAlliance(n);
  return { ok: true, msg: 'Saliste de la alianza' };
}
function actKickAlliance(n, { targetId }) {
  const w = W();
  const a = w.alliances[n.alliance];
  if (!a || a.leader !== n.id) fail('Solo el líder puede expulsar');
  const t = w.nations[targetId];
  if (!t || t.alliance !== a.id || t.id === n.id) fail('Inválido');
  leaveAlliance(t);
  notify(t.id, ':exit: Fuiste expulsado de [' + a.tag + ']', 'bad');
  return { ok: true, msg: 'Expulsado' };
}
function actUpdateProfile(n, { motto, flag }) {
  if (motto != null) n.motto = String(motto).slice(0, 60);
  if (flag) n.flag = sanitizeFlag(flag);
  return { ok: true, msg: 'Perfil actualizado' };
}

/* ---------------------------------------------------------------
 * 8. BUCLE DE JUEGO
 * Se ejecuta cada segundo: proyectos terminados, colas de fabricación,
 * saltos de flotas, batallas (ver battles.js), NPC, IA y ciclo económico.
 * --------------------------------------------------------------- */
let lastPirateCheck = 0;
const isProtected = n => Season.isProtected(n);
function tick() {
  const w = W();
  const t = now();
  if (w.season.status !== 'running') return;
  let changed = false;
  if (!w.nextCycleAt) w.nextCycleAt = t + TICK_SECONDS * 1000;
  if (t >= w.nextCycleAt) { runCycle(); changed = true; }
  // Proyectos
  for (const c of Object.values(w.components)) if (c.status === 'developing' && t >= c.readyAt) { c.status = 'ready'; notify(c.owner, ':ok: Componente listo: ' + c.name, 'good'); changed = true; }
  for (const d of Object.values(w.designs)) if (d.status === 'developing' && t >= d.readyAt) { d.status = 'ready'; notify(d.owner, ':ok: Diseño listo: ' + d.name + '. ¡Ya puedes fabricarlo o venderlo!', 'good'); changed = true; }
  // Producción
  w.buildQueue = w.buildQueue.filter(q => {
    if (t < q.readyAt) return true;
    const p = w.planets[q.planetId];
    if (p && p.owner === q.nation) {
      let f = Object.values(w.fleets).find(f => f.owner === q.nation && f.system === p.system && !f.path && !f.battle && f.name.startsWith(q.domain === 'ground' ? 'Guarnición' : 'Flota'));
      if (!f) f = makeFleet(q.nation, p.system, q.domain === 'ground' ? 'Guarnición ' + p.name : 'Flota de ' + p.name);
      f.units[q.designId] = (f.units[q.designId] || 0) + q.count;
      notify(q.nation, ':b_fabrica: Producción terminada: ' + q.count + 'x ' + (w.designs[q.designId] || {}).name + ' en ' + p.name, 'good');
    }
    changed = true;
    return false;
  });
  // Entregas de unidades compradas en el Mercado
  if (w.deliveries && w.deliveries.length) {
    w.deliveries = w.deliveries.filter(e => {
      if (t < e.readyAt) return true;
      const buyer = w.nations[e.nation];
      let p = w.planets[e.planetId];
      if (buyer && buyer.alive && (!p || p.owner !== e.nation)) p = w.planets[buyer.capital] && w.planets[buyer.capital].owner === e.nation ? w.planets[buyer.capital] : planetsOf(e.nation)[0];
      if (buyer && buyer.alive && p) {
        dropUnits(e.nation, p.system, e.designId, e.count, e.domain, e.domain === 'ground' ? 'Guarnición ' + p.name : 'Flota de ' + p.name);
        notify(e.nation, ':fleet: Llegó tu pedido: ' + e.count + 'x ' + ((w.designs[e.designId] || {}).name || 'unidades') + ' en ' + p.name, 'good');
      }
      changed = true;
      return false;
    });
  }
  // Movimiento de flotas
  for (const f of Object.values(w.fleets)) {
    if (f.battle || !f.path || !f.nextJumpAt || t < f.nextJumpAt) continue;
    const from = f.system;
    f.prev = from;
    f.system = f.path.shift();
    changed = true;
    // Los portales de agujero negro son inestables: puedes perder parte de la flota
    if (w.systems[from].portal === f.system && f.owner !== PIRATES && f.owner !== MONSTERS) portalMishap(f);
    if (!f.path.length) { f.path = null; f.nextJumpAt = null; notify(f.owner, ':pin: ' + f.name + ' llegó a ' + w.systems[f.system].name, 'info'); }
    else { f.jumpStartAt = t; f.nextJumpAt = t + jumpMs(w.nations[f.owner], fleetInfo(f).speed || 5, f.system, f.path[0]); }
    // Interdicción: una flota enemiga en el sistema detiene el avance (como un bloqueo)
    const hostile = Object.values(w.fleets).some(o => o.system === f.system && atWar(f.owner, o.owner) && fleetInfo(o).space > 0);
    if (hostile && f.path && f.owner !== PIRATES && f.owner !== MONSTERS) { f.path = null; f.nextJumpAt = null; notify(f.owner, ':alert: ' + f.name + ' fue interceptada en ' + w.systems[f.system].name, 'bad'); }
  }
  // Batallas en tiempo real (detección + avance)
  Battles.scan(t); Battles.step(t);
  // Misiones de invasión: cuando la órbita está despejada, desembarcan solas
  for (const f of Object.values(w.fleets)) {
    if (!f.mission || f.path || f.battle || f.mission.type !== 'invade') continue;
    const p = w.planets[f.mission.planetId];
    if (!p || p.system !== f.system) continue;
    if (p.owner === f.owner) { f.mission = null; continue; }
    if (!p.owner || !atWar(f.owner, p.owner)) { f.mission = null; notify(f.owner, ':info: ' + f.name + ': ya no estamos en guerra con el dueño de ' + p.name + '. Misión cancelada.', 'warn'); continue; }
    const enemySpace = Object.values(w.fleets).some(o => o.system === f.system && !o.path && atWar(f.owner, o.owner) && fleetInfo(o).space > 0);
    const defUp = (p.defenseHp == null || p.defenseHp > 0) && planetDefenseGroup(p);
    if (enemySpace || defUp) continue; // esperando a ganar la batalla orbital
    // Orbita limpia: si no hay escudo, primero se bombardea (precisión) hasta suprimir la defensa; con escudo se desembarca para apagarlo
    if (!Ground.shieldState(p).up && (p.supp || 0) < 0.45 && Ground.firepower(f) > 0 && !(f.bombard && f.bombard.n >= 12)) {   // máx. ~4 min de bombardeo previo
      if (!f.bombard) { f.bombard = { planetId: p.id, mode: 'precision' }; notify(f.owner, ':war: ' + f.name + ' bombardea ' + p.name + ' antes de desembarcar', 'info'); }
      continue;
    }
    f.mission = null; f.bombard = null; delete f.bombard;
    const r = handleAction(f.owner, 'invade', { fleetId: f.id, planetId: p.id });
    if (!r.ok) notify(f.owner, ':x: Invasión automática de ' + p.name + ' cancelada: ' + r.error, 'bad');
    else notify(f.owner, r.msg, r.msg.indexOf('fracasó') >= 0 ? 'bad' : 'good');
    changed = true;
  }
  // Guerra terrestre: bloqueos, bombardeos y campañas (cada ~20 s)
  if (Ground.tick(t)) changed = true;
  // Enemigos NPC, IA y temporada
  NPC.tick(t);
  if (t - (lastPirateCheck || 0) > ms(60000)) { lastPirateCheck = t; if (NPC.spawnPirates()) changed = true; }
  AI.tick(t);
  if (changed) emit.dirty();
}

/** Travesía por portal: cada grupo de la flota puede perder hasta un 12% de sus unidades */
function portalMishap(f) {
  let lost = 0;
  for (const d of Object.keys(f.units)) {
    const k = Math.floor(f.units[d] * Math.random() * 0.12 + Math.random() * 0.6);
    if (k > 0) { f.units[d] -= Math.min(k, f.units[d]); lost += k; if (!f.units[d]) delete f.units[d]; }
  }
  if (lost) notify(f.owner, ':blackhole: La travesía por el portal fue inestable: ' + f.name + ' perdió ' + lost + ' unidades', 'bad');
  else notify(f.owner, ':blackhole: ' + f.name + ' cruzó el portal sin daños', 'good');
  if (!Object.keys(f.units).length) delete W().fleets[f.id];
}

// Defensas planetarias se recuperan pasado un tiempo
function regenDefenses() {
  const t = now();
  for (const p of Object.values(W().planets)) if (p.defenseHp === 0 && p.defenseDownUntil && t > p.defenseDownUntil) { p.defenseHp = 1; p.defenseDownUntil = null; }
}
function trimReports() {
  const w = W();
  const ids = Object.keys(w.reports);
  if (ids.length > 120) ids.sort((a, b) => w.reports[a].t - w.reports[b].t).slice(0, ids.length - 120).forEach(id => delete w.reports[id]);
}

/** Renuncia voluntaria a la protección de novatos (para quien quiere guerra ya) */
function actEndProtection(n) {
  if (!isProtected(n)) fail('Ya no tienes protección');
  n.createdAt = now() - GD.RULES.protectionHours * 3600000 / TS - 1;
  return { ok: true, msg: ':shield: Protección de novatos terminada. ¡Ya puedes declarar guerras (y te pueden atacar)!' };
}
/** Órdenes dentro de una batalla en vivo (táctica / objetivo / retirada) */
function actBattleCmd(n, data) {
  const r = Battles.command(n.id, data.battleId, data);
  if (!r.ok) fail(r.error);
  return { ok: true };
}

/* ---------------------------------------------------------------
 * VISIBILIDAD (niebla de guerra simple)
 * Ves tus sistemas, sus vecinos y los de tus aliados. Piratas y criaturas
 * se ven siempre (son amenazas "conocidas" de la galaxia).
 * --------------------------------------------------------------- */
function visibleSystems(nid) {
  const w = W();
  const vis = new Set();
  const add = sid => { vis.add(sid); for (const l of w.systems[sid].links) if (w.systems[sid].portal !== l) vis.add(l); };
  for (const p of Object.values(w.planets)) if (p.owner === nid) add(p.system);
  for (const f of Object.values(w.fleets)) if (f.owner === nid) add(f.system);
  const me = w.nations[nid];
  if (me && me.alliance && w.alliances[me.alliance]) for (const m of w.alliances[me.alliance].members) if (m !== nid) {
    for (const p of Object.values(w.planets)) if (p.owner === m) add(p.system);
    for (const f of Object.values(w.fleets)) if (f.owner === m) vis.add(f.system);
  }
  return vis;
}

/* ---------------------------------------------------------------
 * DESPACHO DE ACCIONES
 * --------------------------------------------------------------- */
const ACTIONS = {
  build: actBuild, demolish: actDemolish, setTax: actSetTax, setCapital: actRenameCapital, annex: actAnnex,
  npcTrade: actNpcTrade, marketPost: actMarketPost, marketBuy: actMarketBuy, marketCancel: actMarketCancel,
  chooseSpec: actChooseSpec, research: actResearch, designComponent: actDesignComponent, designShip: actDesignShip, produce: actProduce,
  moveFleet: actMoveFleet, stopFleet: actStopFleet, embark: actEmbark, disembark: actDisembark, transferUnits: actTransferUnits, renameFleet: actRenameFleet, scrap: actScrap, invade: actInvade,
  declareWar: actDeclareWar, joinWar: actJoinWar, proposePeace: actProposePeace, offer: actOffer, respondOffer: actRespondOffer,
  createAlliance: actCreateAlliance, inviteAlliance: actInviteAlliance, leaveAlliance: actLeaveAlliance, kickAlliance: actKickAlliance,
  updateProfile: actUpdateProfile, endProtection: actEndProtection, battleCmd: actBattleCmd,
  groundStance: Ground.actGroundStance, groundWithdraw: Ground.actGroundWithdraw, bombard: Ground.actBombard, stopBombard: Ground.actStopBombard
};
/** Ganchos opcionales (herramientas de balance): hooks.action(nation, type, result) */
const hooks = {};
function handleAction(nationId, type, data) {
  const n = W().nations[nationId];
  if (!n || !n.alive) return { ok: false, error: 'No tienes una nación activa' };
  const fn = ACTIONS[type];
  if (!fn) return { ok: false, error: 'Acción desconocida' };
  if (W().season.status !== 'running') return { ok: false, error: 'La temporada terminó' };
  let r;
  try {
    r = fn(n, data || {}) || { ok: true };
    emit.dirty();
  } catch (e) {
    if (e instanceof GameError) r = { ok: false, error: e.message };
    else { console.error('[action]', type, e); r = { ok: false, error: 'Error interno' }; }
  }
  if (hooks.action) hooks.action(n, type, r);
  return r;
}

/* ---------------------------------------------------------------
 * ARRANQUE DEL MUNDO (NPC + IA de relleno) y contexto de módulos
 * --------------------------------------------------------------- */
const seasonProgress = () => Season.progress();
const seasonDay = () => Season.days();
const ctx = {
  W, now, ms, TS, uid: p => S.uid(p), emit: () => emit, atWar, statsOf, fleetInfo, notify, news, planetDefenseGroup, makeFleet, jumpMs, findPath,
  PIRATES, MONSTERS, trimReports, computeEconomy, seasonProgress, seasonDay, isProtected, handleAction, createNation, planetsOf, fleetsOf, visibleSystems,
  leaveAlliance, leaveWarSide, GameError, clamp, componentCap, conquer: conquerPlanet, applyGroundLosses, groundGroups, canBuildDesign, canUseComponent, nationTechBonus, hasUnlocked, portalOffer, fmtTime
};
Battles.attach(ctx); NPC.attach(ctx); Season.attach(ctx); AI.attach(ctx); Ground.attach(ctx);

/** Se llama una vez al crear/cargar el mundo: siembra criaturas, guaridas y naciones IA (solo la primera vez) */
function bootstrap(opts) {
  opts = opts || {};
  const w = W();
  NPC.ensureNpcNations();
  w.npcState = w.npcState || {};
  if (!w.npcState.seeded) { NPC.seedWorld(); w.npcState.seeded = true; }
  const bots = opts.bots != null ? opts.bots : Number(process.env.AI_COUNT != null ? process.env.AI_COUNT : 9);
  if (!w.npcState.botsSeeded) { w.npcState.botsSeeded = true; AI.ensureBots(bots); }
}
function resetBattles() { Battles.reset(); }

module.exports = {
  PIRATES, MONSTERS, spawnPirates: NPC.spawnPirates, ensurePirates: NPC.ensureNpcNations, bootstrap, resetBattles,
  hooks, TICK_SECONDS, TS, ms, setEmitter, tick, Ground, regenDefenses, handleAction, createNation, computeEconomy, fleetInfo, statsOf, atWar, visibleSystems,
  canBuildDesign, canUseComponent, componentCap, GameError, leaveWarSide, Battles, NPC, Season, AI, isProtected, portalOffer, battleStep: () => Battles.step(now())
};
