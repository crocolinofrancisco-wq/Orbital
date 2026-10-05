/* =====================================================================
 * APP — arranque, login, creación de nación, barra superior y navegación
 * ===================================================================== */
import { GD, store, socket, setState, on, toast, fmt, timeLeft, esc, music, isModalOpen, openModal, closeModal, HELP } from './core.js';
import * as MapView from './views/map.js';
import * as EmpireView from './views/empire.js';
import * as ProjectsView from './views/projects.js';
import * as MilitaryView from './views/military.js';
import * as SocialView from './views/social.js';
import * as BattleView from './views/battle.js';
import { nationName, flagHTML } from './core.js';

const VIEWS = { map: MapView, empire: EmpireView, projects: ProjectsView, military: MilitaryView, social: SocialView };
let currentView = 'map';
const $ = s => document.querySelector(s);

/* ---------------- Fondo de estrellas animado (login) ---------------- */
function starfield() {
  const c = $('#bg-stars'), ctx = c.getContext('2d');
  const stars = Array.from({ length: 160 }, () => ({ x: Math.random(), y: Math.random(), z: Math.random() }));
  function frame() {
    if ($('#auth-screen').classList.contains('hidden')) return;
    c.width = innerWidth; c.height = innerHeight;
    ctx.fillStyle = '#1d2126'; ctx.fillRect(0, 0, c.width, c.height);
    for (const s of stars) {
      s.y += 0.0004 * (s.z + 0.2); if (s.y > 1) s.y = 0;
      ctx.fillStyle = `rgba(223,246,243,${0.3 + s.z * 0.7})`;
      ctx.fillRect(s.x * c.width, s.y * c.height, 1 + s.z * 2, 1 + s.z * 2);
    }
    requestAnimationFrame(frame);
  }
  frame();
}

/* ---------------- Login / registro ---------------- */
let authMode = 'login';
function showAuth() {
  $('#auth-screen').classList.remove('hidden'); $('#app').classList.add('hidden'); $('#create-screen').classList.add('hidden');
  starfield();
}
$('#auth-tabs').onclick = e => {
  const b = e.target.closest('button'); if (!b) return;
  authMode = b.dataset.mode;
  document.querySelectorAll('#auth-tabs button').forEach(x => x.classList.toggle('active', x === b));
  $('#auth-go').textContent = authMode === 'login' ? 'Entrar' : 'Crear cuenta';
};
$('#auth-go').onclick = async () => {
  const r = await fetch('/api/' + (authMode === 'login' ? 'login' : 'register'), {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: $('#auth-user').value, password: $('#auth-pass').value })
  }).then(r => r.json()).catch(() => ({ ok: false, error: 'Sin conexión' }));
  if (!r.ok) { $('#auth-msg').textContent = r.error; return; }
  store.token = r.token; localStorage.setItem('od_token', r.token);
  connect();
};
$('#auth-pass').addEventListener('keydown', e => { if (e.key === 'Enter') $('#auth-go').click(); });

