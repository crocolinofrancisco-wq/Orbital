/* =====================================================================
 * VISTA: IMPERIO (apartado TYCOON)
 * Sub-pestañas: Resumen | Planetas | Mercado | Bandeja
 * El "Resumen" replica la ficha de nación de las capturas (RAZA HUMANA).
 * ===================================================================== */
import { GD, store, action, fmt, pct, esc, flagHTML, ballHTML, nationName, nationTag, timeLeft, helpButton, subtabs, costHTML, ago, openModal, closeModal } from '../core.js';
import { planetThumb } from '../render3d.js';
import { planetModal } from './map.js';

let root, sub = 'summary';
export function init(el) {
  root = el;
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-sub]'); if (b) { sub = b.dataset.sub; render(); }
  });
}
export function show() { render(); }
export function update({ modalOpen }) {
  // No re-dibujar mientras el usuario arrastra el slider de impuestos
  if (document.activeElement && root.contains(document.activeElement) && document.activeElement.matches('input,select')) return;
  render();
}

function render() {
  const me = store.me;
  root.innerHTML = `
    <div class="card"><div class="row"><span class="flag">${GD.flagSVG(me.flag, 54, 36)}</span>
      <div class="title-box grow" style="margin:0">${esc(me.name)}</div>${helpButton('empire')}</div>
      ${me.motto ? `<p class="center muted small" style="margin:8px 0 0">"${esc(me.motto)}"</p>` : ''}</div>
    ${subtabs([['summary', ':chart: Resumen'], ['planets', ':planet: Planetas'], ['market', ':market: Mercado'], ['inbox', ':inbox: Bandeja']], sub)}
    <div id="emp-body"></div>`;
  const body = root.querySelector('#emp-body');
  ({ summary, planets, market, inbox })[sub](body);
}

