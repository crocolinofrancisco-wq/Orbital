/* =====================================================================
 * NACIONES IA DE RELLENO (bots)
 * ---------------------------------------------------------------------
 * Los bots son naciones COMPLETAS: usan exactamente las mismas acciones
 * que un jugador (X.handleAction), con las mismas reglas y costes. Hacen
 * todo lo que hace un humano:
 *   economía (edificios, impuestos, extracción), investigación (con 2
 *   especialidades, como un humano), diseño de componentes y naves, producción,
 *   mercado de unidades (venden excedentes y compran lo que no pueden fabricar), expansión
 *   (anexar), caza de piratas y criaturas, guerra (declarar, invadir, pedir
 *   la paz), diplomacia (alianzas, ofertas, traiciones) y chat.
 *
 * POR QUÉ NUNCA GANAN (sin "nerfs" numéricos): su debilidad está en la
 * LÓGICA, como en un jugador mediocre pero razonable:
 *   1. Información limitada: solo ven lo que su niebla de guerra permite y
 *      estiman el poder enemigo con ruido (±30 %).
 *   2. Atención limitada: piensan cada 4-10 min y hacen 3-6 acciones por turno.
 *   3. Prudencia: nunca atacan sin ~2.2x de superioridad estimada, solo
 *      mantienen UNA guerra ofensiva y no atacan al jugador más fuerte.
 *   4. Apetito acotado: dejan de expandirse al superar la media humana
 *      (la IA "se conforma"), así no acaparan la galaxia.
 *   5. Diseños mediocres: reparten puntos "razonablemente" sin explotar
 *      contrapartidas (no escogen armas según la flota rival).
 *   6. Se retiran pronto en batalla y aceptan la paz con facilidad.
 *   7. Salvaguarda final (season.js): si solo quedan IA, la temporada se
 *      anula; una IA jamás puede ser declarada ganadora.
 * Personalidades distintas hacen que no todas se comporten igual.
 * Ver docs/IA.md.
 * ===================================================================== */
const GD = require('../public/shared/gamedata.js');

let X = null;
function attach(ctx) { X = ctx; }

const SKILL = Number(process.env.AI_SKILL || 0.55);       // 0 = torpe, 1 = muy competente (nunca supera a un humano atento)
const PERSONAS = {
  mercader:    { aggression: 0.10, econ: 1.0, sci: 0.5, mil: 0.4, social: 0.9, turtle: 0.3, betray: 0,    label: 'Mercader' },
  cientifico:  { aggression: 0.12, econ: 0.7, sci: 1.0, mil: 0.4, social: 0.6, turtle: 0.4, betray: 0,    label: 'Científico' },
  tortuga:     { aggression: 0.06, econ: 0.8, sci: 0.5, mil: 0.7, social: 0.5, turtle: 1.0, betray: 0,    label: 'Defensivo' },
  oportunista: { aggression: 0.45, econ: 0.7, sci: 0.5, mil: 0.8, social: 0.7, turtle: 0.2, betray: 0.03, label: 'Oportunista' },
  /* Solo para pruebas de balance: representa a un jugador humano competente y ambicioso (server/tools/simulate.js) */
  jugador:     { aggression: 1.0,  econ: 0.8, sci: 0.7, mil: 1.0, social: 0.6, turtle: 0.3, betray: 0,    label: 'Jugador simulado' },
  belicista:   { aggression: 0.65, econ: 0.6, sci: 0.5, mil: 1.0, social: 0.4, turtle: 0.2, betray: 0,    label: 'Belicista' }
};
/** Ramas que prefiere cada personalidad (elige 2 al azar): asi el mercado tiene de todo y las IA dependen unas de otras */
const SPEC_PREF = {
  mercader: ['sistemas', 'misiles', 'energia'], cientifico: ['energia', 'sistemas', 'misiles'], tortuga: ['balistica', 'orbital', 'energia'],
  oportunista: ['naves', 'cazas', 'misiles'], belicista: ['naves', 'terrestre', 'balistica'], jugador: ['naves', 'energia']
};
function pickSpec(persona) {
  const pool = (SPEC_PREF[persona] || ['naves', 'energia']).slice().sort(() => rnd() - 0.5);
  return pool.slice(0, GD.RULES.specSlots);
}
const NAMES = ['Dominio de Argos', 'Federación Zafiro', 'República de Tessara', 'Imperio Valkor', 'Liga de Orfeo', 'Unión Kestrel', 'Compañía Hesperia', 'Teocracia de Solaris',
  'Coalición Nimbus', 'Mancomunidad Altaír', 'Estado Libre de Ithaka', 'Concordato Lyren', 'Directorio de Vesta', 'Clan Drakmoor', 'Sindicato Perseo', 'Hegemonía Cadmo',
  'Reino de Eos', 'Autarquía Boreal', 'Triunvirato de Mira', 'Alianza Quasar'];
const MOTTOS = ['Paciencia y acero', 'El comercio es la paz', 'Siempre adelante', 'Por la ciencia', 'Cada estrella cuenta', 'No miramos atrás', 'Honor y órbita', 'Nada sin esfuerzo'];
const PALETTE = ['#e63946', '#1d3557', '#f1faee', '#ffb703', '#2a9d8f', '#8338ec', '#06d6a0', '#ef476f', '#118ab2', '#073b4c', '#fb8500', '#3a5a40', '#9d4edd', '#00b4d8'];
const CHAT = {
  hello: ['¡Saludos, galaxia! Abierto a comerciar.', 'Hola a todos, soy nuevo por aquí (bueno, soy una IA 🤖).', 'Buscamos socios comerciales pacíficos.', 'Que las estrellas os sean propicias.'],
  war: ['Esto no es personal, es estrategia.', 'La paz se acabó. Prepárense.', 'Nuestras flotas ya están en camino.'],
  peace: ['Estamos abiertos a la paz.', 'Basta de guerra, ¿firmamos?'],
  trade: ['Tengo excedentes, ¿alguien negocia?', 'Compro cristales a buen precio.', 'Vendo aleaciones, ofertas por privado.'],
  brag: ['Nuestro nuevo diseño está a la venta en el mercado.', 'Acabamos de cazar unos piratas, fácil.']
};

