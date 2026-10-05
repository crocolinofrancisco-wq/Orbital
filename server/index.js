/* =====================================================================
 * ORBITAL DOMINATION — SERVIDOR
 * Express (archivos estáticos + API de cuentas) + Socket.IO (tiempo real)
 * ---------------------------------------------------------------------
 * Variables de entorno (resumen; detalle en docs/OPERACION.md):
 *   PORT          puerto HTTP (3000)
 *   STORAGE       'file' (por defecto) o 'd1' (Cloudflare D1, ver server/storage.js)
 *   GAME_SPEED    acelera TODO el juego x veces (solo pruebas). 1 = ritmo real de temporada
 *   TICK_SECONDS  duración del ciclo económico (por defecto 3600 / GAME_SPEED)
 *   SYSTEMS       sistemas al crear un mundo nuevo (44)
 *   AI_COUNT      naciones IA de relleno al crear el mundo (9)
 *   AI_SKILL      competencia de las IA 0-1 (0.55)
 *   ADMIN_KEY     clave para /api/admin/* (reset, nueva temporada)
 *   BATTLE_SPEED  multiplica la velocidad de las batallas (1 = tiempo real)
 * ===================================================================== */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const S = require('./state.js');
const G = require('./game.js');
const GD = require('../public/shared/gamedata.js');

// Ajuste de pruebas: JUMP_SECONDS acelera los viajes entre sistemas
if (process.env.JUMP_SECONDS) GD.RULES.jumpSeconds = Number(process.env.JUMP_SECONDS);

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, '..', 'public'), { extensions: ['html'] }));

/* ---------------------------------------------------------------
 * CUENTAS (usuario + contraseña con scrypt). Sin email para que sea
 * accesible a menores; ver docs/DECISIONES.md (seguridad y moderación).
 * --------------------------------------------------------------- */
function hashPass(pass, salt) { return crypto.scryptSync(pass, salt, 32).toString('hex'); }
function newSession(userId) { const tok = crypto.randomBytes(24).toString('hex'); S.get().sessions[tok] = userId; return tok; }
const loginAttempts = {};
function rateLimited(key) {
  const t = Date.now(); const a = loginAttempts[key] = (loginAttempts[key] || []).filter(x => t - x < 60000);
  a.push(t); return a.length > 10;
}
app.post('/api/register', (req, res) => {
  const w = S.get();
  const username = String(req.body.username || '').trim();
  const password = String(req.body.password || '');
  if (rateLimited('r' + req.ip)) return res.json({ ok: false, error: 'Demasiados intentos, espera un minuto' });
  if (!/^[a-zA-Z0-9_]{3,16}$/.test(username)) return res.json({ ok: false, error: 'Usuario: 3-16 letras, números o _' });
  if (password.length < 6) return res.json({ ok: false, error: 'La contraseña debe tener 6+ caracteres' });
  if (Object.values(w.users).some(u => u.username && u.username.toLowerCase() === username.toLowerCase())) return res.json({ ok: false, error: 'Ese usuario ya existe' });
  const id = S.uid('u'), salt = crypto.randomBytes(8).toString('hex');
  w.users[id] = { id, username, salt, passHash: hashPass(password, salt), nationId: null, createdAt: Date.now() };
  res.json({ ok: true, token: newSession(id) });
});
app.post('/api/login', (req, res) => {
  const w = S.get();
  if (rateLimited('l' + req.ip)) return res.json({ ok: false, error: 'Demasiados intentos, espera un minuto' });
  const u = Object.values(w.users).find(u => u.username && u.username.toLowerCase() === String(req.body.username || '').toLowerCase());
  if (!u || hashPass(String(req.body.password || ''), u.salt) !== u.passHash) return res.json({ ok: false, error: 'Usuario o contraseña incorrectos' });
  res.json({ ok: true, token: newSession(u.id) });
});
app.get('/api/health', (req, res) => res.json({ ok: true, cycle: S.get().cycle, nations: Object.keys(S.get().nations).length, battles: G.Battles.list().length, season: G.Season.view() }));
function adminOnly(req, res) { if (!process.env.ADMIN_KEY || req.body.key !== process.env.ADMIN_KEY) { res.status(403).json({ ok: false }); return false; } return true; }
/** Borra todo y empieza de cero (también cuentas) */
app.post('/api/admin/reset', async (req, res) => {
  if (!adminOnly(req, res)) return;
  G.resetBattles(); S.reset(); G.bootstrap(); await S.save(); io.emit('reload'); res.json({ ok: true });
});
/** Nueva temporada: mundo nuevo conservando las cuentas de los jugadores */
app.post('/api/admin/new-season', async (req, res) => {
  if (!adminOnly(req, res)) return;
  G.resetBattles(); S.reset({ keepUsers: true }); G.bootstrap(); await S.save(); io.emit('reload'); res.json({ ok: true, season: S.get().season.number });
});

