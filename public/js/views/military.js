/* =====================================================================
 * VISTA: MILITAR (apartado BÉLICO)
 * Sub-pestañas: Flotas | Guerras | Informes
 * Replica el panel "Altos mandos / Fuerza espacial / Ejército" de las capturas.
 * ===================================================================== */
import { GD, store, action, fmt, esc, flagHTML, ballHTML, nationName, helpButton, subtabs, timeLeft, openModal, closeModal, relation, ago, confirmModal } from '../core.js';
import { shipThumb } from '../render3d.js';

let root, sub = 'fleets';
export function init(el) {
  root = el;
  el.addEventListener('click', e => { const b = e.target.closest('[data-sub]'); if (b) { sub = b.dataset.sub; render(); } });
  window.addEventListener('od:report', e => { window.dispatchEvent(new CustomEvent('od:goto', { detail: { view: 'military' } })); setTimeout(() => reportModal(e.detail), 200); });
}
export function show() { render(); }
export function update({ modalOpen }) { if (!modalOpen) render(); }

function render() {
  root.innerHTML = `<div class="card"><div class="row"><div class="title-box grow" style="margin:0">Mando militar</div>${helpButton('military')}</div></div>
    ${subtabs([['fleets', '🚀 Flotas'], ['wars', '⚔️ Guerras'], ['reports', '📜 Informes']], sub)}<div id="ml-body"></div>`;
  ({ fleets, wars, reports })[sub](root.querySelector('#ml-body'));
}