const R = a => a[Math.floor(Math.random() * a.length)];
const rnd = () => Math.random();
const W = () => X.W();

/* ---------------------------------------------------------------
 * CREACIÓN
 * --------------------------------------------------------------- */
function ensureBots(count) {
  const w = W(), names = NAMES.slice().sort(() => rnd() - 0.5);
  const existing = Object.values(w.nations).filter(n => n.bot).length;
  const personas = Object.keys(PERSONAS).filter(k => k !== 'jugador');
  for (let i = existing; i < count; i++) {
    const flag = { layout: R(GD.FLAG_LAYOUTS), emblem: R(GD.FLAG_EMBLEMS), colors: [0, 1, 2].map(() => R(PALETTE)) };
    let n;
    try { n = X.createNation(null, { name: names[i % names.length], motto: R(MOTTOS), flag }, { bot: true, silent: true }); } catch (e) { console.warn('[ai] no se pudo crear bot:', e.message); break; }
    const persona = personas[i % personas.length];
    n.ai = { persona, skill: Math.max(0.2, Math.min(0.85, SKILL * (0.8 + rnd() * 0.4))), noise: 0.2 + rnd() * 0.2, retreatAt: 0.3 + rnd() * 0.15,
      nextThink: X.now() + X.ms(rnd() * 90000), mem: { lastOffer: {}, lastChat: 0, lastWarAt: 0, allySince: {}, designs: 0, colonizer: null, target: null } };
    n.motto = n.motto + ' · IA ' + PERSONAS[persona].label;
    n.spec = pickSpec(persona);
  }
}

/* ---------------------------------------------------------------
 * UTILIDADES DE PERCEPCIÓN
 * --------------------------------------------------------------- */
const myPlanets = n => X.planetsOf(n.id);
const myFleets = n => X.fleetsOf(n.id);
const idle = f => !f.path && !f.battle;
function hops(from, to) {
  const S = W().systems; if (from === to) return 0;
  const seen = { [from]: 0 }, q = [from];
  while (q.length) { const c = q.shift(); for (const l of S[c].links) if (!(l in seen) && S[c].portal !== l) { seen[l] = seen[c] + 1; if (l === to) return seen[l]; q.push(l); } }
  return 99;
}
/** Poder enemigo estimado con ruido, solo con lo visible */
function estPower(n, nid) {
  const w = W(), vis = X.visibleSystems(n.id);
  let pw = 0, seen = false;
  for (const f of Object.values(w.fleets)) if (f.owner === nid && vis.has(f.system)) { pw += X.fleetInfo(f).power; seen = true; }
  for (const p of Object.values(w.planets)) if (p.owner === nid && vis.has(p.system)) { pw += ((p.buildings.bateria || 0) * 60 + (p.buildings.escudo || 0) * 80) * GD.NUM_K; seen = true; }
  if (!seen) { const o = w.nations[nid]; pw = o ? X.computeEconomy(o).gdp / 25 : 0; }
  return pw * (1 + n.ai.noise * (rnd() * 2 - 1));
}
function humanPlanetsMedian() {
  const w = W();
  const hs = Object.values(w.nations).filter(x => x.alive && !x.npc && !x.bot).map(x => X.planetsOf(x.id).length).sort((a, b) => a - b);
  return hs.length ? hs[Math.floor(hs.length / 2)] : null;
}
/** Apetito de expansión: la IA se conforma al superar la media humana */
function mayExpand(n) {
  const mine = myPlanets(n).length, prog = X.seasonProgress();
  if (n.ai.persona === 'jugador') return mine < 30;
  const cap = 3 + prog * 10;
  if (mine >= cap) return false;
  const med = humanPlanetsMedian();
  if (med != null && mine >= med * 1.25 + 2) return false;
  return true;
}
function valueOf(bundle) {
  const w = W(); let v = 0;
  for (const k in bundle) if (k === 'credits') v += bundle[k]; else if (k !== 'designId') v += bundle[k] * (w.npcPrices[k] || 40);
  return v;
}
const atWarWithAny = n => Object.values(W().wars).some(wr => wr.active && (wr.attackers.includes(n.id) || wr.defenders.includes(n.id)));
function activeWars(n) { return Object.values(W().wars).filter(wr => wr.active && (wr.attackers.includes(n.id) || wr.defenders.includes(n.id))); }
function enemiesOf(n) {
  const out = new Set();
  for (const wr of activeWars(n)) for (const id of (wr.attackers.includes(n.id) ? wr.defenders : wr.attackers)) out.add(id);
  return [...out].filter(id => { const o = W().nations[id]; return o && o.alive; });
}
const DEBUG = !!process.env.AI_DEBUG;
const dbg = (n, ...a) => { if (DEBUG) console.log('[ia]', n.name.slice(0, 14), ...a); };
function act(n, type, data) { return X.handleAction(n.id, type, data); }

/* ---------------------------------------------------------------
 * BUCLE
 * --------------------------------------------------------------- */
function tick(t) {
  const w = W();
  if (w.season.status !== 'running') return;
  for (const n of Object.values(w.nations)) {
    if (!n.alive || !n.ai) continue;   // bots y "jugadores simulados" de las pruebas de balance
    if (t < n.ai.nextThink) continue;
    n.ai.nextThink = t + X.ms((240 + rnd() * 360) * 1000);
    try { think(n, t); } catch (e) { console.error('[ai]', n.name, e); }
  }
}

function think(n, t) {
  const P = PERSONAS[n.ai.persona];
  const ctx = { n, P, t, sim: n.ai.persona === 'jugador', planets: myPlanets(n), eco: X.computeEconomy(n), budget: 3 + Math.floor(n.ai.skill * 4) };
  ctx.reserve = (3500 + 1400 * ctx.planets.length * (0.6 + P.turtle * 0.5)) * GD.NUM_K;
  respondOffers(ctx);
  if (n.govFallen) { const best = ctx.planets.filter(p => p.id !== n.capital).sort((a, b) => b.pop - a.pop)[0]; if (best) act(n, 'setCapital', { planetId: best.id }); }
  tax(ctx);
  fleetsKeeping(ctx);
  threats(ctx);
  research(ctx);
  economy(ctx);
  designs(ctx);
  military(ctx);
  expansion(ctx);
  war(ctx);
  campaigns(ctx);
  diplomacy(ctx);
  market(ctx);
  chat(ctx);
}

