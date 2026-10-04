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
 *   5. PROYECTOS: investigación, componentes, diseños, licencias, producción
 *   6. BÉLICO: flotas, movimiento, batallas, invasiones
 *   7. DIPLOMACIA: guerras, paz, alianzas, ofertas
 *   8. Bucle de juego (tick)
 * ===================================================================== */
const GD = require('../public/shared/gamedata.js');
const S = require('./state.js');
const { findPath } = require('./galaxy.js');
const { resolveSpaceBattle, resolveGroundBattle } = require('./combat.js');

const TICK_SECONDS = Number(process.env.TICK_SECONDS || 300); // duración de un ciclo económico
let emit = { nation() {}, news() {}, dirty() {} };            // inyectado por index.js
function setEmitter(e) { emit = e; }

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
  return Object.keys(cost).map(k => (k === 'credits' ? '₡' : (GD.RESOURCES[k] ? GD.RESOURCES[k].emoji : k)) + ' ' + Math.ceil(cost[k] * mult)).join(', ');
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
function createNation(userId, data) {
  const w = W();
  const name = String(data.name || '').trim().slice(0, 24);
  if (name.length < 3) fail('El nombre debe tener al menos 3 letras');
  if (Object.values(w.nations).some(n => n.alive && n.name.toLowerCase() === name.toLowerCase())) fail('Ese nombre ya existe');
  const flag = sanitizeFlag(data.flag);
  // Planeta capital: el pedido si es libre; si no, uno libre lejos de otras naciones
  let capital = data.planetId && w.planets[data.planetId] && !w.planets[data.planetId].owner ? w.planets[data.planetId] : null;
  if (!capital) {
    const free = Object.values(w.planets).filter(p => !p.owner && p.biome !== 'gaseoso');
    const occupiedSystems = new Set(Object.values(w.planets).filter(p => p.owner).map(p => p.system));
    const good = free.filter(p => !occupiedSystems.has(p.system) && !w.systems[p.system].links.some(l => occupiedSystems.has(l)));
    const pool = good.length ? good : free.filter(p => !occupiedSystems.has(p.system));
    if (!pool.length && !free.length) fail('No quedan planetas libres');
    capital = (pool.length ? pool : free).sort((a, b) => b.popCap - a.popCap)[0];
  }
  if (capital.biome === 'gaseoso') fail('No se puede fundar una capital en un gigante gaseoso');
  const id = S.uid('n');
  const n = {
    id, userId, name, flag, motto: String(data.motto || '').slice(0, 60),
    alive: true, createdAt: now(), capital: capital.id,
    credits: GD.RULES.startCredits, research: GD.RULES.startResearch,
    resources: Object.assign({}, GD.RULES.startResources),
    tax: 0.25, stats: { unemployment: 0.1, evasion: 0.1, crime: 0.1, poverty: 0.2, popularity: 0.6, stability: 0.7 },
    techs: GD.TECHS.filter(t => t.cost === 0).map(t => t.id),
    licenses: [], alliance: null, inbox: [], lastIncome: null, betrayals: 0
  };
  w.nations[id] = n;
  w.users[userId].nationId = id;
  capital.owner = id;
  capital.pop = Math.max(capital.pop, GD.RULES.startPopulation);
  capital.popCap = Math.max(capital.popCap, GD.RULES.startPopulation * 1.6);
  capital.stability = 0.8;
  capital.buildings = { extractor: 1, fabrica: 1, astillero: 1, cuartel: 1, laboratorio: 1 };
  // Flota inicial
  const f = makeFleet(id, capital.system, 'Flota Nacional');
  f.units = { bd_corb: 2, bd_caza: 6 };
  makeFleet(id, capital.system, 'Guarnición ' + capital.name).units = { bd_inf: 10 };
  news('🌟 Nace una nueva nación: ' + name + ' en ' + capital.name, 'nation');
  notify(id, '¡Bienvenido, líder de ' + name + '! Tu capital es ' + capital.name + '. Construye, investiga y forja alianzas.', 'good');
  return n;
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
  let pop = 0, gdp = 0, jobs = 0, research = 2, buildUpkeep = 0;
  const prod = {};
  for (const p of planets) {
    pop += p.pop;
    let pGdpMult = 1 + gdpBonus;
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
    gdp += p.pop * GD.RULES.gdpPerMillion * pGdpMult * (0.6 + p.stability * 0.4);
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
  for (const n of Object.values(w.nations)) {
    if (!n.alive) continue;
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
      p.pop = Math.round(clamp(p.pop * (1 + growth), 0.1, cap) * 100) / 100;
      p.stability = clamp(p.stability + (e.stats.stability - p.stability) * 0.25, 0.05, 1);
    }
    // Bancarrota: si los créditos son negativos, cae la estabilidad
    if (n.credits < 0) { n.stats.stability = clamp(n.stats.stability - 0.08, 0.05, 1); notify(n.id, '⚠️ ¡Tesoro en negativo! La estabilidad cae. Baja gastos o sube impuestos.', 'bad'); }
    emit.nation(n.id, { type: 'cycle', text: 'Ciclo ' + w.cycle + ': ' + (e.net >= 0 ? '+' : '') + e.net.toLocaleString('es') + ' ₡' });
  }
  // Planetas independientes crecen lento
  for (const p of Object.values(w.planets)) if (!p.owner) p.pop = Math.round(Math.min(p.popCap, p.pop * 1.01) * 100) / 100;
  // El Consorcio ajusta precios hacia su valor base (recupera 10% por ciclo)
  const base = { aleaciones: 40, energia: 35, helio3: 50, cristales: 90, exoticos: 160, compuestos: 70 };
  for (const r in w.npcPrices) w.npcPrices[r] = Math.round(w.npcPrices[r] + (base[r] - w.npcPrices[r]) * 0.1);
  w.nextCycleAt = now() + TICK_SECONDS * 1000;
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
  if (building === 'extractor' && have >= p.size * 2) fail('Máximo ' + p.size * 2 + ' extractores en este planeta');
  // El coste sube un 15% por cada edificio igual ya construido
  pay(n, B.cost, Math.pow(1.15, have));
  p.buildings[building] = have + 1;
  return { ok: true, msg: B.emoji + ' ' + B.name + ' construido en ' + p.name };
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
  return { ok: true, msg: 'Nueva capital: ' + p.name };
}
function actAnnex(n, { planetId }) {
  const w = W();
  const p = w.planets[planetId];
  if (!p || p.owner) fail('Ese planeta no está disponible');
  const present = planetsOf(n.id).some(q => q.system === p.system) || fleetsOf(n.id).some(f => f.system === p.system && !f.path);
  if (!present) fail('Necesitas una flota en el sistema o un planeta propio en él');
  const cost = { credits: Math.round(5000 + p.pop * GD.RULES.annexCostPerMillion) };
  pay(n, cost);
  p.owner = n.id; p.stability = 0.5;
  news('🪐 ' + n.name + ' anexó pacíficamente ' + p.name, 'nation');
  return { ok: true, msg: p.name + ' se unió a tu nación' };
}