/* ---------------------------------------------------------------
 * VISTAS DEL ESTADO
 * publicView: lo que ve todo el mundo (mapa, naciones, guerras...)
 * privateView: lo que solo ve tu nación (inventario, diseños, ofertas)
 * Las flotas enemigas solo se ven si comparten sistema o son visibles
 * desde tus planetas/flotas (niebla de guerra simple). Los piratas y las
 * criaturas se ven siempre.
 * --------------------------------------------------------------- */
function publicNation(n) {
  const econ = G.computeEconomy(n);
  return { id: n.id, name: n.name, flag: n.flag, motto: n.motto, alive: n.alive, alliance: n.alliance, capital: n.capital,
    planets: Object.values(S.get().planets).filter(p => p.owner === n.id).length, pop: Math.round(econ.pop * 10) / 10, gdp: econ.gdp,
    username: n.bot ? 'IA' : (S.get().users[n.userId] || {}).username, betrayals: n.betrayals, online: onlineNations.has(n.id), npc: !!n.npc, bot: !!n.bot,
    persona: n.bot && n.ai ? n.ai.persona : undefined, spec: n.spec || [], protectedUntil: !n.npc && G.isProtected(n) ? G.Season.protectedUntil(n) : null };
}
const isNpcOwner = id => id === G.PIRATES || id === G.MONSTERS;
function publicSystem(sy) {
  const o = Object.assign({}, sy);
  if (sy.ruin) o.ruin = { name: sy.ruin.name, claimedBy: sy.ruin.claimedBy };
  if (sy.lair) o.lair = { clan: sy.lair.clan, level: sy.lair.level, hp: Math.round(sy.lair.hp), hpMax: sy.lair.hpMax, destroyed: !!sy.lair.destroyedAt };
  delete o.guard;
  return o;
}
function reportSummary(r) {
  const o = Object.assign({}, r);
  delete o.simSetup; delete o.orders; delete o.reinf;
  o.replayable = !!r.simSetup;
  return o;
}
function viewFor(nid) {
  const w = S.get();
  const n = nid ? w.nations[nid] : null;
  const vis = nid ? G.visibleSystems(nid) : new Set();
  const fleets = {};
  for (const f of Object.values(w.fleets)) {
    if (f.owner === nid) fleets[f.id] = Object.assign({ info: G.fleetInfo(f) }, f);
    else if (vis.has(f.system) || isNpcOwner(f.owner)) {
      const i = G.fleetInfo(f);
      fleets[f.id] = { id: f.id, owner: f.owner, system: f.system, name: f.name, moving: !!f.path, path: f.path ? [f.path[0]] : null, jumpStartAt: f.jumpStartAt, nextJumpAt: f.nextJumpAt, battle: f.battle || null,
        units: isNpcOwner(f.owner) ? f.units : undefined, kind: f.kind, raid: f.raid, info: { power: i.power, count: i.count, space: i.space, ground: i.ground } };
    }
  }
  const designs = {};
  for (const d of Object.values(w.designs)) {
    const mine = n && (d.owner === nid || d.public);
    const forSale = Object.values(w.market).some(m => m.designId === d.id);
    if (mine || forSale || Object.values(fleets).some(f => f.units && f.units[d.id])) designs[d.id] = Object.assign({ stats: G.statsOf(d.id), ownerName: d.owner ? (w.nations[d.owner] || {}).name : 'Consorcio Galáctico' }, d);
  }
  const components = {};
  for (const c of Object.values(w.components)) {
    if ((c.public && !c.hidden) || c.owner === nid || Object.values(designs).some(d => d.components.includes(c.id))) components[c.id] = Object.assign({ stats: GD.componentStats(c) }, c);
  }
  const nations = {};
  for (const x of Object.values(w.nations)) nations[x.id] = publicNation(x);
  const planets = {};
  for (const p of Object.values(w.planets)) {
    planets[p.id] = (p.owner === nid || vis.has(p.system))
      ? Object.assign({}, p, { g: G.Ground.info(p) })
      : { id: p.id, name: p.name, system: p.system, biome: p.biome, size: p.size, orbit: p.orbit, owner: p.owner, seed: p.seed, pop: p.pop, deposit: p.deposit, depositRich: p.depositRich, belt: p.belt };
  }
  const systems = {};
  for (const sy of Object.values(w.systems)) systems[sy.id] = publicSystem(sy);
  const reports = {};
  for (const r of Object.values(w.reports)) if (!nid || [].concat(r.attackers || [], r.defenders || [], [r.attacker, r.defender]).includes(nid)) reports[r.id] = reportSummary(r);
  const battles = G.Battles.list().filter(b => vis.has(b.system) || b.A.includes(nid) || b.B.includes(nid));
  return {
    cycle: w.cycle, nextCycleAt: w.nextCycleAt, tickSeconds: G.TICK_SECONDS, gameSpeed: G.TS, serverTime: Date.now(),
    season: G.Season.view(), standings: G.Season.standings().slice(0, 12),
    systems, planets, nations, fleets, designs, components, alliances: w.alliances, battles,
    wars: w.wars, market: w.market, npcPrices: w.npcPrices, news: w.news.slice(0, 40), reports,
    visible: [...vis],
    me: n ? Object.assign({}, n, { ai: undefined, economy: G.computeEconomy(n), componentCap: G.componentCap(n), queue: w.buildQueue.filter(q => q.nation === nid), deliveries: (w.deliveries || []).filter(e => e.nation === nid),
      offers: Object.values(w.offers).filter(o => o.to === nid || o.from === nid), protectedUntil: G.isProtected(n) ? G.Season.protectedUntil(n) : null }) : null,
    username: null
  };
}

