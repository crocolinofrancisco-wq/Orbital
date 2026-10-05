/* =====================================================================
 * VISTA: MAPA (galaxia 3D -> sistema 3D -> planeta)
 * ---------------------------------------------------------------------
 * Interacción (pensada para un pulgar):
 *   - Toca un SISTEMA para entrar.  - Toca una FLOTA para ver sus órdenes.
 *   - Toca un PLANETA para construir / anexar / invadir.
 *
 * MODO ÓRDENES (lo que antes no se entendía):
 *   1. Toca tu flota  ->  "Mover", "Atacar" o "Invadir".
 *   2. Aparece una barra arriba: "Toca el sistema destino".
 *   3. Toca el sistema en el mapa  ->  la flota sale. Al llegar:
 *        Atacar  = combate automáticamente con cualquier enemigo en guerra
 *                  (y siempre con piratas) que haya en ese sistema.
 *        Invadir = combate, y cuando la órbita está limpia desembarca
 *                  sus tropas en el planeta elegido sin que hagas nada.
 * ===================================================================== */
import { GD, store, socket, action, fmt, esc, flagHTML, nationColor, nationName, nationTag, isNpc, nation, relation, REL_LABEL, openModal, closeModal, pct, costHTML, confirmModal, serverNow, timeLeft, toast } from '../core.js';
import { InteractiveScene, buildGalaxy, buildSystem, planetThumb, shipThumb, mainHull, THREE } from '../render3d.js';

let root, view, labelsEl, sheet, orderBar, mode = 'galaxy', currentSystem = null, lastHash = '';
let labelItems = [];
/** Orden pendiente: { fleetId, type: 'move'|'attack'|'invade', planetId? } */
let pendingOrder = null;

export function nationInfo(id) {
  const n = nation(id);
  return { color: new THREE.Color(nationColor(id)), colors: n ? n.flag.colors : ['#888888', '#444444', '#ffffff'], rel: relation(id) };
}

export function init(el) {
  root = el;
  labelsEl = el.querySelector('#map-labels');
  sheet = el.querySelector('#map-sheet');
  orderBar = el.querySelector('#order-bar');
  view = new InteractiveScene(el.querySelector('#galaxy-canvas'), { tilt: 1.05, zoom: 700, minZoom: 120, maxZoom: 1300 });
  view.onPick = pick;
  el.querySelector('#map-back').onclick = () => openGalaxy();
  el.querySelector('#map-home').onclick = () => { const cap = store.state.planets[store.me.capital]; if (cap) openSystem(cap.system); };
  el.querySelector('#map-guide').onclick = () => window.dispatchEvent(new CustomEvent('od:guide'));
  labelsEl.addEventListener('click', e => { const l = e.target.closest('.map-label'); if (l) pick({ type: l.dataset.type, id: l.dataset.id }); });
  window.addEventListener('od:openSystem', e => openSystem(e.detail));
  window.addEventListener('od:order', e => startOrder(e.detail.fleetId, e.detail.type, e.detail.planetId));
}
export function show() {
  view.resize(); view.start();
  if (!lastHash) openGalaxy(); else rebuild(true);
  loopLabels();
}
export function hide() { view.stop(); }
export function update() { rebuild(false); if (!sheet.classList.contains('hidden') && !sheet.dataset.locked) refreshSheet(); }