/* ---------- Resumen ---------- */
function summary(body) {
  const me = store.me, e = me.economy, st = e.stats;
  setTimeout(() => { const b = root.querySelector('#end-prot'); if (b) b.onclick = () => action('endProtection', {}); }, 0);
  const myPlanets = Object.values(store.state.planets).filter(p => p.owner === me.id);
  const cap = store.state.planets[me.capital];
  const indicator = (label, emoji, v, inverse) => {
    const good = inverse ? v < 0.2 : v > 0.6, bad = inverse ? v > 0.35 : v < 0.35;
    return `<li><span>${emoji} ${label}</span><b class="${good ? 'good' : bad ? 'bad' : 'warn'}">${pct(v)}</b></li>`;
  };
  const se = store.state.season, stand = (store.state.standings || []);
  const myPos = stand.findIndex(r => r.id === me.id) + 1;
  const seasonCard = se ? `<div class="card flat"><div class="season-bar">:calendar: <b>Día ${se.day}</b> de ~${se.days} · ${esc(se.phase.name)}<div class="bar"><i style="width:${Math.round(se.progress * 100)}%"></i></div></div>
      <div class="small muted">Temporada ${se.number}. Se gana siendo la <b>última nación o alianza en pie</b>. ${se.crisis && se.crisis.awake ? '<b class="bad">¡El Devorador estelar está despierto!</b>' : 'En la fase III despierta una criatura gigante: unirse es la clave.'}</div>
      ${myPos ? `<div class="small" style="margin-top:4px">:trophy: Tu puesto en el ranking de dominio: <b>${myPos}º</b> de ${stand.length}</div>` : ''}
      ${me.protectedUntil ? `<div class="row" style="margin-top:8px"><span class="small good grow">:shield: Protección de novatos: ${timeLeft(me.protectedUntil)} (nadie puede declararte la guerra)</span><button class="btn small danger" id="end-prot">Renunciar</button></div>` : ''}</div>` : '';
  body.innerHTML = `${seasonCard}<div class="cols">
    <div>
      <div class="card"><div class="center">${ballHTML(me.id, 80)}</div>
        <ul class="stat-list">
          <li><span>:map: Planetas</span><b>${myPlanets.length}</b></li>
          <li><span>:pop: Población</span><b>${fmt(e.pop)} M</b></li>
          <li><span>:gov: PIB</span><b>₡${fmt(e.gdp)}</b></li>
          ${indicator('Desempleo', ':job:', st.unemployment, true)}
          ${indicator('Evasión fiscal', ':evasion:', st.evasion, true)}
          ${indicator('Criminalidad', ':crime:', st.crime, true)}
          ${indicator('Pobreza', ':box:', st.poverty, true)}
          ${indicator('Popularidad', ':pop:', st.popularity)}
          ${indicator('Estabilidad', ':balance:', st.stability)}
        </ul></div>
      <div class="card"><ul class="stat-list">
        <li><span>:star: Capital</span><b>${cap ? esc(cap.name) : '-'}</b></li>
        <li><span>:ally: Alianza</span><b>${me.alliance && store.state.alliances[me.alliance] ? '[' + esc(store.state.alliances[me.alliance].tag) + '] ' + esc(store.state.alliances[me.alliance].name) : 'Ninguna'}</b></li>
        <li><span>:dagger: Traiciones</span><b>${me.betrayals}</b></li>
      </ul></div>
    </div>
    <div>
      <div class="card"><h3>:credits: Balance por ciclo</h3>
        <ul class="stat-list">
          <li><span>Impuestos recaudados</span><b class="good">+₡${fmt(e.taxIncome)}</b></li>
          <li><span>Mantenimiento edificios</span><b class="bad">-₡${fmt(e.buildUpkeep)}</b></li>
          <li><span>Mantenimiento militar</span><b class="bad">-₡${fmt(e.unitUpkeep)}</b></li>
          <li><span><b>Neto</b></span><b class="${e.net >= 0 ? 'good' : 'bad'}">${e.net >= 0 ? '+' : ''}₡${fmt(e.net)}</b></li>
          <li><span>:research: Investigación</span><b>+${e.research} PI</b></li>
          ${Object.keys(e.prod).map(r => `<li><span>${GD.RESOURCES[r].icon} ${GD.RESOURCES[r].name}</span><b>+${fmt(e.prod[r])}</b></li>`).join('')}
        </ul>
        <label>Impuestos: <b id="tax-val">${pct(me.tax)}</b></label>
        <input type="range" id="tax" min="0" max="${GD.RULES.maxTax * 100}" value="${Math.round(me.tax * 100)}">
        <p class="small muted">Impuestos altos = más dinero pero menos popularidad, más pobreza y evasión. Los cambios se reflejan en el próximo ciclo.</p>
      </div>
      <div class="card"><h3>:box: Almacén</h3><div class="grid">
        ${Object.keys(GD.RESOURCES).map(r => `<div class="center"><div class="ico-lg">${GD.RESOURCES[r].icon}</div><b>${fmt(me.resources[r] || 0)}</b><div class="small muted">${GD.RESOURCES[r].name}</div></div>`).join('')}
      </div></div>
      <div class="card"><h3>:flag: Perfil</h3><button class="btn" id="edit-profile">Editar lema</button></div>
    </div></div>`;
  const tax = body.querySelector('#tax');
  tax.oninput = () => body.querySelector('#tax-val').textContent = tax.value + '%';
  tax.onchange = () => { action('setTax', { tax: tax.value / 100 }); tax.blur(); };
  body.querySelector('#edit-profile').onclick = () => openModal(`<h3>Lema</h3><input type="text" id="pm" maxlength="60" value="${esc(me.motto)}"><div class="spacer"></div><button class="btn primary block" id="pm-ok">Guardar</button>`,
    m => m.querySelector('#pm-ok').onclick = () => { action('updateProfile', { motto: m.querySelector('#pm').value }); closeModal(); });
}

/* ---------- Planetas ---------- */
function planets(body) {
  const me = store.me;
  const list = Object.values(store.state.planets).filter(p => p.owner === me.id);
  body.innerHTML = `<div class="grid desk-3">${list.map(p => {
    const B = GD.BIOMES[p.biome];
    const nb = Object.values(p.buildings).reduce((a, b) => a + b, 0);
    return `<div class="card flat planet-card" data-pid="${p.id}">
      <span class="tag">${p.id === me.capital ? ':star: ' : ''}${esc(p.name)}</span>
      <img class="pimg" src="${planetThumb(p, B)}">
      <div class="desc">${B.icon} ${B.name} · ${GD.RESOURCES[p.deposit].icon} · :pop: ${fmt(p.pop)}M</div>
      <div class="small" style="margin-top:6px">${Object.keys(p.buildings).map(b => GD.BUILDINGS[b].icon + p.buildings[b]).join(' ')} <span class="muted">(${nb}/${p.size * 4 + 2})</span></div>
    </div>`;
  }).join('')}</div>
  <p class="small muted center">Toca un planeta para construir. Expándete anexando planetas independientes o conquistando enemigos.</p>`;
  body.querySelectorAll('[data-pid]').forEach(c => c.onclick = () => planetModal(c.dataset.pid));
}

