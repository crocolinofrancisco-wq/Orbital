/* =====================================================================
 * VISTA: SOCIAL (apartado DIPLOMÁTICO + chats)
 * Sub-pestañas: Chat | Naciones | Alianza | Ofertas | Noticias
 * El chat sustituye a Discord: global, alianza, privados (DM) y guerra.
 * ===================================================================== */
import { GD, store, socket, action, fmt, esc, flagHTML, ballHTML, nationName, nationTag, timeLeft, helpButton, subtabs, ago, openModal, closeModal, relation, REL_LABEL, confirmModal, toast } from '../core.js';

let root, sub = 'chat', channel = 'global';
const unread = {};
const history = {};
export function init(el) {
  root = el;
  el.addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (b) { sub = b.dataset.sub; render(); } });
  window.addEventListener('od:channel', e => { sub = 'chat'; channel = e.detail; render(); });
  socket.on('chat', m => {
    (history[m.channel] = history[m.channel] || []).push(m);
    const visible = !root.classList.contains('hidden') && sub === 'chat' && channel === m.channel;
    if (visible) appendMsg(m);
    else if (m.from !== store.me.id) { unread[m.channel] = (unread[m.channel] || 0) + 1; updateBadge(); if (m.channel.startsWith('dm:')) toast(':mail: ' + m.name + ': ' + m.text.slice(0, 60), 'warn'); }
  });
  socket.on('news', () => { if (sub === 'news' && !root.classList.contains('hidden')) render(); });
}
export function show() { render(); }
export function update({ modalOpen }) {
  if (modalOpen) return;
  if (sub === 'chat') { renderChannels(); return; } // no destruir el input mientras se escribe
  render();
}
export function updateBadge() {
  const offers = store.me ? store.me.offers.filter(o => o.to === store.me.id).length : 0;
  const n = Object.values(unread).reduce((a, b) => a + b, 0) + offers;
  const b = document.getElementById('social-badge');
  if (b) { b.textContent = n; b.classList.toggle('hidden', !n); }
}

function render() {
  const offers = store.me.offers.filter(o => o.to === store.me.id).length;
  root.innerHTML = `${subtabs([['chat', ':chat: Chat'], ['nations', ':globe: Naciones'], ['alliance', ':ally: Alianza'], ['offers', ':mail: Ofertas' + (offers ? ' (' + offers + ')' : '')], ['news', ':news: Noticias']], sub)}<div id="so-body" style="height:calc(100% - 46px)"></div>`;
  ({ chat, nations, alliance, offers: offersView, news })[sub](root.querySelector('#so-body'));
}