/* ---------------------------------------------------------------
 * CHAT: global, alianza, privado (DM) y por guerra
 * Filtro de palabras muy básico + límite de mensajes (anti-spam).
 * --------------------------------------------------------------- */
const BAD_WORDS = ['puta', 'puto', 'mierda', 'pendejo', 'concha', 'verga', 'nigger', 'fuck'];
function filterText(t) {
  let s = String(t || '').replace(/[<>]/g, '').slice(0, GD.RULES.chatMaxLength).trim();
  for (const b of BAD_WORDS) s = s.replace(new RegExp(b, 'gi'), m => m[0] + '*'.repeat(m.length - 1));
  return s;
}
function channelAllowed(nid, ch) {
  const w = S.get();
  const n = w.nations[nid];
  if (ch === 'global') return true;
  if (!n) return false;
  if (ch.startsWith('ally:')) return n.alliance === ch.slice(5);
  if (ch.startsWith('dm:')) return ch.slice(3).split('|').includes(nid);
  if (ch.startsWith('war:')) { const war = w.wars[ch.slice(4)]; return war && (war.attackers.includes(nid) || war.defenders.includes(nid)); }
  return false;
}
/** Publica un mensaje (jugadores y bots usan la misma vía) */
function postChat(nid, channel, text) {
  const n = S.get().nations[nid];
  const clean = filterText(text);
  if (!n || !clean) return false;
  const m = { t: Date.now(), from: nid, name: n.name, flag: n.flag, text: clean, channel, bot: !!n.bot };
  const list = S.get().chat[channel] = S.get().chat[channel] || [];
  list.push(m); if (list.length > GD.RULES.chatHistory) list.splice(0, list.length - GD.RULES.chatHistory);
  if (channel === 'global') io.to('global').emit('chat', m);
  else if (channel.startsWith('dm:')) channel.slice(3).split('|').forEach(id => io.to('n:' + id).emit('chat', m));
  else if (channel.startsWith('ally:')) { const a = S.get().alliances[channel.slice(5)]; if (a) a.members.forEach(id => io.to('n:' + id).emit('chat', m)); }
  else if (channel.startsWith('war:')) { const war = S.get().wars[channel.slice(4)]; if (war) war.attackers.concat(war.defenders).forEach(id => io.to('n:' + id).emit('chat', m)); }
  return true;
}