/** Solo reconstruye la escena 3D si cambió algo visible (dueños/flotas/rutas) */
function rebuild(force) {
  const s = store.state;
  const h = mode + currentSystem + Object.values(s.planets).map(p => p.owner || '').join() +
    Object.values(s.fleets).map(f => f.id + f.system + (f.path ? f.path[0] : '') + f.nextJumpAt + (f.info && f.info.count)).join();
  if (!force && h === lastHash) return;
  lastHash = h;
  if (mode === 'galaxy') {
    buildGalaxy(view, s, nationInfo, serverNow);
    makeLabels(Object.values(s.systems).map(sys => ({ type: 'system', id: sys.id, pos: new THREE.Vector3(sys.x, 22, sys.y), html: systemLabel(sys) })));
  } else {
    const built = buildSystem(view, s, currentSystem, nationInfo, GD.BIOMES);
    makeLabels(built.planets.map(p => ({ type: 'planet', id: p.pid, obj: p.holder, html: planetLabel(s.planets[p.pid]) }))
      .concat(built.fleets.map(g => ({ type: 'fleet', id: g.userData.pick.id, obj: g, html: fleetLabel(s.fleets[g.userData.pick.id]), small: true })))
      .concat((built.pois || []).map(o => ({ type: 'poi', id: o.kind, obj: o.obj, html: '<span class="tag">' + esc(o.label) + '</span>', small: true }))));
  }
}
function systemLabel(sys) {
  const s = store.state;
  const owners = [...new Set(sys.planets.map(pid => s.planets[pid].owner).filter(Boolean))];
  const fleets = Object.values(s.fleets).filter(f => f.system === sys.id);
  const hostile = fleets.some(f => relation(f.owner) === 'war');
  const mine = fleets.some(f => f.owner === store.me.id);
  const target = pendingOrder ? ' targetable' : '';
  const feat = [sys.kind === 'blackhole' ? ':blackhole:' : '', (sys.features || []).includes('asteroids') ? ':asteroid:' : '', (sys.features || []).includes('nebula') ? ':nebula:' : '', sys.ruin && !sys.ruin.claimedBy ? ':ruins:' : '', sys.lair && !sys.lair.destroyed ? ':lair:' : '', sys.hub ? ':hub:' : '', sys.choke ? ':choke:' : ''].join('');
  const fight = (store.state.battles || []).some(b => b.system === sys.id);
  return `<span class="tag${target}">${esc(sys.name)}</span>${feat || fight ? '<span class="poi">' + feat + (fight ? ' <span class="bad">:battle:</span>' : '') + '</span>' : ''}<span class="owner">${owners.slice(0, 3).map(o => flagHTML(o, 18, 12)).join(' ')}${mine ? ' <span class="good">:fleet:</span>' : ''}${hostile ? ' <span class="bad">:war:</span>' : ''}</span>`;
}
function planetLabel(p) { return `<span class="tag">${esc(p.name)}</span><span class="owner">${p.owner ? flagHTML(p.owner, 18, 12) : ''}</span>`; }
function fleetLabel(f) {
  const rel = relation(f.owner);
  return `<span class="fleet-chip rel-${rel}">${flagHTML(f.owner, 14, 10)} :power: ${fmt(f.info.power)}</span>`;
}
function makeLabels(items) {
  labelsEl.innerHTML = '';
  labelItems = items.map(it => {
    const d = document.createElement('div');
    d.className = 'map-label' + (it.small ? ' small' : ''); d.dataset.type = it.type; d.dataset.id = it.id; d.innerHTML = it.html;
    labelsEl.appendChild(d);
    return Object.assign(it, { el: d });
  });
}
let raf = null;
function loopLabels() {
  cancelAnimationFrame(raf);
  const v3 = new THREE.Vector3();
  const step = () => {
    if (!view.running) return;
    for (const it of labelItems) {
      if (it.obj) v3.copy(it.obj.position).add(new THREE.Vector3(0, it.small ? 6 : 12, 0)); else v3.copy(it.pos);
      const p = view.project(v3);
      it.el.style.display = p.visible ? '' : 'none';
      it.el.style.transform = `translate(${p.x}px, ${p.y - (it.small ? 22 : 34)}px) translate(-50%, 0)`;
    }
    raf = requestAnimationFrame(step);
  };
  step();
}

function openGalaxy() {
  mode = 'galaxy'; currentSystem = null;
  Object.assign(view.opts, { pan: true, minZoom: 120, maxZoom: 1300, tilt: 1.05 });
  const cap = store.me && store.state.planets[store.me.capital];
  const cs = cap ? store.state.systems[cap.system] : { x: 500, y: 500 };
  view.target.set(cs.x, 0, cs.y); view.zoom = innerWidth < 900 ? 620 : 520;
  root.querySelector('#map-back').style.display = 'none';
  root.querySelector('#map-title').textContent = 'Galaxia';
  sheet.classList.add('hidden');
  rebuild(true);
}
export function openSystem(sid) {
  mode = 'system'; currentSystem = sid;
  const mobile = innerWidth < 900;
  Object.assign(view.opts, { pan: false, minZoom: 80, maxZoom: 420, tilt: 0.75 });
  // En móvil la hoja inferior tapa media pantalla: desplazamos el objetivo para que el sistema quede arriba
  view.target.set(mobile ? 0 : 60, 0, mobile ? 95 : 0); view.zoom = mobile ? 340 : 240;
  root.querySelector('#map-back').style.display = '';
  root.querySelector('#map-title').textContent = 'Sistema ' + store.state.systems[sid].name;
  rebuild(true);
  openSheet();
}

function pick(p) {
  if (!p) return;
  if (pendingOrder) {
    // En modo órdenes, tocar un sistema (o algo dentro de él) lo elige como destino
    const sid = p.type === 'system' ? p.id : p.type === 'planet' ? store.state.planets[p.id].system : p.type === 'fleet' ? store.state.fleets[p.id].system : null;
    if (sid) return confirmOrder(sid);
  }
  if (p.type === 'poi') return poiModal(p.id, currentSystem);
  if (p.type === 'system') openSystem(p.id);
  if (p.type === 'planet') planetModal(p.id);
  if (p.type === 'fleet') fleetSheet(p.id);
}

