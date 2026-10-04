/* =====================================================================
 * VISTA: PROYECTOS (investigación + diseño propio + producción)
 * Sub-pestañas: Investigación | Componentes | Diseños | Producción
 * Flujo del jugador: investigar -> diseñar componente -> diseñar nave
 *                    -> fabricar / vender licencia.
 * ===================================================================== */
import { GD, store, action, fmt, pct, esc, flagHTML, helpButton, subtabs, costHTML, timeLeft, openModal, closeModal, nationName } from '../core.js';
import { shipThumb, InteractiveScene, buildShipPreview } from '../render3d.js';

let root, sub = 'research', branch = 'economia';
export function init(el) {
  root = el;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-sub]'); if (b) { sub = b.dataset.sub; render(); }
    const br = e.target.closest('[data-branch]'); if (br) { branch = br.dataset.branch; render(); }
  });
  window.addEventListener('od:designInfo', e => designInfo(e.detail));
}
export function show() { render(); }
export function update({ modalOpen }) { if (!modalOpen) render(); }

function render() {
  root.innerHTML = `<div class="card"><div class="row"><div class="title-box grow" style="margin:0">Proyectos</div>${helpButton('projects')}</div>
    <p class="small center" style="margin:8px 0 0">🔬 <b>${fmt(store.me.research)} PI</b> · +${store.me.economy.research}/ciclo</p></div>
    ${subtabs([['research', '🔬 Investigación'], ['components', '🧩 Componentes'], ['designs', '🚀 Diseños'], ['production', '🏭 Producción']], sub)}
    <div id="pj-body"></div>`;
  const body = root.querySelector('#pj-body');
  ({ research, components, designs, production })[sub](body);
}

/* ---------- Árbol tecnológico ---------- */
function research(body) {
  const me = store.me;
  const techs = GD.TECHS.filter(t => t.branch === branch);
  body.innerHTML = `<div class="subtabs">${Object.keys(GD.TECH_BRANCHES).map(k => `<button data-branch="${k}" class="${k === branch ? 'active' : ''}">${GD.TECH_BRANCHES[k].emoji} ${GD.TECH_BRANCHES[k].name}</button>`).join('')}</div>
    ${techs.map(t => {
      const done = me.techs.includes(t.id);
      const reqOk = t.req.every(r => me.techs.includes(r));
      const cls = done ? 'done' : reqOk ? 'available' : 'locked';
      return `<div class="tech ${cls}"><div style="font-size:1.6rem">${done ? '✅' : reqOk ? '🔓' : '🔒'}</div>
        <div class="grow"><b>${esc(t.name)}</b><div class="small muted">${esc(t.desc)}</div>
        ${t.req.length ? `<div class="small">Requiere: ${t.req.map(r => (me.techs.includes(r) ? '✔ ' : '✖ ') + GD.techById(r).name).join(', ')}</div>` : ''}</div>
        ${done ? '' : `<button class="btn small primary" data-tech="${t.id}" ${reqOk && me.research >= t.cost ? '' : 'disabled'}>${t.cost} PI</button>`}</div>`;
    }).join('')}`;
  body.querySelectorAll('[data-tech]').forEach(b => b.onclick = () => action('research', { techId: b.dataset.tech }));
}

