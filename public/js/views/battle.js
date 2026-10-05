/* =====================================================================
 * PANTALLA DE BATALLA (en vivo y repetición)
 * ---------------------------------------------------------------------
 * Overlay a pantalla completa con el visor 3D (js/battle3d.js) y un HUD
 * pensado para el pulgar:
 *   - arriba:  salir, lugar, reloj, barras de casco de cada bando
 *   - abajo:   panel con TUS escuadrones, 4 tácticas grandes y la lista
 *              de enemigos (tocar un enemigo = concentrar el fuego)
 * También se puede tocar una nave directamente en la escena.
 *
 * Modo EN VIVO: el servidor manda un frame cada 0.5 s (socket battle:frame).
 * Modo REPETICIÓN: se vuelve a simular en el navegador a partir del
 * informe (shared/battlesim.js: misma semilla + mismas órdenes = misma batalla).
 * ===================================================================== */
import { GD, store, socket, esc, flagHTML, nationName, nationTag, relation, toast, music, fmt } from '../core.js';
import { BattleViewer } from '../battle3d.js';
import { nationInfo } from './map.js';

const BS = window.BattleSim;
const TAC = [['attack', 'tac_attack', 'Atacar', 'Avanza y dispara al enemigo más cercano'], ['hold', 'tac_hold', 'Mantener', 'Se queda quieto y dispara a lo que entre en alcance'],
  ['kite', 'tac_kite', 'Distancia', 'Mantiene la distancia ideal de sus armas'], ['retreat', 'tac_retreat', 'Retirada', 'Carga el salto (20 s) y escapa del combate']];
const HULL_ICON = h => (GD.HULLS[h] && GD.HULLS[h].icon) || (h === 'planeta' ? ':h_planeta:' : h === 'estacion' ? ':h_estacion:' : ':fleet:');
const $ = s => root.querySelector(s);

let root = null, viewer = null, cur = null;      // cur = { mode, id, meta, groups, mine, sel, frame, tick... }

export function init() {
  root = document.createElement('div'); root.id = 'battle-root'; root.className = 'battle-overlay hidden';
  root.innerHTML = `<div class="battle-stage"><canvas id="bt-canvas"></canvas></div>
    <div class="battle-top">
      <button class="btn small" id="bt-close">:back: Salir</button>
      <div class="bt-title"><span class="live-dot" id="bt-live"></span><b id="bt-where"></b><span id="bt-time" class="bt-time">0:00</span></div>
      <button class="btn small" id="bt-cam" title="Cámara automática">:cam:</button>
    </div>
    <div class="bt-hp"><span id="bt-sideA" class="bt-side"></span><div class="bt-bar"><i id="bt-hpA"></i></div><b class="bt-vs">VS</b><div class="bt-bar r"><i id="bt-hpB"></i></div><span id="bt-sideB" class="bt-side"></span></div>
    <div class="bt-ticker" id="bt-ticker"></div>
    <div class="bt-result hidden" id="bt-result"></div>
    <div class="battle-panel" id="bt-panel"></div>`;
  document.body.appendChild(root);
  $('#bt-close').onclick = close;
  $('#bt-cam').onclick = () => { viewer && viewer.resetCamera(); $('#bt-cam').classList.add('on'); };
  socket.on('battle:frame', f => { if (cur && cur.mode === 'live' && viewer) onFrame(f); });
  socket.on('battle:groups', d => { if (cur && cur.mode === 'live') setGroups(d.groups); });
  socket.on('battle:over', d => { if (cur && cur.mode === 'live') { cur.over = d; } });
  window.addEventListener('od:battle', e => openLive(e.detail));
  window.addEventListener('od:replay', e => openReplay(e.detail));
}
export const isOpen = () => !!cur;

/* ---------- apertura ---------- */
export function openLive(id) {
  if (cur) close();
  socket.emit('battle:watch', id, r => {
    if (!r || !r.ok) { toast((r && r.error) || 'La batalla ya terminó. Mira el informe en Militar.', 'warn'); return; }
    const b = r.battle;
    start({ mode: 'live', id, meta: b.meta, mine: b.mine, nations: b.nations, system: b.system, frame: b.frame });
  });
}
export function openReplay(reportId) {
  if (cur) close();
  socket.emit('report:get', reportId, r => {
    if (!r || !r.ok || !r.report.simSetup) { toast('Este informe no se puede repetir en 3D', 'warn'); return; }
    const rep = r.report;
    const sim = BS.replayFrom({ setup: rep.simSetup, orders: rep.orders, reinf: rep.reinf });
    start({ mode: 'replay', id: reportId, report: rep, sim, meta: sim.meta(), mine: [], nations: { A: rep.attackers, B: rep.defenders }, system: rep.system, frame: sim.snapshot(), speed: 1 });
  });
}