/* ---------- Chat ---------- */
function channelsList() {
  const me = store.me, s = store.state;
  const list = [['global', ':globe: Global']];
  if (me.alliance && s.alliances[me.alliance]) list.push(['ally:' + me.alliance, ':ally: [' + s.alliances[me.alliance].tag + ']']);
  for (const w of Object.values(s.wars)) if (w.active && (w.attackers.includes(me.id) || w.defenders.includes(me.id))) list.push(['war:' + w.id, ':war: ' + w.name.slice(0, 14)]);
  const dms = new Set(Object.keys(history).concat(Object.keys(unread)).filter(c => c.startsWith('dm:')));
  if (channel.startsWith('dm:')) dms.add(channel);
  for (const c of dms) { const other = c.slice(3).split('|').find(x => x !== me.id); list.push([c, ':mail: ' + nationName(other).slice(0, 12)]); }
  return list;
}
function renderChannels() {
  const el = root.querySelector('.chat-channels'); if (!el) return;
  el.innerHTML = channelsList().map(([k, l]) => `<button class="btn small ${k === channel ? 'primary' : ''}" data-ch="${esc(k)}">${esc(l)}${unread[k] ? ' :c_laser:' + unread[k] : ''}</button>`).join('');
  el.querySelectorAll('[data-ch]').forEach(b => b.onclick = () => { channel = b.dataset.ch; chat(root.querySelector('#so-body')); });
}
function chat(body) {
  body.innerHTML = `<div class="chat-wrap"><div class="chat-channels"></div><div class="chat-log" id="log"></div>
    <div class="chat-input"><input type="text" id="msg" maxlength="${GD.RULES.chatMaxLength}" placeholder="Escribe un mensaje…" autocomplete="off"><button class="btn primary" id="send">:send:</button></div></div>`;
  renderChannels();
  unread[channel] = 0; updateBadge();
  const log = body.querySelector('#log');
  socket.emit('chat:history', channel, msgs => {
    history[channel] = msgs;
    log.innerHTML = msgs.length ? '' : '<p class="muted center small">Nadie ha escrito aquí todavía. ¡Saluda! :exit:</p>';
    msgs.forEach(appendMsg);
  });
  const input = body.querySelector('#msg');
  const send = () => {
    const text = input.value.trim(); if (!text) return;
    socket.emit('chat:send', { channel, text }, r => { if (r && !r.ok && r.error) toast(r.error, 'bad'); else localStorage.setItem('od_chatted', '1'); });
    input.value = ''; input.focus();
  };
  body.querySelector('#send').onclick = send;
  input.onkeydown = e => { if (e.key === 'Enter') send(); };
}
function appendMsg(m) {
  const log = root.querySelector('#log'); if (!log) return;
  if (log.querySelector('p.muted')) log.innerHTML = '';
  const mine = m.from === store.me.id;
  const d = document.createElement('div');
  d.className = 'msg' + (mine ? ' mine' : '');
  d.innerHTML = `<div data-nation="${m.from}" style="cursor:pointer">${GD.ballSVG(m.flag, 34)}</div><div class="body"><span class="who">${esc(m.name)}${m.bot ? ' <span class="pill bot">:robot: IA</span>' : ''}</span><span class="when">${ago(m.t)}</span><div>${esc(m.text)}</div></div>`;
  d.querySelector('[data-nation]').onclick = () => nationModal(m.from);
  log.appendChild(d);
  log.scrollTop = log.scrollHeight;
}
export function openDM(nid) {
  const ids = [store.me.id, nid].sort();
  channel = 'dm:' + ids.join('|'); sub = 'chat';
  window.dispatchEvent(new CustomEvent('od:goto', { detail: { view: 'social' } }));
  render();
}