/* ---------- Componentes ---------- */
function myComponents() {
  return Object.values(store.state.components).filter(c => c.owner === store.me.id || c.public);
}
function components(body) {
  const me = store.me;
  const unlocked = Object.keys(GD.COMPONENT_TYPES).filter(k => me.techs.some(t => (GD.techById(t).unlocks || {}).component === k));
  const list = myComponents().sort((a, b) => (a.public ? 1 : 0) - (b.public ? 1 : 0));
  body.innerHTML = `<div class="card"><h3>🧩 Nuevo componente</h3>
    <p class="small muted">Elige un tipo y reparte hasta <b>${me.componentCap}</b> puntos. Tus componentes son únicos: nadie más los tiene a menos que compre tus diseños.</p>
    <div class="grid">${unlocked.map(k => { const T = GD.COMPONENT_TYPES[k]; return `<button class="btn" data-newcomp="${k}">${T.emoji} ${T.name}</button>`; }).join('')}</div></div>
    <div class="card"><h3>Mis componentes</h3>${list.map(compRow).join('')}</div>`;
  body.querySelectorAll('[data-newcomp]').forEach(b => b.onclick = () => componentDesigner(b.dataset.newcomp));
}
function compStatText(c) {
  const s = c.stats || GD.componentStats(c), T = GD.COMPONENT_TYPES[c.type];
  const main = T.slot === 'arma' ? `💥 Daño ${s.value.toFixed(1)} (${T.dmgType || 'tropa'})` : T.stat === 'speed' ? `🔥 Velocidad +${s.value.toFixed(1)}` : `${T.emoji} ${({ armor: 'Blindaje', shield: 'Escudo', pd: 'Def. puntual', sensors: 'Sensores', ecm: 'Interferencia' })[T.stat]} ${s.value.toFixed(1)}`;
  return `${main} · 🎯 Fiab. ${pct(s.reliability)} · ${costHTML(s.unitCost)}`;
}
function compRow(c) {
  const T = GD.COMPONENT_TYPES[c.type];
  return `<div class="list-item"><div style="font-size:1.5rem">${T.emoji}</div><div class="grow"><b>${esc(c.name)}</b>
    <span class="small muted">${T.name} · ${c.public ? 'Consorcio' : c.owner === store.me.id ? 'Tuyo' : esc(nationName(c.owner))}</span><br><span class="small">${compStatText(c)}</span></div>
    ${c.status === 'developing' ? `<span class="pill warn">⏳ ${timeLeft(c.readyAt)}</span>` : ''}</div>`;
}
function componentDesigner(type) {
  const T = GD.COMPONENT_TYPES[type], cap = store.me.componentCap;
  const pts = { potencia: Math.round(cap * 0.5), fiabilidad: Math.round(cap * 0.3), eficiencia: cap - Math.round(cap * 0.5) - Math.round(cap * 0.3) };
  openModal(`<h3>${T.emoji} Diseñar: ${T.name}</h3>
    <label>Nombre</label><input type="text" id="cn" maxlength="32" placeholder="Ej: Láser Tormenta X-2">
    <p class="small muted">Puntos: <b id="left"></b> / ${cap}</p>
    ${['potencia', 'fiabilidad', 'eficiencia'].map(k => `<div class="point-row"><span>${({ potencia: '💥 Potencia', fiabilidad: '🎯 Fiabilidad', eficiencia: '💲 Eficiencia' })[k]}</span><input type="range" data-pt="${k}" min="${k === 'potencia' ? 1 : 0}" max="${cap}" value="${pts[k]}"><b data-v="${k}"></b></div>`).join('')}
    <div class="card flat"><div id="preview" class="small"></div></div>
    <p class="small muted">Potencia = stat principal · Fiabilidad = % de que funcione en combate · Eficiencia = más barato de fabricar y mantener.</p>
    <button class="btn primary block" id="go"></button>`, m => {
    const upd = (changed) => {
      let total = pts.potencia + pts.fiabilidad + pts.eficiencia;
      if (total > cap && changed) { // recorta de los otros
        for (const k of ['eficiencia', 'fiabilidad', 'potencia']) { if (k === changed) continue; const cut = Math.min(pts[k] - (k === 'potencia' ? 1 : 0), total - cap); pts[k] -= cut; total -= cut; }
      }
      m.querySelectorAll('[data-pt]').forEach(r => { r.value = pts[r.dataset.pt]; m.querySelector(`[data-v="${r.dataset.pt}"]`).textContent = pts[r.dataset.pt]; });
      m.querySelector('#left').textContent = total;
      const fake = { type, points: pts };
      const dev = GD.componentDevCost(fake);
      m.querySelector('#preview').innerHTML = compStatText(fake);
      m.querySelector('#go').innerHTML = `🧪 Desarrollar (₡${fmt(dev.credits)} · ${dev.minutes} min)`;
    };
    m.querySelectorAll('[data-pt]').forEach(r => r.oninput = () => { pts[r.dataset.pt] = +r.value; upd(r.dataset.pt); });
    upd();
    m.querySelector('#go').onclick = async () => { if ((await action('designComponent', { type, name: m.querySelector('#cn').value, points: pts })).ok) closeModal(); };
  });
}