/* ---------- Modo órdenes ---------- */
const ORDER_TEXT = {
  move: ':compass: Toca el sistema al que quieres <b>mover</b> la flota',
  attack: ':war: Toca el sistema que quieres <b>atacar</b>',
  invade: ':invade: Toca el sistema del planeta a <b>invadir</b>'
};
export function startOrder(fleetId, type, planetId, sysId) {
  closeModal();
  pendingOrder = { fleetId, type, planetId };
  window.dispatchEvent(new CustomEvent('od:goto', { detail: { view: 'map' } }));
  if (planetId) { confirmOrder(store.state.planets[planetId].system); return; }
  if (sysId) { confirmOrder(sysId); return; }
  if (mode !== 'galaxy') openGalaxy();
  orderBar.innerHTML = `<div class="grow">${ORDER_TEXT[type]}<div class="small muted">${esc(store.state.fleets[fleetId].name)}</div></div><button class="btn small" id="ob-cancel">Cancelar</button>`;
  orderBar.classList.remove('hidden');
  orderBar.querySelector('#ob-cancel').onclick = cancelOrder;
  rebuild(true);
}
function cancelOrder() { pendingOrder = null; orderBar.classList.add('hidden'); rebuild(true); }
async function confirmOrder(sid) {
  const o = pendingOrder; if (!o) return;
  const s = store.state, f = s.fleets[o.fleetId], sys = s.systems[sid];
  if (!f) return cancelOrder();
  // Avisos útiles antes de mandar la flota
  const owners = [...new Set(sys.planets.map(pid => s.planets[pid].owner).filter(x => x && x !== store.me.id))];
  const enemies = Object.values(s.fleets).filter(x => x.system === sid && relation(x.owner) === 'war');
  const notAtWar = owners.filter(x => relation(x) !== 'war' && relation(x) !== 'ally');
  let mission = null;
  if (o.type === 'attack') {
    mission = { type: 'attack' };
    if (!enemies.length && notAtWar.length) {
      const ok = await confirmModal(`En ${esc(sys.name)} no hay enemigos con los que estés en guerra. Para atacar a <b>${esc(nationName(notAtWar[0]))}</b> primero hay que <b>declararle la guerra</b>. ¿Declararla ahora?`, 'Declarar guerra', true);
      if (ok) { const r = await action('declareWar', { targetId: notAtWar[0] }); if (!r.ok) return; }
    }
  }
  if (o.type === 'invade') {
    const targets = sys.planets.map(pid => s.planets[pid]).filter(p => p.owner && p.owner !== store.me.id);
    let pid = o.planetId && s.planets[o.planetId].system === sid ? o.planetId : null;
    if (!pid) {
      if (!targets.length) { toast('No hay planetas enemigos en ese sistema. Elige otro.', 'warn'); return; }
      pid = await choosePlanet(targets);
      if (!pid) return;
    }
    const owner = s.planets[pid].owner;
    if (relation(owner) !== 'war') {
      const ok = await confirmModal(`Para invadir ${esc(s.planets[pid].name)} debes estar en guerra con <b>${esc(nationName(owner))}</b>. ¿Declarar la guerra?`, 'Declarar guerra', true);
      if (!ok) return;
      const r = await action('declareWar', { targetId: owner }); if (!r.ok) return;
    }
    if (!f.info.ground) {
      const r = await action('embark', { fleetId: f.id });
      if (!r.ok) { toast('La flota necesita tropas a bordo. Lleva un Transporte y embarca tropas en un sistema donde tengas una guarnición.', 'bad'); return cancelOrder(); }
    }
    mission = { type: 'invade', planetId: pid };
  }
  pendingOrder = null; orderBar.classList.add('hidden');
  if (f.system === sid) {
    if (o.type === 'invade') { const r = await action('invade', { fleetId: f.id, planetId: mission.planetId }); if (r.report) window.dispatchEvent(new CustomEvent('od:report', { detail: r.report })); }
    else toast('La flota ya está en ' + sys.name + (enemies.length ? '. El combate empezará en segundos.' : '.'), 'warn');
  } else {
    // ¿Hay un atajo por portal de agujero negro? Es rápido pero puede costar naves: lo decide el jugador
    const offer = await new Promise(res => socket.emit('portalOffer', { fleetId: f.id, to: sid }, res));
    let usePortal = false;
    if (offer && offer.saves >= 20) usePortal = await confirmModal(`Hay un <b>portal de agujero negro</b> en la ruta: ahorras un <b>${offer.saves}%</b> de tiempo (${offer.fast} saltos en vez de ${offer.safe}), pero la travesía es inestable y <b>puede costarte hasta un 12% de la flota</b>. ¿Usar el portal?`, 'Usar portal', true);
    const r = await action('moveFleet', { fleetId: f.id, to: sid, mission, portal: usePortal });
    if (r && r.ok && r.risky) toast(':warn: La ruta pasa por sistemas con enemigos. ¡Cuidado!', 'warn');
  }
  rebuild(true);
}
function choosePlanet(list) {
  return new Promise(res => openModal(`<h3>:invade: ¿Qué planeta invadir?</h3>${list.map(p => `<div class="list-item" data-p="${p.id}"><img src="${planetThumb(p, GD.BIOMES[p.biome])}" width="48" height="48"><div class="grow"><b>${esc(p.name)}</b><span class="small muted">${esc(nationName(p.owner))} · :pop: ${fmt(p.pop)}M</span></div>${REL_LABEL[relation(p.owner)]}</div>`).join('')}`,
    m => m.querySelectorAll('[data-p]').forEach(el => el.onclick = () => { const id = el.dataset.p; closeModal(); res(id); }), () => res(null)));
}

