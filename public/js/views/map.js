/* =====================================================================
 * VISTA: MAPA (galaxia 3D -> sistema 3D -> planeta)
 * Toca un sistema para entrar. Toca un planeta para ver sus detalles.
 * Las etiquetas son HTML encima del canvas (texto nítido en móvil).
 * ===================================================================== */
import { GD, store, on, action, fmt, esc, flagHTML, nationColor, nationName, relation, REL_LABEL, openModal, closeModal, pct, costHTML } from '../core.js';
import { InteractiveScene, buildGalaxy, buildSystem, planetThumb, THREE } from '../render3d.js';

let root, view, labelsEl, sheet, mode = 'galaxy', currentSystem = null, lastHash = '';
let labelItems = [];

export function init(el) {
  root = el;
  labelsEl = el.querySelector('#map-labels');
  sheet = el.querySelector('#map-sheet');
  view = new InteractiveScene(el.querySelector('#galaxy-canvas'), { tilt: 1.05, zoom: 700, minZoom: 120, maxZoom: 1300 });
  view.onPick = pick;
  el.querySelector('#map-back').onclick = () => openGalaxy();
  el.querySelector('#map-home').onclick = () => {
    const cap = store.state.planets[store.me.capital];
    if (cap) openSystem(cap.system);
  };
  // Las etiquetas también son tocables
  labelsEl.addEventListener('click', e => {
    const l = e.target.closest('.map-label'); if (!l) return;
    pick({ type: l.dataset.type, id: l.dataset.id });
  });
}
export function show() {
  view.resize(); view.start();
  if (!lastHash) openGalaxy(); else rebuild(true);
  loopLabels();
}
export function hide() { view.stop(); }
export function update() { rebuild(false); if (!sheet.classList.contains('hidden')) refreshSheet(); }

/** Solo reconstruye la escena 3D si cambió algo visible (dueños/flotas) */
function rebuild(force) {
  const s = store.state;
  const h = mode + currentSystem + Object.values(s.planets).map(p => p.owner || '').join() + Object.values(s.fleets).map(f => f.system + f.owner).join();
  if (!force && h === lastHash) return;
  lastHash = h;
  if (mode === 'galaxy') {
    buildGalaxy(view, s, id => new THREE.Color(nationColor(id)), store.me.id);
    makeLabels(Object.values(s.systems).map(sys => ({ type: 'system', id: sys.id, pos: new THREE.Vector3(sys.x, 22, sys.y), html: systemLabel(sys) })));
  } else {
    const planets = buildSystem(view, s, currentSystem, id => new THREE.Color(nationColor(id)), GD.BIOMES);
    makeLabels(planets.map(p => ({ type: 'planet', id: p.pid, obj: p.holder, html: planetLabel(s.planets[p.pid]) })));
  }
}
function systemLabel(sys) {
  const s = store.state;
  const owners = [...new Set(sys.planets.map(pid => s.planets[pid].owner).filter(Boolean))];
  const fleets = Object.values(s.fleets).filter(f => f.system === sys.id);
  const war = fleets.some(f => relation(f.owner) === 'war');
  return `<span class="tag">${esc(sys.name)}</span><span class="owner">${owners.slice(0, 3).map(o => flagHTML(o, 18, 12)).join(' ')}${fleets.length ? ' <small>' + (war ? '⚠️' : '🚀') + fleets.length + '</small>' : ''}</span>`;
}
function planetLabel(p) {
  return `<span class="tag">${esc(p.name)}</span><span class="owner">${p.owner ? flagHTML(p.owner, 18, 12) : ''}</span>`;
}
function makeLabels(items) {
  labelsEl.innerHTML = '';
  labelItems = items.map(it => {
    const d = document.createElement('div');
    d.className = 'map-label'; d.dataset.type = it.type; d.dataset.id = it.id; d.innerHTML = it.html;
    labelsEl.appendChild(d);
    return Object.assign(it, { el: d });
  });
}
let raf = null;
function loopLabels() {
  cancelAnimationFrame(raf);
  const step = () => {
    if (!view.running) return;
    for (const it of labelItems) {
      const pos = it.obj ? it.obj.position.clone().add(new THREE.Vector3(0, 12, 0)) : it.pos;
      const p = view.project(pos);
      it.el.style.display = p.visible ? '' : 'none';
      it.el.style.left = p.x + 'px'; it.el.style.top = (p.y - 34) + 'px';
    }
    raf = requestAnimationFrame(step);
  };
  step();
}