function start(c) {
  cur = c;
  root.classList.remove('hidden');
  document.body.classList.add('in-battle');
  const canvas = $('#bt-canvas'); const fresh = canvas.cloneNode(); canvas.replaceWith(fresh);
  viewer = new BattleViewer(fresh, { nationInfo, relOf: owner => relation(owner), delay: c.mode === 'live' ? 640 : 700 });
  viewer.setMeta(c.meta);
  const me = store.me && store.me.id;
  cur.myGids = c.mode === 'live' ? c.mine : c.meta.groups.filter(g => g.owner === me).map(g => g.gid);
  cur.sel = cur.myGids.length ? cur.myGids[0] : null;
  cur.groups = {}; cur.agg = aggregate(c.frame); cur.gv = c.frame.gv; setGroups(c.meta.groups);
  viewer.pickCb = onPick;
  viewer.onAutoCam = on => $('#bt-cam').classList.toggle('on', on);
  viewer.onOver = o => showResult(o);
  viewer.onReinf = side => toast(':fleet: ¡Llegan refuerzos!', 'warn');
  viewer.onEvent = ev => ticker(ev);
  viewer.start();
  $('#bt-where').innerHTML = (c.mode === 'live' ? '' : ':replay: ') + esc(store.state.systems[c.system].name);
  $('#bt-live').style.display = c.mode === 'live' ? '' : 'none';
  $('#bt-cam').classList.add('on');
  $('#bt-result').classList.add('hidden');
  $('#bt-ticker').innerHTML = '';
  sidesHeader();
  onFrame(c.frame);
  if (c.mode === 'replay') runReplay();
  if (c.mode === 'live') music.play('battle');
}
function setGroups(list) {
  for (const g of list) cur.groups[g.gid] = g;
  viewer && viewer.setGroups(list);
  if (cur && cur.frame) panel();
}
function close() {
  if (!cur) return;
  if (cur.mode === 'live') socket.emit('battle:leave', cur.id);
  if (cur.timer) clearInterval(cur.timer);
  viewer && viewer.destroy(); viewer = null; cur = null;
  root.classList.add('hidden'); document.body.classList.remove('in-battle');
  music.play('calm');
}

/* ---------- cabecera: bandos ---------- */
function sidesHeader() {
  const sideTxt = side => {
    const owners = [...new Set(Object.values(cur.groups).filter(g => g.side === side).map(g => g.owner))].filter(Boolean);
    return owners.slice(0, 3).map(o => flagHTML(o, 22, 15)).join(' ');
  };
  $('#bt-sideA').innerHTML = sideTxt('A'); $('#bt-sideB').innerHTML = sideTxt('B');
}

/* ---------- frames ---------- */
function onFrame(f, noPush) {
  if (!noPush) viewer.pushFrame(f);
  cur.frame = f;
  if (f.gv !== cur.gv) { cur.gv = f.gv; sidesHeader(); }
  const t = Math.round(f.t), mm = Math.floor(t / 60), ss = String(t % 60).padStart(2, '0');
  $('#bt-time').textContent = mm + ':' + ss + ' / ' + Math.floor(cur.meta.maxTime / 60) + ':00';
  $('#bt-hpA').style.width = f.hp.A + '%'; $('#bt-hpB').style.width = f.hp.B + '%';
  cur.agg = aggregate(f);
  panel();
  if (f.over && !cur.shownOver) { cur.shownOver = true; }
}
function aggregate(f) {
  const a = {};
  for (const e of f.ents) {
    if (e[2]) continue;                       // cazas lanzados desde portanaves: no cuentan
    const g = a[e[1]] || (a[e[1]] = { n: 0, hp: 0, w: 0, heat: 0, hot: 0, dmg: 0 });
    g.n += e[9]; g.hp += e[7] * e[9]; g.w += e[9]; g.heat += (e[12] || 0) * e[9]; if (e[13]) g.hot += e[9];
    if (e[14] != null && (e[14] < 50 || e[15] < 50 || e[16] < 50)) g.dmg += e[9];      // naves con algún módulo (motor, armas o sensores) a medias
  }
  for (const k in a) { a[k].hp = a[k].w ? Math.round(a[k].hp / a[k].w) : 0; a[k].heat = a[k].w ? Math.round(a[k].heat / a[k].w) : 0; }
  return a;
}
const ordersOf = gid => { const o = cur.frame.orders && cur.frame.orders.find(x => x[0] === gid); return o ? { tactic: o[1], focus: o[2] } : { tactic: 'attack', focus: null }; };