/* ---------- Hoja inferior con info del sistema ---------- */
function openSheet() { sheet.classList.remove('hidden'); sheet.classList.remove('collapsed'); refreshSheet(); }
function refreshSheet() {
  if (mode !== 'system') { sheet.classList.add('hidden'); return; }
  const s = store.state, sys = s.systems[currentSystem];
  const fleets = Object.values(s.fleets).filter(f => f.system === sys.id);
  sheet.innerHTML = `<div class="grab" id="sheet-grab"></div>
    <div class="title-box">Sistema ${esc(sys.name)}</div>
    <div>${envPills(sys)}</div>
    ${(s.battles || []).filter(b => b.system === sys.id).map(b => `<div class="list-item" style="border-color:var(--bad)"><div class="ico-lg">:battle:</div><div class="grow"><b class="bad">¡Batalla en curso!</b><span class="small muted">${Math.round(b.t)} s</span></div><button class="btn small danger" data-watch="${b.id}">:live: Ver</button></div>`).join('')}
    ${sys.planets.length ? '' : '<p class="muted small">Un agujero negro: no hay planetas. Su portal conecta con ' + (sys.portal ? esc(s.systems[sys.portal].name) : 'otro agujero') + '.</p>'}
    <div class="grid">${sys.planets.map(pid => planetCard(s.planets[pid])).join('')}</div>
    <h3 style="margin-top:14px">:fleet: Flotas en el sistema</h3>
    ${fleets.length ? fleets.map(fleetRow).join('') : '<p class="muted small">Ninguna flota visible.</p>'}
    <h3 style="margin-top:14px">:compass: Hiperrutas</h3>
    <div class="row wrap">${sys.links.map(l => `<button class="btn small" data-goto="${l}">${sys.portal === l ? ':blackhole: ' : ''}${esc(s.systems[l].name)}</button>`).join('')}</div>`;
  sheet.querySelector('#sheet-grab').onclick = () => sheet.classList.toggle('collapsed');
  sheet.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => window.dispatchEvent(new CustomEvent('od:battle', { detail: b.dataset.watch })));
  sheet.querySelectorAll('[data-planet]').forEach(b => b.onclick = () => planetModal(b.dataset.planet));
  sheet.querySelectorAll('[data-fleet]').forEach(b => b.onclick = () => fleetSheet(b.dataset.fleet));
  sheet.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => openSystem(b.dataset.goto));
}
function envPills(sys) {
  const f = sys.features || [], out = [];
  if (sys.kind === 'blackhole') out.push('<span class="env-pill bh">:blackhole: Agujero negro (portal)</span>');
  if (f.includes('asteroids')) out.push('<span class="env-pill ast">:asteroid: Cinturón rico</span>');
  if (f.includes('nebula')) out.push('<span class="env-pill neb">:nebula: Nebulosa</span>');
  if (sys.ruin && !sys.ruin.claimedBy) out.push('<span class="env-pill rui">:ruins: Ruinas</span>');
  if (sys.lair && !sys.lair.destroyed) out.push('<span class="env-pill lair">:lair: Guarida pirata</span>');
  if (sys.hub) out.push('<span class="env-pill">:hub: Sistema clave · +25% PIB</span>');
  if (sys.choke) out.push('<span class="env-pill">:choke: Paso estratégico</span>');
  return out.join('');
}
function fleetRow(f) {
  const s = store.state;
  return `<div class="list-item" data-fleet="${f.id}"><img src="${shipThumb(mainHull(f, s), nationInfo(f.owner).colors)}" width="44" height="44"><div class="grow"><b>${esc(f.name)}</b>
    <span class="small muted">${esc(nationName(f.owner))} · :power: ${fmt(f.info.power)} · ${f.info.count} u.${f.path || f.moving ? ' · en viaje' : ''}</span></div>${REL_LABEL[relation(f.owner)]}</div>`;
}
function planetCard(p) {
  const B = GD.BIOMES[p.biome];
  return `<div class="card flat planet-card" data-planet="${p.id}">
    <span class="tag">${esc(p.name)}</span>
    <img class="pimg" src="${planetThumb(p, B)}" alt="">
    <div class="desc">${B.icon} ${B.name} · ${GD.RESOURCES[p.deposit].icon}</div>
    <div class="small" style="margin-top:4px">${p.owner ? flagHTML(p.owner, 18, 12) + ' ' + esc(nationName(p.owner)) : '<span class="muted">Independiente</span>'}</div>
  </div>`;
}