/* ---------- Naciones (ranking) ---------- */
function nations(body) {
  const list = Object.values(store.state.nations).filter(n => n.alive && !n.npc).sort((a, b) => b.gdp - a.gdp);
  const dead = Object.values(store.state.nations).filter(n => !n.alive);
  const st = store.state.standings || [];
  body.innerHTML = `<div class="card"><h3>:trophy: Ranking de dominio</h3><p class="small muted">Puntos por planetas, población, PIB, tecnologías y flota. Para ganar hay que ser la <b>última nación o alianza en pie</b>.</p>
    ${st.slice(0, 8).map((r, i) => `<div class="standing" data-nation="${r.id}"><b class="pos">${i + 1}</b>${ballHTML(r.id, 26)}<span class="grow">${esc(r.name)}${r.bot ? ' <span class="pill bot">:robot: IA</span>' : ''}${r.id === store.me.id ? ' <span class="pill good">Tú</span>' : ''}</span><b>${fmt(r.score)}</b></div>`).join('')}</div>
    <div class="card"><h3>:globe: Naciones de la galaxia (${list.length})</h3>
    ${list.map((n, i) => `<div class="list-item" data-nation="${n.id}"><b style="width:22px">${i + 1}</b>${ballHTML(n.id, 38)}<div class="grow"><b>${esc(n.name)}${nationTag(n.id)} ${n.online ? '<span class="good small">●</span>' : ''}</b>
      <span class="small muted">${n.alliance && store.state.alliances[n.alliance] ? '[' + esc(store.state.alliances[n.alliance].tag) + '] ' : ''}:planet:${n.planets} · :pop:${fmt(n.pop)}M · :gov:₡${fmt(n.gdp)}</span></div>${n.protectedUntil ? '<span class="pill good" title="Protección de novatos">:shield:</span>' : ''}${REL_LABEL[relation(n.id)]}</div>`).join('')}</div>
    ${dead.length ? `<div class="card"><h3>:skull: Naciones caídas</h3><p class="small muted">${dead.map(n => esc(n.name)).join(', ')}</p></div>` : ''}`;
  body.querySelectorAll('[data-nation]').forEach(el => el.onclick = () => nationModal(el.dataset.nation));
}
export function nationModal(nid) {
  const n = store.state.nations[nid]; if (!n) return;
  const me = store.me, s = store.state;
  const isMe = nid === me.id;
  const al = n.alliance && s.alliances[n.alliance];
  openModal(`<div class="center">${ballHTML(nid, 90)}<div class="title-box">${esc(n.name)}</div>${n.motto ? `<p class="muted">"${esc(n.motto)}"</p>` : ''}</div>
    <ul class="stat-list"><li><span>:user: Líder</span><b>${n.bot ? ':robot: IA ' + esc(({ mercader: 'Mercader', cientifico: 'Científico', tortuga: 'Defensivo', oportunista: 'Oportunista', belicista: 'Belicista' })[n.persona] || '') : esc(n.username || '?')} ${n.online ? '<span class="good">● en línea</span>' : ''}</b></li>
    ${n.protectedUntil ? '<li><span>:shield: Protección</span><b class="good">' + timeLeft(n.protectedUntil) + '</b></li>' : ''}
    <li><span>:planet: Planetas</span><b>${n.planets}</b></li><li><span>:pop: Población</span><b>${fmt(n.pop)} M</b></li><li><span>:gov: PIB</span><b>₡${fmt(n.gdp)}</b></li>
    <li><span>:ally: Alianza</span><b>${al ? '[' + esc(al.tag) + '] ' + esc(al.name) : 'Ninguna'}</b></li><li><span>:dagger: Traiciones</span><b>${n.betrayals}</b></li>
    <li><span>Relación</span><b>${REL_LABEL[relation(nid)] || 'Neutral'}</b></li></ul>
    ${isMe ? '' : `<div class="spacer"></div><div class="grid two">
      <button class="btn primary" id="nm-dm">:mail: Mensaje</button><button class="btn good" id="nm-trade">:ally: Oferta</button>
      ${me.alliance && !n.alliance ? '<button class="btn" id="nm-inv">:mail: Invitar a alianza</button>' : ''}
      ${relation(nid) !== 'war' ? '<button class="btn danger" id="nm-war" ' + (n.protectedUntil ? 'disabled title="Bajo protección de novatos"' : '') + '>:war: Guerra</button>' : ''}</div>`}`, m => {
    const b = (id, fn) => { const el = m.querySelector(id); if (el) el.onclick = fn; };
    b('#nm-dm', () => { closeModal(); openDM(nid); });
    b('#nm-trade', () => tradeModal(nid));
    b('#nm-inv', async () => { if ((await action('inviteAlliance', { targetId: nid })).ok) closeModal(); });
    b('#nm-war', async () => { if (await confirmModal('¿Declarar la guerra a <b>' + esc(n.name) + '</b>?' + (relation(nid) === 'ally' ? '<br><span class="bad">¡Es tu aliado! Primero debes abandonar la alianza.</span>' : ''), 'Declarar', true)) action('declareWar', { targetId: nid }); });
  });
}
function tradeModal(nid) {
  const me = store.me;
  const myDesigns = Object.values(store.state.designs).filter(d => d.owner === me.id && d.status === 'ready');
  const resInputs = pre => ['credits'].concat(Object.keys(GD.RESOURCES)).map(r => `<div class="point-row"><span>${r === 'credits' ? '₡ Créditos' : GD.RESOURCES[r].icon + ' ' + GD.RESOURCES[r].name}</span><input type="number" data-${pre}="${r}" min="0" placeholder="0"><span></span></div>`).join('');
  openModal(`<h3>:ally: Oferta a ${esc(nationName(nid))}</h3>
    <h3 class="good">Doy</h3>${resInputs('g')}
    ${myDesigns.length ? `<label>Licencia de diseño (opcional)</label><select id="gd"><option value="">—</option>${myDesigns.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}</select>` : ''}
    <h3 class="warn" style="margin-top:12px">Pido</h3>${resInputs('w')}
    <label>Mensaje</label><input type="text" id="om" maxlength="140" placeholder="Un trato justo entre vecinos…">
    <div class="spacer"></div><button class="btn primary block" id="go">Enviar oferta</button>`, m => {
    m.querySelector('#go').onclick = async () => {
      const give = {}, want = {};
      m.querySelectorAll('[data-g]').forEach(i => { if (+i.value > 0) give[i.dataset.g] = +i.value; });
      m.querySelectorAll('[data-w]').forEach(i => { if (+i.value > 0) want[i.dataset.w] = +i.value; });
      const gd = m.querySelector('#gd'); if (gd && gd.value) give.designId = gd.value;
      if ((await action('offer', { to: nid, give, want, message: m.querySelector('#om').value })).ok) closeModal();
    };
  });
}