/* ---------------------------------------------------------------
 * SOCKETS
 * --------------------------------------------------------------- */
const onlineNations = new Set();
const socketsByNation = {};
const chatRate = {};
io.on('connection', socket => {
  let userId = null;
  const nationId = () => userId ? S.get().users[userId].nationId : null;
  const joinRooms = () => {
    const nid = nationId();
    socket.join('global');
    if (nid) {
      socket.join('n:' + nid);
      onlineNations.add(nid);
      (socketsByNation[nid] = socketsByNation[nid] || new Set()).add(socket.id);
    }
  };
  socket.on('auth', (token, cb) => {
    userId = S.get().sessions[token] || null;
    if (!userId || !S.get().users[userId]) return cb && cb({ ok: false });
    joinRooms();
    const v = viewFor(nationId() && S.get().nations[nationId()] ? nationId() : null); v.username = S.get().users[userId].username;
    cb && cb({ ok: true, state: v });
  });
  socket.on('createNation', (data, cb) => {
    if (!userId) return cb({ ok: false, error: 'No autenticado' });
    if (nationId() && S.get().nations[nationId()].alive) return cb({ ok: false, error: 'Ya tienes una nación' });
    try { G.createNation(userId, data || {}); joinRooms(); markDirty(); cb({ ok: true }); }
    catch (e) { cb({ ok: false, error: e instanceof G.GameError ? e.message : 'Error' }); if (!(e instanceof G.GameError)) console.error(e); }
  });
  socket.on('action', (msg, cb) => {
    const nid = nationId();
    if (!nid) return cb && cb({ ok: false, error: 'Sin nación' });
    const r = G.handleAction(nid, msg && msg.type, msg && msg.data);
    if (msg && msg.type === 'moveFleet' && r.ok && msg.data && msg.data.to) r.portal = G.portalOffer(msg.data.fleetId, msg.data.to);
    cb && cb(r);
  });
  /** Consulta previa: ¿el viaje se acorta mucho con un portal de agujero negro? */
  socket.on('portalOffer', ({ fleetId, to }, cb) => cb && cb(G.portalOffer(fleetId, to)));
  /* ---- Batallas en vivo ---- */
  socket.on('battle:watch', (id, cb) => {
    const r = G.Battles.watch(id);
    if (!r) return cb && cb({ ok: false, error: 'La batalla ya terminó' });
    const nid = nationId();
    // Solo se pueden ver batallas de sistemas visibles (o en las que participas)
    const b0 = G.Battles.get(id);
    if (nid && !G.visibleSystems(nid).has(b0.system) && !b0.nations.A.includes(nid) && !b0.nations.B.includes(nid)) return cb && cb({ ok: false, error: 'No ves ese sistema' });
    socket.join('b:' + id);
    r.mine = G.Battles.get(id).sim.groups.filter(g => g.owner === nid).map(g => g.gid);
    r.groups = r.meta.groups;
    cb && cb({ ok: true, battle: r });
  });
  socket.on('battle:leave', id => socket.leave('b:' + id));
  socket.on('battle:cmd', (data, cb) => {
    const nid = nationId();
    if (!nid) return cb && cb({ ok: false });
    cb && cb(G.handleAction(nid, 'battleCmd', data));
  });
  /** Informe completo (con datos para repetirlo en 3D) */
  socket.on('report:get', (id, cb) => {
    const r = S.get().reports[id];
    const nid = nationId();
    if (!r) return cb && cb({ ok: false, error: 'Informe no encontrado' });
    cb && cb({ ok: true, report: r });
  });
  socket.on('chat:history', (ch, cb) => {
    if (!channelAllowed(nationId(), ch)) return cb && cb([]);
    cb && cb((S.get().chat[ch] || []).slice(-60));
  });
  socket.on('chat:send', ({ channel, text }, cb) => {
    const nid = nationId();
    if (!nid || !channelAllowed(nid, channel)) return cb && cb({ ok: false, error: 'Canal no permitido' });
    const t = Date.now(); const r = chatRate[nid] = (chatRate[nid] || []).filter(x => t - x < 10000);
    if (r.length >= 5) return cb && cb({ ok: false, error: 'Vas muy rápido, espera unos segundos' });
    r.push(t);
    if (!postChat(nid, channel, text)) return cb && cb({ ok: false });
    cb && cb({ ok: true });
  });
  socket.on('disconnect', () => {
    const nid = nationId();
    if (nid && socketsByNation[nid]) { socketsByNation[nid].delete(socket.id); if (!socketsByNation[nid].size) onlineNations.delete(nid); }
  });
});

