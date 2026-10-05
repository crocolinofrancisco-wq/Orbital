/* =====================================================================
 * VISTA: MILITAR (apartado BÉLICO)
 * Sub-pestañas: Flotas | Objetivos | Guerras | Informes
 * - Flotas: cada flota tiene botones grandes MOVER / ATACAR / INVADIR /
 *   EMBARCAR (los mismos que al tocarla en el mapa).
 * - Objetivos: lista de blancos alcanzables (piratas, flotas y planetas
 *   enemigos) con comparación de poder y un botón para atacar directo.
 * - Informes: repetición 3D de cada batalla.
 * ===================================================================== */
import { GD, store, action, fmt, esc, flagHTML, ballHTML, nationName, nationTag, isNpc, nation, helpButton, subtabs, timeLeft, openModal, closeModal, relation, ago, confirmModal, REL_LABEL } from '../core.js';
import { shipThumb, mainHull, planetThumb } from '../render3d.js';
import { startOrder, fleetSheet, nationInfo } from './map.js';

let root, sub = 'fleets';
export function init(el) {
  root = el;
  el.addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (b) { sub = b.dataset.sub; render(); } });
  window.addEventListener('od:report', e => { window.dispatchEvent(new CustomEvent('od:goto', { detail: { view: 'military' } })); setTimeout(() => reportModal(e.detail), 200); });
}
export function show() { render(); }
export function update({ modalOpen }) { if (!modalOpen) render(); }

function render() {
  if (!store.me) return;
  root.innerHTML = `<div class="card"><div class="row"><div class="title-box grow" style="margin:0">Mando militar</div>${helpButton('military')}</div></div>
    ${subtabs([['fleets', ':fleet: Flotas'], ['live', ':live: En vivo' + liveBadge()], ['targets', ':target: Objetivos'], ['wars', ':war: Guerras'], ['reports', ':scroll: Informes']], sub)}<div id="ml-body"></div>`;
  ({ fleets, live, targets, wars, reports })[sub](root.querySelector('#ml-body'));
}

const liveBadge = () => { const n = (store.state.battles || []).length; return n ? ' <span class="pill bad">' + n + '</span>' : ''; };

/* ---------- En vivo: batallas en curso ---------- */
function live(body) {
  const s = store.state, me = store.me;
  const list = (s.battles || []).slice().sort((a, b) => b.startedAt - a.startedAt);
  const names = ids => ids.map(id => flagHTML(id, 18, 12) + ' ' + esc(nationName(id))).join(', ');
  body.innerHTML = `<div class="card"><h3>:live: Batallas en curso</h3>
    ${list.length ? list.map(b => {
      const mine = b.A.includes(me.id) || b.B.includes(me.id);
      return `<div class="list-item" style="display:block"><div class="row"><div class="ico-lg">:battle:</div><div class="grow"><b>${esc(s.systems[b.system].name)}</b> ${mine ? '<span class="pill bad">Tu flota</span>' : '<span class="pill">Espectador</span>'}
        <div class="small muted">${Math.round(b.t)} s · ${b.env === 'none' ? 'espacio abierto' : b.env === 'nebula' ? 'nebulosa' : b.env === 'asteroids' ? 'campo de asteroides' : 'agujero negro'}</div></div>
        <button class="btn small ${mine ? 'danger' : ''}" data-watch="${b.id}">:live: ${mine ? 'Mandar' : 'Ver'}</button></div>
        <div class="row wrap small" style="margin-top:6px"><span>${names(b.A)}</span><b class="bad">VS</b><span>${names(b.B)}</span></div>
        <div class="row" style="margin-top:6px;gap:4px"><div class="bar grow"><i style="width:${b.hp.A}%;background:var(--good)"></i></div><div class="bar grow"><i style="width:${b.hp.B}%;background:var(--bad)"></i></div></div></div>`;
    }).join('') : '<p class="muted">No hay batallas ahora mismo. Cuando tus flotas se encuentren con el enemigo, aparecerá aquí un aviso rojo.</p>'}
    <div class="tip small">:info: Puedes <b>mirar cualquier batalla</b> de un sistema que veas. Si es tuya, elige un escuadrón y dale <b>tácticas</b>: Atacar, Mantener, Distancia o Retirada, y toca a un enemigo para concentrar el fuego.</div></div>`;
  body.querySelectorAll('[data-watch]').forEach(b => b.onclick = () => window.dispatchEvent(new CustomEvent('od:battle', { detail: b.dataset.watch })));
}