/* ---------------- Creación de nación ---------------- */
const flagDraft = { layout: 'horizontal', emblem: 'estrella', colors: ['#1d3557', '#e63946', '#f1faee'] };
function renderFlagEditor() {
  $('#cn-flag').innerHTML = GD.flagSVG(flagDraft, 120, 80);
  $('#cn-ball').innerHTML = GD.ballSVG(flagDraft, 80);
  $('#cn-layouts').innerHTML = GD.FLAG_LAYOUTS.map(l => `<button data-l="${l}" class="${l === flagDraft.layout ? 'active' : ''}">${GD.flagSVG(Object.assign({}, flagDraft, { layout: l, emblem: 'ninguno' }), 36, 24)}</button>`).join('');
  $('#cn-emblems').innerHTML = GD.FLAG_EMBLEMS.map(l => `<button data-e="${l}" class="${l === flagDraft.emblem ? 'active' : ''}">${GD.flagSVG(Object.assign({}, flagDraft, { emblem: l }), 36, 24)}</button>`).join('');
  [0, 1, 2].forEach(i => $('#cn-c' + i).value = flagDraft.colors[i]);
}
$('#cn-layouts').onclick = e => { const b = e.target.closest('button'); if (b) { flagDraft.layout = b.dataset.l; renderFlagEditor(); } };
$('#cn-emblems').onclick = e => { const b = e.target.closest('button'); if (b) { flagDraft.emblem = b.dataset.e; renderFlagEditor(); } };
[0, 1, 2].forEach(i => $('#cn-c' + i).oninput = e => { flagDraft.colors[i] = e.target.value; renderFlagEditor(); });
$('#cn-random').onclick = () => {
  const pal = ['#e63946', '#1d3557', '#f1faee', '#ffb703', '#2a9d8f', '#8338ec', '#06d6a0', '#ef476f', '#118ab2', '#073b4c', '#fb8500', '#000000', '#ffffff', '#3a5a40'];
  flagDraft.layout = GD.FLAG_LAYOUTS[Math.floor(Math.random() * GD.FLAG_LAYOUTS.length)];
  flagDraft.emblem = GD.FLAG_EMBLEMS[Math.floor(Math.random() * GD.FLAG_EMBLEMS.length)];
  flagDraft.colors = [0, 1, 2].map(() => pal[Math.floor(Math.random() * pal.length)]);
  renderFlagEditor();
};
$('#cn-go').onclick = () => {
  socket.emit('createNation', { name: $('#cn-name').value, motto: $('#cn-motto').value, flag: flagDraft }, r => {
    if (!r.ok) { $('#cn-msg').textContent = r.error; return; }
    socket.emit('auth', store.token, onAuth);
  });
};
function showCreate() {
  $('#auth-screen').classList.add('hidden'); $('#app').classList.add('hidden'); $('#create-screen').classList.remove('hidden');
  renderFlagEditor();
}

/* ---------------- Conexión ---------------- */
function connect() {
  if (!socket.connected) socket.connect();
  else socket.emit('auth', store.token, onAuth);
}
socket.on('connect', () => socket.emit('auth', store.token, onAuth));
socket.on('disconnect', () => toast('Conexión perdida. Reconectando…', 'warn'));
socket.on('reload', () => location.reload());
function onAuth(r) {
  if (!r || !r.ok) { localStorage.removeItem('od_token'); store.token = null; showAuth(); return; }
  setState(r.state);
  if (!r.state.me || !r.state.me.alive) {
    if (r.state.me && !r.state.me.alive) toast('Tu nación cayó. Puedes fundar una nueva.', 'bad');
    showCreate(); return;
  }
  startGame();
}
socket.on('state', s => { setState(s); });
socket.on('event', ev => {
  if (ev.type === 'notify') toast(ev.text, ev.kind);
  if (ev.type === 'cycle') toast(':credits: ' + ev.text, 'good');
  if (ev.type === 'battle' && ev.phase === 'start') { toast(':battle: ¡Batalla en ' + ev.systemName + '! Toca el aviso rojo para verla en vivo', 'bad'); updateBattleBanner(); }
  if (ev.type === 'battle' && ev.phase === 'end') {
    toast(ev.draw ? ':balance: Batalla sin vencedor' : ev.won ? ':trophy: ¡Ganaste la batalla!' : ':skull: Perdiste la batalla', ev.won ? 'good' : ev.draw ? 'warn' : 'bad');
    updateBattleBanner();
  }
  if (ev.type === 'eliminated') { toast(':skull: Tu nación ha caído.', 'bad'); setTimeout(() => location.reload(), 4000); }
});