/** Mercado del Consorcio (NPC): compra/venta de recursos con precio dinámico */
function actNpcTrade(n, { resource, amount, side }) {
  const w = W();
  amount = Math.floor(Number(amount));
  if (!GD.RESOURCES[resource] || !(amount > 0) || amount > 10000) fail('Cantidad inválida');
  const price = w.npcPrices[resource];
  if (side === 'buy') {
    const total = Math.round(price * 1.1 * amount);
    pay(n, { credits: total });
    n.resources[resource] = (n.resources[resource] || 0) + amount;
    w.npcPrices[resource] = Math.round(price * (1 + amount / 4000));
    return { ok: true, msg: 'Compraste ' + amount + ' ' + GD.RESOURCES[resource].name + ' por ₡' + total };
  } else {
    if ((n.resources[resource] || 0) < amount) fail('No tienes tanto');
    const total = Math.round(price * 0.8 * amount);
    n.resources[resource] -= amount; n.credits += total;
    w.npcPrices[resource] = Math.max(5, Math.round(price * (1 - amount / 4000)));
    return { ok: true, msg: 'Vendiste ' + amount + ' ' + GD.RESOURCES[resource].name + ' por ₡' + total };
  }
}

/** Mercado entre jugadores: órdenes de venta de recursos o licencias de diseños */
function actMarketPost(n, { kind, resource, amount, price, designId }) {
  const w = W();
  price = Math.round(Number(price));
  if (!(price > 0) || price > 1e9) fail('Precio inválido');
  const id = S.uid('m');
  if (kind === 'resource') {
    amount = Math.floor(Number(amount));
    if (!GD.RESOURCES[resource] || !(amount > 0) || (n.resources[resource] || 0) < amount) fail('No tienes ese recurso');
    n.resources[resource] -= amount; // queda en depósito (escrow)
    w.market[id] = { id, kind, seller: n.id, resource, amount, price, t: now() };
  } else if (kind === 'design') {
    const d = w.designs[designId];
    if (!d || d.owner !== n.id || d.status !== 'ready') fail('Solo puedes vender licencias de tus diseños terminados');
    if (Object.values(w.market).some(m => m.designId === designId)) fail('Ese diseño ya está a la venta');
    w.market[id] = { id, kind, seller: n.id, designId, price, t: now() };
  } else fail('Tipo inválido');
  news('🛒 ' + n.name + ' publicó una oferta en el mercado', 'trade');
  return { ok: true, msg: 'Publicado en el mercado' };
}
function actMarketBuy(n, { id }) {
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
    if (seller) notify(seller.id, '💰 ' + n.name + ' compró tus ' + m.amount + ' ' + GD.RESOURCES[m.resource].name + ' por ₡' + m.price, 'good');
    return { ok: true, msg: 'Compra realizada' };
  }
  // Licencia: la oferta queda activa (se puede vender a muchos compradores)
  const d = w.designs[m.designId];
  if (!d) { delete w.market[id]; fail('El diseño ya no existe'); }
  if (n.licenses.includes(d.id)) fail('Ya tienes esta licencia');
  pay(n, { credits: m.price });
  n.licenses.push(d.id);
  if (seller) { seller.credits += m.price; notify(seller.id, '📜 ' + n.name + ' compró la licencia de "' + d.name + '" por ₡' + m.price, 'good'); }
  news('📜 ' + n.name + ' compró la licencia de "' + d.name + '" a ' + (seller ? seller.name : '?'), 'trade');
  return { ok: true, msg: 'Licencia adquirida: ya puedes fabricar "' + d.name + '"' };
}
function actMarketCancel(n, { id }) {
  const w = W();
  const m = w.market[id];
  if (!m || m.seller !== n.id) fail('No es tu oferta');
  if (m.kind === 'resource') n.resources[m.resource] = (n.resources[m.resource] || 0) + m.amount;
  delete w.market[id];
  return { ok: true, msg: 'Oferta retirada' };
}