/* ---------- Diseños de naves / tropas ---------- */
function canBuild(d) { const me = store.me; return d.status === 'ready' && (d.public || d.owner === me.id || me.licenses.includes(d.id)); }
function designs(body) {
  const me = store.me;
  const hulls = Object.keys(GD.HULLS).filter(h => me.techs.some(t => (GD.techById(t).unlocks || {}).hull === h));
  const list = Object.values(store.state.designs).filter(d => d.owner === me.id || d.public || me.licenses.includes(d.id));
  body.innerHTML = `<div class="card"><h3>🛠️ Nuevo proyecto de nave / tropa</h3>
    <div class="grid">${hulls.map(h => `<button class="btn" data-hull="${h}">${GD.HULLS[h].emoji} ${GD.HULLS[h].name}</button>`).join('')}</div></div>
    <div class="grid desk-3">${list.map(designCard).join('')}</div>`;
  body.querySelectorAll('[data-hull]').forEach(b => b.onclick = () => shipDesigner(b.dataset.hull));
  body.querySelectorAll('[data-dinfo]').forEach(b => b.onclick = () => designInfo(b.dataset.dinfo));
}
function designCard(d) {
  const H = GD.HULLS[d.hull];
  const tag = d.public ? 'Consorcio' : d.owner === store.me.id ? 'Tuyo' : 'Licencia';
  return `<div class="card flat planet-card" data-dinfo="${d.id}">
    <span class="tag">${esc(d.name)}</span>
    <img class="pimg" src="${shipThumb(d.hull, colorHex())}">
    <div class="desc">${H.emoji} ${H.name} · ⚡ Poder ${d.stats.power}</div>
    <div class="small" style="margin-top:4px">${d.status === 'developing' ? `<span class="pill warn">⏳ ${timeLeft(d.readyAt)}</span>` : `<span class="pill">${tag}</span>`}</div></div>`;
}
function colorHex() { const c = store.me.flag.colors; return parseInt(c[0].slice(1), 16); }

function statBlock(s) {
  if (s.domain === 'ground') return `<ul class="stat-list"><li><span>⚔️ Ataque terrestre</span><b>${s.groundAttack}</b></li><li><span>🛡️ Defensa terrestre</span><b>${s.groundDefense}</b></li>
    <li><span>📏 Tamaño (espacio en transporte)</span><b>${s.size}</b></li><li><span>💲 Coste unidad</span><b>${costHTML(s.unitCost)}</b></li><li><span>🔧 Mantenimiento</span><b>₡${s.upkeep}</b></li></ul>`;
  const dmg = t => s.weapons.filter(w => w.dmgType === t).reduce((a, w) => a + w.dmg, 0).toFixed(0);
  return `<ul class="stat-list">
    <li><span>❤️ Casco</span><b>${s.hp}</b></li><li><span>🚀 Velocidad</span><b>${s.speed.toFixed(1)}</b></li>
    <li><span>🔴 Daño energía / ⚙️ cinético / 💣 explosivo</span><b>${dmg('energia')} / ${dmg('cinetico')} / ${dmg('explosivo')}</b></li>
    <li><span>🧱 Blindaje · 🔵 Escudo · 🎯 Def. puntual</span><b>${Math.round(s.armor)} · ${Math.round(s.shield)} · ${Math.round(s.pd)}</b></li>
    <li><span>📡 Sensores · 📶 Interferencia</span><b>${Math.round(s.sensors)} · ${Math.round(s.ecm)}</b></li>
    ${s.capacity ? `<li><span>🪖 Capacidad de tropas</span><b>${s.capacity}</b></li>` : ''}
    ${s.hangar ? `<li><span>✈️ Hangar</span><b>${s.hangar}</b></li>` : ''}
    <li><span>🎯 Fiabilidad media</span><b>${pct(s.reliability)}</b></li>
    <li><span>💲 Coste unidad</span><b>${costHTML(s.unitCost)}</b></li><li><span>🔧 Mantenimiento</span><b>₡${s.upkeep}/ciclo</b></li></ul>`;
}

