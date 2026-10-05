/* Test de humo contra un servidor corriendo: node server/tests/smoke.test.js
 * Crea 2 jugadores, funda naciones, construye, investiga, diseña, comercia,
 * chatea, declara guerra y mueve una flota. Requiere un servidor corriendo (npm run dev -> URL=http://localhost:3100). */
const { io } = require('socket.io-client');
const URL = process.env.URL || 'http://localhost:3000';
const post = (p, b) => fetch(URL + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function player(name) {
  const u = name + Math.floor(Math.random() * 9999);
  const r = await post('/api/register', { username: u, password: 'secret123' });
  const s = io(URL, { transports: ['websocket'] });
  let state = null;
  s.on('state', v => state = v);
  await new Promise(res => s.on('connect', res));
  await new Promise(res => s.emit('auth', r.token, res));
  const c = await new Promise(res => s.emit('createNation', { name: 'Nación ' + u, flag: { layout: 'cruz', emblem: 'estrella', colors: ['#112233', '#ff0000', '#ffffff'] } }, res));
  if (!c.ok) throw new Error(c.error);
  const a = await new Promise(res => s.emit('auth', r.token, res));
  state = a.state;
  const act = (type, data) => new Promise(res => s.emit('action', { type, data }, res));
  return { s, act, get state() { return state; } };
}
(async () => {
  const A = await player('ana'), B = await player('beto');
  const me = A.state.me;
  console.log('A nación:', me.name, 'créditos', me.credits, 'econ net', me.economy.net);
  console.log('build:', await A.act('build', { planetId: me.capital, building: 'vivienda' }));
  console.log('research:', await A.act('research', { techId: 'w_misil' }));
  console.log('component:', await A.act('designComponent', { type: 'misil', name: 'Misil Test', points: { potencia: 20, fiabilidad: 8, eficiencia: 2 } }));
  console.log('design:', await A.act('designShip', { hull: 'corbeta', name: 'Corbeta Test', components: ['bc_canon', 'bc_blind', 'bc_motor'] }));
  console.log('produce:', await A.act('produce', { designId: 'bd_caza', planetId: me.capital, count: 2 }));
  console.log('npc buy:', await A.act('npcTrade', { resource: 'cristales', amount: 10, side: 'buy' }));
  console.log('market post:', await A.act('marketPost', { kind: 'resource', resource: 'aleaciones', amount: 10, price: 500 }));
  const mid = Object.keys(B.state.market)[0] || Object.keys((await sleep(1700), B.state.market))[0];
  console.log('market buy:', await B.act('marketBuy', { id: mid }));
  console.log('alliance:', await A.act('createAlliance', { name: 'Pacto Test', tag: 'PT' }));
  const bId = B.state.me.id;
  console.log('offer:', await A.act('offer', { to: bId, give: { credits: 100 }, want: {} }));
  await new Promise(res => A.s.emit('chat:send', { channel: 'global', text: 'hola galaxia mierda' }, r => { console.log('chat:', r); res(); }));
  console.log('protección A/B:', (await A.act('endProtection', {})).ok, (await B.act('endProtection', {})).ok);
  console.log('war:', await A.act('declareWar', { targetId: bId }));
  const fleet = Object.values(A.state.fleets).find(f => f.owner === me.id && f.info.space > 0);
  const bCap = B.state.planets[B.state.me.capital];
  console.log('move:', await A.act('moveFleet', { fleetId: fleet.id, to: bCap.system }));
  await sleep(2000);
  const watch = Object.keys(A.state.battles || [])[0];
  console.log('battles visibles:', (A.state.battles || []).length, '| season:', A.state.season.phase.name, '| NPC visibles:', Object.values(A.state.fleets).filter(f => f.owner === 'pirates' || f.owner === 'monsters').length);
  console.log('A credits after:', A.state.me.credits, 'news:', A.state.news.slice(0, 3).map(n => n.text));
  A.s.close(); B.s.close();
  console.log('SMOKE OK');
  process.exit(0);
})().catch(e => { console.error('FAIL', e); process.exit(1); });