/* ---------------------------------------------------------------
 * ECONOMÍA
 * --------------------------------------------------------------- */
function tax(c) {
  const { n } = c, st = n.stats;
  let t = n.tax;
  if (st.stability < 0.5 || st.popularity < 0.45) t -= 0.03;
  else if (n.credits < c.reserve * 0.6 && st.stability > 0.65) t += 0.02;
  else if (st.popularity > 0.62 && st.stability > 0.7) t += 0.01;
  t = Math.max(0.12, Math.min(0.40, t));
  if (Math.abs(t - n.tax) > 0.001) act(n, 'setTax', { tax: t });
}

function buildScore(c, p, key) {
  const { n, P } = c, B = GD.BUILDINGS[key];
  if (B.requiresTech && !n.techs.includes(B.requiresTech)) return -1;
  const have = p.buildings[key] || 0;
  if (B.max && have >= B.max) return -1;
  const total = Object.values(p.buildings).reduce((a, b) => a + b, 0);
  if (total >= p.size * 4 + 2) return -1;
  if (p.belt && !['extractor', 'planta', 'bateria'].includes(key)) return -1;
  const stock = r => n.resources[r] || 0;
  let s = 0;
  switch (key) {
    case 'extractor': { const max = p.belt ? 5 : p.size * 2; if (have >= max) return -1; s = 4.5 + (stock(p.deposit) < 120 * GD.NUM_K ? 2.5 : 0) + (p.depositRich > 1 ? 1.5 : 0) - have * 0.8; break; }
    case 'planta': s = stock('energia') < 80 * GD.NUM_K ? 5 : (have < 1 ? 1.5 : 0.3); break;
    case 'fabrica': s = 3.4 * P.econ - have * 0.9; break;
    case 'comercio': s = 3.9 * P.econ - have * 0.9; break;
    case 'laboratorio': s = (2.4 + P.sci * 2.2) - have * 0.9 - (c.eco.research > 14 + 10 * P.sci ? 2 : 0); break;
    case 'vivienda': s = p.pop > p.popCap * 0.8 ? 3.6 : 0.5; break;
    case 'astillero': s = p.id === n.capital ? 0 : (c.planets.length > 3 && P.mil > 0.6 ? 2 : -1); break;
    case 'cuartel': s = p.id === n.capital ? 0 : (c.planets.length > 3 ? 1.5 : -1); break;
    case 'bateria': s = (P.turtle * 3.2 - have * 1.0) + (c.threatened && c.threatened.includes(p.system) ? 3 : 0) + (p.id === n.capital ? 1 : 0); break;
    case 'escudo': s = P.turtle * 2.4 + (p.id === n.capital ? 1.5 : 0) - 0.5; break;
  }
  return s * (0.85 + rnd() * 0.3);
}
function economy(c) {
  const { n } = c;
  let spent = 0;
  const planets = c.planets.slice().sort((a, b) => (b.id === n.capital) - (a.id === n.capital) || b.popCap - a.popCap);
  for (let guard = 0; guard < 3 && c.budget > 0; guard++) {
    let best = null;
    for (const p of planets) for (const key in GD.BUILDINGS) {
      const s = buildScore(c, p, key);
      if (s <= 0.8) continue;
      const B = GD.BUILDINGS[key], mult = Math.pow(1.15, p.buildings[key] || 0);
      const cost = (B.cost.credits || 0) * mult;
      if (n.credits - spent < cost + c.reserve * 0.6) continue;
      let ok = true; for (const r in B.cost) if (r !== 'credits' && (n.resources[r] || 0) < B.cost[r] * mult) ok = false;
      if (!ok) continue;
      if (!best || s > best.s) best = { p, key, s, cost };
    }
    if (!best) break;
    const r = act(n, 'build', { planetId: best.p.id, building: best.key });
    if (r.ok) { spent += best.cost; c.budget--; } else break;
  }
}

function research(c) {
  const { n, P } = c;
  const w = { economia: P.econ, sistemas: 0.8, naves: P.mil, cazas: P.mil * 0.8, energia: 0.8 + P.sci * 0.4, balistica: 0.7 + P.turtle * 0.4, misiles: 0.8, terrestre: P.mil * 0.6, orbital: P.turtle };
  const allowed = t => !GD.TECH_BRANCHES[t.branch].spec || n.spec.includes(t.branch);
  const cand = GD.TECHS.filter(t => allowed(t) && !n.techs.includes(t.id) && t.req.every(r => n.techs.includes(r)) && n.research >= t.cost);
  if (!cand.length) return;
  cand.sort((a, b) => ((w[b.branch] || 0.5) * 10 + rnd() * 6 * (1.2 - n.ai.skill) - b.cost * 0.02) - ((w[a.branch] || 0.5) * 10 + rnd() * 6 * (1.2 - n.ai.skill) - a.cost * 0.02));
  act(n, 'research', { techId: cand[0].id });
}

/* ---------------------------------------------------------------
 * DISEÑO (componentes y naves) — razonable pero no óptimo
 * --------------------------------------------------------------- */
