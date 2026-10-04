/* =====================================================================
 * APP — arranque, login, creación de nación, barra superior y navegación
 * ===================================================================== */
import { GD, store, socket, setState, on, toast, fmt, timeLeft, esc, music, isModalOpen } from './core.js';
import * as MapView from './views/map.js';
import * as EmpireView from './views/empire.js';
import * as ProjectsView from './views/projects.js';
import * as MilitaryView from './views/military.js';
import * as SocialView from './views/social.js';

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
  if (ev.type === 'cycle') toast('💰 ' + ev.text, 'good');
  if (ev.type === 'battle') { toast('💥 ¡Batalla! Revisa Militar > Informes', 'bad'); music.play('battle'); setTimeout(() => music.play('calm'), 120000); }
  if (ev.type === 'eliminated') { toast('💀 Tu nación ha caído.', 'bad'); setTimeout(() => location.reload(), 4000); }
});

/* ---------------- Juego ---------------- */
let started = false;
function startGame() {
  $('#auth-screen').classList.add('hidden'); $('#create-screen').classList.add('hidden'); $('#app').classList.remove('hidden');
  if (started) return;
  started = true;
  for (const k in VIEWS) VIEWS[k].init && VIEWS[k].init(document.getElementById('view-' + k));
  show('map');
  renderTopbar();
  // La música arranca al primer toque (los navegadores bloquean autoplay)
  document.addEventListener('pointerdown', () => music.play('calm'), { once: true });
}
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
    `<span class="res" title="Investigación">🔬 ${fmt(me.research)}</span>` +
    Object.keys(GD.RESOURCES).map(r => `<span class="res" title="${GD.RESOURCES[r].name}">${GD.RESOURCES[r].emoji} ${fmt(me.resources[r] || 0)}</span>`).join('') +
    `<span class="res" id="cycle-timer" title="Próximo ciclo">⏳ <b id="cycle-left"></b></span>` +
    `<button class="btn small" id="music-btn" title="Música">${music.enabled ? '🔊' : '🔇'}</button>`;
  $('#music-btn').onclick = () => { $('#music-btn').textContent = music.toggle() ? '🔊' : '🔇'; };
  tickTimer();
}
function tickTimer() {
  const el = document.getElementById('cycle-left');
  if (el && store.state) el.textContent = timeLeft(store.state.nextCycleAt);
}
setInterval(tickTimer, 1000);

on('state', () => {
  if (!started) return;
  renderTopbar();
  // Re-dibuja solo la vista activa (y no si el usuario tiene un modal abierto para no perder lo que escribe)
  const V = VIEWS[currentView];
  if (V.update) V.update({ modalOpen: isModalOpen() });
  SocialView.updateBadge && SocialView.updateBadge();
});

/* Arranque */
if (store.token) connect(); else showAuth();