/* ---------- panel inferior ---------- */
function chip(g, mine, selected, focused) {
  const a = cur.agg[g.gid] || { n: 0, hp: 0 };
  const dead = !a.n;
  const o = ordersOf(g.gid);
  const rel = relation(g.owner);
  return `<button class="bt-chip ${mine ? 'mine' : 'foe'} ${selected ? 'sel' : ''} ${focused ? 'focus' : ''} ${dead ? 'dead' : ''}" data-gid="${g.gid}">
    <span class="bt-ci">${HULL_ICON(g.hull)}</span>
    <span class="bt-cn"><b>${esc(g.name.replace(/ \(.*\)$/, ''))}</b><small>${flagHTML(g.owner, 14, 10)} ${a.n}/${g.count}${mine ? ' · ' + tacLabel(o.tactic) : ''}</small>
    <span class="bt-cb"><i style="width:${a.hp}%;background:${a.hp > 55 ? 'var(--good)' : a.hp > 28 ? 'var(--warn)' : 'var(--bad)'}"></i></span>
    ${g.isPlanet || g.station || g.monster ? '' : `<span class="bt-cb" title="Calor: al llegar al máximo las armas se bloquean"><i style="width:${a.heat || 0}%;background:${a.hot ? '#ff3b4a' : '#ff9d5c'}"></i></span>`}</span>
    ${a.hot ? '<span class="bt-cf" title="Armas bloqueadas por sobrecalentamiento">:heat:</span>' : ''}
    ${focused ? '<span class="bt-cf">:focus:</span>' : ''}</button>`;
}
const tacLabel = t => (TAC.find(x => x[0] === t) || TAC[0])[2];
function panel() {
  if (!cur || !cur.frame) return;
  const all = Object.values(cur.groups);
  const mine = all.filter(g => cur.myGids.includes(g.gid) && !g.isPlanet && !g.station);
  const foes = all.filter(g => !cur.myGids.includes(g.gid) && (relation(g.owner) === 'war' || g.side !== sideOfMine()));
  const allies = all.filter(g => !cur.myGids.includes(g.gid) && !foes.includes(g));
  const replay = cur.mode === 'replay';
  const sel = cur.sel != null ? cur.groups[cur.sel] : null;
  const o = sel ? ordersOf(sel.gid) : null;
  let html = '';
  if (replay) {
    const sim = cur.sim, over = !!sim.over;
    html += `<div class="bt-controls"><button class="btn small" id="bt-play">${cur.paused ? ':play:' : ':pause:'}</button>
      ${[1, 2, 4].map(s => `<button class="btn small ${cur.speed === s ? 'primary' : ''}" data-speed="${s}">×${s}</button>`).join('')}
      <button class="btn small" id="bt-restart">:replay: Reiniciar</button><span class="grow"></span><span class="muted small">Repetición · no se pueden dar órdenes</span></div>`;
  } else if (mine.length) {
    html += `<div class="bt-tactics">${TAC.map(([k, ic, label, tip]) => `<button class="btn bt-tac ${o && o.tactic === k ? 'primary' : ''} ${k === 'retreat' ? 'danger' : ''}" data-tac="${k}" title="${tip}">:${ic}:<span>${label}</span></button>`).join('')}</div>
      <div class="bt-hint small muted">${sel ? 'Escuadrón: <b>' + esc(sel.name) + '</b> · ' + (o.focus != null && cur.groups[o.focus] ? 'objetivo ' + esc(cur.groups[o.focus].name) : 'objetivo automático') : 'Toca un escuadrón'} · <a href="#" id="bt-auto">objetivo auto</a> · <a href="#" id="bt-allret">retirada total</a></div>`;
  } else html += '<div class="bt-hint small muted">:eye: Estás mirando la batalla como espectador.</div>';
  if (mine.length) html += `<div class="bt-row-title">Mis escuadrones</div><div class="bt-chips">${mine.map(g => chip(g, true, cur.sel === g.gid, false)).join('')}</div>`;
  if (allies.length) html += `<div class="bt-row-title">Aliados</div><div class="bt-chips">${allies.map(g => chip(g, false, false, false)).join('')}</div>`;
  html += `<div class="bt-row-title">${mine.length && !replay ? 'Enemigos (toca para concentrar el fuego)' : 'Enemigos'}</div><div class="bt-chips">${foes.map(g => chip(g, false, false, o && o.focus === g.gid)).join('')}</div>`;
  const panelEl = $('#bt-panel');
  const scroll = [...panelEl.querySelectorAll('.bt-chips')].map(e => e.scrollLeft);
  panelEl.innerHTML = html;
  [...panelEl.querySelectorAll('.bt-chips')].forEach((e, i) => { e.scrollLeft = scroll[i] || 0; });
  bindPanel(panelEl, mine, replay);
  if (viewer && window.innerWidth < 900) viewer.setBottomInset(panelEl.offsetHeight * 0.92); else if (viewer) viewer.setBottomInset(0);
}
function sideOfMine() { const g = cur.myGids.length ? cur.groups[cur.myGids[0]] : null; return g ? g.side : 'A'; }
function bindPanel(el, mine, replay) {
  el.querySelectorAll('[data-tac]').forEach(b => b.onclick = () => command({ tactic: b.dataset.tac }));
  el.querySelectorAll('.bt-chip.mine').forEach(b => b.onclick = () => { cur.sel = +b.dataset.gid; viewer.setSelected(cur.sel); panel(); });
  el.querySelectorAll('.bt-chip.foe').forEach(b => b.onclick = () => { if (replay || !mine.length) { viewer.setFocus(+b.dataset.gid); return; } focusOn(+b.dataset.gid); });
  const au = el.querySelector('#bt-auto'); if (au) au.onclick = e => { e.preventDefault(); command({ focus: null }); viewer.setFocus(null); };
  const ar = el.querySelector('#bt-allret'); if (ar) ar.onclick = e => { e.preventDefault(); socket.emit('battle:cmd', { battleId: cur.id, all: true, tactic: 'retreat' }, r => { if (r && !r.ok) toast(r.error, 'bad'); else toast(':tac_retreat: Retirada total ordenada', 'warn'); }); };
  const pl = el.querySelector('#bt-play'); if (pl) pl.onclick = () => { cur.paused = !cur.paused; panel(); };
  el.querySelectorAll('[data-speed]').forEach(b => b.onclick = () => { cur.speed = +b.dataset.speed; runReplay(); panel(); });
  const rs = el.querySelector('#bt-restart'); if (rs) rs.onclick = () => { const rep = cur.report; const id = cur.id; close(); openReplay(id); };
}
function focusOn(gid) {
  if (cur.sel == null) { toast('Elige primero uno de tus escuadrones', 'warn'); return; }
  command({ focus: gid }); viewer.setFocus(gid);
  toast(':focus: Fuego concentrado en ' + cur.groups[gid].name, 'good');
}
function command(o) {
  if (cur.mode !== 'live' || cur.sel == null) return;
  const g = cur.groups[cur.sel];
  const data = Object.assign({ battleId: cur.id, fleetId: g.fleetId, gid: g.gid }, o);
  socket.emit('battle:cmd', data, r => { if (r && !r.ok) toast(r.error || 'Orden no válida', 'bad'); });
  if (o.tactic) toast(':' + TAC.find(t => t[0] === o.tactic)[1] + ': ' + TAC.find(t => t[0] === o.tactic)[2] + ' → ' + esc(g.name), 'good');
}
function onPick(info) {
  if (!info || !info.group) return;
  const g = info.group;
  if (cur.myGids.includes(g.gid)) { cur.sel = g.gid; viewer.setSelected(g.gid); panel(); }
  else if (cur.mode === 'live' && cur.myGids.length && !info.strike) focusOn(g.gid);
}

