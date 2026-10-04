/* =====================================================================
 * ORBITAL DOMINATION — SERVIDOR
 * Express (archivos estáticos + API de cuentas) + Socket.IO (tiempo real)
 * ---------------------------------------------------------------------
 * Variables de entorno:
 *   PORT          puerto HTTP (3000)
 *   TICK_SECONDS  duración del ciclo económico en segundos (300 = 5 min)
 *   SYSTEMS       cantidad de sistemas al crear un mundo nuevo (26)
 *   ADMIN_KEY     clave para /api/admin/reset (opcional)
 * ===================================================================== */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');
const S = require('./state.js');
const G = require('./game.js');
const GD = require('../public/shared/gamedata.js');

S.load();
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
  if (Object.values(w.users).some(u => u.username.toLowerCase() === username.toLowerCase())) return res.json({ ok: false, error: 'Ese usuario ya existe' });
  const id = S.uid('u'), salt = crypto.randomBytes(8).toString('hex');
  w.users[id] = { id, username, salt, passHash: hashPass(password, salt), nationId: null, createdAt: Date.now() };
  res.json({ ok: true, token: newSession(id) });
});
app.post('/api/login', (req, res) => {
  const w = S.get();
  if (rateLimited('l' + req.ip)) return res.json({ ok: false, error: 'Demasiados intentos, espera un minuto' });
  const u = Object.values(w.users).find(u => u.username.toLowerCase() === String(req.body.username || '').toLowerCase());
  if (!u || hashPass(String(req.body.password || ''), u.salt) !== u.passHash) return res.json({ ok: false, error: 'Usuario o contraseña incorrectos' });
  res.json({ ok: true, token: newSession(u.id) });
});
app.get('/api/health', (req, res) => res.json({ ok: true, cycle: S.get().cycle, nations: Object.keys(S.get().nations).length }));
app.post('/api/admin/reset', (req, res) => {
  if (!process.env.ADMIN_KEY || req.body.key !== process.env.ADMIN_KEY) return res.status(403).json({ ok: false });
  S.reset(); io.emit('reload'); res.json({ ok: true });
});

/* ---------------------------------------------------------------
 * VISTAS DEL ESTADO
 * publicView: lo que ve todo el mundo (mapa, naciones, guerras...)
 * privateView: lo que solo ve tu nación (inventario, diseños, ofertas)
 * Las flotas enemigas solo se ven si comparten sistema o son visibles
 * desde tus planetas/flotas (niebla de guerra simple).
 * --------------------------------------------------------------- */