/* ---------------- Juego ---------------- */
let started = false;
function startGame() {
  $('#auth-screen').classList.add('hidden'); $('#create-screen').classList.add('hidden'); $('#app').classList.remove('hidden');
  if (started) return;
  started = true;
  for (const k in VIEWS) VIEWS[k].init && VIEWS[k].init(document.getElementById('view-' + k));
  BattleView.init();
  const bn = document.createElement('div'); bn.id = 'battle-banner'; bn.className = 'battle-banner hidden'; document.body.appendChild(bn);
  bn.onclick = e => { const b = e.target.closest('[data-watch]'); if (b) window.dispatchEvent(new CustomEvent('od:battle', { detail: b.dataset.watch })); };
  show('map');
  renderTopbar();
  // La música arranca al primer toque (los navegadores bloquean autoplay)
  document.addEventListener('pointerdown', () => music.play('calm'), { once: true });
  if (!localStorage.getItem('od_guide_seen')) setTimeout(guide, 800);
}

/* ---------------- Guía de inicio + objetivos ----------------
 * Objetivos simples que enseñan los 3 apartados. Se comprueban con el
 * estado (no requieren servidor extra), salvo los "flags" que el
 * servidor marca al ocurrir (pirateKill, annexed, invaded, battleWon). */
const OBJECTIVES = [
  { icon: 'crane', title: 'Construye un edificio', desc: 'Toca tu planeta capital en el mapa y pulsa + en un edificio.', done: me => planetsMine().some(p => Object.values(p.buildings).reduce((a, b) => a + b, 0) > 5) },
  { icon: 'spec', title: 'Elige tus 2 especialidades', desc: 'Proyectos > Investigación. No puedes investigarlo todo: lo demás se compra a otros.', done: me => (me.spec || []).length >= GD.RULES.specSlots },
  { icon: 'research', title: 'Investiga una tecnología', desc: 'Proyectos > Investigación.', done: me => me.techs.length > GD.TECHS.filter(t => t.cost === 0).length },
  { icon: 'chip', title: 'Diseña tu propio componente', desc: 'Proyectos > Componentes: crea un arma con tu nombre.', done: me => Object.values(store.state.components).some(c => c.owner === me.id) },
  { icon: 'skull', title: 'Destruye una flota pirata', desc: 'Militar > Objetivos > botón de ataque junto a los piratas.', done: me => me.flags && me.flags.pirateKill },
  { icon: 'live', title: 'Manda en una batalla en vivo', desc: 'Cuando tu flota combata toca el aviso rojo y da una orden (Atacar, Mantener, Distancia o Retirada).', done: me => me.flags && me.flags.commanded },
  { icon: 'leviathan', title: 'Abate una criatura del vacío', desc: 'Leviatán de los asteroides, medusa, enjambre… Necesitas una flota grande o ayuda de aliados.', done: me => me.flags && me.flags.monsterKill },
  { icon: 'ruins', title: 'Saquea unas ruinas antiguas', desc: 'Quédate 20 min con una flota en un sistema con ruinas (primero destruye a los centinelas).', done: me => me.flags && me.flags.ruins },
  { icon: 'ally', title: 'Anexa un planeta', desc: 'Lleva una flota a un sistema con planetas independientes y tócalos.', done: me => (me.flags && me.flags.annexed) || planetsMine().length > 1 },
  { icon: 'chat', title: 'Saluda en el chat global', desc: 'Social > Chat.', done: () => localStorage.getItem('od_chatted') === '1' },
  { icon: 'market', title: 'Vende unidades a otra nación', desc: 'Proyectos > Diseños > tu diseño > Vender unidades. Fabricas tú, vendes hecho.', done: me => me.flags && me.flags.soldUnits },
  { icon: 'deliver', title: 'Compra unidades que no puedes fabricar', desc: 'Imperio > Mercado: compra a quien se especializó en esa rama.', done: me => me.flags && me.flags.boughtUnits },
  { icon: 'invade', title: 'Conquista un planeta enemigo', desc: 'Declara la guerra, gana la órbita, bloquea, bombardea y desembarca tropas (la campaña va por rondas).', done: me => me.flags && me.flags.invaded }
];
function planetsMine() { return Object.values(store.state.planets).filter(p => p.owner === store.me.id); }
function guide() {
  localStorage.setItem('od_guide_seen', '1');
  const me = store.me;
  const list = OBJECTIVES.map(o => { const d = !!o.done(me); return `<div class="objective ${d ? 'done' : ''}"><span class="ico-lg">:${d ? 'ok' : o.icon}:</span><div class="grow"><b>${o.title}</b><span class="small muted">${o.desc}</span></div></div>`; }).join('');
  openModal(`<div class="title-box">Cómo jugar</div>
    <div class="guide-step"><span class="ico-xl">:gov:</span><div><b>Tycoon</b><br>Cada ciclo cobras impuestos. Construye edificios en tus planetas y ajusta los impuestos (Imperio).</div></div>
    <div class="guide-step"><span class="ico-xl">:research:</span><div><b>Proyectos</b><br>Elige <b>2 especialidades</b> (no puedes investigarlo todo), diseña tus armas y naves y <b>véndelas ya fabricadas</b>. Lo que no investigaste, se lo compras a otros.</div></div>
    <div class="guide-step"><span class="ico-xl">:war:</span><div><b>Guerra y diplomacia</b><br>Toca una flota en el mapa ⟶ <b>Atacar</b> ⟶ toca el sistema enemigo. Alíate, comercia… o traiciona.</div></div>
    <div class="guide-step"><span class="ico-xl">:live:</span><div><b>Batallas en vivo</b><br>Las grandes duran hasta 30 minutos y las ves en 3D. Cuidado con el <b>calor</b>: las armas se bloquean al sobrecalentarse. Da órdenes a tus escuadrones: <b>Atacar</b>, <b>Mantener</b>, <b>Distancia</b> o <b>Retirada</b>, y toca un enemigo para concentrar el fuego.</div></div>
    <div class="guide-step"><span class="ico-xl">:calendar:</span><div><b>Temporada</b><br>Cada partida dura unas 2-3 semanas y gana la <b>última nación o alianza en pie</b>. Tienes 48 h de protección de novatos. Cuidado con piratas, criaturas del vacío y el <b>Devorador</b> de la fase final.</div></div>
    <h3>Objetivos</h3>${list}
    <div class="spacer"></div><button class="btn block" id="g-war">:war: Ver guía de combate</button>`,
    m => m.querySelector('#g-war').onclick = () => openModal(HELP.military));
}
window.addEventListener('od:guide', guide);
function show(view) {
  currentView = view;
  document.querySelectorAll('#tabbar button').forEach(b => b.classList.toggle('active', b.dataset.view === view));
  for (const k in VIEWS) {
    const el = document.getElementById('view-' + k);
    el.classList.toggle('hidden', k !== view);
    if (k !== view && VIEWS[k].hide) VIEWS[k].hide();
  }
  VIEWS[view].show && VIEWS[view].show();
}
$('#tabbar').onclick = e => { const b = e.target.closest('button'); if (b) show(b.dataset.view); };
window.addEventListener('od:goto', e => { show(e.detail.view); if (e.detail.then) e.detail.then(); });