/* ---------------------------------------------------------------
 * 5. PROYECTOS Y TECNOLOGÍA
 * --------------------------------------------------------------- */
function actResearch(n, { techId }) {
  const t = GD.techById(techId);
  if (!t) fail('Tecnología inválida');
  if (n.techs.includes(techId)) fail('Ya investigada');
  for (const r of t.req) if (!n.techs.includes(r)) fail('Requiere: ' + GD.techById(r).name);
  if (n.research < t.cost) fail('Te faltan Puntos de Investigación (PI)');
  n.research -= t.cost;
  n.techs.push(techId);
  return { ok: true, msg: '🔬 Investigado: ' + t.name };
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
  w.components[id] = Object.assign(comp, { id, owner: n.id, status: 'developing', readyAt: now() + dev.minutes * 60000, createdAt: now() });
  return { ok: true, msg: '🧪 Proyecto iniciado: ' + name + ' (' + dev.minutes + ' min)' };
}

function canUseComponent(n, c) {
  if (!c || c.status !== 'ready') return false;
  if (c.public || c.owner === n.id) return true;
  // Puedes usar componentes que vienen en diseños que licenciaste
  return n.licenses.some(did => (W().designs[did] || { components: [] }).components.includes(c.id));
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
  w.designs[id] = Object.assign(design, { id, owner: n.id, status: 'developing', readyAt: now() + dev.minutes * 60000, createdAt: now() });
  return { ok: true, msg: '🛠️ Proyecto de ' + H.name + ' iniciado: ' + name + ' (' + dev.minutes + ' min)' };
}
function canBuildDesign(n, d) {
  return d && d.status === 'ready' && (d.public || d.owner === n.id || n.licenses.includes(d.id));
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
  // Regalías: el creador del diseño cobra 10% del coste en créditos
  if (d.owner && d.owner !== n.id && w.nations[d.owner]) {
    const roy = Math.round((s.unitCost.credits || 0) * count * 0.10);
    w.nations[d.owner].credits += roy;
    notify(d.owner, '💸 Regalías: ' + n.name + ' fabricó ' + count + 'x "' + d.name + '" (+₡' + roy + ')', 'good');
  }
  const last = w.buildQueue.filter(q => q.planetId === planetId && q.domain === H.domain).reduce((a, q) => Math.max(a, q.readyAt), now());
  const secs = Math.round(H.build * Math.pow(count, 0.75));
  w.buildQueue.push({ id: S.uid('q'), nation: n.id, designId, planetId, count, domain: H.domain, readyAt: last + secs * 1000 });
  return { ok: true, msg: '🏭 Fabricando ' + count + 'x ' + d.name + ' (' + fmtTime(secs) + ')' };
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
function actMoveFleet(n, { fleetId, to }) {
  const w = W();
  const f = w.fleets[fleetId];
  if (!f || f.owner !== n.id) fail('Flota inválida');
  if (!w.systems[to]) fail('Destino inválido');
  const info = fleetInfo(f);
  if (!info.space) fail('Las tropas necesitan naves para moverse');
  if (info.groundSize > info.capacity) fail('Faltan transportes: capacidad ' + info.capacity + ', tropas ' + info.groundSize);
  const from = f.path ? f.path[0] : f.system;
  const path = findPath(w.systems, from, to);
  if (!path || path.length < 2) fail('No hay ruta');
  f.path = path.slice(1);
  if (!f.nextJumpAt) f.nextJumpAt = now() + jumpMs(n, info.speed);
  return { ok: true, msg: '🚀 ' + f.name + ' en camino (' + f.path.length + ' saltos)' };
}
function jumpMs(n, speed) { return Math.round(GD.RULES.jumpSeconds * 1000 * 5 / Math.max(1, speed) / (1 + nationTechBonus(n, 'fleetSpeed'))); }
function actStopFleet(n, { fleetId }) {
  const f = W().fleets[fleetId];
  if (!f || f.owner !== n.id) fail('Flota inválida');
  f.path = null; f.nextJumpAt = null;
  return { ok: true, msg: 'Flota detenida' };
}
/** Divide/une flotas: mueve unidades de una flota a otra (o a una nueva) en el mismo sistema */
function actTransferUnits(n, { fromId, toId, designId, count, newName }) {
  const w = W();
  const a = w.fleets[fromId];
  if (!a || a.owner !== n.id || a.path) fail('Flota de origen inválida (debe estar quieta)');
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
function actRenameFleet(n, { fleetId, name }) {
  const f = W().fleets[fleetId];
  if (!f || f.owner !== n.id) fail('Flota inválida');
  f.name = String(name || '').trim().slice(0, 24) || f.name;
  return { ok: true };
}
function actScrap(n, { fleetId, designId, count }) {
  const f = W().fleets[fleetId];
  count = Math.floor(Number(count));
  if (!f || f.owner !== n.id || !(count > 0) || (f.units[designId] || 0) < count) fail('Inválido');
  f.units[designId] -= count; if (!f.units[designId]) delete f.units[designId];
  if (!Object.keys(f.units).length) delete W().fleets[f.id];
  return { ok: true, msg: 'Unidades desmanteladas' };
}

/** Invasión de un planeta enemigo (requiere guerra y superioridad orbital) */
function actInvade(n, { fleetId, planetId }) {
  const w = W();
  const f = w.fleets[fleetId], p = w.planets[planetId];
  if (!f || f.owner !== n.id || f.path) fail('Flota inválida');
  if (!p || p.system !== f.system) fail('El planeta debe estar en el sistema de la flota');
  if (!p.owner) fail('Planeta independiente: usa "Anexar"');
  if (p.owner === n.id) fail('Ya es tuyo');
  if (!atWar(n.id, p.owner)) fail('Debes estar en guerra con ' + w.nations[p.owner].name);
  // Superioridad orbital: no debe haber naves espaciales enemigas ni defensas en pie
  const enemySpace = Object.values(w.fleets).some(o => o.system === f.system && !o.path && atWar(n.id, o.owner) && fleetInfo(o).space > 0);
  if (enemySpace) fail('Primero destruye las naves enemigas del sistema');
  if ((p.defenseHp || 0) > 0 && planetDefenseGroup(p)) fail('Las defensas orbitales siguen activas');
  const atk = groundGroups(f);
  if (!atk.length) fail('La flota no lleva tropas');
  const defFleets = Object.values(w.fleets).filter(o => o.system === p.system && o.owner === p.owner && !o.path);
  const def = [].concat(...defFleets.map(groundGroups));
  const militia = p.pop * 4;
  const res = resolveGroundBattle(atk, def, militia, now() % 100000);
  applyGroundLosses(f, atk);
  defFleets.forEach(df => applyGroundLosses(df, def.filter(g => g.fleetId === df.id)));
  const defender = w.nations[p.owner];
  const repId = S.uid('r');
  w.reports[repId] = { id: repId, t: now(), kind: 'ground', planet: p.name, system: p.system, attacker: n.id, defender: p.owner, winner: res.winner === 'A' ? n.id : p.owner, rounds: res.rounds };
  if (res.winner === 'A') {
    const prevOwner = p.owner;
    p.owner = n.id; p.stability = 0.3; p.pop = Math.round(p.pop * 0.85 * 100) / 100;
    // Las tropas supervivientes desembarcan como guarnición
    const gar = makeFleet(n.id, p.system, 'Guarnición ' + p.name);
    for (const d in f.units) { const s = statsOf(d); if (s && s.domain === 'ground') { gar.units[d] = f.units[d]; delete f.units[d]; } }
    if (!Object.keys(f.units).length) delete w.fleets[f.id];
    news('⚔️ ' + n.name + ' conquistó ' + p.name + ' de ' + defender.name + '!', 'war');
    notify(prevOwner, '🔥 ¡Perdimos ' + p.name + ' ante ' + n.name + '!', 'bad');
    checkElimination(prevOwner, n.id);
    return { ok: true, msg: '🏴 ¡' + p.name + ' es nuestro!', report: repId };
  }
  notify(p.owner, '🛡️ Repelimos una invasión de ' + n.name + ' en ' + p.name, 'good');
  return { ok: true, msg: '❌ La invasión de ' + p.name + ' fracasó', report: repId };
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
  news('💀 ' + n.name + ' ha caído' + (byId ? ' ante ' + w.nations[byId].name : '') + '. Quedan ' + Object.values(w.nations).filter(x => x.alive).length + ' naciones.', 'war');
  emit.nation(nid, { type: 'eliminated' });
  const alive = Object.values(w.nations).filter(x => x.alive);
  if (alive.length === 1 && Object.keys(w.nations).length > 1) news('👑 ' + alive[0].name + ' DOMINA LA GALAXIA. ¡Fin de la temporada!', 'victory');
}

/** Defensa planetaria como "grupo" de combate */
function planetDefenseGroup(p) {
  const bat = p.buildings.bateria || 0, esc = p.buildings.escudo || 0;
  if (!bat && !esc) return null;
  const hp = bat * GD.BUILDINGS.bateria.defense.hp + esc * GD.BUILDINGS.escudo.defense.hp;
  return {
    name: 'Defensas de ' + p.name, planetId: p.id, count: 1, isPlanet: true,
    stats: { hp, size: 30, role: 'line', armor: bat * 15, shield: esc * GD.BUILDINGS.escudo.defense.shield, pd: bat * 10, sensors: 10, ecm: 0,
      weapons: bat ? [{ type: 'railgun', dmgType: 'cinetico', range: [1, 1, 1], dmg: bat * GD.BUILDINGS.bateria.defense.kinetic, rel: 0.95, antiCapital: 1 }] : [] }
  };
}

/* ---------------------------------------------------------------
 * 7. DIPLOMACIA
 * --------------------------------------------------------------- */
function atWar(a, b) {
  if (!a || !b || a === b) return false;
  return Object.values(W().wars).some(w => w.active && ((w.attackers.includes(a) && w.defenders.includes(b)) || (w.attackers.includes(b) && w.defenders.includes(a))));
}
function actDeclareWar(n, { targetId, name }) {
  const w = W();
  const t = w.nations[targetId];
  if (!t || !t.alive || t.id === n.id) fail('Objetivo inválido');
  if (atWar(n.id, t.id)) fail('Ya están en guerra');
  if (n.alliance && n.alliance === t.alliance) fail('Es tu aliado. Sal de la alianza primero (será una traición pública)');
  const id = S.uid('w');
  w.wars[id] = { id, name: String(name || ('Guerra ' + n.name + '-' + t.name)).slice(0, 40), attackers: [n.id], defenders: [t.id], active: true, startedAt: now() };
  news('⚔️ ¡' + n.name + ' declaró la guerra a ' + t.name + '!', 'war');
  notify(t.id, '⚔️ ' + n.name + ' nos declaró la guerra. ¡Prepara las defensas y llama a tus aliados!', 'bad');
  if (t.alliance) for (const mid of w.alliances[t.alliance].members) if (mid !== t.id) notify(mid, '📣 Tu aliado ' + t.name + ' fue atacado por ' + n.name + '. Puedes unirte a la guerra desde Diplomacia.', 'warn');
  return { ok: true, msg: 'Guerra declarada' };
}
function actJoinWar(n, { warId, side }) {
  const war = W().wars[warId];
  if (!war || !war.active) fail('Guerra inválida');
  if (war.attackers.includes(n.id) || war.defenders.includes(n.id)) fail('Ya participas');
  const list = side === 'attackers' ? war.attackers : war.defenders;
  list.push(n.id);
  news('🛡️ ' + n.name + ' se unió a "' + war.name + '" del lado ' + (side === 'attackers' ? 'atacante' : 'defensor'), 'war');
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
  notify(other[0], '🕊️ ' + n.name + ' propone la paz en "' + war.name + '". Revisa Diplomacia > Ofertas.', 'warn');
  return { ok: true, msg: 'Propuesta de paz enviada' };
}
function leaveWarSide(n, war) {
  war.attackers = war.attackers.filter(x => x !== n.id); war.defenders = war.defenders.filter(x => x !== n.id);
  if (!war.attackers.length || !war.defenders.length) { war.active = false; war.endedAt = now(); }
}

/** Ofertas privadas: intercambio de créditos/recursos/licencias entre dos naciones */
function actOffer(n, { to, give, want, message }) {
  const w = W();
  const t = w.nations[to];
  if (!t || !t.alive || t.id === n.id) fail('Destino inválido');
  const clean = o => {
    const r = {};
    for (const k in (o || {})) if (k === 'credits' || GD.RESOURCES[k]) { const v = Math.floor(+o[k]); if (v > 0) r[k] = v; }
    if (o && o.designId && w.designs[o.designId]) r.designId = o.designId;
    return r;
  };
  const g = clean(give), wt = clean(want);
  if (!Object.keys(g).length && !Object.keys(wt).length) fail('Oferta vacía');
  if (g.designId && w.designs[g.designId].owner !== n.id) fail('Solo puedes ofrecer licencias de tus diseños');
  const id = S.uid('o');
  w.offers[id] = { id, kind: 'trade', from: n.id, to, give: g, want: wt, message: String(message || '').slice(0, 140), t: now() };
  notify(to, '🤝 ' + n.name + ' te envió una oferta comercial', 'warn');
  return { ok: true, msg: 'Oferta enviada' };
}
function transfer(from, to, bundle) {
  const res = Object.assign({}, bundle); delete res.designId;
  pay(from, res);
  for (const k in res) { if (k === 'credits') to.credits += res[k]; else to.resources[k] = (to.resources[k] || 0) + res[k]; }
  if (bundle.designId && !to.licenses.includes(bundle.designId)) to.licenses.push(bundle.designId);
}
function actRespondOffer(n, { id, accept }) {
  const w = W();
  const o = w.offers[id];
  if (!o || (o.to !== n.id && o.from !== n.id)) fail('Oferta inválida');
  delete w.offers[id];
  if (!accept || o.from === n.id) { if (o.from !== n.id) notify(o.from, '❌ ' + n.name + ' rechazó tu oferta', 'bad'); return { ok: true, msg: 'Oferta cerrada' }; }
  const from = w.nations[o.from];
  if (!from || !from.alive) fail('La otra nación ya no existe');
  if (o.kind === 'peace') {
    const war = w.wars[o.warId];
    if (war && war.active) { war.active = false; war.endedAt = now(); news('🕊️ Paz firmada: fin de "' + war.name + '"', 'peace'); }
    return { ok: true, msg: 'Paz firmada' };
  }
  if (o.kind === 'alliance_invite') {
    const a = w.alliances[o.allianceId];
    if (!a) fail('La alianza ya no existe');
    if (n.alliance) fail('Ya estás en una alianza');
    a.members.push(n.id); n.alliance = a.id;
    news('🤝 ' + n.name + ' se unió a la alianza [' + a.tag + '] ' + a.name, 'alliance');
    return { ok: true, msg: 'Te uniste a ' + a.name };
  }
  // Comercio: validar ambos lados antes de mover nada (atómico)
  const gRes = Object.assign({}, o.give); delete gRes.designId;
  const wRes = Object.assign({}, o.want); delete wRes.designId;
  if (!canAfford(from, gRes)) fail(from.name + ' ya no tiene lo que ofreció');
  if (!canAfford(n, wRes)) fail('No tienes lo que te piden');
  if (o.want.designId && w.designs[o.want.designId].owner !== n.id) fail('Ese diseño no es tuyo');
  transfer(from, n, o.give);
  transfer(n, from, o.want);
  notify(from.id, '✅ ' + n.name + ' aceptó tu oferta', 'good');
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
  news('🤝 Se fundó la alianza [' + tag + '] ' + name + ' liderada por ' + n.name, 'alliance');
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
  notify(t.id, '📨 ' + n.name + ' te invita a la alianza [' + a.tag + '] ' + a.name, 'warn');
  return { ok: true, msg: 'Invitación enviada' };
}
function leaveAlliance(n) {
  const w = W();
  const a = w.alliances[n.alliance];
  n.alliance = null;
  if (!a) return;
  a.members = a.members.filter(m => m !== n.id);
  if (!a.members.length) { delete w.alliances[a.id]; news('🏚️ La alianza [' + a.tag + '] se disolvió', 'alliance'); }
  else if (a.leader === n.id) a.leader = a.members[0];
}
function actLeaveAlliance(n, { betray }) {
  const a = W().alliances[n.alliance];
  if (!a) fail('No estás en una alianza');
  news((betray ? '🗡️ ¡TRAICIÓN! ' : '👋 ') + n.name + ' abandonó la alianza [' + a.tag + ']', betray ? 'war' : 'alliance');
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
  notify(t.id, '🚪 Fuiste expulsado de [' + a.tag + ']', 'bad');
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
 * saltos de flotas, batallas y ciclo económico.
 * --------------------------------------------------------------- */
const lastBattleAt = {}; // systemId -> timestamp
function tick() {
  const w = W();
  const t = now();
  let changed = false;
  if (!w.nextCycleAt) w.nextCycleAt = t + TICK_SECONDS * 1000;
  if (t >= w.nextCycleAt) { runCycle(); changed = true; }
  // Proyectos
  for (const c of Object.values(w.components)) if (c.status === 'developing' && t >= c.readyAt) { c.status = 'ready'; notify(c.owner, '✅ Componente listo: ' + c.name, 'good'); changed = true; }
  for (const d of Object.values(w.designs)) if (d.status === 'developing' && t >= d.readyAt) { d.status = 'ready'; notify(d.owner, '✅ Diseño listo: ' + d.name + '. ¡Ya puedes fabricarlo o venderlo!', 'good'); changed = true; }
  // Producción
  w.buildQueue = w.buildQueue.filter(q => {
    if (t < q.readyAt) return true;
    const p = w.planets[q.planetId];
    if (p && p.owner === q.nation) {
      let f = Object.values(w.fleets).find(f => f.owner === q.nation && f.system === p.system && !f.path && f.name.startsWith(q.domain === 'ground' ? 'Guarnición' : 'Flota'));
      if (!f) f = makeFleet(q.nation, p.system, q.domain === 'ground' ? 'Guarnición ' + p.name : 'Flota de ' + p.name);
      f.units[q.designId] = (f.units[q.designId] || 0) + q.count;
      notify(q.nation, '🏭 Producción terminada: ' + q.count + 'x ' + (w.designs[q.designId] || {}).name + ' en ' + p.name, 'good');
    }
    changed = true;
    return false;
  });
  // Movimiento de flotas
  for (const f of Object.values(w.fleets)) {
    if (!f.path || !f.nextJumpAt || t < f.nextJumpAt) continue;
    f.system = f.path.shift();
    changed = true;
    if (!f.path.length) { f.path = null; f.nextJumpAt = null; notify(f.owner, '📍 ' + f.name + ' llegó a ' + w.systems[f.system].name, 'info'); }
    else f.nextJumpAt = t + jumpMs(w.nations[f.owner], fleetInfo(f).speed);
    // Interdicción: una flota enemiga en el sistema detiene el avance (como un bloqueo)
    const hostile = Object.values(w.fleets).some(o => o.system === f.system && atWar(f.owner, o.owner) && fleetInfo(o).space > 0);
    if (hostile && f.path) { f.path = null; f.nextJumpAt = null; notify(f.owner, '🚨 ' + f.name + ' fue interceptada en ' + w.systems[f.system].name, 'bad'); }
  }
  // Batallas
  for (const sid in w.systems) if (checkBattle(sid, t)) changed = true;
  if (changed) emit.dirty();
}

function checkBattle(sid, t) {
  const w = W();
  if (lastBattleAt[sid] && t - lastBattleAt[sid] < 20000) return false;
  const fleetsHere = Object.values(w.fleets).filter(f => f.system === sid && fleetInfo(f).space > 0);
  const planetsHere = w.systems[sid].planets.map(id => w.planets[id]).filter(p => p.owner && planetDefenseGroup(p));
  const present = new Set([...fleetsHere.map(f => f.owner), ...planetsHere.map(p => p.owner)]);
  if (present.size < 2) return false;
  for (const war of Object.values(w.wars)) {
    if (!war.active) continue;
    const A = [...present].filter(x => war.attackers.includes(x)), B = [...present].filter(x => war.defenders.includes(x));
    // Solo hay batalla si al menos un lado tiene naves (dos planetas no se pelean solos)
    if (!A.length || !B.length) continue;
    if (!fleetsHere.some(f => A.includes(f.owner) || B.includes(f.owner))) continue;
    const build = list => {
      const gs = [];
      for (const f of fleetsHere.filter(f => list.includes(f.owner)))
        for (const d in f.units) { const s = statsOf(d); if (s && s.domain === 'space' && f.units[d] > 0) gs.push({ fleetId: f.id, designId: d, name: w.designs[d].name + ' (' + w.nations[f.owner].name + ')', count: f.units[d], stats: s }); }
      for (const p of planetsHere.filter(p => list.includes(p.owner))) { const g = planetDefenseGroup(p); if ((p.defenseHp == null || p.defenseHp > 0)) gs.push(g); }
      return gs;
    };
    const ga = build(A), gb = build(B);
    if (!ga.length || !gb.length) continue;
    lastBattleAt[sid] = t;
    const res = resolveSpaceBattle(ga, gb, t % 1000000);
    for (const g of ga.concat(gb)) {
      if (g.isPlanet) { const p = w.planets[g.planetId]; p.defenseHp = g.count > 0 ? 1 : 0; if (!g.count) p.defenseDownUntil = t + 5 * 60000; continue; }
      const f = w.fleets[g.fleetId]; if (!f) continue;
      if (g.count > 0) f.units[g.designId] = g.count; else delete f.units[g.designId];
    }
    for (const f of fleetsHere) if (w.fleets[f.id] && !Object.keys(f.units).length) delete w.fleets[f.id];
    const id = S.uid('r');
    w.reports[id] = { id, t, kind: 'space', system: sid, war: war.id, attackers: A, defenders: B, winner: res.winner, result: res };
    const names = l => l.map(x => w.nations[x].name).join(', ');
    news('💥 Batalla en ' + w.systems[sid].name + ': ' + names(A) + ' vs ' + names(B) + ' → ' + (res.winner === 'A' ? 'gana ' + names(A) : res.winner === 'B' ? 'gana ' + names(B) : 'sin vencedor'), 'war');
    for (const nid of A.concat(B)) emit.nation(nid, { type: 'battle', reportId: id });
    trimReports();
    return true;
  }
  return false;
}
// Defensas planetarias se recuperan pasado un tiempo
function regenDefenses() {
  const t = now();
  for (const p of Object.values(W().planets)) if (p.defenseHp === 0 && p.defenseDownUntil && t > p.defenseDownUntil) { p.defenseHp = 1; p.defenseDownUntil = null; }
}
function trimReports() {
  const w = W();
  const ids = Object.keys(w.reports);
  if (ids.length > 300) ids.sort((a, b) => w.reports[a].t - w.reports[b].t).slice(0, ids.length - 300).forEach(id => delete w.reports[id]);
}

/* ---------------------------------------------------------------
 * DESPACHO DE ACCIONES
 * --------------------------------------------------------------- */
const ACTIONS = {
  build: actBuild, demolish: actDemolish, setTax: actSetTax, setCapital: actRenameCapital, annex: actAnnex,
  npcTrade: actNpcTrade, marketPost: actMarketPost, marketBuy: actMarketBuy, marketCancel: actMarketCancel,
  research: actResearch, designComponent: actDesignComponent, designShip: actDesignShip, produce: actProduce,
  moveFleet: actMoveFleet, stopFleet: actStopFleet, transferUnits: actTransferUnits, renameFleet: actRenameFleet, scrap: actScrap, invade: actInvade,
  declareWar: actDeclareWar, joinWar: actJoinWar, proposePeace: actProposePeace, offer: actOffer, respondOffer: actRespondOffer,
  createAlliance: actCreateAlliance, inviteAlliance: actInviteAlliance, leaveAlliance: actLeaveAlliance, kickAlliance: actKickAlliance,
  updateProfile: actUpdateProfile
};
function handleAction(nationId, type, data) {
  const n = W().nations[nationId];
  if (!n || !n.alive) return { ok: false, error: 'No tienes una nación activa' };
  const fn = ACTIONS[type];
  if (!fn) return { ok: false, error: 'Acción desconocida' };
  try {
    const r = fn(n, data || {}) || { ok: true };
    emit.dirty();
    return r;
  } catch (e) {
    if (e instanceof GameError) return { ok: false, error: e.message };
    console.error('[action]', type, e);
    return { ok: false, error: 'Error interno' };
  }
}

module.exports = {
  TICK_SECONDS, setEmitter, tick, regenDefenses, handleAction, createNation, computeEconomy, fleetInfo, statsOf, atWar,
  canBuildDesign, canUseComponent, componentCap, GameError, leaveWarSide
};