function openGalaxy() {
  mode = 'galaxy'; currentSystem = null;
  view.opts.pan = true; view.opts.minZoom = 120; view.opts.maxZoom = 1300; view.opts.tilt = 1.05;
  view.target.set(500, 0, 500); view.zoom = 900;
  root.querySelector('#map-back').style.display = 'none';
  root.querySelector('#map-title').textContent = 'Galaxia';
  sheet.classList.add('hidden');
  rebuild(true);
}
export function openSystem(sid) {
  mode = 'system'; currentSystem = sid;
  view.opts.pan = false; view.opts.minZoom = 80; view.opts.maxZoom = 400; view.opts.tilt = 0.75;
  // En móvil la hoja inferior tapa media pantalla: desplazamos el objetivo para que el sistema quede arriba
  const mobile = innerWidth < 900;
  view.target.set(mobile ? 0 : 60, 0, mobile ? 95 : 0); view.zoom = mobile ? 330 : 230;
  root.querySelector('#map-back').style.display = '';
  root.querySelector('#map-title').textContent = 'Sistema ' + store.state.systems[sid].name;
  rebuild(true);
  openSheet();
}
window.addEventListener('od:openSystem', e => openSystem(e.detail));

function pick(p) {
  if (!p) return;
  if (p.type === 'system') openSystem(p.id);
  if (p.type === 'planet') planetModal(p.id);
}

/* ---------- Hoja inferior con info del sistema ---------- */
function openSheet() { sheet.classList.remove('hidden'); sheet.classList.remove('collapsed'); refreshSheet(); }
function refreshSheet() {
  if (mode !== 'system') { sheet.classList.add('hidden'); return; }
  const s = store.state, sys = s.systems[currentSystem];
  const fleets = Object.values(s.fleets).filter(f => f.system === sys.id);
  const myFleets = fleets.filter(f => f.owner === store.me.id);
  sheet.innerHTML = `<div class="grab" id="sheet-grab"></div>
    <div class="title-box">Planetas del sistema ${esc(sys.name)}</div>
    <div class="grid">${sys.planets.map(pid => planetCard(s.planets[pid])).join('')}</div>
    <h3 style="margin-top:14px">🚀 Flotas en el sistema</h3>
    ${fleets.length ? fleets.map(f => `<div class="list-item">${flagHTML(f.owner)}<div class="grow"><b>${esc(f.name)}</b><span class="small muted">${esc(nationName(f.owner))} · Poder ${fmt(f.info.power)} · ${f.info.count} unidades</span></div>${REL_LABEL[relation(f.owner)]}</div>`).join('') : '<p class="muted small">Ninguna flota visible.</p>'}
    <h3 style="margin-top:14px">🧭 Hiperrutas</h3>
    <div class="row wrap">${sys.links.map(l => `<button class="btn small" data-goto="${l}">${esc(s.systems[l].name)}</button>`).join('')}</div>
    ${myFleets.length ? '' : `<p class="small muted">Envía flotas desde la pestaña Militar.</p>`}`;
  sheet.querySelector('#sheet-grab').onclick = () => sheet.classList.toggle('collapsed');
  sheet.querySelectorAll('[data-planet]').forEach(b => b.onclick = () => planetModal(b.dataset.planet));
  sheet.querySelectorAll('[data-goto]').forEach(b => b.onclick = () => openSystem(b.dataset.goto));
}
function planetCard(p) {
  const B = GD.BIOMES[p.biome];
  return `<div class="card flat planet-card" data-planet="${p.id}">
    <span class="tag">${esc(p.name)}</span>
    <img class="pimg" src="${planetThumb(p, B)}" alt="">
    <div class="desc">${B.emoji} ${B.name} · ${GD.RESOURCES[p.deposit].emoji}</div>
    <div class="small" style="margin-top:4px">${p.owner ? flagHTML(p.owner, 18, 12) + ' ' + esc(nationName(p.owner)) : '<span class="muted">Independiente</span>'}</div>
  </div>`;
}