function ownComps(n) { return Object.values(W().components).filter(c => c.owner === n.id); }
function usableComps(n) { return Object.values(W().components).filter(c => X.canUseComponent(n, c) && !c.hidden); }
function designs(c) {
  const { n, P } = c, w = W(), me = n.ai;
  if (c.budget <= 0 || n.credits < c.reserve * 0.9) return;
  // 1) un componente nuevo cuando falta alguno de los tipos desbloqueados
  const unlocked = Object.keys(GD.COMPONENT_TYPES).filter(k => !GD.COMPONENT_TYPES[k].npcOnly && !GD.COMPONENT_TYPES[k].groundOnly && X.hasUnlocked(n, 'component', k));
  const mine = ownComps(n);
  if (mine.length < 9 && mine.filter(x => x.status === 'developing').length < 1) {
    const missing = unlocked.filter(k => !mine.some(x => x.type === k));
    if (missing.length) {
      const type = R(missing), cap = X.componentCap(n);
      if (n.credits < (1500 + cap * cap * 6) * GD.NUM_K + c.reserve * 0.5) return;
      const pot = Math.round(cap * (0.5 + rnd() * 0.2)), fia = Math.round(cap * (0.18 + rnd() * 0.12)), efi = Math.max(0, cap - pot - fia);
      const r = act(n, 'designComponent', { type, name: GD.COMPONENT_TYPES[type].name + ' ' + n.name.split(' ').pop().slice(0, 6) + '-' + (mine.length + 1), points: { potencia: pot, fiabilidad: fia, eficiencia: efi } });
      if (r.ok) { c.budget--; return; }
    }
  }
  // 2) una nave nueva cuando hay un casco desbloqueado sin diseño propio
  const myDesigns = Object.values(w.designs).filter(d => d.owner === n.id);
  if (myDesigns.length >= 7 || myDesigns.some(d => d.status === 'developing')) { sellUnits(c); return; }
  const hulls = Object.keys(GD.HULLS).filter(h => !GD.HULLS[h].npcOnly && GD.HULLS[h].domain === 'space' && X.hasUnlocked(n, 'hull', h) && GD.HULLS[h].role !== 'transport');
  const need = hulls.filter(h => !myDesigns.some(d => d.hull === h));
  if (!need.length) { sellUnits(c); return; }
  const hull = need.sort((a, b) => GD.HULLS[b].size - GD.HULLS[a].size)[rnd() < 0.5 ? 0 : Math.min(1, need.length - 1)];
  const H = GD.HULLS[hull];
  if (n.credits < H.devCost + c.reserve * 0.5) return;
  const comps = usableComps(n);
  const choose = (slot, kinds) => {
    const pool = comps.filter(cc => GD.COMPONENT_TYPES[cc.type].slot === slot && (!kinds || kinds.includes(cc.type)));
    if (!pool.length) return null;
    pool.sort((a, b) => (GD.componentStats(b).value * GD.componentStats(b).reliability * (0.85 + rnd() * 0.3)) - (GD.componentStats(a).value * GD.componentStats(a).reliability * (0.85 + rnd() * 0.3)));
    return pool[0].id;
  };
  const list = [];
  const wk = ['laser', 'canon', 'railgun', 'misil', 'torpedo', 'plasma', 'pulso', 'ion', 'enjambre'];
  for (let i = 0; i < (H.slots.arma || 0); i++) {
    const kind = R(wk.filter(k => comps.some(cc => cc.type === k)));
    const id = kind ? choose('arma', [kind]) : null; if (id) list.push(id);
  }
  for (let i = 0; i < (H.slots.defensa || 0); i++) { const id = choose('defensa', i === 0 ? ['blindaje', 'escudo'] : ['blindaje', 'escudo', 'pd']); if (id) list.push(id); }
  for (let i = 0; i < (H.slots.motor || 0); i++) { const id = choose('motor'); if (id) list.push(id); }
  for (let i = 0; i < Math.min(1, H.slots.sistema || 0); i++) { const id = choose('sistema', rnd() < 0.5 ? ['radiador', 'sensor', 'ecm'] : null) || choose('sistema'); if (id) list.push(id); }
  const design = { hull, components: list };
  if (GD.validateDesign(design, id => w.components[id])) return;
  const r = act(n, 'designShip', { hull, name: H.name + ' ' + n.name.split(' ').pop().slice(0, 5) + '-' + (myDesigns.length + 1), components: list, description: 'Diseño de ' + n.name });
  if (r.ok) c.budget--;
}
/** Vende excedentes: un lote de unidades de sus propias flotas quietas, a precio de coste + margen (no vende si esta amenazada) */
function sellUnits(c) {
  const { n, P } = c, w = W();
  if (P.social < 0.5 || rnd() > 0.3 || c.enemyNear || c.budget <= 0) return;
  if (Object.values(w.market).filter(m => m.seller === n.id).length >= 2) return;
  const f = myFleets(n).filter(idle).sort((a, b) => X.fleetInfo(b).count - X.fleetInfo(a).count)[0];
  if (!f) return;
  const d = Object.keys(f.units).filter(id => { const s = X.statsOf(id); return s && s.domain === 'space' && s.role !== 'transport' && f.units[id] >= 10; })[0];
  if (!d) return;
  const count = Math.floor(f.units[d] * 0.3), s = X.statsOf(d);
  const price = Math.round((s.unitCost.credits || 500) * count * (1.15 + rnd() * 0.25));
  if (count >= 3 && act(n, 'marketPost', { kind: 'units', fleetId: f.id, designId: d, count, price }).ok) c.budget--;
}
/** Compra unidades que no puede fabricar (casco que no investigo): solo si le sobra el dinero y la oferta es razonable */
function buyUnits(c) {
  const { n } = c, w = W();
  if (c.budget <= 0 || rnd() > 0.35) return;
  const offers = Object.values(w.market).filter(m => m.kind === 'units' && m.seller !== n.id && !X.atWar(n.id, m.seller));
  let best = null;
  for (const m of offers) {
    const d = w.designs[m.designId], s = X.statsOf(m.designId);
    if (!d || !s || s.domain !== 'space' || s.role === 'transport') continue;
    if (X.hasUnlocked(n, 'hull', d.hull)) continue;                           // si puede fabricarlo, lo fabrica
    if (n.credits - m.price < c.reserve * 1.6) continue;
    const value = s.power * m.count / Math.max(1, m.price);
    if (!best || value > best.value) best = { m, value };
  }
  if (best && best.value > 0.05 && act(n, 'marketBuy', { id: best.m.id }).ok) c.budget--;
}

/* ---------------------------------------------------------------
 * MILITAR
 * --------------------------------------------------------------- */