/* ---------- Ficha de flota (propia o ajena) ---------- */
export function fleetSheet(fid) {
  const s = store.state, f = s.fleets[fid]; if (!f) return;
  const mine = f.owner === store.me.id, rel = relation(f.owner);
  const myFleets = Object.values(s.fleets).filter(x => x.owner === store.me.id && x.info.space > 0);
  const units = f.units ? Object.keys(f.units).map(d => { const D = s.designs[d]; return D ? `<div class="list-item"><img src="${shipThumb(D.hull, nationInfo(f.owner).colors)}" width="40" height="40"><div class="grow"><b>${f.units[d]}× ${esc(D.name)}</b><span class="small muted">${GD.HULLS[D.hull].name} · :power: ${D.stats.power}</span></div></div>` : ''; }).join('') : '<p class="small muted">Composición desconocida (necesitas espías — próximamente).</p>';
  const dest = f.path && f.path.length ? s.systems[f.path[f.path.length - 1]] : null;
  const missionTxt = f.mission ? (f.mission.type === 'invade' ? ':invade: Misión: invadir ' + esc(s.planets[f.mission.planetId].name) : ':war: Misión: atacar') : '';
  openModal(`<div class="row">${flagHTML(f.owner, 36, 24)}<div class="grow"><h3 style="margin:0">${esc(f.name)}</h3><span class="small muted">${esc(nationName(f.owner))} ${REL_LABEL[rel]}</span></div></div>
    <ul class="stat-list"><li><span>:pin: Ubicación</span><b>${esc(s.systems[f.system].name)}</b></li>
      ${dest ? `<li><span>:compass: Destino</span><b>${esc(dest.name)} · salto en ${timeLeft(f.nextJumpAt)}</b></li>` : ''}
      <li><span>:power: Poder</span><b>${fmt(f.info.power)}</b></li>
      <li><span>:fleet: Naves · :troops: Tropas</span><b>${f.info.space} · ${f.info.ground}${mine && f.info.capacity ? ' (capacidad ' + f.info.groundSize + '/' + f.info.capacity + ')' : ''}</b></li>
      ${missionTxt ? `<li><span>${missionTxt}</span></li>` : ''}</ul>
    ${units}
    ${mine ? `<h3>Órdenes</h3><div class="order-grid">
        <button class="btn order" data-o="move" ${f.info.space ? '' : 'disabled'}>:compass:<span>Mover</span></button>
        <button class="btn order danger" data-o="attack" ${f.info.space ? '' : 'disabled'}>:war:<span>Atacar</span></button>
        <button class="btn order danger" data-o="invade" ${f.info.space ? '' : 'disabled'}>:invade:<span>Invadir</span></button>
        <button class="btn order" id="fs-embark" ${f.info.capacity ? '' : 'disabled'}>:troops:<span>Embarcar</span></button>
      </div>
      ${f.path ? '<button class="btn block" id="fs-stop">:stop: Detener flota</button>' : ''}
      ${!f.info.space ? '<p class="small warn">Esta guarnición no tiene naves: no puede viajar. Para moverla, junta un Transporte en este sistema y pulsa "Embarcar" desde esa flota.</p>' : ''}
      ${f.info.space && !f.info.capacity ? '<p class="small muted">Para invadir necesitas un <b>Transporte de tropas</b> en la flota.</p>' : ''}`
    : (rel === 'war' ? `<h3>Atacar esta flota</h3>${myFleets.length ? myFleets.map(m => `<div class="list-item"><div class="grow"><b>${esc(m.name)}</b><span class="small muted">:pin: ${esc(s.systems[m.system].name)} · :power: ${fmt(m.info.power)}</span></div><button class="btn small danger" data-hit="${m.id}">:war: Enviar</button></div>`).join('') : '<p class="muted">No tienes flotas con naves.</p>'}
        <p class="small muted">Las batallas se simulan solas cuando tus naves llegan al sistema. Compara el <b>poder</b> antes de atacar.</p>`
      : `<p class="small muted">No estás en guerra con ${esc(nationName(f.owner))}. Para atacar, declara la guerra desde su ficha de nación (Social > Naciones) o usa "Atacar" desde tu flota.</p>`)}`, m => {
    m.querySelectorAll('[data-o]').forEach(b => b.onclick = () => startOrder(fid, b.dataset.o));
    const em = m.querySelector('#fs-embark'); if (em) em.onclick = async () => { await action('embark', { fleetId: fid }); fleetSheet(fid); };
    const st = m.querySelector('#fs-stop'); if (st) st.onclick = async () => { await action('stopFleet', { fleetId: fid }); closeModal(); };
    m.querySelectorAll('[data-hit]').forEach(b => b.onclick = async () => { const r = await action('moveFleet', { fleetId: b.dataset.hit, to: f.system, mission: { type: 'attack' } }); if (r.ok) closeModal(); });
  });
}

