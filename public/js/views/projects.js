/* =====================================================================
 * VISTA: PROYECTOS (investigación + diseño propio + producción)
 * Sub-pestañas: Investigación | Componentes | Diseños | Producción
 * Flujo del jugador: elegir 2 ESPECIALIDADES -> investigar -> diseñar componente
 *                    -> diseñar nave -> fabricar / vender UNIDADES ya hechas a otros.
 * No hay licencias: lo que no puedes fabricar lo compras hecho en el Mercado.
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
    <p class="small center" style="margin:8px 0 0">:research: <b>${fmt(store.me.research)} PI</b> · +${store.me.economy.research}/ciclo</p></div>
    ${subtabs([['research', ':research: Investigación'], ['components', ':chip: Componentes'], ['designs', ':fleet: Diseños'], ['production', ':b_fabrica: Producción']], sub)}
    <div id="pj-body"></div>`;
  const body = root.querySelector('#pj-body');
  ({ research, components, designs, production })[sub](body);
}

/* ---------- Árbol tecnológico ---------- */
function specBanner(me) {
  const slots = GD.RULES.specSlots, spec = me.spec || [];
  if (spec.length < slots) return `<div class="card warn-card"><h3>:spec: Elige tus ${slots} especialidades</h3>
    <p class="small">No puedes investigarlo todo: solo las ramas que elijas. <b>Lo demás lo compras ya fabricado a otras naciones</b> (Mercado). Piensa con quién te vas a aliar.</p>
    <button class="btn primary block" id="pickspec">:spec: Elegir especialidades</button></div>`;
  return `<div class="card flat"><p class="small" style="margin:0">:spec: Tus especialidades: ${spec.map(k => '<b>' + GD.TECH_BRANCHES[k].icon + ' ' + GD.TECH_BRANCHES[k].name + '</b>').join(' y ')}. El resto de ramas hay que comprarlo hecho en el <b>Mercado</b>.</p></div>`;
}
function specPicker() {
  const sel = new Set(store.me.spec || []), slots = GD.RULES.specSlots;
  const keys = Object.keys(GD.TECH_BRANCHES).filter(k => GD.TECH_BRANCHES[k].spec);
  openModal(`<h3>:spec: Especialidades</h3>
    <p class="small muted">Elige exactamente <b>${slots}</b>. Solo podrás investigar a fondo esas ramas. Solo se puede corregir mientras no hayas investigado nada en ellas.</p>
    ${keys.map(k => { const B = GD.TECH_BRANCHES[k]; return `<div class="list-item" data-k="${k}" style="cursor:pointer"><div class="ico-lg">${B.icon}</div><div class="grow"><b>${B.name}</b><span class="small muted">${esc(B.desc)}</span></div><span class="pill" data-ck="${k}"></span></div>`; }).join('')}
    <div class="spacer"></div><button class="btn primary block" id="ok"></button>`, m => {
    const upd = () => {
      m.querySelectorAll('[data-ck]').forEach(e => { e.innerHTML = sel.has(e.dataset.ck) ? ':check: elegida' : ''; });
      const ok = m.querySelector('#ok'); ok.textContent = sel.size === slots ? 'Confirmar especialidades' : `Elige ${slots - sel.size} más`; ok.disabled = sel.size !== slots;
    };
    m.querySelectorAll('[data-k]').forEach(e => e.onclick = () => { const k = e.dataset.k; if (sel.has(k)) sel.delete(k); else if (sel.size < slots) sel.add(k); upd(); });
    upd();
    m.querySelector('#ok').onclick = async () => { if ((await action('chooseSpec', { branches: [...sel] })).ok) closeModal(); };
  });
}
function research(body) {
  const me = store.me;
  const techs = GD.TECHS.filter(t => t.branch === branch);
  const locked = k => GD.TECH_BRANCHES[k].spec && !(me.spec || []).includes(k);
  body.innerHTML = specBanner(me) + `<div class="subtabs">${Object.keys(GD.TECH_BRANCHES).map(k => `<button data-branch="${k}" class="${k === branch ? 'active' : ''}">${locked(k) ? ':lock:' : GD.TECH_BRANCHES[k].icon} ${GD.TECH_BRANCHES[k].name}</button>`).join('')}</div>
    <p class="small muted" style="margin:6px 2px">${esc(GD.TECH_BRANCHES[branch].desc)}${locked(branch) ? ' <b class="warn">No es tu especialidad: compra esas unidades en el Mercado.</b>' : ''}</p>
    ${techs.map(t => {
      const done = me.techs.includes(t.id);
      const reqOk = t.req.every(r => me.techs.includes(r));
      const lk = locked(t.branch) && !done;
      const cls = done ? 'done' : (reqOk && !lk) ? 'available' : 'locked';
      return `<div class="tech ${cls}"><div class="ico-lg">${done ? ':ok:' : (reqOk && !lk) ? ':unlock:' : ':lock:'}</div>
        <div class="grow"><b>${esc(t.name)}</b><div class="small muted">${esc(t.desc)}</div>
        ${t.req.length ? `<div class="small">Requiere: ${t.req.map(r => (me.techs.includes(r) ? ':check: ' : ':x: ') + GD.techById(r).name).join(', ')}</div>` : ''}</div>
        ${done ? '' : `<button class="btn small primary" data-tech="${t.id}" ${reqOk && !lk && me.research >= t.cost ? '' : 'disabled'}>${t.cost} PI</button>`}</div>`;
    }).join('')}`;
  body.querySelectorAll('[data-tech]').forEach(b => b.onclick = () => action('research', { techId: b.dataset.tech }));
  const ps = body.querySelector('#pickspec'); if (ps) ps.onclick = specPicker;
}