/* ---------- Flotas ---------- */
function fleets(body) {
  const s = store.state, me = store.me;
  const mine = Object.values(s.fleets).filter(f => f.owner === me.id);
  let space = 0, ground = 0, power = 0;
  mine.forEach(f => { space += f.info.space; ground += f.info.ground; power += f.info.power; });
  body.innerHTML = `<div class="card"><ul class="stat-list">
      <li><span>:galaxy: Fuerza espacial (naves)</span><b>${space}</b></li><li><span>:troops: Ejército (tropas)</span><b>${ground}</b></li>
      <li><span>:power: Poder total</span><b>${fmt(power)}</b></li><li><span>:wrench: Mantenimiento</span><b class="bad">₡${fmt(me.economy.unitUpkeep)}/ciclo</b></li></ul>
      <div class="tip small">:info: <b>¿Cómo ataco?</b> Pulsa <b>Atacar</b> en una flota y toca el sistema enemigo en el mapa. Al llegar empieza una <b>batalla en tiempo real</b>: míralá en <b>En vivo</b> y da órdenes. Para conquistar planetas usa <b>Invadir</b> (necesitas un Transporte con tropas). Empieza cazando <b class="bad">piratas</b> en Objetivos.</div></div>
    ${mine.map(f => `<div class="card flat"><div class="row"><img src="${shipThumb(mainHull(f, s), me.flag.colors)}" width="54" height="54"><div class="grow"><b>${esc(f.name)}</b><div class="small muted">:pin: ${esc(s.systems[f.system].name)}${f.path ? ' :arrow: ' + esc(s.systems[f.path[f.path.length - 1]].name) + ' (salto en ' + timeLeft(f.nextJumpAt) + ')' : ''}</div>
      ${f.mission ? `<div class="small warn">${f.mission.type === 'invade' ? ':invade: Invadir ' + esc(s.planets[f.mission.planetId].name) : ':war: Atacar'}</div>` : ''}
      ${f.battle ? `<div class="small bad">:battle: ¡En combate! <a href="#" data-watch="${f.battle}">Ver en vivo</a></div>` : ''}</div>
      <span class="pill">:power: ${fmt(f.info.power)}</span></div>
      <div class="row wrap small" style="margin:8px 0">${Object.keys(f.units).map(d => { const D = s.designs[d]; return D ? `<span class="res">${GD.HULLS[D.hull].icon} ${f.units[d]}× ${esc(D.name)}</span>` : ''; }).join('')}</div>
      ${f.info.ground || f.info.capacity ? `<div class="small muted">:troops: Tropas ${f.info.groundSize}/${f.info.capacity} capacidad${f.info.groundSize > f.info.capacity ? ' <span class="bad">(faltan transportes)</span>' : ''}</div>` : ''}
      ${f.info.space ? `<div class="order-grid">
        <button class="btn order" data-o="move" data-f="${f.id}">:compass:<span>Mover</span></button>
        <button class="btn order danger" data-o="attack" data-f="${f.id}">:war:<span>Atacar</span></button>
        <button class="btn order danger" data-o="invade" data-f="${f.id}">:invade:<span>Invadir</span></button>
        <button class="btn order" data-embark="${f.id}" ${f.info.capacity ? '' : 'disabled'}>:troops:<span>Embarcar</span></button></div>`
      : '<p class="small muted">Guarnición terrestre: defiende el planeta. Para moverla, usa "Embarcar" desde una flota con Transporte en este sistema.</p>'}
      <div class="row wrap">${f.path ? `<button class="btn small" data-stop="${f.id}">:stop: Parar</button>` : ''}<button class="btn small" data-manage="${f.id}">:gear: Gestionar</button><button class="btn small" data-see="${f.system}">:eye: Ver en mapa</button></div></div>`).join('') || '<p class="muted">No tienes flotas.</p>'}`;
  body.querySelectorAll('[data-watch]').forEach(b => b.onclick = e => { e.preventDefault(); window.dispatchEvent(new CustomEvent('od:battle', { detail: b.dataset.watch })); });
  body.querySelectorAll('[data-o]').forEach(b => b.onclick = () => startOrder(b.dataset.f, b.dataset.o));
  body.querySelectorAll('[data-embark]').forEach(b => b.onclick = () => action('embark', { fleetId: b.dataset.embark }));
  body.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => action('stopFleet', { fleetId: b.dataset.stop }));
  body.querySelectorAll('[data-manage]').forEach(b => b.onclick = () => manageModal(b.dataset.manage));
  body.querySelectorAll('[data-see]').forEach(b => b.onclick = () => { window.dispatchEvent(new CustomEvent('od:goto', { detail: { view: 'map', then: () => window.dispatchEvent(new CustomEvent('od:openSystem', { detail: b.dataset.see })) } })); });
}
function manageModal(fid) {
  const s = store.state, f = s.fleets[fid];
  const others = Object.values(s.fleets).filter(o => o.owner === f.owner && o.id !== fid && o.system === f.system && !o.path);
  openModal(`<h3>:gear: ${esc(f.name)}</h3>
    <label>Nombre</label><div class="row"><input type="text" id="nm" value="${esc(f.name)}" maxlength="24"><button class="btn small" id="rn">OK</button></div>
    ${f.info.ground && !f.path ? '<div class="spacer"></div><button class="btn small" id="dis">:troops: Desembarcar tropas aquí</button>' : ''}
    <h3 style="margin-top:12px">Unidades</h3>
    ${Object.keys(f.units).map(d => { const D = s.designs[d]; return `<div class="list-item"><img src="${shipThumb(D.hull, store.me.flag.colors)}" width="44" height="44"><div class="grow"><b>${f.units[d]}× ${esc(D.name)}</b><span class="small muted">${GD.HULLS[D.hull].name} · :power: ${D.stats.power}</span></div>
      <input type="number" data-n="${d}" value="${f.units[d]}" min="1" max="${f.units[d]}" style="width:70px"></div>
      <div class="row wrap" style="margin:-4px 0 10px">${f.path ? '' : `<button class="btn small" data-split="${d}">:split: A flota nueva</button>${others.map(o => `<button class="btn small" data-join="${d}" data-to="${o.id}">:arrow: ${esc(o.name)}</button>`).join('')}`}<button class="btn small danger" data-scrap="${d}">:trash:</button></div>`; }).join('')}`, m => {
    const n = d => m.querySelector(`[data-n="${d}"]`).value;
    m.querySelector('#rn').onclick = () => action('renameFleet', { fleetId: fid, name: m.querySelector('#nm').value });
    const dis = m.querySelector('#dis'); if (dis) dis.onclick = async () => { await action('disembark', { fleetId: fid }); closeModal(); };
    m.querySelectorAll('[data-split]').forEach(b => b.onclick = async () => { await action('transferUnits', { fromId: fid, designId: b.dataset.split, count: n(b.dataset.split), newName: 'Grupo ' + Math.floor(Math.random() * 90 + 10) }); closeModal(); });
    m.querySelectorAll('[data-join]').forEach(b => b.onclick = async () => { await action('transferUnits', { fromId: fid, toId: b.dataset.to, designId: b.dataset.join, count: n(b.dataset.join) }); closeModal(); });
    m.querySelectorAll('[data-scrap]').forEach(b => b.onclick = async () => { if (await confirmModal('¿Desmantelar estas unidades?', 'Desmantelar', true)) action('scrap', { fleetId: fid, designId: b.dataset.scrap, count: n(b.dataset.scrap) }); });
  });
}