/* ---------- Alianza ---------- */
function alliance(body) {
  const me = store.me, s = store.state;
  const a = me.alliance && s.alliances[me.alliance];
  if (!a) {
    const list = Object.values(s.alliances);
    body.innerHTML = `<div class="card"><h3>:ally: Fundar una alianza</h3>
      <label>Nombre</label><input type="text" id="an" maxlength="30" placeholder="Ej: Pacto de Orión">
      <label>Etiqueta (2-4 letras)</label><input type="text" id="at" maxlength="4" placeholder="ORI">
      <label>Color</label><input type="color" id="ac" value="#4cc9f0">
      <div class="spacer"></div><button class="btn primary block" id="ago">Fundar</button>
      <p class="small muted">Los miembros comparten visión del mapa y un chat privado. Para unirte a otra alianza, pide a su líder que te invite.</p></div>
      <div class="card"><h3>Alianzas existentes</h3>${list.length ? list.map(x => `<div class="list-item"><span class="pill" style="color:${x.color}">${esc(x.tag)}</span><div class="grow"><b>${esc(x.name)}</b><span class="small muted">${x.members.length} miembros · líder ${esc(nationName(x.leader))}</span></div></div>`).join('') : '<p class="muted">Ninguna todavía.</p>'}</div>`;
    body.querySelector('#ago').onclick = () => action('createAlliance', { name: body.querySelector('#an').value, tag: body.querySelector('#at').value, color: body.querySelector('#ac').value });
    return;
  }
  const leader = a.leader === me.id;
  body.innerHTML = `<div class="card"><div class="title-box" style="border-color:${a.color}">[${esc(a.tag)}] ${esc(a.name)}</div>
    ${a.members.map(mid => `<div class="list-item" data-nation="${mid}">${ballHTML(mid, 36)}<div class="grow"><b>${esc(nationName(mid))} ${mid === a.leader ? ':crown:' : ''}</b></div>
      ${leader && mid !== me.id ? `<button class="btn small danger" data-kick="${mid}">Expulsar</button>` : ''}</div>`).join('')}
    <div class="row wrap"><button class="btn primary" id="ach">:chat: Chat de alianza</button><button class="btn" id="aleave">:exit: Salir</button><button class="btn danger" id="abetray">:dagger: Traicionar</button></div>
    <p class="small muted">"Salir" es una salida educada. "Traicionar" se anuncia a toda la galaxia como traición (baja tu estabilidad) — úsalo antes de atacar a un ex-aliado para dar drama al rol.</p></div>`;
  body.querySelectorAll('[data-nation]').forEach(el => el.onclick = e => { if (!e.target.closest('[data-kick]')) nationModal(el.dataset.nation); });
  body.querySelectorAll('[data-kick]').forEach(b => b.onclick = () => action('kickAlliance', { targetId: b.dataset.kick }));
  body.querySelector('#ach').onclick = () => { channel = 'ally:' + a.id; sub = 'chat'; render(); };
  body.querySelector('#aleave').onclick = async () => { if (await confirmModal('¿Salir de la alianza?', 'Salir')) action('leaveAlliance', { betray: false }); };
  body.querySelector('#abetray').onclick = async () => { if (await confirmModal(':dagger: ¿Traicionar a tus aliados? Toda la galaxia lo sabrá.', 'Traicionar', true)) action('leaveAlliance', { betray: true }); };
}