function bestDesigns(n) {
  const w = W();
  const ok = Object.values(w.designs).filter(d => X.canBuildDesign(n, d) && !d.npc);
  const score = d => { const s = X.statsOf(d.id); if (!s) return 0; return (s.power / Math.max(1, s.unitCost.credits || 1)) * (0.8 + rnd() * 0.4); };
  const space = ok.filter(d => GD.HULLS[d.hull].domain === 'space' && GD.HULLS[d.hull].role !== 'transport');
  return {
    line: space.filter(d => GD.HULLS[d.hull].role === 'line' || GD.HULLS[d.hull].role === 'carrier').sort((a, b) => score(b) - score(a)),
    fighters: space.filter(d => GD.HULLS[d.hull].role === 'fighter').sort((a, b) => score(b) - score(a)),
    transport: ok.filter(d => GD.HULLS[d.hull].role === 'transport'),
    ground: ok.filter(d => GD.HULLS[d.hull].domain === 'ground').sort((a, b) => score(b) - score(a))
  };
}
function mainFleet(n) {
  const fl = myFleets(n).filter(f => X.fleetInfo(f).space > 0);
  return fl.sort((a, b) => X.fleetInfo(b).power - X.fleetInfo(a).power)[0] || null;
}
function totalPower(n) { return myFleets(n).reduce((a, f) => a + X.fleetInfo(f).power, 0); }
function fleetsKeeping(c) {
  const { n } = c;
  // une las flotas quietas del mismo sistema en la más grande
  const bySys = {};
  for (const f of myFleets(n)) if (idle(f) && X.fleetInfo(f).space > 0 && !f.noEngageUntil) (bySys[f.system] = bySys[f.system] || []).push(f);
  for (const sid in bySys) {
    const list = bySys[sid].sort((a, b) => X.fleetInfo(b).power - X.fleetInfo(a).power);
    const head = list[0];
    for (const f of list.slice(1)) {
      if (f.name.startsWith('Colonizadora')) continue;
      for (const d of Object.keys(f.units)) if (f.units[d] > 0) X.handleAction(n.id, 'transferUnits', { fromId: f.id, toId: head.id, designId: d, count: f.units[d] });
    }
  }
}
function threats(c) {
  const { n } = c, w = W();
  const mine = new Set(c.planets.map(p => p.system));
  c.threatened = []; c.threatPower = {};
  for (const f of Object.values(w.fleets)) {
    if (f.owner === n.id) continue;
    if (!(X.atWar(n.id, f.owner))) continue;
    if (X.fleetInfo(f).space <= 0) continue;
    const npc = f.owner === X.PIRATES || f.owner === X.MONSTERS;
    // los guardianes NPC quietos en su sistema no son una amenaza; las incursiones y flotas en movimiento sí
    if (npc && !f.raid && !f.path && !mine.has(f.system)) continue;
    if (npc && f.guard && !mine.has(f.system)) continue;
    for (const sid of mine) {
      const near = f.system === sid || (f.path && f.path.includes(sid)) || (!npc && hops(f.system, sid) <= 1);
      if (near) { if (!c.threatened.includes(sid)) c.threatened.push(sid); c.threatPower[sid] = (c.threatPower[sid] || 0) + X.fleetInfo(f).power; }
    }
  }
  c.enemyNear = c.threatened.length > 0;
}
/** Planeta donde se entrenan tropas: la capital si tiene academia (así la flota y las tropas coinciden) */
function cuartelPlanet(c) { const cap = c.planets.find(p => p.id === c.n.capital && p.buildings.cuartel); return cap || c.planets.find(p => p.buildings.cuartel) || null; }
/** Tropas que una IA quiere llevar a una invasión (los jugadores simulados llevan más) */
function troopsNeeded(n) { return n.ai.persona === 'jugador' ? 40 : 18; }
function produceUnits(c, budgetShare, wantInvasion) {
  const { n, P } = c, w = W();
  const yard = c.planets.filter(p => p.buildings.astillero).sort((a, b) => (b.id === n.capital) - (a.id === n.capital))[0];
  if (!yard || c.budget <= 0) return false;
  const D = bestDesigns(n);
  let money = Math.max(0, (n.credits - c.reserve) * budgetShare);
  let did = false;
  const buy = (list, share, maxCount) => {
    const d = list[0]; if (!d) return;
    const s = X.statsOf(d.id); if (!s) return;
    const unit = s.unitCost.credits || 1;
    let count = Math.min(maxCount, Math.floor(money * share / unit));
    // evita comprar más de lo que permiten los recursos
    for (const r in s.unitCost) if (r !== 'credits') count = Math.min(count, Math.floor((n.resources[r] || 0) / s.unitCost[r]));
    if (count < 1) return;
    const r = act(n, 'produce', { designId: d.id, planetId: yard.id, count });
    if (r.ok) { money -= count * unit; did = true; c.budget--; }
  };
  const burst = 3 + Math.floor(n.ai.skill * 6);
  if (wantInvasion) {
    // Fuerza de invasión: suficientes transportes (10 tropas c/u) y tropas para vencer a guarnición + milicia
    const need = troopsNeeded(n);
    const f = mainFleet(n), fi = f ? X.fleetInfo(f) : { capacity: 0, groundSize: 0 };
    const inQueue = w.buildQueue.filter(q => q.nation === n.id).reduce((a, q) => a + q.count * (((X.statsOf(q.designId) || {}).capacity) || 0), 0);
    const missingCap = need - fi.capacity - inQueue;
    if (missingCap > 0 && D.transport[0]) buy(D.transport, 0.4, Math.ceil(missingCap / 10));
    const cuartel = cuartelPlanet(c);
    const ground = myFleets(n).reduce((a, g) => a + X.fleetInfo(g).groundSize, 0) + w.buildQueue.filter(q => q.nation === n.id && q.domain === 'ground').reduce((a, q) => a + q.count, 0);
    if (cuartel && ground < need) {
      const d = D.ground[0];
      if (d) { const s = X.statsOf(d.id); const count = Math.min(need - ground, 40, Math.floor(money * 0.5 / (s.unitCost.credits || 1))); if (count >= 1 && act(n, 'produce', { designId: d.id, planetId: cuartel.id, count }).ok) { money -= count * (s.unitCost.credits || 1); c.budget--; did = true; } }
    }
  }
  buy(D.line, 0.55, burst); buy(D.fighters, 0.3, burst * 2);
  return did;
}
function military(c) {
  const { n, P } = c;
  const prog = X.seasonProgress();
  const target = (900 + 520 * c.planets.length) * GD.NUM_K * (0.55 + P.mil * 0.7) * (1 + 2.2 * prog) * (c.enemyNear ? 1.5 : 1);
  const have = totalPower(n);
  if (have < target) produceUnits(c, c.enemyNear ? 0.7 : 0.4, false);
  // guarniciones terrestres mínimas
  const gar = myFleets(n).reduce((a, f) => a + X.fleetInfo(f).ground, 0);
  if (gar < 6 + c.planets.length * 4 && c.budget > 0) {
    const cuartel = cuartelPlanet(c);
    const d = bestDesigns(n).ground[0];
    if (cuartel && d) { const s = X.statsOf(d.id); const cnt = Math.min(10, Math.floor((n.credits - c.reserve) * 0.15 / (s.unitCost.credits || 1))); if (cnt >= 1) { act(n, 'produce', { designId: d.id, planetId: cuartel.id, count: cnt }); c.budget--; } }
  }
  // defensa: manda la flota principal al sistema amenazado; si no hay amenazas, caza criaturas/piratas con ventaja o vuelve a casa
  const f = mainFleet(n);
  if (!f || !idle(f)) return;
  const home = c.planets.find(p => p.id === n.capital);
  if (!home) return;
  if (c.enemyNear) {
    const sid = c.threatened[0];
    const est = (c.threatPower[sid] || 0) * (1 + n.ai.noise * (rnd() * 2 - 1));
    // solo acude si cree poder ganar; si no, se queda en casa reforzando (los planetas se defienden solos con baterías)
    if (f.system !== sid && X.fleetInfo(f).power > est * 0.9) act(n, 'moveFleet', { fleetId: f.id, to: sid, mission: { type: 'attack' } });
    else if (f.system !== home.system && X.fleetInfo(f).power <= est * 0.9) act(n, 'moveFleet', { fleetId: f.id, to: home.system });
    return;
  }
  if (f.noEngageUntil) return;
  // caza de NPC: solo con clara superioridad estimada y cerca de casa
  const w = W(), vis = X.visibleSystems(n.id);
  const npcs = Object.values(w.fleets).filter(o => (o.owner === X.PIRATES || o.owner === X.MONSTERS) && vis.has(o.system) && hops(home.system, o.system) <= 3);
  const mine = X.fleetInfo(f).power;
  const pick = npcs.map(o => ({ o, pw: X.fleetInfo(o).power * (1 + n.ai.noise * (rnd() * 2 - 1)) })).filter(x => mine > x.pw * (1.7 / Math.max(0.5, n.ai.skill + 0.3))).sort((a, b) => b.pw - a.pw)[0];
  if (pick && rnd() < 0.5 + P.mil * 0.3) { act(n, 'moveFleet', { fleetId: f.id, to: pick.o.system, mission: { type: 'attack' } }); return; }
  if (f.system !== home.system && !f.mission && f.system !== (n.ai.mem.target && n.ai.mem.target.system)) act(n, 'moveFleet', { fleetId: f.id, to: home.system });
}