/* ---------- Objetivos ---------- */
function hops(from, to) {
  const S = store.state.systems; if (from === to) return 0;
  const seen = { [from]: 0 }, q = [from];
  while (q.length) { const c = q.shift(); for (const l of S[c].links) if (!(l in seen)) { seen[l] = seen[c] + 1; if (l === to) return seen[l]; q.push(l); } }
  return 99;
}
function poiText(sy) {
  const out = [];
  if (sy.lair && !sy.lair.destroyed) out.push('guarida ' + (GD && sy.lair.clan) + ' nv.' + sy.lair.level);
  if (sy.ruin && !sy.ruin.claimedBy) out.push('ruinas sin saquear');
  if (sy.portal) out.push('portal → ' + (store.state.systems[sy.portal] ? store.state.systems[sy.portal].name : '?'));
  if ((sy.features || []).includes('asteroids')) out.push('cinturón rico');
  if ((sy.features || []).includes('nebula')) out.push('nebulosa');
  if (sy.hub) out.push('sistema clave (+25% PIB)');
  if (sy.choke) out.push('paso estratégico');
  return out.join(' · ');
}
function targets(body) {
  const s = store.state, me = store.me;
  const mine = Object.values(s.fleets).filter(f => f.owner === me.id && f.info.space > 0);
  const best = mine.sort((a, b) => b.info.power - a.info.power)[0];
  const capSys = s.planets[me.capital] ? s.planets[me.capital].system : null;
  const from = best ? best.system : capSys;
  const odds = p => { if (!best) return ''; const r = best.info.power / Math.max(1, p); return r > 1.6 ? '<span class="pill good">Ventaja</span>' : r > 0.9 ? '<span class="pill warn">Pareja</span>' : '<span class="pill bad">Peligro</span>'; };
  const hostileFleets = Object.values(s.fleets).filter(f => f.owner !== me.id && (relation(f.owner) === 'war')).map(f => ({ f, d: hops(from, f.system) })).sort((a, b) => a.d - b.d).slice(0, 12);
  const enemyPlanets = Object.values(s.planets).filter(p => p.owner && relation(p.owner) === 'war').map(p => ({ p, d: hops(from, p.system) })).sort((a, b) => a.d - b.d).slice(0, 10);
  const neighbours = Object.values(s.nations).filter(n => n.alive && !n.npc && n.id !== me.id && relation(n.id) === 'neutral' && !(n.protectedUntil));
  const protectedN = Object.values(s.nations).filter(n => n.alive && !n.npc && n.id !== me.id && n.protectedUntil);
  const pois = Object.values(s.systems).filter(sy => (sy.lair && !sy.lair.destroyed) || (sy.ruin && !sy.ruin.claimedBy) || sy.portal || (sy.features || []).includes('asteroids')).map(sy => ({ sy, d: hops(from, sy.id) })).sort((a, b) => a.d - b.d).slice(0, 12);
  body.innerHTML = `<div class="card"><h3>:target: Blancos (desde ${best ? esc(best.name) : 'tu capital'})</h3>
    ${best ? '' : '<p class="warn small">No tienes flotas con naves.</p>'}
    ${hostileFleets.length ? hostileFleets.map(({ f, d }) => `<div class="list-item"><img src="${shipThumb(mainHull(f, s), nationInfo(f.owner).colors)}" width="44" height="44"><div class="grow"><b>${esc(f.name)}</b>
      <span class="small muted">${esc(nationName(f.owner))}${f.kind === 'devorador' ? ' · <b class="bad">JEFE DE LA CRISIS</b>' : f.raid ? ' · <b class="warn">incursión</b>' : ''} · :pin: ${esc(s.systems[f.system].name)} · ${d} saltos · :power: ${fmt(f.info.power)}</span></div>${odds(f.info.power)}
      <button class="btn small danger" data-hit="${f.system}" ${best ? '' : 'disabled'}>:war:</button></div>`).join('') : '<p class="muted small">No hay flotas hostiles visibles. Explora o declara una guerra.</p>'}
    </div>
    <div class="card"><h3>:search: Puntos de interés</h3><p class="small muted">Guaridas pirata (botín grande), ruinas (botín único si te quedas 20 min), cinturones de asteroides (yacimiento x3, custodiados por un Leviatán) y portales de agujero negro (atajos, con riesgo).</p>
      ${pois.map(({ sy, d }) => `<div class="list-item"><div class="ico-lg">${sy.lair ? ':lair:' : sy.ruin ? ':ruins:' : sy.portal ? ':blackhole:' : ':asteroid:'}</div><div class="grow"><b>${esc(sy.name)}</b>
        <span class="small muted">${d} saltos · ${poiText(sy)}</span></div><button class="btn small" data-poi="${sy.id}">:eye:</button></div>`).join('') || '<p class="muted small">Nada a la vista.</p>'}</div>
    ${enemyPlanets.length ? `<div class="card"><h3>:invade: Planetas enemigos</h3>${enemyPlanets.map(({ p, d }) => `<div class="list-item"><img src="${planetThumb(p, GD.BIOMES[p.biome])}" width="44" height="44"><div class="grow"><b>${esc(p.name)}</b><span class="small muted">${esc(nationName(p.owner))} · ${d} saltos · :pop: ${fmt(p.pop)}M${p.defenseHp === 0 ? ' · <span class="good">defensas caídas</span>' : ''}</span></div>
      <button class="btn small danger" data-inv="${p.id}" ${best ? '' : 'disabled'}>:invade:</button></div>`).join('')}</div>` : ''}
    ${protectedN.length ? `<div class="card"><h3>:shield: Bajo protección de novatos</h3><p class="small muted">No se les puede declarar la guerra todavía.</p>${protectedN.map(n => `<div class="small">${flagHTML(n.id, 18, 12)} ${esc(n.name)}${nationTag(n.id)} · ${timeLeft(n.protectedUntil)}</div>`).join('')}</div>` : ''}
    ${neighbours.length ? `<div class="card"><h3>:globe: Naciones en paz contigo</h3><p class="small muted">Para atacarlas debes declarar la guerra (se anuncia a toda la galaxia).</p>
      ${neighbours.map(n => `<div class="list-item">${ballHTML(n.id, 32)}<div class="grow"><b>${esc(n.name)}${nationTag(n.id)}</b><span class="small muted">:planet: ${n.planets} · :gov: ₡${fmt(n.gdp)}</span></div><button class="btn small danger" data-war="${n.id}">Declarar guerra</button></div>`).join('')}</div>` : ''}`;
  body.querySelectorAll('[data-poi]').forEach(b => b.onclick = () => window.dispatchEvent(new CustomEvent('od:goto', { detail: { view: 'map', then: () => window.dispatchEvent(new CustomEvent('od:openSystem', { detail: b.dataset.poi })) } })));
  body.querySelectorAll('[data-hit]').forEach(b => b.onclick = async () => { const r = await action('moveFleet', { fleetId: best.id, to: b.dataset.hit, mission: { type: 'attack' } }); if (r.ok) render(); });
  body.querySelectorAll('[data-inv]').forEach(b => b.onclick = () => {
    const tf = Object.values(s.fleets).filter(f => f.owner === me.id && f.info.space && (f.info.capacity || f.info.ground)).sort((a, b) => b.info.power - a.info.power)[0];
    if (!tf) return openModal('<h3>:troops: Necesitas un transporte</h3><p>Para invadir, tu flota debe llevar un <b>Transporte de tropas</b> con tropas a bordo.</p><p class="small muted">1) Fabrica un Transporte (Proyectos > Diseños > Transporte "Mula").<br>2) Fabrica infantería.<br>3) En la flota, pulsa <b>Embarcar</b>.</p>');
    startOrder(tf.id, 'invade', b.dataset.inv);
  });
  body.querySelectorAll('[data-war]').forEach(b => b.onclick = async () => { if (await confirmModal('¿Declarar la guerra a <b>' + esc(nationName(b.dataset.war)) + '</b>?', 'Declarar', true)) { await action('declareWar', { targetId: b.dataset.war }); render(); } });
}