/* ---------- repetición local ---------- */
function runReplay() {
  if (cur.timer) clearInterval(cur.timer);
  const sim = cur.sim, speed = cur.speed || 1;
  viewer.opts.delay = Math.round(500 / speed * 1.3 + 60);
  cur.timer = setInterval(() => {
    if (cur.paused || sim.over) { if (sim.over && !cur.overShown) { cur.overShown = true; viewer.pushFrame(sim.snapshot()); } return; }
    BS.replayStep(sim);
    if (sim.gv !== cur.simGv) { cur.simGv = sim.gv; setGroups(sim.groupsMeta()); }
    const snap = sim.snapshot();
    viewer.pushFrame(snap);
    onFrame(snap, true);
    if (sim.over) { cur.overShown = true; }
  }, 500 / speed);
}

/* ---------- fin de batalla ---------- */
function showResult(o) {
  if (!cur) return;
  const w = o.winner, me = store.me && store.me.id;
  const myside = cur.nations && (cur.nations.A.includes(me) ? 'A' : cur.nations.B.includes(me) ? 'B' : null);
  const mineSide = cur.myGids.length ? cur.groups[cur.myGids[0]].side : myside;
  const draw = w === 'draw';
  const won = !draw && mineSide && w === mineSide;
  const loot = cur.over && cur.over.loot;
  $('#bt-result').innerHTML = `<div class="bt-rcard ${draw ? '' : won ? 'win' : mineSide ? 'lose' : ''}">
    <div class="bt-rtitle">${draw ? ':balance: Sin vencedor' : mineSide ? (won ? ':trophy: ¡VICTORIA!' : ':skull: DERROTA') : ':trophy: Gana el ' + (w === 'A' ? 'bando A' : 'bando B')}</div>
    <div class="small muted">${o.timeout ? 'Se agotó el tiempo: el bando perdedor rompió contacto.' : 'Batalla de ' + Math.round(o.t) + ' s'}</div>
    ${loot && (loot.credits || loot.research) ? `<div class="small">:credits: Botín: ₡${fmt(loot.credits)}${loot.research ? ' · :research: ' + loot.research : ''}${loot.surrendered ? ' · :surrender: ' + loot.surrendered + ' naves rendidas' : ''}</div>` : ''}
    <div class="row" style="margin-top:10px"><button class="btn grow" id="bt-r-close">Cerrar</button>${cur.mode === 'live' ? '<button class="btn grow primary" id="bt-r-replay">:replay: Ver repetición</button>' : ''}</div></div>`;
  $('#bt-result').classList.remove('hidden');
  $('#bt-r-close').onclick = close;
  const rb = $('#bt-r-replay'); if (rb) rb.onclick = () => {
    const rid = cur.over && cur.over.reportId; if (!rid) return close();
    close(); setTimeout(() => openReplay(rid), 100);
  };
}