/* ---------- Ofertas ---------- */
function bundleText(b) {
  const parts = Object.keys(b || {}).filter(k => k !== 'designId').map(k => (k === 'credits' ? '₡' : GD.RESOURCES[k].icon) + fmt(b[k]));
  if (b && b.designId) parts.push(':scroll: ' + esc((store.state.designs[b.designId] || { name: 'Licencia' }).name));
  return parts.join(' ') || 'nada';
}
function offersView(body) {
  const me = store.me, s = store.state;
  const inc = me.offers.filter(o => o.to === me.id), out = me.offers.filter(o => o.from === me.id);
  const desc = o => o.kind === 'peace' ? `:peace: Paz en "${esc((s.wars[o.warId] || {}).name)}"` : o.kind === 'alliance_invite' ? `:mail: Invitación a [${esc((s.alliances[o.allianceId] || {}).tag)}] ${esc((s.alliances[o.allianceId] || {}).name)}` : `Da: ${bundleText(o.give)}<br>Pide: ${bundleText(o.want)}${o.message ? '<br><i>"' + esc(o.message) + '"</i>' : ''}`;
  body.innerHTML = `<div class="card"><h3>:in: Recibidas</h3>${inc.length ? inc.map(o => `<div class="list-item">${flagHTML(o.from)}<div class="grow"><b>${esc(nationName(o.from))}</b><span class="small">${desc(o)}</span></div>
      <button class="btn small good" data-acc="${o.id}">:check:</button><button class="btn small danger" data-rej="${o.id}">:close:</button></div>`).join('') : '<p class="muted">Nada pendiente.</p>'}</div>
    <div class="card"><h3>:out: Enviadas</h3>${out.length ? out.map(o => `<div class="list-item">${flagHTML(o.to)}<div class="grow"><b>${esc(nationName(o.to))}</b><span class="small">${desc(o)}</span></div><button class="btn small" data-rej="${o.id}">Cancelar</button></div>`).join('') : '<p class="muted">Nada enviado.</p>'}</div>`;
  body.querySelectorAll('[data-acc]').forEach(b => b.onclick = () => action('respondOffer', { id: b.dataset.acc, accept: true }));
  body.querySelectorAll('[data-rej]').forEach(b => b.onclick = () => action('respondOffer', { id: b.dataset.rej, accept: false }));
}

/* ---------- Noticias galácticas ---------- */
function news(body) {
  body.innerHTML = `<div class="card"><div class="row"><h3 class="grow">:news: Noticiero Galáctico</h3>${helpButton('social')}</div>
    ${store.state.news.map(n => `<div class="list-item"><div class="grow">${esc(n.text)}</div><span class="small muted">${ago(n.t)}</span></div>`).join('') || '<p class="muted">Sin noticias.</p>'}</div>`;
}