/* ---------- Panel de guerra terrestre (bloqueo, bombardeo, escudo, campaña) ---------- */
const bar = (v, color) => `<span class="bar" style="display:inline-block;width:90px;vertical-align:middle"><i style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></i></span>`;
function warPanel(pid) {
  const s = store.state, p = s.planets[pid], me = store.me, g = p.g;
  if (!p.owner || !g) return '';
  const mine = p.owner === me.id;
  const camp = g.camp, myCamp = camp && camp.attacker === me.id;
  const sysName = s.systems[p.system].name;
  const myFleets = Object.values(s.fleets).filter(f => f.owner === me.id && f.system === p.system && !f.path && f.info && f.info.space > 0);
  const atWar = relation(p.owner) === 'war';
  let h = '';
  const rows = [];
  if (g.blockade) rows.push(`<li><span>:blockade: Bloqueo</span><b class="bad">${esc(nationName(g.blockade))}${mine ? ' · ¡sin PIB y con estabilidad cayendo!' : ''}</b></li>`);
  if (g.supp > 0) rows.push(`<li><span>:bombard: Defensa suprimida</span><b>${bar(g.supp, '#ef476f')} ${g.supp}%</b></li>`);
  if (g.militia < 100 || g.supp > 0 || camp) rows.push(`<li><span>:troops: Milicia</span><b>${bar(g.militia, '#57cc99')} ${g.militia}%</b></li>`);
  if (g.shield) rows.push(`<li><span>:b_escudo: Escudo planetario</span><b>${g.shield.up ? bar(g.shield.pct, '#4cc9f0') + ' ' + g.shield.pct + '%' : '<span class="good">Apagado (se reactiva en unas horas)</span>'}</b></li>`);
  if (rows.length) h += `<h3>:war: Situación de guerra</h3><ul class="stat-list">${rows.join('')}</ul>`;
  if (g.shield && g.shield.up && !mine) h += `<p class="small muted">El escudo impide bombardear. Desembarca tropas para apagar su generador (la <b>artillería de asedio</b> lo hace x3 más rápido).</p>`;
  if (camp) {
    const last = camp.log[camp.log.length - 1];
    h += `<h3>:invade: Campaña terrestre · ronda ${camp.round}</h3>
      <p class="small">${flagHTML(camp.attacker)} <b>${esc(nationName(camp.attacker))}</b> ataca con ${camp.au} tropas (empezó con ${camp.start}) contra ${camp.du} defensores y la milicia. Postura: <b>${camp.stance === 'assault' ? 'asalto' : 'asedio'}</b>.</p>
      <div class="gw-chart">${camp.log.map(r => `<div title="Ronda ${r.round}: ataque ${r.atk} · defensa ${r.def}" style="display:inline-block;width:6px;margin-right:1px;vertical-align:bottom"><i style="display:block;height:${Math.min(46, Math.round(r.atk / Math.max(1, Math.max(r.atk, r.def)) * 46))}px;background:var(--bad)"></i><i style="display:block;height:${Math.min(46, Math.round(r.def / Math.max(1, Math.max(r.atk, r.def)) * 46))}px;background:var(--good);margin-top:1px"></i></div>`).join('')}</div>
      <p class="small muted">Rojo = poder atacante · Verde = poder defensor, por ronda${last ? ' (última: ' + last.atk + ' vs ' + last.def + ')' : ''}.</p>
      ${myCamp ? `<div class="row"><button class="btn small ${camp.stance === 'assault' ? 'danger' : ''}" data-stance="assault">:tac_attack: Asalto</button><button class="btn small ${camp.stance === 'siege' ? 'primary' : ''}" data-stance="siege">:tac_hold: Asedio</button><button class="btn small" id="gw-withdraw">:tac_retreat: Retirar</button></div>
      <p class="small muted"><b>Asalto</b>: +35% de daño pero +35% de bajas. <b>Asedio</b>: -25% de daño, pero -40% de bajas. Puedes reforzar enviando más tropas desde Invadir.</p>` : (mine ? '<p class="small warn">¡Defiende! Tus guarniciones y tu milicia combaten solas. Mueve más tropas al sistema para reforzar.</p>' : '')}`;
  }
  if (!mine && atWar && myFleets.length) {
    h += `<h3>:bombard: Bombardeo orbital</h3><p class="small muted">Necesitas la órbita limpia y las defensas orbitales caídas. <b>Precisión</b>: lento, conserva población y edificios. <b>Saturación</b>: rápido, pero mata población y destruye edificios.</p>
      ${myFleets.map(f => { const bb = f.bombard && f.bombard.planetId === pid ? f.bombard : null; return `<div class="list-item"><div class="grow"><b>${esc(f.name)}</b><span class="small muted">:power: ${fmt(f.info.power)}${bb ? ' · bombardeando (' + (bb.mode === 'precision' ? 'precisión' : 'saturación') + ')' : ''}</span></div>
        ${bb ? `<button class="btn small" data-stopb="${f.id}">Parar</button>` : `<button class="btn small" data-bomb="${f.id}:precision">:bombard: Precisión</button><button class="btn small danger" data-bomb="${f.id}:saturation">Saturación</button>`}</div>`; }).join('')}`;
  }
  return h;
}
function bindWarPanel(m, pid) {
  m.querySelectorAll('[data-stance]').forEach(b => b.onclick = async () => { await action('groundStance', { planetId: pid, stance: b.dataset.stance }); });
  const w = m.querySelector('#gw-withdraw'); if (w) w.onclick = async () => { await action('groundWithdraw', { planetId: pid }); };
  m.querySelectorAll('[data-bomb]').forEach(b => b.onclick = async () => { const [fid, mode] = b.dataset.bomb.split(':'); await action('bombard', { fleetId: fid, planetId: pid, mode }); });
  m.querySelectorAll('[data-stopb]').forEach(b => b.onclick = async () => { await action('stopBombard', { fleetId: b.dataset.stopb }); });
}