/* ---------------------------------------------------------------
 * EXPANSIÓN: anexar planetas libres con una "colonizadora"
 * --------------------------------------------------------------- */
function expansion(c) {
  const { n } = c, w = W();
  if (!mayExpand(n) || c.budget <= 0) return;
  const mem = n.ai.mem;
  // ¿Puedo anexar ya desde donde estoy?
  const presentSys = new Set(c.planets.map(p => p.system));
  for (const f of myFleets(n)) if (idle(f)) presentSys.add(f.system);
  const npcAt = sid => Object.values(w.fleets).some(f => f.system === sid && (f.owner === X.PIRATES || f.owner === X.MONSTERS));
  const free = Object.values(w.planets).filter(p => !p.owner && presentSys.has(p.system) && p.biome !== 'gaseoso' && !npcAt(p.system));
  const cost = p => GD.annexCost(p, c.planets.length);
  free.sort((a, b) => (b.popCap + (b.depositRich > 1 ? 3 : 0)) - (a.popCap + (a.depositRich > 1 ? 3 : 0)));
  for (const p of free) {
    if (n.credits - cost(p) < c.reserve * 0.4) continue;
    const r = act(n, 'annex', { planetId: p.id });
    if (r.ok) { c.budget--; return; }
  }
  // Si no, envía una colonizadora a un sistema vecino con planetas libres y sin enemigos
  let col = myFleets(n).find(f => f.name.startsWith('Colonizadora') && f.id === mem.colonizer);
  if (col && !idle(col)) return;
  const mine = new Set(c.planets.map(p => p.system));
  const cand = Object.values(w.systems).filter(sy => sy.kind === 'star' && !sy.lair && sy.planets.some(pid => !w.planets[pid].owner && w.planets[pid].biome !== 'gaseoso') && [...mine].some(m => hops(m, sy.id) <= 2)
    && !Object.values(w.fleets).some(f => f.system === sy.id && (f.owner === X.PIRATES || f.owner === X.MONSTERS)));
  if (!cand.length) return;
  cand.sort((a, b) => Math.min(...[...mine].map(m => hops(m, a.id))) - Math.min(...[...mine].map(m => hops(m, b.id))));
  const target = cand[Math.floor(rnd() * Math.min(3, cand.length))];
  if (!col) {
    const f = mainFleet(n); if (!f || !idle(f) || f.battle) return;
    const d = Object.keys(f.units).find(d => (X.statsOf(d) || {}).role === 'fighter' && f.units[d] >= 3);
    if (!d) return;
    const r = act(n, 'transferUnits', { fromId: f.id, designId: d, count: 2, newName: 'Colonizadora ' + n.name.slice(0, 6) });
    if (!r.ok) return;
    col = myFleets(n).find(x => x.name.startsWith('Colonizadora') && (x.units[d] || 0) >= 2 && x.system === f.system);
    if (!col) return;
    mem.colonizer = col.id;
  }
  if (col && idle(col)) act(n, 'moveFleet', { fleetId: col.id, to: target.id });
}

/* ---------------------------------------------------------------
 * GUERRA
 * --------------------------------------------------------------- */
