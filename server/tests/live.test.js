/* Prueba de extremo a extremo de la batalla EN VIVO por sockets (arranca su propio servidor):
 *   node server/tests/live.test.js
 * Dos jugadores, guerra, flotas que chocan, el jugador A mira la batalla (battle:watch), recibe
 * frames, da órdenes (battle:cmd), se confirma que llegan a la simulación y que la batalla termina
 * con un informe repetible (report:get). Usa GAME_SPEED alto para que el viaje dure segundos. */
const { spawn } = require('child_process');
const os = require('os'), fs = require('fs'), path = require('path');
const { io } = require('socket.io-client');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-live-'));
const PORT = 3290 + Math.floor(Math.random() * 9);
const URL = 'http://localhost:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const post = (p, b) => fetch(URL + p, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(b) }).then(r => r.json());
const srv = spawn(process.execPath, [path.join(__dirname, '..', 'index.js')], { env: Object.assign({}, process.env, { PORT, DATA_DIR: dir, GAME_SPEED: '400', AI_COUNT: '0', BATTLE_SPEED: '15' }), stdio: ['ignore', 'pipe', 'pipe'] });
let log = ''; srv.stdout.on('data', d => log += d); srv.stderr.on('data', d => log += d);
const done = code => { srv.kill(); process.exit(code); };
async function player(name) {
  const u = name + Math.floor(Math.random() * 99999);
  const r = await post('/api/register', { username: u, password: 'secret123' });
  const s = io(URL, { transports: ['websocket'] });
  const P = { s, events: [], frames: [], state: null };
  s.on('state', v => P.state = v); s.on('event', e => P.events.push(e));
  await new Promise(res => s.on('connect', res));
  await new Promise(res => s.emit('auth', r.token, res));
  const c = await new Promise(res => s.emit('createNation', { name: 'Nación ' + u, flag: { layout: 'cruz', emblem: 'estrella', colors: ['#112233', '#ff0000', '#ffffff'] } }, res));
  if (!c.ok) throw new Error(c.error);
  P.state = (await new Promise(res => s.emit('auth', r.token, res))).state;
  P.act = (type, data) => new Promise(res => s.emit('action', { type, data }, res));
  return P;
}
(async () => {
  for (let i = 0; i < 50 && !/Orbital Domination en/.test(log); i++) await sleep(200);
  if (!/Orbital Domination en/.test(log)) { console.error('el servidor no arrancó', log); return done(1); }
  const A = await player('ana'), B = await player('beto');
  await A.act('endProtection', {}); await B.act('endProtection', {});
  const bId = B.state.me.id, bCap = B.state.planets[B.state.me.capital];
  const w = await A.act('declareWar', { targetId: bId }); if (!w.ok) throw new Error(w.error);
  const fleet = Object.values(A.state.fleets).find(f => f.owner === A.state.me.id && f.info.space > 0);
  const mv = await A.act('moveFleet', { fleetId: fleet.id, to: bCap.system, mission: { type: 'attack' } }); if (!mv.ok) throw new Error(mv.error);
  // esperar el aviso de batalla
  let start = null;
  for (let i = 0; i < 400 && !start; i++) { await sleep(250); start = A.events.find(e => e.type === 'battle' && e.phase === 'start'); }
  if (!start) { console.error('no empezó ninguna batalla', log.slice(-500)); return done(1); }
  console.log('batalla iniciada en', start.systemName, start.battleId);
  const watch = await new Promise(res => A.s.emit('battle:watch', start.battleId, res));
  if (!watch.ok) throw new Error('watch: ' + watch.error);
  console.log('watch OK: grupos', watch.battle.groups.length, '| mis grupos', watch.battle.mine.length, '| entorno', watch.battle.meta.env);
  const frames = []; A.s.on('battle:frame', f => frames.push(f));
  let over = null; A.s.on('battle:over', o => over = o);
  await sleep(2500);
  if (frames.length < 3) { console.error('pocos frames:', frames.length); return done(1); }
  console.log('frames recibidos en 2.5 s:', frames.length, '(el servidor emite 2 por segundo)');
  const myG = watch.battle.groups.find(g => g.owner === A.state.me.id);
  const cmd = await new Promise(res => A.s.emit('battle:cmd', { battleId: start.battleId, fleetId: myG.fleetId, tactic: 'hold' }, res));
  if (!cmd.ok) throw new Error('cmd: ' + cmd.error);
  await sleep(1200);
  const last = frames[frames.length - 1];
  const ord = last.orders.find(o => o[0] === myG.gid);
  if (!ord || ord[1] !== 'hold') { console.error('la orden no llegó a la simulación', JSON.stringify(last.orders)); return done(1); }
  console.log('orden "mantener" aplicada en la simulación OK');
  const foe = await new Promise(res => B.s.emit('battle:cmd', { battleId: start.battleId, fleetId: myG.fleetId, tactic: 'retreat' }, res));
  if (foe.ok) { console.error('B pudo mandar la flota de A'); return done(1); }
  for (let i = 0; i < 1500 && !over; i++) await sleep(200);
  if (!over) { console.error('la batalla no terminó a tiempo'); return done(1); }
  console.log('batalla terminada:', over.result.winner, over.result.duration + ' s | informe', over.reportId);
  const rep = await new Promise(res => A.s.emit('report:get', over.reportId, res));
  if (!rep.ok || !rep.report.simSetup || !rep.report.orders.some(o => o.o.tactic === 'hold')) { console.error('informe sin datos de repetición'); return done(1); }
  console.log('informe repetible OK (órdenes grabadas:', rep.report.orders.length + ')');
  console.log('OK'); done(0);
})().catch(e => { console.error('FALLO', e, log.slice(-600)); done(1); });