/* ---------- Modal de planeta ---------- */
export function planetModal(pid) {
  const s = store.state, p = s.planets[pid], me = store.me;
  const B = GD.BIOMES[p.biome];
  const mine = p.owner === me.id;
  const rel = relation(p.owner);
  const buildings = p.buildings || {};
  const annexCost = GD.annexCost(p, Object.values(s.planets).filter(q => q.owner === me.id).length);
  const totalB = Object.values(buildings).reduce((a, b) => a + b, 0);
  const troopFleets = Object.values(s.fleets).filter(f => f.owner === me.id && f.info.space > 0 && (f.info.ground > 0 || f.info.capacity > 0));
  openModal(`
    <div class="center"><span class="tag" class="ico-lg">${esc(p.name)}</span>
    <img src="${planetThumb(p, B)}" style="width:150px;height:150px;display:block;margin:8px auto"></div>
    <ul class="stat-list">
      <li><span>:biome: Bioma</span><b>${B.icon} ${B.name}</b></li>
      <li><span>:ruler: Tamaño</span><b>${['', 'Pequeño', 'Mediano', 'Grande'][p.size]}</b></li>
      <li><span>:b_extractor: Yacimiento</span><b>${GD.RESOURCES[p.deposit].icon} ${GD.RESOURCES[p.deposit].name}${p.depositRich > 1 ? ' (rico ×2)' : ''}</b></li>
      <li><span>:pop: Población</span><b>${fmt(p.pop)} M${p.popCap ? ' / ' + fmt(p.popCap) + ' M' : ''}</b></li>
      <li><span>:flag: Dueño</span><b>${p.owner ? flagHTML(p.owner) + ' ' + esc(nationName(p.owner)) : 'Independiente'} ${REL_LABEL[rel]}</b></li>
      ${p.stability != null ? `<li><span>:balance: Estabilidad</span><b>${pct(p.stability)}</b></li>` : ''}
      ${p.owner && p.defenseHp === 0 ? '<li><span>:tower: Defensas</span><b class="bad">Destruidas</b></li>' : ''}
      ${s.systems[p.system].hub ? '<li><span>:hub: Sistema clave</span><b class="good">+25% PIB aquí</b></li>' : ''}
    </ul>
    <div id="warpanel">${warPanel(pid)}</div>
    ${p.owner && !mine && Object.keys(buildings).length ? `<p class="small muted">Edificios: ${Object.keys(buildings).map(b => GD.BUILDINGS[b].icon + buildings[b]).join(' ')}</p>` : ''}
    <div class="spacer"></div>
    ${mine ? `<h3>:crane: Edificios (${totalB}/${p.size * 4 + 2})</h3>
      ${Object.keys(GD.BUILDINGS).map(k => buildRow(p, k)).join('')}
      ${me.capital !== p.id ? `<button class="btn small" id="pm-capital">:star: Hacer capital</button>` : '<p class="small">:star: Capital de tu nación</p>'}` : ''}
    ${!p.owner ? `<button class="btn primary block" id="pm-annex">:ally: Anexar pacíficamente (₡${fmt(annexCost)})</button>
      <p class="small muted">Necesitas una flota o un planeta propio en este sistema.</p>` : ''}
    ${p.owner && !mine && rel !== 'ally' ? `<h3>:invade: Invadir ${esc(p.name)}</h3>
      ${troopFleets.length ? troopFleets.map(f => `<div class="list-item"><div class="grow"><b>${esc(f.name)}</b><span class="small muted">:pin: ${esc(s.systems[f.system].name)} · :power: ${fmt(f.info.power)} · :troops: ${f.info.ground}${f.info.capacity ? '/' + f.info.capacity + ' cap.' : ''}</span></div><button class="btn small danger" data-inv="${f.id}">Enviar</button></div>`).join('')
        : '<p class="small warn">Necesitas una flota con un <b>Transporte de tropas</b> y tropas a bordo.</p>'}
      <p class="small muted">La flota viaja, combate contra naves y defensas del sistema, <b>bombardea</b> (precisión) hasta suprimir la defensa y desembarca sola. Luego pelean por rondas: puedes cambiar la postura o retirarte aquí. ${rel !== 'war' ? 'Se te pedirá declarar la guerra.' : ''}</p>` : ''}
  `, m => {
    m.querySelectorAll('[data-build]').forEach(b => b.onclick = async () => { await action('build', { planetId: pid, building: b.dataset.build }); planetModal(pid); });
    const cap = m.querySelector('#pm-capital'); if (cap) cap.onclick = () => action('setCapital', { planetId: pid });
    const an = m.querySelector('#pm-annex'); if (an) an.onclick = async () => { const r = await action('annex', { planetId: pid }); if (r.ok) closeModal(); };
    m.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => startOrder(b.dataset.inv, 'invade', pid));
    bindWarPanel(m, pid);
    // La guerra terrestre avanza sola: el panel se refresca mientras el modal está abierto
    clearInterval(warTimer); warTimer = setInterval(() => { const el = m.querySelector('#warpanel'); if (!el || !store.state.planets[pid]) return; el.innerHTML = warPanel(pid); bindWarPanel(m, pid); }, 2500);
  }, () => { clearInterval(warTimer); });
}
let warTimer = null;
function buildRow(p, k) {
  const B = GD.BUILDINGS[k], me = store.me;
  const have = p.buildings[k] || 0;
  const locked = B.requiresTech && !me.techs.includes(B.requiresTech);
  const maxed = B.max && have >= B.max;
  const mult = Math.pow(1.15, have);
  return `<div class="list-item"><div class="ico-lg">${B.icon}</div><div class="grow"><b>${B.name} ${have ? '×' + have : ''}</b>
    <span class="small muted">${B.desc}${k === 'extractor' ? ' (' + GD.RESOURCES[p.deposit].icon + ')' : ''}</span><br>
    <span class="small">${locked ? ':lock: ' + GD.techById(B.requiresTech).name : costHTML(B.cost, mult) + ' · mant. ₡' + B.upkeep}</span></div>
    <button class="btn small primary" data-build="${k}" ${locked || maxed ? 'disabled' : ''}>${maxed ? 'Máx' : '+'}</button></div>`;
}