function publicNation(n) {
  const econ = G.computeEconomy(n);
  return { id: n.id, name: n.name, flag: n.flag, motto: n.motto, alive: n.alive, alliance: n.alliance, capital: n.capital,
    planets: Object.values(S.get().planets).filter(p => p.owner === n.id).length, pop: Math.round(econ.pop * 10) / 10, gdp: econ.gdp,
    username: (S.get().users[n.userId] || {}).username, betrayals: n.betrayals, online: onlineNations.has(n.id) };
}
function visibleSystems(nid) {
  const w = S.get();
  const vis = new Set();
  const add = sid => { vis.add(sid); for (const l of w.systems[sid].links) vis.add(l); };
  for (const p of Object.values(w.planets)) if (p.owner === nid) add(p.system);
  for (const f of Object.values(w.fleets)) if (f.owner === nid) add(f.system);
  // Los aliados comparten visión
  const me = w.nations[nid];
  if (me && me.alliance && w.alliances[me.alliance]) for (const m of w.alliances[me.alliance].members) if (m !== nid) {
    for (const p of Object.values(w.planets)) if (p.owner === m) add(p.system);
    for (const f of Object.values(w.fleets)) if (f.owner === m) vis.add(f.system);
  }
  return vis;
}
function viewFor(nid) {
  const w = S.get();
  const n = nid ? w.nations[nid] : null;
  const vis = nid ? visibleSystems(nid) : new Set();
  const fleets = {};
  for (const f of Object.values(w.fleets)) {
    if (f.owner === nid) fleets[f.id] = Object.assign({ info: G.fleetInfo(f) }, f);
    else if (vis.has(f.system)) { const i = G.fleetInfo(f); fleets[f.id] = { id: f.id, owner: f.owner, system: f.system, name: f.name, moving: !!f.path, info: { power: i.power, count: i.count, space: i.space, ground: i.ground } }; }
  }
  const myDesignIds = new Set();
  const designs = {};
  for (const d of Object.values(w.designs)) {
    const mine = n && (d.owner === nid || n.licenses.includes(d.id) || d.public);
    if (mine) myDesignIds.add(d.id);
    // Los diseños a la venta son visibles para todos (escaparate del mercado)
    const forSale = Object.values(w.market).some(m => m.designId === d.id);
    if (mine || forSale || Object.values(fleets).some(f => f.units && f.units[d.id])) designs[d.id] = Object.assign({ stats: G.statsOf(d.id), ownerName: d.owner ? (w.nations[d.owner] || {}).name : 'Consorcio Galáctico' }, d);
  }
  const components = {};
  for (const c of Object.values(w.components)) {
    if (c.public || c.owner === nid || Object.values(designs).some(d => d.components.includes(c.id))) components[c.id] = Object.assign({ stats: GD.componentStats(c) }, c);
  }
  const nations = {};
  for (const x of Object.values(w.nations)) nations[x.id] = publicNation(x);
  const planets = {};
  for (const p of Object.values(w.planets)) {
    planets[p.id] = (p.owner === nid || vis.has(p.system))
      ? p
      : { id: p.id, name: p.name, system: p.system, biome: p.biome, size: p.size, orbit: p.orbit, owner: p.owner, seed: p.seed, pop: p.pop, deposit: p.deposit };
  }
  const reports = {};
  for (const r of Object.values(w.reports)) if (!nid || [].concat(r.attackers || [], r.defenders || [], [r.attacker, r.defender]).includes(nid)) reports[r.id] = r;
  return {
    cycle: w.cycle, nextCycleAt: w.nextCycleAt, tickSeconds: G.TICK_SECONDS, serverTime: Date.now(),
    systems: w.systems, planets, nations, fleets, designs, components, alliances: w.alliances,
    wars: w.wars, market: w.market, npcPrices: w.npcPrices, news: w.news.slice(0, 40), reports,
    visible: [...vis],
    me: n ? Object.assign({}, n, { economy: G.computeEconomy(n), componentCap: G.componentCap(n), queue: w.buildQueue.filter(q => q.nation === nid),
      offers: Object.values(w.offers).filter(o => o.to === nid || o.from === nid) }) : null,
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
    const v = viewFor(nationId()); v.username = S.get().users[userId].username;
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
    cb && cb(r);
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
    const clean = filterText(text);
    if (!clean) return cb && cb({ ok: false });
    const n = S.get().nations[nid];
    const m = { t, from: nid, name: n.name, flag: n.flag, text: clean, channel };
    const list = S.get().chat[channel] = S.get().chat[channel] || [];
    list.push(m); if (list.length > GD.RULES.chatHistory) list.splice(0, list.length - GD.RULES.chatHistory);
    if (channel === 'global') io.to('global').emit('chat', m);
    else if (channel.startsWith('dm:')) channel.slice(3).split('|').forEach(id => io.to('n:' + id).emit('chat', m));
    else if (channel.startsWith('ally:')) S.get().alliances[channel.slice(5)].members.forEach(id => io.to('n:' + id).emit('chat', m));
    else if (channel.startsWith('war:')) { const war = S.get().wars[channel.slice(4)]; war.attackers.concat(war.defenders).forEach(id => io.to('n:' + id).emit('chat', m)); }
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
  dirty: markDirty
});

/* Bucle: lógica cada 1 s; difusión del estado como máximo cada 1.5 s si hubo cambios */
setInterval(() => { try { G.tick(); G.regenDefenses(); } catch (e) { console.error('[tick]', e); } }, 1000);
setInterval(() => {
  if (!dirty) return;
  dirty = false;
  for (const [id, s] of io.of('/').sockets) {
    const uid = [...s.rooms].find(r => r.startsWith('n:'));
    const v = viewFor(uid ? uid.slice(2) : null);
    s.emit('state', v);
  }
}, 1500);
setInterval(() => S.save(), 20000);
process.on('SIGINT', () => { S.save(); process.exit(0); });
process.on('SIGTERM', () => { S.save(); process.exit(0); });

const PORT = Number(process.env.PORT || 3000);
server.listen(PORT, '0.0.0.0', () => console.log('🚀 Orbital Domination en http://localhost:' + PORT + ' | ciclo cada ' + G.TICK_SECONDS + 's'));