/* ---------- Mercado ---------- */
function market(body) {
  const s = store.state, me = store.me;
  const orders = Object.values(s.market).sort((a, b) => b.t - a.t);
  body.innerHTML = `
    <div class="card"><h3>:bank: Consorcio Galáctico (NPC)</h3>
      <p class="small muted">Compra caro (+10%) y vende barato (-20%). El precio sube cuando muchos compran. Comerciar con jugadores siempre es mejor negocio.</p>
      ${Object.keys(GD.RESOURCES).map(r => `<div class="list-item"><div class="ico-lg">${GD.RESOURCES[r].icon}</div>
        <div class="grow"><b>${GD.RESOURCES[r].name}</b><span class="small muted">Compra ₡${Math.round(s.npcPrices[r] * 1.1)} · Venta ₡${Math.round(s.npcPrices[r] * 0.8)}</span></div>
        <button class="btn small" data-npc="${r}">Operar</button></div>`).join('')}
    </div>
    ${me.deliveries && me.deliveries.length ? `<div class="card"><h3>:deliver: Pedidos en camino</h3>${me.deliveries.map(e => { const d = s.designs[e.designId]; return `<div class="list-item"><div class="ico-lg">${d ? GD.HULLS[d.hull].icon : ':fleet:'}</div><div class="grow"><b>${e.count}× ${esc(d ? d.name : '?')}</b><span class="small muted">de ${esc(nationName(e.from))} → ${esc(s.planets[e.planetId] ? s.planets[e.planetId].name : '?')}</span></div><span class="pill warn">:time: ${timeLeft(e.readyAt)}</span></div>`; }).join('')}</div>` : ''}
    <div class="card"><div class="row"><h3 class="grow">:market: Mercado de jugadores</h3><button class="btn small primary" id="post-res">+ Vender recurso</button></div>
      <p class="small muted">Aquí compras unidades ya fabricadas por quien las investigó (no se venden licencias: <b>fabrica el otro y te vende</b>). Para vender las tuyas: Proyectos > Diseños > un diseño > Vender unidades.</p>
      ${orders.length ? orders.map(o => orderRow(o)).join('') : '<p class="muted">No hay ofertas todavía. ¡Sé el primero!</p>'}
    </div>
    <div class="card"><h3>:spec: Especialistas de la galaxia</h3><p class="small muted">Quién domina cada rama: a ellos les compras lo que tú no puedes investigar.</p>
      ${Object.values(s.nations).filter(n => n.alive && !n.npc && n.spec && n.spec.length).map(n => `<div class="list-item">${flagHTML(n.id)}<div class="grow"><b>${esc(nationName(n.id))}</b><span class="small muted">${n.spec.map(k => GD.TECH_BRANCHES[k].icon + ' ' + GD.TECH_BRANCHES[k].name).join(' · ')}</span></div></div>`).join('') || '<p class="muted">Nadie ha elegido aún.</p>'}
    </div>`;
  body.querySelectorAll('[data-npc]').forEach(b => b.onclick = () => npcModal(b.dataset.npc));
  body.querySelectorAll('[data-buy]').forEach(b => b.onclick = () => { const o = s.market[b.dataset.buy]; if (o && o.kind === 'units') buyUnitsModal(o); else action('marketBuy', { id: b.dataset.buy }); });
  body.querySelectorAll('[data-cancel]').forEach(b => b.onclick = () => action('marketCancel', { id: b.dataset.cancel }));
  body.querySelectorAll('[data-design]').forEach(b => b.onclick = () => window.dispatchEvent(new CustomEvent('od:designInfo', { detail: b.dataset.design })));
  body.querySelector('#post-res').onclick = postResourceModal;
}
function orderRow(o) {
  const s = store.state, mine = o.seller === store.me.id;
  let what;
  if (o.kind === 'resource') what = `${GD.RESOURCES[o.resource].icon} ${fmt(o.amount)} ${GD.RESOURCES[o.resource].name} <span class="small muted">(₡${fmt(o.price / o.amount)} c/u)</span>`;
  else { const d = s.designs[o.designId]; what = `${d ? GD.HULLS[d.hull].icon : ':fleet:'} ${o.count}× <a href="#" data-design="${o.designId}">${esc(d ? d.name : '?')}</a> <span class="small muted">${d ? GD.HULLS[d.hull].name + ' · Poder ' + d.stats.power + ' c/u · ₡' + fmt(o.price / o.count) + ' c/u' : ''}</span>`; }
  const owned = false;
  return `<div class="list-item">${flagHTML(o.seller)}<div class="grow"><b>${what}</b><span class="small muted">${esc(nationName(o.seller))} · ${ago(o.t)}</span></div>
    <b>₡${fmt(o.price)}</b>${mine ? `<button class="btn small danger" data-cancel="${o.id}">:close:</button>` : owned ? '<span class="pill good">Tuya</span>' : `<button class="btn small good" data-buy="${o.id}">Comprar</button>`}</div>`;
}
/** Compra de unidades: eliges a qué planeta tuyo llegan (tras el viaje desde el sistema del vendedor) */
function buyUnitsModal(o) {
  const s = store.state, me = store.me, d = s.designs[o.designId];
  const mine = Object.values(s.planets).filter(p => p.owner === me.id);
  if (!mine.length) return;
  const hops = (a, b) => { if (a === b) return 0; const seen = { [a]: 0 }, q = [a]; while (q.length) { const c = q.shift(); for (const l of s.systems[c].links || []) if (!(l in seen)) { seen[l] = seen[c] + 1; if (l === b) return seen[l]; q.push(l); } } return null; };
  openModal(`<h3>:market: Comprar ${o.count}× ${esc(d ? d.name : '?')}</h3>
    <p class="small muted">Vendedor: ${flagHTML(o.seller, 18, 12)} ${esc(nationName(o.seller))} · Precio total <b>₡${fmt(o.price)}</b> (${'₡' + fmt(o.price / o.count)} c/u)</p>
    <label>Entregar en</label><select id="dest">${mine.map(p => { const h = hops(o.system, p.system); return `<option value="${p.id}" ${p.id === me.capital ? 'selected' : ''}>${esc(p.name)}${p.id === me.capital ? ' (capital)' : ''} · ${h == null ? 'sin ruta' : h + ' saltos'}</option>`; }).join('')}</select>
    <p class="small muted">Las unidades salen del sistema del vendedor y tardan lo que tarden en viajar hasta ti.</p>
    <button class="btn primary block" id="ok">Comprar por ₡${fmt(o.price)}</button>`, m => {
    m.querySelector('#ok').onclick = async () => { if ((await action('marketBuy', { id: o.id, planetId: m.querySelector('#dest').value })).ok) closeModal(); };
  });
}
function npcModal(r) {
  const R = GD.RESOURCES[r], price = store.state.npcPrices[r];
  openModal(`<h3>${R.icon} ${R.name}</h3><p class="small muted">${R.desc}</p>
    <label>Cantidad</label><input type="number" id="amt" value="500" min="1">
    <p>Comprar: <b id="bc"></b> · Vender: <b id="sc"></b></p>
    <div class="row"><button class="btn grow good" id="b">Comprar</button><button class="btn grow" id="s">Vender</button></div>`, m => {
    const amt = m.querySelector('#amt');
    const upd = () => { m.querySelector('#bc').textContent = '₡' + fmt(price * 1.1 * amt.value); m.querySelector('#sc').textContent = '₡' + fmt(price * 0.8 * amt.value); };
    amt.oninput = upd; upd();
    m.querySelector('#b').onclick = async () => { if ((await action('npcTrade', { resource: r, amount: amt.value, side: 'buy' })).ok) closeModal(); };
    m.querySelector('#s').onclick = async () => { if ((await action('npcTrade', { resource: r, amount: amt.value, side: 'sell' })).ok) closeModal(); };
  });
}
function postResourceModal() {
  openModal(`<h3>Vender recurso a jugadores</h3>
    <label>Recurso</label><select id="r">${Object.keys(GD.RESOURCES).map(r => `<option value="${r}">${GD.RESOURCES[r].icon} ${GD.RESOURCES[r].name} (tienes ${fmt(store.me.resources[r] || 0)})</option>`).join('')}</select>
    <label>Cantidad</label><input type="number" id="a" value="500" min="1">
    <label>Precio total (₡)</label><input type="number" id="p" value="30000" min="1">
    <p class="small muted">Los recursos quedan en depósito hasta que alguien compre o retires la oferta.</p>
    <button class="btn primary block" id="ok">Publicar</button>`, m => {
    m.querySelector('#ok').onclick = async () => {
      const r = await action('marketPost', { kind: 'resource', resource: m.querySelector('#r').value, amount: m.querySelector('#a').value, price: m.querySelector('#p').value });
      if (r.ok) closeModal();
    };
  });
}

/* ---------- Bandeja de notificaciones ---------- */
function inbox(body) {
  const me = store.me;
  body.innerHTML = `<div class="card">${me.inbox.length ? me.inbox.map(i => `<div class="list-item"><div class="grow ${i.kind}">${esc(i.text)}</div><span class="small muted">${ago(i.t)}</span></div>`).join('') : '<p class="muted">Sin mensajes.</p>'}</div>`;
}
