/* =====================================================================
 * NÚCLEO DEL CLIENTE
 * - Conexión Socket.IO y estado recibido del servidor
 * - Helpers de UI: toasts, modales, formato de números, banderas
 * - Bus de eventos simple para que las vistas se re-dibujen
 * Las vistas (js/views/*.js) importan desde aquí.
 * ===================================================================== */
export const GD = window.GameData;
export const Icons = window.Icons;

/* ---------- Iconos procedurales ----------
 * Cualquier texto ":nombre:" (ver shared/icons.js) se convierte en <svg>.
 * Un MutationObserver lo hace automáticamente en todo el documento, así
 * las vistas, notificaciones y noticias del servidor pueden usar tokens. */
export const icon = (name, o) => Icons.svg(name, o);
const TOKEN_RX = /:([a-z][a-z0-9_]*):|₡/g;
export function expandIcons(rootNode) {
  const walker = document.createTreeWalker(rootNode, NodeFilter.SHOW_TEXT, {
    acceptNode: n => (n.nodeValue.indexOf(':') >= 0 || n.nodeValue.indexOf('₡') >= 0) && n.parentNode && !/^(SCRIPT|STYLE|TEXTAREA|INPUT|OPTION)$/.test(n.parentNode.nodeName) && !n.parentNode.closest('[data-noicons]') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  for (const n of nodes) {
    const txt = n.nodeValue;
    TOKEN_RX.lastIndex = 0;
    if (!TOKEN_RX.test(txt)) continue;
    TOKEN_RX.lastIndex = 0;
    let html = '', last = 0, m, changed = false;
    while ((m = TOKEN_RX.exec(txt))) {
      const name = m[1] || 'credits';
      if (m[1] && !Icons.has(name)) continue;
      html += escText(txt.slice(last, m.index)) + Icons.svg(name); last = m.index + m[0].length; changed = true;
    }
    if (!changed) continue;
    html += escText(txt.slice(last));
    const span = document.createElement('span'); span.className = 'ico-wrap'; span.innerHTML = html;
    n.parentNode.replaceChild(span, n);
  }
  // <option> no admite SVG: quitamos los tokens dejando solo texto
  rootNode.querySelectorAll && rootNode.querySelectorAll('option').forEach(o => { if (/:[a-z][a-z0-9_]*:/.test(o.textContent)) o.textContent = o.textContent.replace(/:[a-z][a-z0-9_]*:\s?/g, ''); });
}
function escText(t) { return t.replace(/&/g, '&amp;').replace(/</g, '&lt;'); }
/** Quita tokens (para title="", placeholders, notificaciones del sistema) */
export const stripIcons = t => String(t).replace(/:[a-z][a-z0-9_]*:\s?/g, '');
new MutationObserver(muts => {
  for (const m of muts) for (const n of m.addedNodes) {
    if (n.nodeType === 1) expandIcons(n);
    else if (n.nodeType === 3 && n.parentNode) expandIcons(n.parentNode);
  }
}).observe(document.documentElement, { childList: true, subtree: true });
document.addEventListener('DOMContentLoaded', () => expandIcons(document.body));

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
    return `<span class="${cls}">${k === 'credits' ? '₡' : GD.RESOURCES[k].icon}${fmt(Math.ceil(v))}</span>`;
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
  if (nid === 'pirates') return '#e63946';
  if (nid === 'monsters') return '#1fa37a';
  const n = nation(nid);
  if (!n) return '#666';
  const c = n.flag.colors;
  // Evita colores casi blancos/negros como color de territorio
  const lum = hex => { const v = parseInt(hex.slice(1), 16); return ((v >> 16) * 0.3 + ((v >> 8) & 255) * 0.59 + (v & 255) * 0.11); };
  return c.find(x => lum(x) > 40 && lum(x) < 225) || c[0];
}
export function nationName(nid) { const n = nation(nid); return n ? n.name : 'Independiente'; }
/** Etiqueta pequeña junto al nombre: IA / NPC */
export function nationTag(nid) { const n = nation(nid); if (!n) return ''; if (n.npc) return ' <span class="pill bad">NPC</span>'; return n.bot ? ' <span class="pill bot" title="Nación controlada por IA">:robot: IA</span>' : ''; }
/** Piratas y criaturas: hostiles a todos (siempre "en guerra" con el jugador) */
export const isNpc = nid => nid === 'pirates' || nid === 'monsters';
export function relation(nid) {
  const me = store.me; if (!me || !nid) return 'neutral';
  if (nid === me.id) return 'mine';
  if (isNpc(nid)) return 'war';
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
  root.innerHTML = `<div class="modal"><button class="btn small modal-close" data-close>:close:</button>${html}</div>`;
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
  empire: '<h3>:gov: Tu Imperio</h3><p>Cada <b>ciclo</b> recibes tu <b>PIB</b> en impuestos. Más población, más edificios y más estabilidad = más dinero.</p><p>Si subes mucho los impuestos ganas más ahora, pero sube la pobreza, la evasión y baja la popularidad. ¡Busca el equilibrio!</p><p>Los <b>extractores</b> te dan el recurso del yacimiento del planeta cada ciclo.</p>',
  projects: '<h3>:research: Proyectos</h3><p>1) <b>Investiga</b> tecnologías con Puntos de Investigación (PI).<br>2) <b>Diseña componentes</b> (armas, escudos, motores) repartiendo puntos.<br>3) <b>Diseña naves</b> eligiendo un casco y montando componentes.<br>4) <b>Fabrica</b> en tus astilleros y <b>vende las unidades ya hechas</b> a otras naciones (no hay licencias: fabrica el otro y te vende).<br>Solo puedes investigar a fondo <b>2 especialidades</b>: lo demás lo compras en el Mercado.</p>',
  military: '<h3>:war: Cómo combatir</h3>' +
    '<div class="guide-step"><span class="ico-xl">:fleet:</span><div><b>1. Elige una flota</b><br>En el mapa toca tu flota (o ve a Militar > Flotas).</div></div>' +
    '<div class="guide-step"><span class="ico-xl">:war:</span><div><b>2. Pulsa ATACAR y toca el sistema destino</b><br>La flota viaja por las hiperrutas. Al llegar, si hay enemigos <b>en guerra</b> contigo (piratas y criaturas siempre lo están), empieza una <b>batalla en tiempo real</b> (de 3 a 30 minutos según el tamaño de las flotas).</div></div>' +
    '<div class="guide-step"><span class="ico-xl">:live:</span><div><b>3. Míralo en vivo y da órdenes</b><br>Toca el aviso <b>BATALLA</b> de arriba. Elige tu escuadrón y su táctica: <b>:tac_attack: Atacar</b>, <b>:tac_hold: Mantener</b>, <b>:tac_kite: Distancia</b> o <b>:tac_retreat: Retirada</b>, y toca un enemigo para <b>:focus: concentrar el fuego</b>.</div></div>' +
    '<div class="guide-step"><span class="ico-xl">:blockade:</span><div><b>4. Domina la órbita</b><br>Una flota armada quieta sobre un planeta enemigo <b>lo bloquea</b>: sin PIB y con la estabilidad cayendo. Es lo más barato para ahogar a un rival.</div></div>' +
    '<div class="guide-step"><span class="ico-xl">:bombard:</span><div><b>5. Bombardea</b><br>Desde la flota: <b>precisión</b> (lento, no destruye el planeta) o <b>saturación</b> (rápido, pero mata población y edificios). Con <b>escudo planetario</b> no se puede: hay que apagar el generador con tropas (la artillería de asedio pega x3).</div></div>' +
    '<div class="guide-step"><span class="ico-xl">:invade:</span><div><b>6. Desembarca: la campaña terrestre</b><br>Lleva un <b>Transporte</b> con tropas. Pelean ronda a ronda (cada ~20 s) contra guarnición y milicia. Elige <b>asalto</b> (rápido, sangriento) o <b>asedio</b> (lento, cuida a tus tropas), refuerza o retírate desde la ficha del planeta.</div></div>' +
    '<div class="guide-step"><span class="ico-xl">:heat:</span><div><b>Calor</b><br>Cada disparo calienta la nave. Al llegar al máximo las armas <b>se bloquean</b> hasta enfriarse. Los <b>radiadores</b> (rama Sistemas) y las armas frías (pulsos, cañones, misiles) aguantan más. Una nave muy dañada y sin armas puede <b>rendirse</b> y su botín pasa al vencedor.</div></div>' +
    '<div class="guide-step"><span class="ico-xl">:skull:</span><div><b>Piratas y criaturas</b><br>Los <b>Piratas del Vacío</b> y las <b>criaturas</b> (Leviatán de los asteroides, medusas de plasma, enjambres centinela…) son hostiles siempre y dan botín. Míralos en Militar > Objetivos.</div></div>' +
    '<h3>Piedra, papel, tijera</h3><p>:c_laser: <b>Energía</b> (láser, plasma) ⟶ la frenan los :c_escudo: <b>escudos</b>.<br>:c_canon: <b>Cinético</b> (cañones, riel) ⟶ lo frena el :c_blindaje: <b>blindaje</b>.<br>:c_misil: <b>Explosivo</b> (misiles, torpedos) ⟶ lo intercepta la :c_pd: <b>defensa puntual</b>.</p><p>Las batallas empiezan a <b>larga distancia</b> (misiles y riel) y terminan cuerpo a cuerpo (plasma, cañones, cazas). Mira la repetición en Informes.</p>',
  social: '<h3>:chat: Social</h3><p>Chatea en el canal global, con tu alianza o en privado. Forma alianzas, declara guerras y negocia la paz.</p><p>Traicionar a un aliado se anuncia a toda la galaxia y baja tu estabilidad. ¡Piénsalo dos veces!</p><p>Sé respetuoso: los insultos se filtran.</p>'
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