/* ---------- Flotas ---------- */
function fleets(body) {
  const s = store.state, me = store.me;
  const mine = Object.values(s.fleets).filter(f => f.owner === me.id);
  let space = 0, ground = 0, power = 0;
  mine.forEach(f => { space += f.info.space; ground += f.info.ground; power += f.info.power; });
  body.innerHTML = `<div class="card"><ul class="stat-list">
      <li><span>🌌 Fuerza espacial (naves)</span><b>${space}</b></li><li><span>🪖 Ejército (tropas)</span><b>${ground}</b></li>
      <li><span>⚡ Poder total</span><b>${fmt(power)}</b></li><li><span>🔧 Mantenimiento</span><b class="bad">₡${fmt(me.economy.unitUpkeep)}/ciclo</b></li></ul></div>
    ${mine.map(f => `<div class="card flat"><div class="row"><div class="grow"><b>${esc(f.name)}</b><div class="small muted">📍 ${esc(s.systems[f.system].name)}${f.path ? ' → ' + esc(s.systems[f.path[f.path.length - 1]].name) + ' (salto en ' + timeLeft(f.nextJumpAt) + ')' : ''}</div></div>
      <span class="pill">⚡ ${fmt(f.info.power)}</span></div>
      <div class="row wrap small" style="margin:8px 0">${Object.keys(f.units).map(d => { const D = s.designs[d]; return D ? `<span class="res">${GD.HULLS[D.hull].emoji} ${f.units[d]}× ${esc(D.name)}</span>` : ''; }).join('')}</div>
      ${f.info.ground ? `<div class="small muted">🪖 Tropas ${f.info.groundSize}/${f.info.capacity} capacidad de transporte${f.info.groundSize > f.info.capacity ? ' <span class="bad">(no puede moverse)</span>' : ''}</div>` : ''}
      <div class="row wrap"><button class="btn small primary" data-move="${f.id}">🧭 Mover</button>${f.path ? `<button class="btn small" data-stop="${f.id}">⏹ Parar</button>` : ''}
      <button class="btn small" data-manage="${f.id}">⚙️ Gestionar</button><button class="btn small" data-see="${f.system}">👁 Ver</button></div></div>`).join('') || '<p class="muted">No tienes flotas.</p>'}`;
  body.querySelectorAll('[data-move]').forEach(b => b.onclick = () => moveModal(b.dataset.move));
  body.querySelectorAll('[data-stop]').forEach(b => b.onclick = () => action('stopFleet', { fleetId: b.dataset.stop }));
  body.querySelectorAll('[data-manage]').forEach(b => b.onclick = () => manageModal(b.dataset.manage));
  body.querySelectorAll('[data-see]').forEach(b => b.onclick = () => { window.dispatchEvent(new CustomEvent('od:goto', { detail: { view: 'map', then: () => window.dispatchEvent(new CustomEvent('od:openSystem', { detail: b.dataset.see })) } })); });
}
function moveModal(fid) {
  const s = store.state, f = s.fleets[fid];
  const systems = Object.values(s.systems).sort((a, b) => a.name.localeCompare(b.name));
  const near = s.systems[f.system].links;
  openModal(`<h3>🧭 Mover ${esc(f.name)}</h3><p class="small muted">Desde ${esc(s.systems[f.system].name)}. Las flotas viajan por hiperrutas; si entran a un sistema con enemigos en guerra, se detienen y combaten.</p>
    <label>Vecinos</label><div class="row wrap">${near.map(l => `<button class="btn small" data-to="${l}">${esc(s.systems[l].name)}</button>`).join('')}</div>
    <label>Cualquier sistema</label><select id="to">${systems.map(x => `<option value="${x.id}">${esc(x.name)}${ownerHint(x)}</option>`).join('')}</select>
    <div class="spacer"></div><button class="btn primary block" id="go">🚀 Iniciar viaje</button>`, m => {
    const go = async to => { if ((await action('moveFleet', { fleetId: fid, to })).ok) closeModal(); };
    m.querySelectorAll('[data-to]').forEach(b => b.onclick = () => go(b.dataset.to));
    m.querySelector('#go').onclick = () => go(m.querySelector('#to').value);
  });
}
function ownerHint(sys) {
  const owners = [...new Set(sys.planets.map(p => store.state.planets[p].owner).filter(Boolean))];
  return owners.length ? ' — ' + owners.map(o => nationName(o)).join(', ') : '';
}
function manageModal(fid) {
  const s = store.state, f = s.fleets[fid];
  const others = Object.values(s.fleets).filter(o => o.owner === f.owner && o.id !== fid && o.system === f.system && !o.path);
  openModal(`<h3>⚙️ ${esc(f.name)}</h3>
    <label>Nombre</label><div class="row"><input type="text" id="nm" value="${esc(f.name)}" maxlength="24"><button class="btn small" id="rn">OK</button></div>
    <h3 style="margin-top:12px">Unidades</h3>
    ${Object.keys(f.units).map(d => { const D = s.designs[d]; return `<div class="list-item"><img src="${shipThumb(D.hull, 0xb8c4cc)}" width="44" height="44"><div class="grow"><b>${f.units[d]}× ${esc(D.name)}</b><span class="small muted">${GD.HULLS[D.hull].name} · Poder ${D.stats.power}</span></div>
      <input type="number" data-n="${d}" value="${f.units[d]}" min="1" max="${f.units[d]}" style="width:70px"></div>
      <div class="row wrap" style="margin:-4px 0 10px">${f.path ? '' : `<button class="btn small" data-split="${d}">➗ A flota nueva</button>${others.map(o => `<button class="btn small" data-join="${d}" data-to="${o.id}">➡ ${esc(o.name)}</button>`).join('')}`}<button class="btn small danger" data-scrap="${d}">🗑</button></div>`; }).join('')}`, m => {
    const n = d => m.querySelector(`[data-n="${d}"]`).value;
    m.querySelector('#rn').onclick = () => action('renameFleet', { fleetId: fid, name: m.querySelector('#nm').value });
    m.querySelectorAll('[data-split]').forEach(b => b.onclick = async () => { await action('transferUnits', { fromId: fid, designId: b.dataset.split, count: n(b.dataset.split), newName: 'Grupo ' + Math.floor(Math.random() * 90 + 10) }); closeModal(); });
    m.querySelectorAll('[data-join]').forEach(b => b.onclick = async () => { await action('transferUnits', { fromId: fid, toId: b.dataset.to, designId: b.dataset.join, count: n(b.dataset.join) }); closeModal(); });
    m.querySelectorAll('[data-scrap]').forEach(b => b.onclick = async () => { if (await confirmModal('¿Desmantelar estas unidades?', 'Desmantelar', true)) action('scrap', { fleetId: fid, designId: b.dataset.scrap, count: n(b.dataset.scrap) }); });
  });
}