function war(c) {
  const { n, P } = c, w = W(), mem = n.ai.mem;
  const wars = activeWars(n);
  const enemies = enemiesOf(n);
  // Paz: si va perdiendo o la guerra se alarga
  for (const wr of wars) {
    const dur = (X.now() - wr.startedAt);
    const myP = totalPower(n);
    const losing = enemies.length && myP < enemies.reduce((a, id) => a + estPower(n, id), 0) * 0.55;
    if ((losing || dur > X.ms(30 * 3600000)) && rnd() < 0.5) { act(n, 'proposePeace', { warId: wr.id }); break; }
  }
  // Operaciones en guerra: invadir el planeta enemigo más cercano
  if (enemies.length && !c.enemyNear) operate(c, enemies);
  // Declarar guerra: prudente y con superioridad clara
  const sim = n.ai.persona === 'jugador';
  if (wars.length >= (sim ? 2 : 1) || mem.lastWarAt && X.now() - mem.lastWarAt < X.ms((sim ? 4 : 36) * 3600000)) return;
  if (X.isProtected(n)) return;
  const prog = X.seasonProgress();
  if (prog < (sim ? 0.04 : 0.08)) return;            // nadie ataca en el primer día
  if (rnd() > P.aggression * n.ai.skill * (0.5 + prog) * 1.4 && !sim) return;
  const humans = Object.values(w.nations).filter(x => x.alive && !x.npc && !x.bot);
  const strongest = Season().standings().filter(s => !s.bot)[0];
  const myP = totalPower(n);
  const mineSys = c.planets.map(p => p.system);
  const cands = Object.values(w.nations).filter(o => o.alive && !o.npc && o.id !== n.id && !X.isProtected(o) && !(n.alliance && n.alliance === o.alliance) && !(!sim && strongest && o.id === strongest.id && humans.length > 1));
  const scored = cands.map(o => {
    const planetsNear = X.planetsOf(o.id).filter(p => mineSys.some(m => hops(m, p.system) <= 3));
    if (!planetsNear.length) return null;
    return { o, est: estPower(n, o.id), near: planetsNear.length };
  }).filter(Boolean).sort((a, b) => a.est - b.est);
  const t = scored[0];
  if (!t) return;
  if (myP < Math.max(600 * GD.NUM_K, t.est * (sim ? 1.5 : 2.2))) { produceUnits(c, 0.6, true); return; }    // se arma antes de atacar
  const r = act(n, 'declareWar', { targetId: t.o.id, name: 'Guerra de ' + n.name.split(' ')[0] });
  if (r.ok) { mem.lastWarAt = X.now(); mem.target = { nation: t.o.id }; if (rnd() < 0.6) say(n, R(CHAT.war)); }
}
function Season() { return X.Season || require('./season.js'); }
/** Campañas terrestres propias: asedio si la cosa va igualada, asalto si hay ventaja, retirada si se pierde */
function campaigns(c) {
  const { n } = c, w = W();
  for (const p of Object.values(w.planets)) {
    const cp = p.camp; if (!cp || cp.attacker !== n.id) continue;
    const last = cp.log[cp.log.length - 1]; if (!last) continue;
    const start = Object.values(cp.start).reduce((a, b) => a + b, 0) || 1;
    if (last.au < start * 0.3 && last.du > last.au) { act(n, 'groundWithdraw', { planetId: p.id }); continue; }
    const want = last.au > last.du * 1.5 ? 'assault' : 'siege';
    if (cp.stance !== want) act(n, 'groundStance', { planetId: p.id, stance: want });
  }
}

function operate(c, enemies) {
  const { n } = c, w = W();
  const f = mainFleet(n); if (!f || !idle(f) || f.noEngageUntil) return;
  const info = X.fleetInfo(f);
  const myP = info.power;
  const targets = Object.values(w.planets).filter(p => p.owner && enemies.includes(p.owner));
  if (!targets.length) { dbg(n, 'sin objetivos'); return; }
  targets.sort((a, b) => hops(f.system, a.system) - hops(f.system, b.system) || a.pop - b.pop);
  const tp = targets[0];
  const enemyFleetHere = Object.values(w.fleets).filter(o => o.system === tp.system && enemies.includes(o.owner)).reduce((a, o) => a + X.fleetInfo(o).power, 0);
  const est = (enemyFleetHere + ((tp.buildings.bateria || 0) * 60 + (tp.buildings.escudo || 0) * 80) * GD.NUM_K) * (1 + n.ai.noise * (rnd() * 2 - 1));
  if (myP < est * 1.8) { dbg(n, 'poder insuficiente', Math.round(myP), 'vs', Math.round(est)); produceUnits(c, 0.6, true); return; }
  if (!info.ground) {
    // se prepara en casa: la flota debe estar donde se fabrican las tropas
    const home = cuartelPlanet(c) || c.planets.find(p => p.id === n.capital);
    if (home && f.system !== home.system) { act(n, 'moveFleet', { fleetId: f.id, to: home.system }); return; }
    // embarca tropas disponibles en el sistema; si no hay transporte/tropas, fabrica
    const r = act(n, 'embark', { fleetId: f.id });
    if (!r.ok) { dbg(n, 'embarque', r.error); produceUnits(c, 0.6, true); return; }
  }
  // espera a juntar una fuerza decente antes de zarpar (si no, la milicia del planeta la barre)
  const info2 = X.fleetInfo(f);
  if (info2.groundSize < troopsNeeded(n) * 0.7 && info2.capacity > info2.groundSize) { produceUnits(c, 0.6, true); const r2 = act(n, 'embark', { fleetId: f.id }); if (X.fleetInfo(f).groundSize < troopsNeeded(n) * 0.7) return; }
  const rr = act(n, 'moveFleet', { fleetId: f.id, to: tp.system, mission: { type: 'invade', planetId: tp.id } });
  dbg(n, 'invade →', tp.name, rr.ok ? 'OK' : rr.error);
}

/* ---------------------------------------------------------------
 * DIPLOMACIA
 * --------------------------------------------------------------- */