function shipDesigner(hull) {
  const H = GD.HULLS[hull];
  const avail = Object.values(store.state.components).filter(c => c.status === 'ready' && (c.public || c.owner === store.me.id)
    && (H.slots[GD.COMPONENT_TYPES[c.type].slot] || 0) > 0 && (H.domain === 'ground' || !GD.COMPONENT_TYPES[c.type].groundOnly)
    && !(hull === 'infanteria' && GD.COMPONENT_TYPES[c.type].slot === 'arma' && !GD.COMPONENT_TYPES[c.type].groundOnly));
  const chosen = { arma: [], defensa: [], motor: [], sistema: [] };
  let preview = null;
  const lookup = id => store.state.components[id];
  openModal(`<h3>${H.emoji} Proyecto: ${H.name}</h3>
    <canvas class="ship-preview" id="sp"></canvas>
    <label>Nombre del diseño</label><input type="text" id="dn" maxlength="32" placeholder="Ej: Destructor Clase Furia">
    <div id="slots"></div>
    <div class="card flat" id="ds"></div>
    <label>Descripción (para el mercado)</label><input type="text" id="dd" maxlength="200" placeholder="Rápido y letal...">
    <div class="spacer"></div><button class="btn primary block" id="go">🛠️ Iniciar proyecto (₡${fmt(H.devCost)} · ${H.devMinutes} min)</button>`, m => {
    preview = new InteractiveScene(m.querySelector('#sp'), { pan: false, tilt: 0.5, zoom: 90, minZoom: 40, maxZoom: 200, center: [0, 0] });
    buildShipPreview(preview, hull, colorHex()); preview.start();
    const draw = () => {
      m.querySelector('#slots').innerHTML = ['arma', 'defensa', 'motor', 'sistema'].filter(k => H.slots[k]).map(k => `
        <label>${({ arma: '💥 Armas', defensa: '🛡️ Defensa', motor: '🔥 Motores', sistema: '📡 Sistemas' })[k]} (${chosen[k].length}/${H.slots[k]}${H.minSlots[k] ? ', mín ' + H.minSlots[k] : ''})</label>
        <div class="slot-row">${chosen[k].map((cid, i) => `<div class="slot filled" data-rm="${k}:${i}">${GD.COMPONENT_TYPES[lookup(cid).type].emoji} ${esc(lookup(cid).name)} ✕</div>`).join('')}
        ${chosen[k].length < H.slots[k] ? `<select data-add="${k}"><option value="">+ Añadir…</option>${avail.filter(c => GD.COMPONENT_TYPES[c.type].slot === k).map(c => `<option value="${c.id}">${GD.COMPONENT_TYPES[c.type].emoji} ${esc(c.name)} (P${c.points.potencia}/F${c.points.fiabilidad}/E${c.points.eficiencia})</option>`).join('')}</select>` : ''}</div>`).join('');
      const design = { hull, components: [].concat(chosen.arma, chosen.defensa, chosen.motor, chosen.sistema) };
      const err = GD.validateDesign(design, lookup);
      const s = GD.designStats(design, lookup);
      m.querySelector('#ds').innerHTML = statBlock(s) + `<p class="center"><b>⚡ Poder: ${s.power}</b></p>` + (err ? `<p class="small bad">${esc(err)}</p>` : '');
      m.querySelector('#go').disabled = !!err;
      m.querySelectorAll('[data-add]').forEach(sel => sel.onchange = () => { if (sel.value) { chosen[sel.dataset.add].push(sel.value); draw(); } });
      m.querySelectorAll('[data-rm]').forEach(el => el.onclick = () => { const [k, i] = el.dataset.rm.split(':'); chosen[k].splice(+i, 1); draw(); });
    };
    draw();
    m.querySelector('#go').onclick = async () => {
      const r = await action('designShip', { hull, name: m.querySelector('#dn').value, description: m.querySelector('#dd').value, components: [].concat(chosen.arma, chosen.defensa, chosen.motor, chosen.sistema) });
      if (r.ok) closeModal();
    };
  }, () => { if (preview) { preview.stop(); preview.renderer.dispose(); } });
}