/* ---------- Guerras ---------- */
function wars(body) {
  const s = store.state, me = store.me;
  const active = Object.values(s.wars).filter(w => w.active);
  const ended = Object.values(s.wars).filter(w => !w.active).slice(-10).reverse();
  const nations = Object.values(s.nations).filter(n => n.alive && n.id !== me.id && !n.npc && !n.protectedUntil);
  body.innerHTML = `<div class="card"><h3>:war: Guerras activas</h3>
    ${active.length ? active.map(w => warRow(w)).join('') : '<p class="muted">La galaxia está en paz… por ahora.</p>'}
    <p class="small muted">:skull: Los <b>Piratas del Vacío</b> y las <b>criaturas</b> siempre son hostiles: no hace falta declararles la guerra.</p>
    ${me.protectedUntil ? '<p class="small good">:shield: Estás bajo protección de novatos: podrás declarar guerras en ' + timeLeft(me.protectedUntil) + '.</p>' : ''}</div>
    <div class="card"><h3>:target: Declarar guerra</h3><p class="small muted">Se anuncia a toda la galaxia. Tus enemigos pueden pedir ayuda a sus aliados.</p>
      <select id="wt">${nations.map(n => `<option value="${n.id}">${esc(n.name)}${n.bot ? ' (IA)' : ''} ${relation(n.id) === 'ally' ? '(aliado)' : ''}</option>`).join('')}</select>
      <label>Nombre de la guerra (opcional)</label><input type="text" id="wn" maxlength="40" placeholder="Ej: Guerra del Helio">
      <div class="spacer"></div><button class="btn danger block" id="dw" ${nations.length ? '' : 'disabled'}>:war: Declarar guerra</button></div>
    ${ended.length ? `<div class="card"><h3>:peace: Guerras terminadas</h3>${ended.map(w => `<div class="small muted">• ${esc(w.name)}</div>`).join('')}</div>` : ''}`;
  body.querySelector('#dw').onclick = async () => {
    const t = body.querySelector('#wt').value;
    if (await confirmModal('¿Declarar la guerra a <b>' + esc(nationName(t)) + '</b>?', 'Declarar', true)) action('declareWar', { targetId: t, name: body.querySelector('#wn').value });
  };
  body.querySelectorAll('[data-peace]').forEach(b => b.onclick = () => action('proposePeace', { warId: b.dataset.peace }));
  body.querySelectorAll('[data-join]').forEach(b => b.onclick = () => action('joinWar', { warId: b.dataset.join, side: b.dataset.side }));
  body.querySelectorAll('[data-warchat]').forEach(b => b.onclick = () => window.dispatchEvent(new CustomEvent('od:goto', { detail: { view: 'social', then: () => window.dispatchEvent(new CustomEvent('od:channel', { detail: 'war:' + b.dataset.warchat })) } })));
}
function warRow(w) {
  const me = store.me.id;
  const inIt = w.attackers.includes(me) || w.defenders.includes(me);
  const side = l => l.map(id => `<span class="row" style="display:inline-flex;gap:4px">${ballHTML(id, 26, 'angry')} ${esc(nationName(id))}</span>`).join(' ');
  return `<div class="list-item" style="display:block"><b>${esc(w.name)}</b> <span class="small muted">${ago(w.startedAt)}</span>
    <div class="row wrap" style="margin:6px 0"><div>${side(w.attackers)}</div><b class="bad">VS</b><div>${side(w.defenders)}</div></div>
    <div class="row wrap">${inIt ? `<button class="btn small" data-peace="${w.id}">:peace: Proponer paz</button><button class="btn small" data-warchat="${w.id}">:chat: Chat de guerra</button>`
      : `<button class="btn small" data-join="${w.id}" data-side="attackers">Unirse a atacantes</button><button class="btn small" data-join="${w.id}" data-side="defenders">Unirse a defensores</button>`}</div></div>`;
}