/* ---------- Componentes ---------- */
function myComponents() {
  return Object.values(store.state.components).filter(c => c.owner === store.me.id || c.public);
}
function components(body) {
  const me = store.me;
  const unlocked = Object.keys(GD.COMPONENT_TYPES).filter(k => me.techs.some(t => (GD.techById(t).unlocks || {}).component === k));
  const list = myComponents().sort((a, b) => (a.public ? 1 : 0) - (b.public ? 1 : 0));
  body.innerHTML = `<div class="card"><h3>:chip: Nuevo componente</h3>
    <p class="small muted">Elige un tipo y reparte hasta <b>${me.componentCap}</b> puntos. Tus componentes son tuyos: otras naciones solo pueden tener las unidades que tú les vendas.</p>
    <div class="grid">${unlocked.map(k => { const T = GD.COMPONENT_TYPES[k]; return `<button class="btn" data-newcomp="${k}">${T.icon} ${T.name}</button>`; }).join('')}</div></div>
    <div class="card"><h3>Mis componentes</h3>${list.map(compRow).join('')}</div>`;
  body.querySelectorAll('[data-newcomp]').forEach(b => b.onclick = () => componentDesigner(b.dataset.newcomp));
}
function compStatText(c) {
  const s = c.stats || GD.componentStats(c), T = GD.COMPONENT_TYPES[c.type];
  const main = T.slot === 'arma' ? `:battle: Daño ${s.value.toFixed(1)} (${T.dmgType || 'tropa'})` : T.stat === 'speed' ? `:engine: Velocidad +${s.value.toFixed(1)}` : `${T.icon} ${({ armor: 'Blindaje', shield: 'Escudo', pd: 'Def. puntual', sensors: 'Sensores', ecm: 'Interferencia', cooling: 'Disipación de calor' })[T.stat]} ${s.value.toFixed(1)}`;
  return `${main} · :target: Fiab. ${pct(s.reliability)} · ${costHTML(s.unitCost)}`;
}
function compRow(c) {
  const T = GD.COMPONENT_TYPES[c.type];
  return `<div class="list-item"><div class="ico-lg">${T.icon}</div><div class="grow"><b>${esc(c.name)}</b>
    <span class="small muted">${T.name} · ${c.public ? 'Consorcio' : c.owner === store.me.id ? 'Tuyo' : esc(nationName(c.owner))}</span><br><span class="small">${compStatText(c)}</span></div>
    ${c.status === 'developing' ? `<span class="pill warn">:time: ${timeLeft(c.readyAt)}</span>` : ''}</div>`;
}
function componentDesigner(type) {
  const T = GD.COMPONENT_TYPES[type], cap = store.me.componentCap;
  const pts = { potencia: Math.round(cap * 0.5), fiabilidad: Math.round(cap * 0.3), eficiencia: cap - Math.round(cap * 0.5) - Math.round(cap * 0.3) };
  openModal(`<h3>${T.icon} Diseñar: ${T.name}</h3>
    <label>Nombre</label><input type="text" id="cn" maxlength="32" placeholder="Ej: Láser Tormenta X-2">
    <p class="small muted">Puntos: <b id="left"></b> / ${cap}</p>
    ${['potencia', 'fiabilidad', 'eficiencia'].map(k => `<div class="point-row"><span>${({ potencia: ':battle: Potencia', fiabilidad: ':target: Fiabilidad', eficiencia: ':price: Eficiencia' })[k]}</span><input type="range" data-pt="${k}" min="${k === 'potencia' ? 1 : 0}" max="${cap}" value="${pts[k]}"><b data-v="${k}"></b></div>`).join('')}
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
      m.querySelector('#go').innerHTML = `:lab: Desarrollar (₡${fmt(dev.credits)} · ${dev.minutes} min)`;
    };
    m.querySelectorAll('[data-pt]').forEach(r => r.oninput = () => { pts[r.dataset.pt] = +r.value; upd(r.dataset.pt); });
    upd();
    m.querySelector('#go').onclick = async () => { if ((await action('designComponent', { type, name: m.querySelector('#cn').value, points: pts })).ok) closeModal(); };
  });
}

/* ---------- Diseños de naves / tropas ---------- */
function canBuild(d) { const me = store.me; return d.status === 'ready' && (d.public || d.owner === me.id); }
/** Diseños que ya tienes en alguna flota propia (aunque los haya fabricado otro: los compraste) */
function ownedUnits(designId) { let n = 0; for (const f of Object.values(store.state.fleets)) if (f.owner === store.me.id && f.units) n += f.units[designId] || 0; return n; }
function designs(body) {
  const me = store.me;
  const hulls = Object.keys(GD.HULLS).filter(h => me.techs.some(t => (GD.techById(t).unlocks || {}).hull === h));
  const list = Object.values(store.state.designs).filter(d => d.owner === me.id || d.public || ownedUnits(d.id) > 0);
  body.innerHTML = `<div class="card"><h3>:build: Nuevo proyecto de nave / tropa</h3>
    <div class="grid">${hulls.map(h => `<button class="btn" data-hull="${h}">${GD.HULLS[h].icon} ${GD.HULLS[h].name}</button>`).join('')}</div></div>
    <div class="grid desk-3">${list.map(designCard).join('')}</div>`;
  body.querySelectorAll('[data-hull]').forEach(b => b.onclick = () => shipDesigner(b.dataset.hull));
  body.querySelectorAll('[data-dinfo]').forEach(b => b.onclick = () => designInfo(b.dataset.dinfo));
}
function designCard(d) {
  const H = GD.HULLS[d.hull];
  const tag = d.public ? 'Consorcio' : d.owner === store.me.id ? 'Tuyo' : 'Comprado a ' + nationName(d.owner);
  return `<div class="card flat planet-card" data-dinfo="${d.id}">
    <span class="tag">${esc(d.name)}</span>
    <img class="pimg" src="${shipThumb(d.hull, colorHex())}">
    <div class="desc">${H.icon} ${H.name} · :power: Poder ${d.stats.power}</div>
    <div class="small" style="margin-top:4px">${d.status === 'developing' ? `<span class="pill warn">:time: ${timeLeft(d.readyAt)}</span>` : `<span class="pill">${tag}</span>`}</div></div>`;
}
function colorHex() { return store.me.flag.colors; }

function statBlock(s) {
  if (s.domain === 'ground') return `<ul class="stat-list"><li><span>:war: Ataque terrestre</span><b>${s.groundAttack}</b></li><li><span>:shield: Defensa terrestre</span><b>${s.groundDefense}</b></li>
    <li><span>:ruler: Tamaño (espacio en transporte)</span><b>${s.size}</b></li><li><span>:price: Coste unidad</span><b>${costHTML(s.unitCost)}</b></li><li><span>:wrench: Mantenimiento</span><b>₡${s.upkeep}</b></li></ul>`;
  const dmg = t => s.weapons.filter(w => w.dmgType === t).reduce((a, w) => a + w.dmg, 0).toFixed(0);
  return `<ul class="stat-list">
    <li><span>:heart: Casco</span><b>${s.hp}</b></li><li><span>:fleet: Velocidad</span><b>${s.speed.toFixed(1)}</b></li>
    <li><span>:c_laser: Daño energía / :gear: cinético / :c_torpedo: explosivo</span><b>${dmg('energia')} / ${dmg('cinetico')} / ${dmg('explosivo')}</b></li>
    <li><span>:c_blindaje: Blindaje · :c_escudo: Escudo · :target: Def. puntual</span><b>${Math.round(s.armor)} · ${Math.round(s.shield)} · ${Math.round(s.pd)}</b></li>
    <li><span>:radar: Sensores · :signal: Interferencia</span><b>${Math.round(s.sensors)} · ${Math.round(s.ecm)}</b></li>
    ${s.capacity ? `<li><span>:troops: Capacidad de tropas</span><b>${s.capacity}</b></li>` : ''}
    ${s.hangar ? `<li><span>:h_caza: Hangar</span><b>${s.hangar}</b></li>` : ''}
    ${s.cooling ? `<li><span>:heat: Disipación de calor</span><b>+${Math.round(s.cooling)}</b></li>` : ''}
    <li><span>:target: Fiabilidad media</span><b>${pct(s.reliability)}</b></li>
    <li><span>:price: Coste unidad</span><b>${costHTML(s.unitCost)}</b></li><li><span>:wrench: Mantenimiento</span><b>₡${s.upkeep}/ciclo</b></li></ul>`;
}

function shipDesigner(hull) {
  const H = GD.HULLS[hull];
  const avail = Object.values(store.state.components).filter(c => c.status === 'ready' && (c.public || c.owner === store.me.id)
    && (H.slots[GD.COMPONENT_TYPES[c.type].slot] || 0) > 0 && (H.domain === 'ground' || !GD.COMPONENT_TYPES[c.type].groundOnly)
    && !(hull === 'infanteria' && GD.COMPONENT_TYPES[c.type].slot === 'arma' && !GD.COMPONENT_TYPES[c.type].groundOnly));
  const chosen = { arma: [], defensa: [], motor: [], sistema: [] };
  let preview = null;
  const lookup = id => store.state.components[id];
  openModal(`<h3>${H.icon} Proyecto: ${H.name}</h3>
    <canvas class="ship-preview" id="sp"></canvas>
    <label>Nombre del diseño</label><input type="text" id="dn" maxlength="32" placeholder="Ej: Destructor Clase Furia">
    <div id="slots"></div>
    <div class="card flat" id="ds"></div>
    <label>Descripción (para el mercado)</label><input type="text" id="dd" maxlength="200" placeholder="Rápido y letal...">
    <div class="spacer"></div><button class="btn primary block" id="go">:build: Iniciar proyecto (₡${fmt(H.devCost)} · ${H.devMinutes} min)</button>`, m => {
    preview = new InteractiveScene(m.querySelector('#sp'), { pan: false, tilt: 0.5, zoom: 90, minZoom: 40, maxZoom: 200, center: [0, 0] });
    buildShipPreview(preview, hull, colorHex()); preview.start();
    const draw = () => {
      m.querySelector('#slots').innerHTML = ['arma', 'defensa', 'motor', 'sistema'].filter(k => H.slots[k]).map(k => `
        <label>${({ arma: ':battle: Armas', defensa: ':shield: Defensa', motor: ':engine: Motores', sistema: ':radar: Sistemas' })[k]} (${chosen[k].length}/${H.slots[k]}${H.minSlots[k] ? ', mín ' + H.minSlots[k] : ''})</label>
        <div class="slot-row">${chosen[k].map((cid, i) => `<div class="slot filled" data-rm="${k}:${i}">${GD.COMPONENT_TYPES[lookup(cid).type].icon} ${esc(lookup(cid).name)} :close:</div>`).join('')}
        ${chosen[k].length < H.slots[k] ? `<select data-add="${k}"><option value="">+ Añadir…</option>${avail.filter(c => GD.COMPONENT_TYPES[c.type].slot === k).map(c => `<option value="${c.id}">${GD.COMPONENT_TYPES[c.type].icon} ${esc(c.name)} (P${c.points.potencia}/F${c.points.fiabilidad}/E${c.points.eficiencia})</option>`).join('')}</select>` : ''}</div>`).join('');
      const design = { hull, components: [].concat(chosen.arma, chosen.defensa, chosen.motor, chosen.sistema) };
      const err = GD.validateDesign(design, lookup);
      const s = GD.designStats(design, lookup);
      m.querySelector('#ds').innerHTML = statBlock(s) + `<p class="center"><b>:power: Poder: ${s.power}</b></p>` + (err ? `<p class="small bad">${esc(err)}</p>` : '');
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

/** Ficha de un diseño: stats, fabricar (solo diseños tuyos o del Consorcio) y vender unidades ya fabricadas */
export function designInfo(id) {
  const d = store.state.designs[id]; if (!d) return;
  const H = GD.HULLS[d.hull], me = store.me, s = d.stats;
  const mine = d.owner === me.id;
  const okPlanets = Object.values(store.state.planets).filter(p => p.owner === me.id && (H.domain === 'space' ? p.buildings.astillero : p.buildings.cuartel));
  const have = ownedUnits(id);
  const offers = Object.values(store.state.market).filter(o => o.kind === 'units' && o.designId === id && o.seller === me.id);
  openModal(`<div class="center"><span class="tag">${esc(d.name)}</span><img src="${shipThumb(d.hull, colorHex())}" style="width:140px;height:140px;display:block;margin:6px auto"></div>
    <p class="small center muted">${H.icon} ${H.name} · Fabricante: ${d.owner ? flagHTML(d.owner, 18, 12) + ' ' + esc(nationName(d.owner)) : 'Consorcio Galáctico'}</p>
    ${d.description ? `<p class="center">"${esc(d.description)}"</p>` : ''}
    <p class="small"><b>Componentes:</b> ${d.components.map(c => { const x = store.state.components[c]; return x ? GD.COMPONENT_TYPES[x.type].icon + ' ' + esc(x.name) : '?'; }).join(', ')}</p>
    ${statBlock(s)}
    <p class="small">:fleet: Tienes <b>${have}</b> unidades de este diseño en tus flotas.</p>
    ${canBuild(d) ? `<h3>:b_fabrica: Fabricar</h3>${okPlanets.length ? `
      <label>Planeta</label><select id="pp">${okPlanets.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select>
      <label>Cantidad: <b id="qv">1</b></label><input type="range" id="q" min="1" max="200" value="1">
      <p>Total: <span id="tot"></span></p><button class="btn primary block" id="mk">Fabricar</button>` : `<p class="small warn">Necesitas un ${H.domain === 'space' ? 'Astillero orbital' : 'Academia militar'} en algún planeta.</p>`}` : d.status === 'developing' ? `<p class="warn">:time: En desarrollo: ${timeLeft(d.readyAt)}</p>` : '<p class="muted">No puedes fabricar este diseño: solo su creador. Si quieres más unidades, compralas en el <b>Mercado</b>.</p>'}
    ${offers.map(o => `<p class="small good">:market: ${o.count} unidades a la venta por ₡${fmt(o.price)}</p><button class="btn small danger" data-unsell="${o.id}">Retirar oferta</button>`).join('')}
    ${have > 0 && d.status === 'ready' ? `<h3>:market: Vender unidades</h3><p class="small muted">Vendes unidades que ya tienes. El comprador las recibe en uno de sus planetas tras el viaje. El precio es por el lote.</p>
      <button class="btn good block" id="sellu">Preparar venta</button>` : ''}`, m => {
    const q = m.querySelector('#q');
    if (q) {
      const upd = () => { m.querySelector('#qv').textContent = q.value; m.querySelector('#tot').innerHTML = costHTML(s.unitCost, +q.value); };
      q.oninput = upd; upd();
      m.querySelector('#mk').onclick = async () => { if ((await action('produce', { designId: id, planetId: m.querySelector('#pp').value, count: q.value })).ok) closeModal(); };
    }
    m.querySelectorAll('[data-unsell]').forEach(b => b.onclick = async () => { if ((await action('marketCancel', { id: b.dataset.unsell })).ok) closeModal(); });
    const su = m.querySelector('#sellu'); if (su) su.onclick = () => sellUnitsModal(id);
  });
}
/** Vender unidades ya fabricadas: elige flota (quieta), cantidad y precio total */
export function sellUnitsModal(designId) {
  const d = store.state.designs[designId], me = store.me, s = d.stats;
  const fleets = Object.values(store.state.fleets).filter(f => f.owner === me.id && !f.path && !f.battle && f.units && (f.units[designId] || 0) > 0);
  if (!fleets.length) return openModal('<h3>:market: Vender unidades</h3><p class="warn">No tienes unidades de este diseño en una flota quieta y fuera de combate.</p>');
  openModal(`<h3>:market: Vender ${esc(d.name)}</h3>
    <label>Flota</label><select id="fl">${fleets.map(f => `<option value="${f.id}">${esc(f.name)} · ${esc(store.state.systems[f.system].name)} (${f.units[designId]})</option>`).join('')}</select>
    <label>Cantidad: <b id="cv">1</b></label><input type="range" id="cn" min="1" max="${fleets[0].units[designId]}" value="1">
    <label>Precio total (₡)</label><input type="number" id="pr" value="${Math.round((s.unitCost.credits || 500) * 1.2)}">
    <p class="small muted">Coste de fabricarla: ₡${fmt(s.unitCost.credits || 0)} cada una. Pide un margen razonable o nadie te comprará.</p>
    <button class="btn primary block" id="go">Publicar en el Mercado</button>`, m => {
    const fl = m.querySelector('#fl'), cn = m.querySelector('#cn'), pr = m.querySelector('#pr');
    const sync = () => { const f = store.state.fleets[fl.value]; cn.max = f.units[designId]; if (+cn.value > +cn.max) cn.value = cn.max; m.querySelector('#cv').textContent = cn.value; };
    fl.onchange = () => { sync(); }; cn.oninput = () => { m.querySelector('#cv').textContent = cn.value; pr.value = Math.round((s.unitCost.credits || 500) * 1.2 * cn.value); };
    pr.value = Math.round((s.unitCost.credits || 500) * 1.2);
    m.querySelector('#go').onclick = async () => { if ((await action('marketPost', { kind: 'units', fleetId: fl.value, designId, count: cn.value, price: pr.value })).ok) closeModal(); };
  });
}

/* ---------- Producción ---------- */
function production(body) {
  const q = store.me.queue.slice().sort((a, b) => a.readyAt - b.readyAt);
  const devC = Object.values(store.state.components).filter(c => c.owner === store.me.id && c.status === 'developing');
  const devD = Object.values(store.state.designs).filter(d => d.owner === store.me.id && d.status === 'developing');
  body.innerHTML = `<div class="card"><h3>:b_fabrica: Cola de fabricación</h3>
    ${q.length ? q.map(i => { const d = store.state.designs[i.designId]; return `<div class="list-item"><div class="ico-lg">${GD.HULLS[d.hull].icon}</div><div class="grow"><b>${i.count}× ${esc(d.name)}</b><span class="small muted">${esc(store.state.planets[i.planetId].name)}</span></div><span class="pill warn">:time: ${timeLeft(i.readyAt)}</span></div>`; }).join('') : '<p class="muted">Nada en producción. Fabrica desde la pestaña Diseños.</p>'}</div>
    <div class="card"><h3>:lab: Proyectos en desarrollo</h3>
    ${devC.concat(devD).length ? devC.map(c => `<div class="list-item">:chip:<div class="grow"><b>${esc(c.name)}</b></div><span class="pill warn">:time: ${timeLeft(c.readyAt)}</span></div>`).join('') + devD.map(d => `<div class="list-item">:fleet:<div class="grow"><b>${esc(d.name)}</b></div><span class="pill warn">:time: ${timeLeft(d.readyAt)}</span></div>`).join('') : '<p class="muted">Ningún proyecto activo.</p>'}</div>`;
}