/* ---------- ticker de bajas ---------- */
function ticker(ev) {
  if (!cur) return;
  let txt = null;
  if (ev.k === 'boom') {
    const info = viewer.gone.get(ev.id), g = info && cur.groups[info.gid];
    if (g && !info.strike) txt = (cur.myGids.includes(g.gid) ? '<span class="bad">' : '<span class="good">') + ':skull: ' + esc(g.name.replace(/ \(.*\)$/, '')) + (info.n > 1 ? ' ×' + info.n : '') + ' destruido</span>';
  } else if (ev.k === 'emp') txt = '<span class="warn">:warn: ¡Pulso EMP! Escudos apagados</span>';
  else if (ev.k === 'escape') txt = '<span class="muted">:warp: Una nave escapa del combate</span>';
  else if (ev.k === 'surr') txt = '<span class="good">:surrender: ¡Una nave enemiga se rinde!</span>';
  else if (ev.k === 'hot' || ev.k === 'mod') {
    const st = viewer.ents.get(ev.id), g = st && cur.groups[st.gid];
    if (g && cur.myGids.includes(g.gid)) txt = ev.k === 'hot' ? '<span class="warn">:heat: ' + esc(g.name.replace(/ \(.*\)$/, '')) + ': armas bloqueadas por calor</span>'
      : '<span class="warn">:warn: ' + esc(g.name.replace(/ \(.*\)$/, '')) + ': ' + ({ motor: 'motores', arms: 'armas', sens: 'sensores' })[ev.m] + ' dañados</span>';
  }
  if (!txt) return;
  const el = $('#bt-ticker'); const d = document.createElement('div'); d.className = 'bt-tk'; d.innerHTML = txt; el.appendChild(d);
  while (el.children.length > 4) el.firstChild.remove();
  setTimeout(() => d.remove(), 5000);
}

/** ¿Estoy participando en alguna batalla en curso? (para el aviso superior) */
export function myLiveBattles() {
  const me = store.me && store.me.id; if (!me) return [];
  return (store.state.battles || []).filter(b => b.A.includes(me) || b.B.includes(me));
}