/* Emisores que usa game.js */
let dirty = false;
function markDirty() { dirty = true; }
G.setEmitter({
  nation: (nid, payload) => io.to('n:' + nid).emit('event', payload),
  news: (text, kind) => io.to('global').emit('news', { t: Date.now(), text, kind }),
  dirty: markDirty,
  battle: (id, ev, payload) => io.to('b:' + id).emit('battle:' + ev, payload),
  chat: (nid, channel, text) => postChat(nid, channel, text)
});

/* ---------------------------------------------------------------
 * ARRANQUE
 * --------------------------------------------------------------- */
async function main() {
  await S.init();
  G.bootstrap();
  await S.save();
  /* Bucle: lógica cada 1 s; batallas cada 250 ms; difusión del estado como máximo cada 1.5 s si hubo cambios */
  setInterval(() => { try { G.tick(); G.regenDefenses(); } catch (e) { console.error('[tick]', e); } }, 1000);
  setInterval(() => { try { G.battleStep(); } catch (e) { console.error('[battle]', e); } }, 250);
  setInterval(() => {
    if (!dirty) return;
    dirty = false;
    for (const [id, s] of io.of('/').sockets) {
      const uid = [...s.rooms].find(r => r.startsWith('n:'));
      const v = viewFor(uid ? uid.slice(2) : null);
      s.emit('state', v);
    }
  }, 1500);
  setInterval(() => S.save(), process.env.STORAGE === 'd1' ? 60000 : 20000);
  const bye = async () => { try { await Promise.race([S.save(), new Promise(r => setTimeout(r, 4000))]); } finally { process.exit(0); } };
  process.on('SIGINT', bye); process.on('SIGTERM', bye);
  const PORT = Number(process.env.PORT || 3000);
  server.listen(PORT, '0.0.0.0', () => console.log('Orbital Domination en http://localhost:' + PORT + ' | ciclo cada ' + G.TICK_SECONDS + 's | velocidad x' + G.TS + ' | almacenamiento ' + (process.env.STORAGE || 'file')));
}
main().catch(e => { console.error(e); process.exit(1); });