/** Ficha de un diseño: stats, fabricar, vender licencia */
export function designInfo(id) {
  const d = store.state.designs[id]; if (!d) return;
  const H = GD.HULLS[d.hull], me = store.me, s = d.stats;
  const mine = d.owner === me.id;
  const okPlanets = Object.values(store.state.planets).filter(p => p.owner === me.id && (H.domain === 'space' ? p.buildings.astillero : p.buildings.cuartel));
  const forSale = Object.values(store.state.market).find(o => o.designId === id);
  openModal(`<div class="center"><span class="tag">${esc(d.name)}</span><img src="${shipThumb(d.hull, colorHex())}" style="width:140px;height:140px;display:block;margin:6px auto"></div>
    <p class="small center muted">${H.emoji} ${H.name} · Creador: ${d.owner ? flagHTML(d.owner, 18, 12) + ' ' + esc(nationName(d.owner)) : 'Consorcio Galáctico'}</p>
    ${d.description ? `<p class="center">"${esc(d.description)}"</p>` : ''}
    <p class="small"><b>Componentes:</b> ${d.components.map(c => { const x = store.state.components[c]; return x ? GD.COMPONENT_TYPES[x.type].emoji + ' ' + esc(x.name) : '?'; }).join(', ')}</p>
    ${statBlock(s)}
    ${canBuild(d) ? `<h3>🏭 Fabricar</h3>${okPlanets.length ? `
      <label>Planeta</label><select id="pp">${okPlanets.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <label>Cantidad: <b id="qv">1</b></label><input type="range" id="q" min="1" max="50" value="1">
      <p>Total: <span id="tot"></span></p><button class="btn primary block" id="mk">Fabricar</button>
      ${d.owner && !mine ? '<p class="small muted">El creador cobra 10% de regalías.</p>' : ''}` : `<p class="small warn">Necesitas un ${H.domain === 'space' ? 'Astillero orbital' : 'Academia militar'} en algún planeta.</p>`}` : d.status === 'developing' ? `<p class="warn">⏳ En desarrollo: ${timeLeft(d.readyAt)}</p>` : '<p class="muted">No tienes licencia para fabricar este diseño. Búscalo en el Mercado.</p>'}
    ${mine && d.status === 'ready' ? (forSale ? `<p class="small good">📜 Licencia a la venta por ₡${fmt(forSale.price)}</p><button class="btn small danger" id="unsell">Retirar del mercado</button>` :
      `<h3>📜 Vender licencia</h3><p class="small muted">Otros jugadores podrán fabricar tu diseño. Cobras el precio de la licencia + 10% de regalías por cada unidad fabricada.</p>
      <div class="row"><input type="number" id="lp" value="${Math.round((s.unitCost.credits || 1000) * 3)}"><button class="btn good" id="sell">Publicar</button></div>`) : ''}`, m => {
    const q = m.querySelector('#q');
    if (q) {
      const upd = () => { m.querySelector('#qv').textContent = q.value; m.querySelector('#tot').innerHTML = costHTML(s.unitCost, +q.value); };
      q.oninput = upd; upd();
      m.querySelector('#mk').onclick = async () => { if ((await action('produce', { designId: id, planetId: m.querySelector('#pp').value, count: q.value })).ok) closeModal(); };
    }
    const sell = m.querySelector('#sell'); if (sell) sell.onclick = async () => { if ((await action('marketPost', { kind: 'design', designId: id, price: m.querySelector('#lp').value })).ok) closeModal(); };
    const un = m.querySelector('#unsell'); if (un) un.onclick = async () => { if ((await action('marketCancel', { id: forSale.id })).ok) closeModal(); };
  });
}

/* ---------- Producción ---------- */
function production(body) {
  const q = store.me.queue.slice().sort((a, b) => a.readyAt - b.readyAt);
  const devC = Object.values(store.state.components).filter(c => c.owner === store.me.id && c.status === 'developing');
  const devD = Object.values(store.state.designs).filter(d => d.owner === store.me.id && d.status === 'developing');
  body.innerHTML = `<div class="card"><h3>🏭 Cola de fabricación</h3>
    ${q.length ? q.map(i => { const d = store.state.designs[i.designId]; return `<div class="list-item"><div style="font-size:1.4rem">${GD.HULLS[d.hull].emoji}</div><div class="grow"><b>${i.count}× ${esc(d.name)}</b><span class="small muted">${esc(store.state.planets[i.planetId].name)}</span></div><span class="pill warn">⏳ ${timeLeft(i.readyAt)}</span></div>`; }).join('') : '<p class="muted">Nada en producción. Fabrica desde la pestaña Diseños.</p>'}</div>
    <div class="card"><h3>🧪 Proyectos en desarrollo</h3>
    ${devC.concat(devD).length ? devC.map(c => `<div class="list-item">🧩<div class="grow"><b>${esc(c.name)}</b></div><span class="pill warn">⏳ ${timeLeft(c.readyAt)}</span></div>`).join('') + devD.map(d => `<div class="list-item">🚀<div class="grow"><b>${esc(d.name)}</b></div><span class="pill warn">⏳ ${timeLeft(d.readyAt)}</span></div>`).join('') : '<p class="muted">Ningún proyecto activo.</p>'}</div>`;
}
