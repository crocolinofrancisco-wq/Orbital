/* =====================================================================
 * NÚCLEO DEL CLIENTE
 * - Conexión Socket.IO y estado recibido del servidor
 * - Helpers de UI: toasts, modales, formato de números, banderas
 * - Bus de eventos simple para que las vistas se re-dibujen
 * Las vistas (js/views/*.js) importan desde aquí.
 * ===================================================================== */
export const GD = window.GameData;

export const store = {
  token: localStorage.getItem('od_token'),
  state: null,         // último estado recibido (ver server/index.js viewFor)
  get me() { return this.state && this.state.me; },
  timeOffset: 0        // serverTime - Date.now()
};

/* ---------- Eventos ---------- */
const listeners = {};
export function on(ev, fn) { (listeners[ev] = listeners[ev] || []).push(fn); }
export function emit(ev, data) { (listeners[ev] || []).forEach(fn => fn(data)); }

/* ---------- Red ---------- */
export const socket = window.io({ autoConnect: false, transports: ['websocket', 'polling'] });
export function action(type, data) {
  return new Promise(res => {
    socket.emit('action', { type, data }, r => {
      if (!r) return res(r);
      if (r.ok && r.msg) toast(r.msg, 'good');
      if (!r.ok && r.error) toast(r.error, 'bad');
      res(r);
    });
  });
}
export function setState(s) {
  store.state = s;
  store.timeOffset = s.serverTime - Date.now();
  emit('state', s);
}
export const serverNow = () => Date.now() + store.timeOffset;

/* ---------- Formato ---------- */
export function fmt(n) {
  n = Number(n) || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return Math.round(n).toLocaleString('es');
}
export const pct = v => Math.round((v || 0) * 100) + '%';
export function costHTML(cost, mult) {
  mult = mult || 1;
  return Object.keys(cost || {}).map(k => {
    const v = cost[k] * mult;
    const have = k === 'credits' ? store.me.credits : (store.me.resources[k] || 0);
    const cls = have >= v ? '' : 'bad';
    return `<span class="${cls}">${k === 'credits' ? '₡' : GD.RESOURCES[k].emoji}${fmt(Math.ceil(v))}</span>`;
  }).join(' ');
}
export function timeLeft(ts) {
  const s = Math.max(0, Math.round((ts - serverNow()) / 1000));
  if (s >= 3600) return Math.floor(s / 3600) + 'h ' + Math.floor(s % 3600 / 60) + 'm';
  if (s >= 60) return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
  return s + 's';
}
export function ago(t) {
  const s = Math.round((serverNow() - t) / 1000);
  if (s < 60) return 'ahora';
  if (s < 3600) return Math.floor(s / 60) + ' min';
  if (s < 86400) return Math.floor(s / 3600) + ' h';
  return Math.floor(s / 86400) + ' d';
}
export function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }

/* ---------- Naciones ---------- */
export function nation(id) { return (store.state && store.state.nations[id]) || null; }
export function flagHTML(flagOrNationId, w, h) {
  const f = typeof flagOrNationId === 'string' ? (nation(flagOrNationId) || {}).flag : flagOrNationId;
  return `<span class="flag">${GD.flagSVG(f, w || 30, h || 20)}</span>`;
}
export function ballHTML(nid, size, mood) {
  const n = nation(nid);
  return GD.ballSVG(n ? n.flag : null, size || 40, mood);
}
/** Color de mapa de una nación: color principal de su bandera (los aliados no se confunden porque cada uno elige el suyo) */
export function nationColor(nid) {
  const n = nation(nid);
  if (!n) return '#666';
  const c = n.flag.colors;
  // Evita colores casi blancos/negros como color de territorio
  const lum = hex => { const v = parseInt(hex.slice(1), 16); return ((v >> 16) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11); };
  return c.find(x => lum(x) > 40 && lum(x) < 225) || c[0];
}
export function nationName(nid) { const n = nation(nid); return n ? n.name : 'Independiente'; }
export function relation(nid) {
  const me = store.me; if (!me || !nid) return 'neutral';
  if (nid === me.id) return 'mine';
  const st = store.state;
  for (const w of Object.values(st.wars)) if (w.active && ((w.attackers.includes(me.id) && w.defenders.includes(nid)) || (w.defenders.includes(me.id) && w.attackers.includes(nid)))) return 'war';
  if (me.alliance && nation(nid) && nation(nid).alliance === me.alliance) return 'ally';
  return 'neutral';
}
export const REL_LABEL = { mine: '<span class="pill good">Tuyo</span>', ally: '<span class="pill" style="color:#4cc9f0">Aliado</span>', war: '<span class="pill bad">En guerra</span>', neutral: '' };

/* ---------- Toasts ---------- */
export function toast(text, kind) {
  const el = document.createElement('div');
  el.className = 'toast ' + (kind || '');
  el.textContent = text;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; el.style.transition = 'opacity .4s'; }, 3200);
  setTimeout(() => el.remove(), 3700);
  if (navigator.vibrate && kind === 'bad') navigator.vibrate(30);
}