/* ---------- Modal de planeta ---------- */
export function planetModal(pid) {
  const s = store.state, p = s.planets[pid], me = store.me;
  const B = GD.BIOMES[p.biome];
  const mine = p.owner === me.id;
  const rel = relation(p.owner);
  const myFleetsHere = Object.values(s.fleets).filter(f => f.owner === me.id && f.system === p.system && !f.path);
  const hasTroops = myFleetsHere.filter(f => f.info.ground > 0);
  const buildings = p.buildings || {};
  const annexCost = Math.round(5000 + p.pop * GD.RULES.annexCostPerMillion);
  const totalB = Object.values(buildings).reduce((a, b) => a + b, 0);
  openModal(`
    <div class="center"><span class="tag" style="font-size:1.2rem">${esc(p.name)}</span>
    <img src="${planetThumb(p, B)}" style="width:150px;height:150px;display:block;margin:8px auto"></div>
    <ul class="stat-list">
      <li><span>🌍 Bioma</span><b>${B.emoji} ${B.name}</b></li>
      <li><span>📏 Tamaño</span><b>${['', 'Pequeño', 'Mediano', 'Grande'][p.size]}</b></li>
      <li><span>⛏️ Yacimiento</span><b>${GD.RESOURCES[p.deposit].emoji} ${GD.RESOURCES[p.deposit].name}${p.depositRich > 1 ? ' (rico ×2)' : ''}</b></li>
      <li><span>👥 Población</span><b>${fmt(p.pop)} M${p.popCap ? ' / ' + fmt(p.popCap) + ' M' : ''}</b></li>
      <li><span>🏳️ Dueño</span><b>${p.owner ? flagHTML(p.owner) + ' ' + esc(nationName(p.owner)) : 'Independiente'} ${REL_LABEL[rel]}</b></li>
      ${p.stability != null ? `<li><span>⚖️ Estabilidad</span><b>${pct(p.stability)}</b></li>` : ''}
      ${p.owner && p.defenseHp === 0 ? '<li><span>🗼 Defensas</span><b class="bad">Destruidas</b></li>' : ''}
    </ul>
    ${p.owner && !mine && Object.keys(buildings).length ? `<p class="small muted">Edificios: ${Object.keys(buildings).map(b => GD.BUILDINGS[b].emoji + buildings[b]).join(' ')}</p>` : ''}
    <div class="spacer"></div>
    ${mine ? `<h3>🏗️ Edificios (${totalB}/${p.size * 4 + 2})</h3>
      ${Object.keys(GD.BUILDINGS).map(k => buildRow(p, k)).join('')}
      ${me.capital !== p.id ? `<button class="btn small" id="pm-capital">⭐ Hacer capital</button>` : '<p class="small">⭐ Capital de tu nación</p>'}` : ''}
    ${!p.owner ? `<button class="btn primary block" id="pm-annex">🤝 Anexar pacíficamente (₡${fmt(annexCost)})</button>
      <p class="small muted">Necesitas una flota o un planeta propio en este sistema.</p>` : ''}
    ${rel === 'war' ? `<button class="btn danger block" id="pm-invade" ${hasTroops.length ? '' : 'disabled'}>🪖 Invadir con tropas</button>
      <p class="small muted">Requiere control orbital (sin naves enemigas ni defensas activas) y tropas en transportes en este sistema.</p>` : ''}
  `, m => {
    m.querySelectorAll('[data-build]').forEach(b => b.onclick = async () => { await action('build', { planetId: pid, building: b.dataset.build }); planetModal(pid); });
    const cap = m.querySelector('#pm-capital'); if (cap) cap.onclick = () => action('setCapital', { planetId: pid });
    const an = m.querySelector('#pm-annex'); if (an) an.onclick = async () => { const r = await action('annex', { planetId: pid }); if (r.ok) closeModal(); };
    const inv = m.querySelector('#pm-invade'); if (inv) inv.onclick = async () => {
      const r = await action('invade', { fleetId: hasTroops[0].id, planetId: pid });
      if (r.report) window.dispatchEvent(new CustomEvent('od:report', { detail: r.report }));
      closeModal();
    };
  });
}
function buildRow(p, k) {
  const B = GD.BUILDINGS[k], me = store.me;
  const have = p.buildings[k] || 0;
  const locked = B.requiresTech && !me.techs.includes(B.requiresTech);
  const maxed = B.max && have >= B.max;
  const mult = Math.pow(1.15, have);
  return `<div class="list-item"><div style="font-size:1.6rem">${B.emoji}</div><div class="grow"><b>${B.name} ${have ? '×' + have : ''}</b>
    <span class="small muted">${B.desc}${k === 'extractor' ? ' (' + GD.RESOURCES[p.deposit].emoji + ')' : ''}</span><br>
    <span class="small">${locked ? '🔒 ' + GD.techById(B.requiresTech).name : costHTML(B.cost, mult) + ' · mant. ₡' + B.upkeep}</span></div>
    <button class="btn small primary" data-build="${k}" ${locked || maxed ? 'disabled' : ''}>${maxed ? 'Máx' : '+'}</button></div>`;
}