/* ---------- Guerras ---------- */
function wars(body) {
  const s = store.state, me = store.me;
  const active = Object.values(s.wars).filter(w => w.active);
  const ended = Object.values(s.wars).filter(w => !w.active).slice(-10).reverse();
  const nations = Object.values(s.nations).filter(n => n.alive && n.id !== me.id);
  body.innerHTML = `<div class="card"><h3>⚔️ Guerras activas</h3>
    ${active.length ? active.map(w => warRow(w)).join('') : '<p class="muted">La galaxia está en paz… por ahora.</p>'}</div>
    <div class="card"><h3>🎯 Declarar guerra</h3><p class="small muted">Se anuncia a toda la galaxia. Tus enemigos pueden pedir ayuda a sus aliados.</p>
      <select id="wt">${nations.map(n => `<option value="${n.id}">${esc(n.name)} ${relation(n.id) === 'ally' ? '(aliado)' : ''}</option>`).join('')}</select>
      <label>Nombre de la guerra (opcional)</label><input type="text" id="wn" maxlength="40" placeholder="Ej: Guerra del Helio">
      <div class="spacer"></div><button class="btn danger block" id="dw" ${nations.length ? '' : 'disabled'}>⚔️ Declarar guerra</button></div>
    ${ended.length ? `<div class="card"><h3>🕊️ Guerras terminadas</h3>${ended.map(w => `<div class="small muted">• ${esc(w.name)}</div>`).join('')}</div>` : ''}`;
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
    <div class="row wrap">${inIt ? `<button class="btn small" data-peace="${w.id}">🕊️ Proponer paz</button><button class="btn small" data-warchat="${w.id}">💬 Chat de guerra</button>`
      : `<button class="btn small" data-join="${w.id}" data-side="attackers">Unirse a atacantes</button><button class="btn small" data-join="${w.id}" data-side="defenders">Unirse a defensores</button>`}</div></div>`;
}

/* ---------- Informes de batalla ---------- */
function reports(body) {
  const list = Object.values(store.state.reports).sort((a, b) => b.t - a.t);
  body.innerHTML = `<div class="card">${list.length ? list.map(r => {
    const s = store.state;
    const where = r.kind === 'space' ? s.systems[r.system].name : r.planet;
    const won = r.kind === 'space' ? ((r.winner === 'A' && r.attackers.includes(store.me.id)) || (r.winner === 'B' && r.defenders.includes(store.me.id))) : r.winner === store.me.id;
    const draw = r.kind === 'space' && r.winner === 'draw';
    return `<div class="list-item" data-rep="${r.id}"><div style="font-size:1.5rem">${r.kind === 'space' ? '💥' : '🪖'}</div><div class="grow"><b>${r.kind === 'space' ? 'Batalla espacial' : 'Invasión'} en ${esc(where)}</b><span class="small muted">${ago(r.t)}</span></div>
      <span class="pill ${draw ? 'warn' : won ? 'good' : 'bad'}">${draw ? 'Empate' : won ? 'Victoria' : 'Derrota'}</span></div>`;
  }).join('') : '<p class="muted">Sin batallas todavía.</p>'}</div>`;
  body.querySelectorAll('[data-rep]').forEach(el => el.onclick = () => reportModal(el.dataset.rep));
}
function reportModal(id) {
  const r = store.state.reports[id]; if (!r) return;
  const s = store.state;
  if (r.kind === 'ground') {
    openModal(`<h3>🪖 Invasión de ${esc(r.planet)}</h3><p>${flagHTML(r.attacker)} ${esc(nationName(r.attacker))} atacó a ${flagHTML(r.defender)} ${esc(nationName(r.defender))}</p>
      <p><b>Ganador:</b> ${esc(nationName(r.winner))}</p>
      ${r.rounds.map(x => `<div class="small">Ronda ${x.round}: ataque ${x.atk} · defensa ${x.def} · milicia restante ${x.militia}</div>`).join('')}`);
    return;
  }
  const res = r.result;
  const side = (label, list, groups) => `<div class="report-side"><b>${label}:</b> ${list.map(n => flagHTML(n, 20, 14) + ' ' + esc(nationName(n))).join(', ')}
    ${groups.map(g => `<div class="row small"><span class="grow">${esc(g.name)}</span><span>${g.start} → <b>${g.end}</b> ${g.end < g.start ? `<span class="loss">(-${g.start - g.end})</span>` : ''}</span></div>`).join('')}</div>`;
  openModal(`<h3>💥 Batalla de ${esc(s.systems[r.system].name)}</h3>
    <p class="center"><b>${res.winner === 'draw' ? '⚖️ Sin vencedor claro' : '🏆 Vence: ' + (res.winner === 'A' ? 'Atacantes' : 'Defensores')}</b></p>
    ${side('⚔️ Atacantes', r.attackers, res.A)}${side('🛡️ Defensores', r.defenders, res.B)}
    <h3>Desarrollo</h3>
    ${res.rounds.map(x => `<div class="small" style="margin:4px 0">Ronda ${x.round} <span class="pill">${({ larga: '🔭 Larga', media: '🎯 Media', corta: '💢 Corta' })[x.phase]}</span><br>
      ⚔️ Daño ${x.A.dealt}${x.A.intercepted ? ' (interceptado ' + x.A.intercepted + ')' : ''} · 🛡️ Daño ${x.B.dealt}${x.B.intercepted ? ' (interceptado ' + x.B.intercepted + ')' : ''}</div>`).join('')}
    <p class="small muted">Si nadie fue destruido por completo, la batalla se reanuda en 20 segundos mientras ambas flotas sigan en el sistema.</p>`);
}