/* ---------- Modal (bottom-sheet en móvil, centrado en PC) ---------- */
let modalOnClose = null;
export function openModal(html, onMount, onClose) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal"><button class="btn small modal-close" data-close>✕</button>${html}</div>`;
  root.classList.remove('hidden');
  modalOnClose = onClose || null;
  root.onclick = e => { if (e.target === root || e.target.closest('[data-close]')) closeModal(); };
  if (onMount) onMount(root.querySelector('.modal'));
}
export function closeModal() {
  const root = document.getElementById('modal-root');
  root.classList.add('hidden'); root.innerHTML = '';
  if (modalOnClose) { const f = modalOnClose; modalOnClose = null; f(); }
}
export function isModalOpen() { return !document.getElementById('modal-root').classList.contains('hidden'); }
export function confirmModal(text, okLabel, danger) {
  return new Promise(res => {
    openModal(`<h3>Confirmar</h3><p>${text}</p><div class="row"><button class="btn grow" data-close>Cancelar</button><button class="btn grow ${danger ? 'danger' : 'primary'}" id="cm-ok">${okLabel || 'Aceptar'}</button></div>`,
      m => m.querySelector('#cm-ok').onclick = () => { modalOnClose = null; closeModal(); res(true); }, () => res(false));
  });
}

/* ---------- Ayuda contextual (botón "?" de las capturas) ---------- */
export const HELP = {
  empire: '<h3>🏛️ Tu Imperio</h3><p>Cada <b>ciclo</b> recibes tu <b>PIB</b> en impuestos. Más población, más edificios y más estabilidad = más dinero.</p><p>Si subes mucho los impuestos ganas más ahora, pero sube la pobreza, la evasión y baja la popularidad. ¡Busca el equilibrio!</p><p>Los <b>extractores</b> te dan el recurso del yacimiento del planeta cada ciclo.</p>',
  projects: '<h3>🔬 Proyectos</h3><p>1) <b>Investiga</b> tecnologías con Puntos de Investigación (PI).<br>2) <b>Diseña componentes</b> (armas, escudos, motores) repartiendo puntos.<br>3) <b>Diseña naves</b> eligiendo un casco y montando componentes.<br>4) <b>Fabrica</b> en tus astilleros o <b>vende la licencia</b> a otros jugadores: ¡cobras regalías cada vez que fabriquen tu diseño!</p>',
  military: '<h3>⚔️ Militar</h3><p>Las batallas se <b>simulan automáticamente</b> cuando flotas de naciones en guerra coinciden en un sistema.</p><p><b>Energía</b> (láser, plasma) ⟶ la frenan los <b>escudos</b>.<br><b>Cinético</b> (cañones, riel) ⟶ lo frena el <b>blindaje</b>.<br><b>Explosivo</b> (misiles, torpedos) ⟶ lo intercepta la <b>defensa puntual</b>.</p><p>Las batallas empiezan a <b>larga distancia</b> (misiles y riel) y terminan cuerpo a cuerpo (plasma, cañones, cazas).</p><p>Para conquistar un planeta: gana el control orbital y desembarca tropas con <b>transportes</b>.</p>',
  social: '<h3>💬 Social</h3><p>Chatea en el canal global, con tu alianza o en privado. Forma alianzas, declara guerras y negocia la paz.</p><p>Traicionar a un aliado se anuncia a toda la galaxia y baja tu estabilidad. ¡Piénsalo dos veces!</p><p>Sé respetuoso: los insultos se filtran.</p>'
};
export function helpButton(key) { return `<button class="btn help" data-help="${key}">?</button>`; }
document.addEventListener('click', e => {
  const h = e.target.closest('[data-help]');
  if (h) openModal(HELP[h.dataset.help] || '');
});

/* ---------- Sub-pestañas reutilizables ---------- */
export function subtabs(items, active) {
  return `<div class="subtabs">${items.map(([k, label]) => `<button data-sub="${k}" class="${k === active ? 'active' : ''}">${label}</button>`).join('')}</div>`;
}

/* ---------- Audio (OST del juego) ---------- */
export const music = {
  el: null, current: null, enabled: localStorage.getItem('od_music') !== '0',
  tracks: { calm: 'assets/ost/chill_interstellar.m4a', battle: ['assets/ost/battle_lavarun.m4a', 'assets/ost/battle_indoorspace.m4a'] },
  play(kind) {
    if (!this.enabled) return;
    if (this.current === kind && this.el && !this.el.paused) return;
    let src = this.tracks[kind]; if (Array.isArray(src)) src = src[Math.floor(Math.random() * src.length)];
    if (!this.el) { this.el = new Audio(); this.el.loop = true; this.el.volume = 0.35; }
    this.current = kind; this.el.src = src; this.el.play().catch(() => {});
  },
  toggle() {
    this.enabled = !this.enabled; localStorage.setItem('od_music', this.enabled ? '1' : '0');
    if (!this.enabled && this.el) this.el.pause(); else this.play(this.current || 'calm');
    return this.enabled;
  }
};