function respondOffers(c) {
  const { n, P } = c, w = W();
  for (const o of Object.values(w.offers)) {
    if (o.to !== n.id) continue;
    const from = w.nations[o.from]; if (!from || !from.alive) { act(n, 'respondOffer', { id: o.id, accept: false }); continue; }
    let accept = false;
    if (o.kind === 'peace') {
      const wr = w.wars[o.warId]; const dur = wr ? X.now() - wr.startedAt : 0;
      accept = dur > X.ms(10 * 3600000) || rnd() < 0.45 + (1 - P.aggression) * 0.3;
    } else if (o.kind === 'alliance_invite') {
      const a = w.alliances[o.allianceId];
      const atWarWithMember = a && a.members.some(m => X.atWar(n.id, m));
      accept = !n.alliance && !atWarWithMember && rnd() < P.social * 0.8 && Season().score(from) > Season().score(n) * 0.35;
    } else if (o.kind === 'trade') {
      const give = valueOf(o.give), want = valueOf(o.want);
      const can = Object.keys(o.want).every(k => k === 'designId' || (k === 'credits' ? n.credits - c.reserve >= o.want[k] : (n.resources[k] || 0) >= o.want[k]));
      accept = can && !X.atWar(n.id, from.id) && give >= want * (0.85 + (1 - n.ai.skill) * 0.1) && (give > 0);
    }
    act(n, 'respondOffer', { id: o.id, accept });
  }
}
function diplomacy(c) {
  const { n, P } = c, w = W(), mem = n.ai.mem, t = X.now();
  if (c.budget < 0) return;
  // fundar o ampliar una alianza
  if (!n.alliance && P.social > 0.5 && rnd() < 0.10 && X.seasonProgress() > 0.03) {
    const r = act(n, 'createAlliance', { name: R(['Pacto', 'Liga', 'Concordia', 'Frente', 'Acuerdo']) + ' ' + R(['Estelar', 'Orión', 'del Vacío', 'Lyra', 'Cobalto', 'Aurora']), tag: n.name.replace(/[^A-Za-zÁÉÍÓÚ]/g, '').slice(0, 3).toUpperCase() + Math.floor(rnd() * 9), color: R(PALETTE) });
    if (!r.ok) return;
  }
  const a = n.alliance && w.alliances[n.alliance];
  if (a && a.leader === n.id && a.members.length < 4 && rnd() < 0.15) {
    const vis = X.visibleSystems(n.id);
    const cands = Object.values(w.nations).filter(o => o.alive && !o.npc && !o.alliance && o.id !== n.id && !X.atWar(n.id, o.id) && (!mem.lastOffer[o.id] || t - mem.lastOffer[o.id] > X.ms(24 * 3600000))
      && X.planetsOf(o.id).some(p => vis.has(p.system)));
    const o = cands[Math.floor(rnd() * cands.length)];
    if (o) { mem.lastOffer[o.id] = t; act(n, 'inviteAlliance', { targetId: o.id }); }
  }
  // traición ocasional de oportunistas
  if (a && P.betray && rnd() < P.betray) {
    const since = mem.allySince[a.id] || (mem.allySince[a.id] = t);
    const weak = a.members.map(m => w.nations[m]).filter(m => m && m.id !== n.id).some(m => Season().score(m) < Season().score(n) * 0.35);
    if (weak && t - since > X.ms(48 * 3600000)) { act(n, 'leaveAlliance', { betray: true }); mem.lastWarAt = 0; }
  }
  // oferta comercial: cambia excedente por lo que falta (los humanos pueden ignorarla)
  if (P.social > 0.6 && rnd() < 0.2 && c.budget > 0) {
    const res = Object.keys(n.resources);
    const surplus = res.filter(r => (n.resources[r] || 0) > 450 * GD.NUM_K).sort((x, y) => n.resources[y] - n.resources[x])[0];
    const lacking = res.filter(r => (n.resources[r] || 0) < 60 * GD.NUM_K)[0];
    if (surplus && lacking) {
      const vis = X.visibleSystems(n.id);
      const cands = Object.values(w.nations).filter(o => o.alive && !o.npc && !o.bot && o.id !== n.id && !X.atWar(n.id, o.id) && (!mem.lastOffer[o.id] || t - mem.lastOffer[o.id] > X.ms(12 * 3600000)) && X.planetsOf(o.id).some(p => vis.has(p.system)));
      const o = cands[Math.floor(rnd() * cands.length)];
      if (o) {
        const amtGive = 150 * GD.NUM_K, price = w.npcPrices[surplus] || 40, wantAmt = Math.max(20 * GD.NUM_K, Math.round(amtGive * price / (w.npcPrices[lacking] || 40) * 0.95));
        mem.lastOffer[o.id] = t;
        act(n, 'offer', { to: o.id, give: { [surplus]: amtGive }, want: { [lacking]: wantAmt }, message: 'Intercambio justo, saludos de ' + n.name });
      }
    }
  }
}
function market(c) {
  const { n } = c;
  buyUnits(c);
  // Consorcio: vende excedentes enormes y compra lo que se acaba
  const w = W();
  for (const r of Object.keys(GD.RESOURCES)) {
    const have = n.resources[r] || 0;
    if (have > 1500 * GD.NUM_K && W().npcPrices[r] > 30 && rnd() < 0.35) { act(n, 'npcTrade', { resource: r, amount: 400 * GD.NUM_K, side: 'sell' }); return; }
    if (have < 25 * GD.NUM_K && n.credits > c.reserve * 1.4 && (r === 'energia' || r === 'aleaciones') && w.npcPrices[r] < 90) { act(n, 'npcTrade', { resource: r, amount: 60 * GD.NUM_K, side: 'buy' }); return; }
  }
}
function say(n, text) { if (X.emit().chat) X.emit().chat(n.id, 'global', text); }
function chat(c) {
  const { n, P } = c, mem = n.ai.mem, t = X.now();
  if (t - mem.lastChat < X.ms(5 * 3600000) || rnd() > 0.25) return;
  mem.lastChat = t;
  const pool = mem.lastWarAt && t - mem.lastWarAt < X.ms(6 * 3600000) ? CHAT.war : (P.social > 0.7 ? CHAT.trade.concat(CHAT.hello) : (rnd() < 0.5 ? CHAT.hello : CHAT.brag));
  say(n, R(pool));
}

/** Convierte una nación en jugador simulado (herramienta de balance: server/tools/simulate.js) */
function drive(n, skill) {
  n.spec = pickSpec('jugador');
  n.ai = { persona: 'jugador', skill, noise: 0.1, retreatAt: 0.3, nextThink: X.now(), mem: { lastOffer: {}, lastChat: 0, lastWarAt: 0, allySince: {}, designs: 0, colonizer: null, target: null } };
}

module.exports = { attach, tick, ensureBots, PERSONAS, think, drive };