/* ---------- Informes de batalla ---------- */
function myWin(r) {
  if (r.kind !== 'space') return r.winner === store.me.id;
  return (r.winner === 'A' && r.attackers.includes(store.me.id)) || (r.winner === 'B' && r.defenders.includes(store.me.id));
}
function reports(body) {
  const list = Object.values(store.state.reports).sort((a, b) => b.t - a.t);
  body.innerHTML = `<div class="card">${list.length ? list.map(r => {
    const s = store.state;
    const where = r.kind === 'space' ? s.systems[r.system].name : r.planet;
    const draw = r.kind === 'space' && r.winner === 'draw', won = myWin(r);
    return `<div class="list-item" data-rep="${r.id}"><div class="ico-lg">${r.kind === 'space' ? ':battle:' : ':troops:'}</div><div class="grow"><b>${r.kind === 'space' ? 'Batalla espacial' : 'Invasión'} en ${esc(where)}</b><span class="small muted">${ago(r.t)}</span></div>
      <span class="pill ${draw ? 'warn' : won ? 'good' : 'bad'}">${draw ? 'Empate' : won ? 'Victoria' : 'Derrota'}</span></div>`;
  }).join('') : '<p class="muted">Sin batallas todavía.</p>'}</div>`;
  body.querySelectorAll('[data-rep]').forEach(el => el.onclick = () => reportModal(el.dataset.rep));
}
function reportModal(id) {
  const r = store.state.reports[id]; if (!r) return;
  const s = store.state;
  if (r.kind === 'ground') {
    const OUT = { won: 'Conquista', lost: 'Invasión rechazada', withdraw: 'Retirada', cancel: 'Campaña cancelada (fin de la guerra)' };
    const mx = Math.max(1, ...r.rounds.map(x => Math.max(x.atk, x.def)));
    openModal(`<h3>:troops: Campaña terrestre en ${esc(r.planet)}</h3><p>${flagHTML(r.attacker)} ${esc(nationName(r.attacker))} atacó a ${flagHTML(r.defender)} ${esc(nationName(r.defender))}</p>
      <p><b>${esc(OUT[r.outcome] || 'Resultado')}</b> · Ganador: ${esc(nationName(r.winner))}${r.duration ? ' · ' + Math.floor(r.duration / 60) + ' min ' + (r.duration % 60) + ' s' : ''}${r.start != null ? ' · tropas atacantes ' + r.start + ' → ' + r.end : ''}</p>
      <div class="gw-chart">${r.rounds.map(x => `<div title="Ronda ${x.round}: ataque ${x.atk} · defensa ${x.def}" style="display:inline-block;width:5px;margin-right:1px;vertical-align:bottom"><i style="display:block;height:${Math.round(x.atk / mx * 54)}px;background:var(--bad)"></i><i style="display:block;height:${Math.round(x.def / mx * 54)}px;background:var(--good);margin-top:1px"></i></div>`).join('')}</div>
      <p class="small muted">Rojo = poder atacante · Verde = poder defensor, ronda a ronda.</p>
      ${r.rounds.slice(-6).map(x => `<div class="small">Ronda ${x.round}: ataque ${x.atk} · defensa ${x.def} · milicia ${x.militia}%${x.shield != null ? ' · escudo ' + x.shield + '%' : ''}${x.au != null ? ' · tropas ' + x.au + ' vs ' + x.du : ''}</div>`).join('')}`);
    return;
  }
  const res = r.result;
  const grp = (g, side) => `<div class="row small"><span class="grow">${flagHTML(g.owner, 14, 10)} ${esc(g.name.replace(/ \(.*\)$/, ''))}</span><span>${g.start} :arrow: <b>${g.end}</b> ${g.end < g.start ? `<span class="loss">(-${g.start - g.end})</span>` : ''}${g.escaped ? ' <span class="muted">(' + g.escaped + ' huyeron)</span>' : ''}${g.surrendered ? ' <span class="good">(' + g.surrendered + ' rendidas)</span>' : ''}</span><span class="muted" title="Daño causado">:war: ${fmt(g.dealt)}</span></div>`;
  const side = (label, list, groups) => `<div class="report-side"><b>${label}:</b> ${list.map(n => flagHTML(n, 20, 14) + ' ' + esc(nationName(n))).join(', ')}${groups.map(grp).join('')}</div>`;
  const loot = r.loot && (r.loot.credits || r.loot.research) ? `<p class="small">:credits: Botín repartido: ₡${fmt(r.loot.credits)}${r.loot.research ? ' · :research: ' + r.loot.research : ''}</p>` : '';
  openModal(`<h3>:battle: Batalla de ${esc(s.systems[r.system].name)}</h3>
    <p class="center"><b>${res.winner === 'draw' ? ':balance: Sin vencedor claro' : ':trophy: Vence: ' + (res.winner === 'A' ? 'Atacantes' : 'Defensores')}</b> ${res.winner !== 'draw' ? (myWin(r) ? '<span class="pill good">Tu bando</span>' : '<span class="pill bad">Enemigo</span>') : ''}
      <span class="muted small"> · ${res.duration} s${res.timeout ? ' (tiempo agotado)' : ''}</span></p>
    ${r.replayable ? '<button class="btn primary block" id="rp-go">:replay: Ver repetición en 3D</button><div class="spacer"></div>' : ''}
    ${side(':war: Atacantes', r.attackers, res.A)}${side(':shield: Defensores', r.defenders, res.B)}${loot}
    <p class="small muted">La repetición se vuelve a simular con las mismas órdenes que se dieron: es idéntica a lo que pasó.</p>`, m => {
    const b = m.querySelector('#rp-go'); if (b) b.onclick = () => { closeModal(); window.dispatchEvent(new CustomEvent('od:replay', { detail: id })); };
  });
}