/* Barra superior: recursos + temporizador de ciclo */
function renderTopbar() {
  const me = store.me; if (!me) return;
  const e = me.economy;
  $('#topbar').innerHTML =
    `<span class="res" title="Créditos">₡ ${fmt(me.credits)} <small class="${e.net >= 0 ? 'good' : 'bad'}">${e.net >= 0 ? '+' : ''}${fmt(e.net)}</small></span>` +
    `<span class="res" title="Investigación">:research: ${fmt(me.research)}</span>` +
    Object.keys(GD.RESOURCES).map(r => `<span class="res" title="${GD.RESOURCES[r].name}">${GD.RESOURCES[r].icon} ${fmt(me.resources[r] || 0)}</span>`).join('') +
    seasonChip() +
    `<span class="res" id="cycle-timer" title="Próximo ciclo">:time: <b id="cycle-left"></b></span>` +
    `<button class="btn small" id="music-btn" title="Música">${music.enabled ? ':sound:' : ':mute:'}</button>`;
  $('#music-btn').onclick = () => { $('#music-btn').innerHTML = window.Icons.svg(music.toggle() ? 'sound' : 'mute'); };
  tickTimer();
}
/** Chip de temporada: día, fase y protección de novatos */
function seasonChip() {
  const se = store.state.season; if (!se) return '';
  const prot = store.me && store.me.protectedUntil;
  return `<span class="res" title="Temporada ${se.number} · día ${se.day} de ~${se.days}. ${se.phase.name}">:calendar: ${se.day}/${se.days}${se.crisis && se.crisis.awake ? ' <span class="pill crisis">crisis</span>' : ''}</span>` +
    (prot ? `<span class="res" title="Protección de novatos: nadie puede declararte la guerra" style="color:var(--good)">:shield: <b id="prot-left">${timeLeft(prot)}</b></span>` : '');
}
/** Aviso rojo "BATALLA en X – ver en vivo" cuando alguna de tus flotas combate */
function updateBattleBanner() {
  const bn = document.getElementById('battle-banner'); if (!bn || !store.state) return;
  const mine = BattleView.myLiveBattles();
  if (!mine.length || BattleView.isOpen()) { bn.classList.add('hidden'); return; }
  const b = mine[0], sys = store.state.systems[b.system];
  bn.innerHTML = `<span class="live-dot"></span><div class="grow"><b>BATALLA en ${sys ? sys.name : '?'}</b><div class="small muted">Tu flota está combatiendo${mine.length > 1 ? ' · +' + (mine.length - 1) + ' más' : ''}</div></div><button class="btn small danger" data-watch="${b.id}">:live: Ver en vivo</button>`;
  bn.classList.remove('hidden');
}
let victoryShown = null;
function checkSeasonEnd() {
  const se = store.state.season;
  if (!se || se.status === 'running' || victoryShown === se.number + se.status) return;
  victoryShown = se.number + se.status;
  const me = store.me, w = se.winner;
  const mine = me && w && (w.members || []).includes(me.id);
  const rows = (se.final || []).slice(0, 8).map((r, i) => `<div class="standing"><b class="pos">${i + 1}</b><span class="grow">${r.name} ${r.bot ? '<span class="pill bot">:robot: IA</span>' : ''}</span><b>${r.score}</b></div>`).join('');
  openModal(`<div class="victory-card"><div class="ico-xl">:crown:</div><div class="title-box">${se.status === 'void' ? 'Temporada anulada' : (mine ? '¡VICTORIA!' : 'Fin de la temporada')}</div>
    <p>${se.status === 'void' ? esc(se.reason) : '<b>' + esc(w.name) + '</b> domina la galaxia.'}</p><p class="small muted">${esc(se.reason || '')}</p>${rows}
    <p class="small muted">El administrador iniciará la siguiente temporada. ¡Gracias por jugar!</p></div>`);
}
function tickTimer() {
  const pl = document.getElementById('prot-left'); if (pl && store.me && store.me.protectedUntil) pl.textContent = timeLeft(store.me.protectedUntil);
  const el = document.getElementById('cycle-left');
  if (el && store.state) el.textContent = timeLeft(store.state.nextCycleAt);
}
setInterval(tickTimer, 1000);

on('state', () => {
  if (!started) return;
  renderTopbar();
  updateBattleBanner();
  checkSeasonEnd();
  // Re-dibuja solo la vista activa (y no si el usuario tiene un modal abierto para no perder lo que escribe)
  const V = VIEWS[currentView];
  if (V.update) V.update({ modalOpen: isModalOpen() });
  SocialView.updateBadge && SocialView.updateBadge();
});

/* Arranque */
if (store.token) connect(); else showAuth();