/* ---------- Puntos de interés: guarida, ruinas, portal ---------- */
function poiModal(kind, sid) {
  const s = store.state, sys = s.systems[sid], me = store.me;
  const myFleets = Object.values(s.fleets).filter(f => f.owner === me.id && f.info.space > 0 && !f.battle);
  const sendList = (type) => myFleets.length ? myFleets.map(f => `<div class="list-item"><div class="grow"><b>${esc(f.name)}</b><span class="small muted">:pin: ${esc(s.systems[f.system].name)} · :power: ${fmt(f.info.power)}</span></div><button class="btn small ${type === 'attack' ? 'danger' : ''}" data-send="${f.id}">Enviar</button></div>`).join('') : '<p class="muted small">No tienes flotas con naves.</p>';
  let html = '';
  if (kind === 'lair') {
    const L = sys.lair;
    const defenders = Object.values(s.fleets).filter(f => f.system === sid && f.owner === 'pirates');
    html = `<h3>:lair: Guarida pirata de ${esc(sys.name)}</h3>
      <ul class="stat-list"><li><span>Clan</span><b>${esc({ cometa: 'Cometa Negro (enjambres de cazas)', helio: 'Saqueadores de Helio (misiles)', hermandad: 'Hermandad del Vacío (fragatas y destructores)' }[L.clan] || L.clan)}</b></li>
      <li><span>Nivel</span><b>${L.level}</b></li><li><span>Estación</span><b>${fmt(L.hp)} / ${fmt(L.hpMax)} PV</b></li>
      <li><span>Defensores</span><b>${defenders.length ? defenders.map(f => fmt(f.info.power)).join(' + ') + ' poder' : 'ninguno ahora'}</b></li></ul>
      <p class="small muted">Destruir la estación da un <b>botín grande</b> y los piratas tardan días en reconstruirla. Suelen lanzar incursiones contra los sistemas peor defendidos.</p>
      <h3>:war: Atacar</h3>${sendList('attack')}`;
  } else if (kind === 'ruins') {
    const R = sys.ruin;
    html = `<h3>:ruins: ${esc(R.name)}</h3><p>Restos de una civilización antigua. Si una flota <b>se queda 20 minutos</b> en el sistema sin enemigos, ¡saquea un <b>botín único</b> de créditos, investigación y recursos raros!</p>
      <p class="small muted">${R.claimedBy ? 'Ya fueron saqueadas por ' + esc(nationName(R.claimedBy)) + '.' : 'Un enjambre centinela las custodia: destrúyelo primero.'}</p><h3>:search: Explorar</h3>${sendList('move')}`;
  } else if (kind === 'portal') {
    const other = s.systems[sys.portal];
    html = `<h3>:blackhole: Portal de ${esc(sys.name)}</h3><p>Conecta con <b>${other ? esc(other.name) : '?'}</b> al otro lado de la galaxia. Es <b>2.5× más rápido</b> que viajar por las hiperrutas, pero la travesía es inestable: <b>puedes perder hasta un 12% de tu flota</b>.</p>
      <p class="small muted">Las rutas automáticas evitan los portales; al mandar una flota, si hay un atajo grande te preguntaremos. Dentro de un agujero negro las naves son atraídas y pueden ser devoradas en combate.</p>
      ${other ? `<button class="btn block" id="poi-other">:eye: Ver ${esc(other.name)}</button>` : ''}`;
  }
  openModal(html, m => {
    m.querySelectorAll('[data-send]').forEach(b => b.onclick = () => startOrder(b.dataset.send, kind === 'lair' ? 'attack' : 'move', null, sid));
    const o = m.querySelector('#poi-other'); if (o) o.onclick = () => { closeModal(); openSystem(sys.portal); };
  });
}
