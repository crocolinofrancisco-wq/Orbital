/* =====================================================================
 * ORBITAL DOMINATION — SIMULADOR DE BATALLA EN TIEMPO REAL (v2)
 * ---------------------------------------------------------------------
 * Reemplaza al simulador por rondas (server/combat.js) para el combate
 * espacial. Una batalla dura 1-4 minutos de tiempo REAL y se puede ver
 * en vivo: las naves se mueven, disparan proyectiles, los escudos caen,
 * los misiles se interceptan y las naves explotan.
 *
 * ES UN MÓDULO COMPARTIDO (cliente + servidor, igual que gamedata.js):
 *   - El SERVIDOR lo ejecuta en vivo (paso de 0.5 s) y es la autoridad.
 *   - El CLIENTE lo usa para repetir una batalla ya terminada: basta con
 *     guardar { setup, orders } (semilla + órdenes dadas) y re-simular.
 *
 * DETERMINISMO: mismo setup + mismas órdenes (mismo tick) = mismo
 * resultado. Solo se usan + - * / y sqrt (exactos en IEEE-754) y un RNG
 * con semilla; NO se usa Math.random ni trigonometría dentro de la
 * simulación. Si añades mecánicas, mantén esa regla (ver docs/BATALLAS.md).
 *
 * MODELO
 *   - Arena 2D de 1000 x 560. Bando A entra por la izquierda, B por la derecha.
 *   - Cada grupo (diseño de nave de una flota) se reparte en "entidades";
 *     una entidad representa varias unidades iguales y va perdiendo
 *     unidades conforme pierde casco (así 200 cazas no son 200 objetos).
 *   - Armas con alcance, cadencia y tipo de proyectil real:
 *       rayo (láser), bala (cañón/riel/plasma), misil (misil/torpedo), mordisco (monstruos)
 *   - Escudo = reserva que se regenera. Piedra-papel-tijera:
 *       ENERGÍA   -> el escudo la absorbe del todo
 *       CINÉTICO  -> casi atraviesa el escudo, lo frena el blindaje
 *       EXPLOSIVO -> la defensa puntual intercepta misiles en vuelo
 *   - Órdenes del jugador por grupo: táctica (atacar / mantener / distancia /
 *     retirada) y objetivo prioritario (focus) sobre un grupo enemigo.
 *   - Entorno: asteroides (bloquean balas), nebulosa (alcance y puntería
 *     reducidos), agujero negro (atrae y devora naves).
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BattleSim = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  const ARENA = { w: 1000, h: 560 };
  const DT = 0.5;            // segundos de simulación por paso
  const MOVE_K = 4.2;        // unidades/segundo por punto de velocidad
  const NUM_K = 10;          // escala numerica del juego (debe coincidir con GameData.NUM_K): vida, dano, blindaje... van x10
  const DPS_K = 0.05;            // escala global de daño (ver docs/BATALLAS.md). v3: 4x menos que v2 para que las batallas grandes duren 10-30 min
  const SHIELD_POOL = 6;     // reserva de escudo = stat * unidades * esto
  const SHIELD_REGEN = 0.003;// fracción de la reserva que se regenera por segundo
  const MAX_ENTS = 320;      // entidades simultáneas máximas (una entidad = 1 a pocos barcos iguales)
  const RETREAT_SPOOL = 20;   // segundos para cargar el salto de escape
  // Calor (v3): cada disparo calienta; al llegar a 1 las armas se bloquean hasta bajar de HEAT_RESUME
  const HEAT_COOL = 0.014;    // enfriamiento base por segundo (se multiplica por tamaño y radiadores)
  const HEAT_RESUME = 0.55;
  const HEAT_THROTTLE = 0.8;  // por encima de esto la cadencia cae un 25 %
  const KIND_CODE = { bolt: 0, missile: 1 };
  /** Código de color/estilo de cada proyectil (para dibujarlo en el cliente) */
  const COLOR_CODE = { tracer: 0, rail: 1, plasma: 2, missile: 3, torpedo: 4, laser: 5, maw: 6, ion: 7, pulse: 8, swarm: 9 };

  /** Armas: alcance real (unidades de arena), cadencia (s) y tipo de proyectil */
  const WEAPON = {
    laser:   { range: 330, interval: 1.0, kind: 'beam',    color: 'laser',  heat: 0.018 },
    pulso:   { range: 290, interval: 0.35, kind: 'beam',   color: 'pulse',  heat: 0.0045 },            // láser de pulsos: poco calor por daño
    ion:     { range: 300, interval: 1.2, kind: 'beam',    color: 'ion',    heat: 0.014, ion: true },  // devora escudos, poco daño al casco, a veces retrasa las armas del objetivo
    canon:   { range: 240, interval: 0.5, kind: 'bolt',    speed: 560, color: 'tracer', heat: 0.006 },
    railgun: { range: 480, interval: 2.5, kind: 'bolt',    speed: 1000, color: 'rail', heat: 0.030 },
    misil:   { range: 540, interval: 3.0, kind: 'missile', speed: 170, color: 'missile', heat: 0.012 },
    enjambre:{ range: 470, interval: 4.0, kind: 'missile', speed: 200, color: 'swarm', heat: 0.020, salvo: 5 },   // 5 misiles pequeños: saturan la defensa puntual
    torpedo: { range: 440, interval: 5.0, kind: 'missile', speed: 100, color: 'torpedo', heat: 0.030 },
    plasma:  { range: 180, interval: 1.4, kind: 'bolt',    speed: 300, color: 'plasma', heat: 0.050 },
    maw:     { range: 150, interval: 3.5, kind: 'melee',   color: 'maw',    heat: 0 },
    spit:    { range: 360, interval: 2.2, kind: 'bolt',    speed: 340, color: 'plasma', heat: 0 },
    bat:     { range: 400, interval: 2.0, kind: 'bolt',    speed: 800, color: 'rail',   heat: 0 }
  };
  const STRIKE_STATS = { hp: 30 * NUM_K, speed: 11, size: 1, role: 'fighter', armor: 0, shield: 0, pd: 0, sensors: 0, ecm: 0,
    weapons: [{ type: 'laser', dmgType: 'energia', range: [0.6, 1, 1], dmg: 9 * NUM_K, rel: 0.92, antiCapital: 1 }] };

  function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
  const dist2 = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };

  /**
   * setup = {
   *   seed, env: 'none'|'asteroids'|'nebula'|'blackhole', maxTime,
   *   sides: { A: [grupo...], B: [grupo...] }
   * }
   * grupo = { gid?, owner, name, hull, count, stats, fleetId?, designId?, isPlanet?, monster?, station? }
   *   stats = { hp, speed, size, role, armor, shield, pd, sensors, ecm, hangar, weapons:[{type,dmgType,range:[3],dmg,rel,antiCapital}], special? }
   */
  class BattleSim {
    constructor(setup) {
      this.setup = setup;
      this.rng = makeRng(setup.seed || 1);
      this.env = setup.env || 'none';
      this.maxTime = setup.maxTime || 1800;
      this.t = 0; this.tick = 0;
      this.ents = []; this.projs = []; this.groups = [];
      this.events = []; this.orderLog = []; this.reinfLog = [];
      this.nextId = 1; this.nextPid = 1;
      this.pending = [];       // refuerzos programados
      this.over = null;
      this.gv = 0;             // versión de la lista de grupos (para el cliente)
      this.obstacles = [];
      this.bh = null;
      const er = makeRng((setup.seed || 1) ^ 0x9e3779b9);
      if (this.env === 'asteroids') {
        for (let i = 0; i < 7; i++) this.obstacles.push({ x: 380 + er() * 240, y: 40 + er() * (ARENA.h - 80), r: 10 + er() * 14 });
      }
      if (this.env === 'blackhole') this.bh = { x: ARENA.w / 2, y: ARENA.h / 2, r: 22, pull: 250 };
      this._scale(setup);
      for (const side of ['A', 'B']) this._spawnSide(side, setup.sides[side] || [], false);
      this.snapshotCache = null;
    }

    /* ---------- construcción ---------- */
    _scale(setup) {
      let total = 0, units = 0;
      for (const s of ['A', 'B']) for (const g of setup.sides[s] || []) { total += this._chunks(g); if (!g.isPlanet && !g.station) units += g.count * (g.stats.role === 'fighter' ? 0.5 : 1); }
      this.chunkScale = total > MAX_ENTS ? MAX_ENTS / total : 1;
      // Saturacion del campo de batalla: cuantas mas naves, mas fuego cruzado, objetivos tapados y sobredano.
      // Asi un duelo de 20 naves dura minutos y una batalla de 300 puede durar 20-30 minutos.
      this.dpsK = DPS_K * clamp(55 / Math.max(1, units), 0.17, 1);
    }
    _chunks(g) {
      if (g.isPlanet || g.station) return 1;
      // v3: una entidad = pocas unidades iguales, para que 150 barcos se vean como ~150 (y no como 7 bultos)
      const st = g.stats, per = st.role === 'fighter' ? 3 : (st.size >= 4 ? 1 : 2);
      return Math.max(1, Math.ceil(g.count / per));
    }
    _spawnSide(side, groups, reinforce) {
      const rows = { line: 0, fighter: 0, planet: 0 };
      const W = ARENA.w, H = ARENA.h, dir = side === 'A' ? 1 : -1;
      // Formacion: las flotas grandes se abren en mas filas y columnas mas juntas (si no, se salian del escenario)
      let nLine = 0;
      for (const g of groups) if (!g.isPlanet && !g.station && !reinforce && g.stats.role !== 'fighter' && !g.monster) nLine += Math.min(g.count, Math.max(1, Math.round(this._chunks(g) * this.chunkScale)));
      const nRows = Math.max(5, Math.min(13, Math.ceil(nLine / 7))), vSpace = Math.min(62, 470 / Math.max(1, nRows - 1));
      const nCols = Math.ceil(Math.max(1, nLine) / nRows), xSpace = Math.min(26, 330 / Math.max(1, nCols - 1));
      for (const g of groups) {
        const gid = g.gid != null ? g.gid : this.groups.length;
        const grp = { gid, side, owner: g.owner, name: g.name, hull: g.hull, count: g.count, start: g.count, stats: g.stats, fleetId: g.fleetId,
          designId: g.designId, isPlanet: !!g.isPlanet, station: !!g.station, monster: !!g.monster, planetId: g.planetId,
          tactic: 'attack', focus: null, dealt: 0, kills: 0, lost: 0, escaped: 0, ents: [] };
        this.groups.push(grp); this.gv++;
        const st = g.stats;
        let nch = Math.max(1, Math.round(this._chunks(g) * this.chunkScale));
        nch = Math.min(nch, g.count);
        for (let i = 0; i < nch; i++) {
          const w0 = g.count / nch;
          const e = this._makeEnt(grp, 'ship', st, w0);
          if (g.isPlanet || g.station) {
            e.x = side === 'A' ? 70 : W - 70; e.y = H / 2 + (g.station ? 90 : 0); e.static = true; e.rad = g.station ? 30 : 36;
          } else if (reinforce) {
            e.x = side === 'A' ? -30 : W + 30; e.y = 60 + this.rng() * (H - 120);
          } else {
            const fighter = st.role === 'fighter';
            const slot = fighter ? rows.fighter++ : rows.line++;
            const depth = clamp(st.size, 1, 60);
            const col = fighter ? Math.floor(slot / 4) : Math.floor(slot / nRows);
            const cs = fighter ? 26 : xSpace;
            e.x = side === 'A' ? 150 - depth * 0.9 - col * cs + this.rng() * 10 : W - 150 + depth * 0.9 + col * cs - this.rng() * 10;
            if (fighter) e.y = (slot % 2 ? H * 0.17 : H * 0.83) + (this.rng() - 0.5) * 70;
            else e.y = H / 2 + ((slot % nRows) - (nRows - 1) / 2) * vSpace + (this.rng() - 0.5) * 16;
            if (g.monster) { e.x = side === 'A' ? 240 : W - 240; e.y = H / 2 + (this.rng() - 0.5) * 120; }
          }
          e.hx = dir; e.hy = 0;
          grp.ents.push(e); this.ents.push(e);
        }
      }
    }
    _makeEnt(grp, kind, st, w0) {
      const size = st.size || 1;
      const e = { id: this.nextId++, side: grp.side, gid: grp.gid, kind, w0, hp: 0, hpMax: (st.hp || 30) * w0, sh: 0, shMax: (st.shield || 0) * w0 * SHIELD_POOL,
        x: 0, y: 0, vx: 0, vy: 0, hx: 1, hy: 0, size, rad: 6 + 2.2 * Math.sqrt(size), role: st.role || 'line',
        speed: Math.max(0.5, st.speed || 3), armor: st.armor || 0, pd: st.pd || 0, sensors: st.sensors || 0, ecm: st.ecm || 0,
        heat: 0, locked: false, noHeat: !!grp.monster || kind === 'strike', cool: HEAT_COOL * Math.sqrt(Math.max(1, size / 4)) * (1 + (st.cooling || 0) / (12 * NUM_K)),
        mod: { motor: 1, arms: 1, sens: 1 }, surr: false,
        special: st.special || [], weapons: [], target: null, dead: false, esc: false, static: false, born: this.t,
        hangar: st.hangar ? Math.ceil(st.hangar * w0 / 4) : 0, launched: 0, nextLaunch: 6 + this.rng() * 4, pdCd: 0, empCd: 8 + this.rng() * 6,
        strafe: this.rng() < 0.5 ? 1 : -1, dmgDealt: 0 };
      e.hp = e.hpMax; e.sh = e.shMax;
      let best = 0, wsum = 0;
      for (const w of st.weapons || []) {
        const def = WEAPON[w.type] || WEAPON.canon;
        e.weapons.push({ type: w.type, def, dmgType: w.dmgType, dmg: w.dmg, rel: w.rel, band: w.range || [1, 1, 1], anti: w.antiCapital || 1, cd: this.rng() * def.interval });
        best += def.range * w.dmg; wsum += w.dmg;
      }
      e.maxRange = e.weapons.reduce((a, w) => Math.max(a, w.def.range), 0);
      e.pref = e.weapons.length ? (wsum ? best / wsum : e.maxRange) * 0.82 : 160;
      if (e.role === 'fighter') e.pref *= 0.55;
      if (kind === 'strike') { e.pref = 110; }
      return e;
    }

    /* ---------- API pública ---------- */
    /** Añade refuerzos que entran por el borde de su bando */
    addReinforcements(side, groups, delaySec) {
      const delay = delaySec == null ? 4 : delaySec;
      this.reinfLog.push({ tick: this.tick, side, groups, delay });
      this.pending.push({ at: this.t + delay, side, groups });
    }
    /** Orden del jugador: {tactic:'attack'|'hold'|'kite'|'retreat', focus: gidEnemigo|null} */
    order(gid, o) {
      const g = this.groups[gid];
      if (!g || this.over) return false;
      if (o.tactic && ['attack', 'hold', 'kite', 'retreat'].indexOf(o.tactic) >= 0) g.tactic = o.tactic;
      if ('focus' in o) {
        const f = o.focus == null ? null : this.groups[o.focus];
        g.focus = f && f.side !== g.side ? f.gid : null;
      }
      this.orderLog.push({ tick: this.tick, gid, o: { tactic: o.tactic, focus: o.focus } });
      return true;
    }
    orderSide(side, o) { for (const g of this.groups) if (g.side === side && !g.isPlanet && !g.station) this.order(g.gid, o); }
    alive(side) { return this.ents.filter(e => !e.dead && !e.esc && e.side === side && e.kind !== 'strike'); }

    /* ---------- paso de simulación ---------- */
    step() {
      if (this.over) return this.events = [];
      this.events = [];
      this.t += DT; this.tick++;
      // refuerzos
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const p = this.pending[i];
        if (this.t >= p.at) { this._spawnSide(p.side, p.groups.map(g => Object.assign({ gid: undefined }, g)), true); this.events.push({ k: 'reinf', side: p.side }); this.pending.splice(i, 1); }
      }
      const ents = this.ents;
      const live = ents.filter(e => !e.dead && !e.esc);
      const enemies = { A: live.filter(e => e.side === 'B'), B: live.filter(e => e.side === 'A') };
      this._environment(live);
      // 1) puntería y movimiento
      for (const e of live) { this._think(e, enemies[e.side]); }
      this._separate(live);
      // 2) disparos
      for (const e of live) this._fire(e, enemies[e.side]);
      // 3) defensa puntual
      for (const e of live) if (e.pd > 0 && e.kind !== 'strike') this._pointDefense(e, enemies[e.side]);
      // 4) proyectiles
      this._projectiles(live);
      // 5) habilidades especiales, escudos, hangares
      for (const e of live) this._upkeep(e, enemies[e.side]);
      // 6) bajas
      for (const e of this.ents) if (!e.dead && e.hp <= 0) this._kill(e);
      // 7) fin de batalla
      this._checkEnd();
      return this.events;
    }

    _environment(live) {
      if (this.bh) {
        for (const e of live) {
          if (e.static) continue;
          const dx = this.bh.x - e.x, dy = this.bh.y - e.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          if (d < this.bh.pull) { const a = (1 - d / this.bh.pull) * 24 * (1 / (1 + e.size * 0.03)) * DT; e.x += dx / d * a; e.y += dy / d * a; }
          if (d < this.bh.r) { e.hp = 0; e.devoured = true; }
        }
      }
    }

    _acquire(e, foes) {
      const grp = this.groups[e.gid];
      if (e.target && !e.target.dead && !e.target.esc && (this.tick + e.id) % 4 !== 0) {
        if (!grp.focus || this.groups[e.target.gid].gid === grp.focus) return e.target;
      }
      let best = null, bs = 1e18;
      const focus = grp.focus;
      let hasFocus = false;
      if (focus != null) for (const f of foes) if (f.gid === focus) { hasFocus = true; break; }
      for (const f of foes) {
        if (hasFocus && f.gid !== focus) continue;
        let s = dist2(e, f);
        if (!hasFocus) {
          if (e.role === 'fighter' && f.role === 'fighter') s *= 0.5;
          else if (f.size >= 14 && e.weapons.some(w => w.anti > 1.2)) s *= 0.45;
          if (f.kind === 'strike') s *= 0.8;
        }
        if (s < bs) { bs = s; best = f; }
      }
      return best;
    }

    _think(e, foes) {
      const grp = this.groups[e.gid];
      if (e.static) { e.target = this._acquire(e, foes); this._face(e, e.target); return; }
      const tactic = grp.tactic;
      e.target = this._acquire(e, foes);
      const T = e.target;
      let dx = 0, dy = 0, want = 0;
      const dirA = e.side === 'A' ? 1 : -1;
      if (tactic === 'retreat') { dx = -dirA; dy = 0; want = 1; }
      else if (!T) { const c = foes.length ? foes[0] : null; if (c) { dx = c.x - e.x; dy = c.y - e.y; want = 0.6; } }
      else {
        const ddx = T.x - e.x, ddy = T.y - e.y, d = Math.sqrt(ddx * ddx + ddy * ddy) || 1;
        const pref = e.pref * (this.env === 'nebula' ? 0.75 : 1);
        if (tactic === 'hold') { want = 0; }
        else if (tactic === 'kite') {
          if (d < pref * 0.9) { dx = -ddx / d; dy = -ddy / d; want = 1; }
          else if (d > pref * 1.1) { dx = ddx / d; dy = ddy / d; want = 0.8; }
        } else {
          if (d > pref * 1.04) { dx = ddx / d; dy = ddy / d; want = 1; }
          else if (e.role === 'fighter') {
            // los cazas giran alrededor del objetivo, pero corrigiendo la distancia (si no, se apilan en un punto)
            // y cambiando de sentido al topar con el borde de la arena (si no, se quedan pegados a la pared)
            if ((e.y < 40 && e.strafe * ddx < 0) || (e.y > ARENA.h - 40 && e.strafe * ddx > 0) ||
                (e.x > ARENA.w - 40 && e.strafe * ddy < 0) || (e.x < 40 && e.strafe * ddy > 0)) e.strafe = -e.strafe;
            const radial = clamp((d - pref) / pref, -1, 1) * 0.9;
            dx = -ddy / d * e.strafe + ddx / d * radial; dy = ddx / d * e.strafe + ddy / d * radial; want = 0.8;
          }
          else if (d < pref * 0.55) { dx = -ddx / d; dy = -ddy / d; want = 0.35; }
        }
      }
      const dl = Math.sqrt(dx * dx + dy * dy);
      const sp = e.speed * MOVE_K * want * (this.env === 'nebula' ? 0.85 : 1) * (0.35 + 0.65 * e.mod.motor);
      const tvx = dl ? dx / dl * sp : 0, tvy = dl ? dy / dl * sp : 0;
      const acc = 0.35;
      e.vx += (tvx - e.vx) * acc; e.vy += (tvy - e.vy) * acc;
      e.x += e.vx * DT; e.y += e.vy * DT;
      const newborn = this.t - e.born < 6, lo = (tactic === 'retreat' || newborn) ? -60 : 8, hi = ARENA.w + ((tactic === 'retreat' || newborn) ? 60 : -8);
      e.x = clamp(e.x, lo, hi);
      e.y = clamp(e.y, 10, ARENA.h - 10);
      const sv = Math.sqrt(e.vx * e.vx + e.vy * e.vy);
      if (sv > 3) this._turn(e, e.vx / sv, e.vy / sv, 0.3); else if (T) this._face(e, T);
      // retirada: los motores de salto tardan RETREAT_SPOOL segundos en cargarse (mientras tanto te siguen disparando)
      if (tactic === 'retreat') {
        e.retreatT = (e.retreatT || 0) + DT;
        if (e.retreatT >= RETREAT_SPOOL) { e.esc = true; this.events.push({ k: 'escape', id: e.id, x: e.x, y: e.y }); }
      } else e.retreatT = 0;
    }
    _face(e, T) { if (!T) return; const dx = T.x - e.x, dy = T.y - e.y, d = Math.sqrt(dx * dx + dy * dy) || 1; this._turn(e, dx / d, dy / d, 0.25); }
    _turn(e, tx, ty, k) {
      let nx = e.hx + (tx - e.hx) * k, ny = e.hy + (ty - e.hy) * k;
      const l = Math.sqrt(nx * nx + ny * ny) || 1; e.hx = nx / l; e.hy = ny / l;
    }
    _separate(live) {
      for (let i = 0; i < live.length; i++) {
        const a = live[i]; if (a.static) continue;
        for (let j = i + 1; j < live.length; j++) {
          const b = live[j];
          if (a.side !== b.side) continue;
          const dx = b.x - a.x, dy = b.y - a.y, m = (a.rad + b.rad) * 0.9;
          const d2 = dx * dx + dy * dy;
          if (d2 > 0 && d2 < m * m) {
            const d = Math.sqrt(d2), push = (m - d) * 0.25;
            if (!b.static) { b.x += dx / d * push; b.y += dy / d * push; }
            a.x -= dx / d * push; a.y -= dy / d * push;
          }
        }
      }
    }

    _units(e) { return e.w0 * clamp(e.hp / e.hpMax, 0, 1); }

    _fire(e, foes) {
      if (!foes.length || !e.weapons.length) return;
      const n = Math.max(0.2, this._units(e));
      const rangeK = this.env === 'nebula' ? 0.72 : 1;
      const grp = this.groups[e.gid];
      for (const w of e.weapons) {
        w.cd -= DT;
        if (w.cd > 0) continue;
        if (e.locked) { w.cd = 0.5; continue; }        // sobrecalentado: las armas esperan a enfriarse
        // objetivo: el principal si está en alcance; si no, el más cercano en alcance
        const range = w.def.range * rangeK;
        let T = e.target;
        if (!T || T.dead || T.esc || dist2(e, T) > range * range) {
          T = null; let bd = range * range;
          for (const f of foes) { const d = dist2(e, f); if (d < bd) { bd = d; T = f; } }
        }
        if (!T) { w.cd = 0.25; continue; }
        if (this.rng() > w.rel) { w.cd = w.def.interval * 0.5; continue; }
        w.cd = w.def.interval * (0.9 + this.rng() * 0.2) * (e.heat > HEAT_THROTTLE ? 1.25 : 1);
        if (!e.noHeat && w.def.heat) {
          e.heat += w.def.heat;
          if (e.heat >= 1 && !e.locked) { e.locked = true; this.events.push({ k: 'hot', id: e.id }); }
        }
        const dx = T.x - e.x, dy = T.y - e.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
        const band = d > 350 ? 0 : d > 150 ? 1 : 2;
        let dmg = w.dmg * (w.band[band] != null ? w.band[band] : 1) * this.dpsK * w.def.interval * n * (0.3 + 0.7 * e.mod.arms);
        if (T.size >= 14) dmg *= w.anti;
        // puntería: sensores propios - guerra electrónica enemiga
        let acc = clamp(0.8 + (e.sensors - T.ecm) * 0.01 / NUM_K - (1 - e.mod.sens) * 0.25, 0.25, 0.97);
        if (this.env === 'nebula') acc -= 0.12;
        if (T.role === 'fighter' && e.role !== 'fighter') acc *= 0.6;
        if (e.role === 'fighter') acc *= 0.9;
        const spread = (1 - acc) * 0.5 * d;          // error lateral en unidades de arena
        const px = -dy / d, py = dx / d;
        const off = (this.rng() * 2 - 1) * spread;
        const kind = w.def.kind;
        if (kind === 'beam') {
          const hit = this.rng() < acc;
          if (hit) {
            if (w.def.ion) {                                // canon de iones: drena el escudo y a veces retrasa las armas
              T.sh = Math.max(0, T.sh - dmg * 2.2); dmg *= 0.35;
              if (this.rng() < 0.22) for (const tw of T.weapons) tw.cd += 0.9;
            }
            this._damage(T, dmg, w.dmgType, e, grp); this.events.push({ k: 'beam', f: e.id, t: T.id, c: w.def.color, h: 1 });
          }
          else this.events.push({ k: 'beam', f: e.id, t: T.id, c: w.def.color, h: 0, o: off });
        } else if (kind === 'melee') {
          const splash = 70;
          for (const f of foes) { const dd = dist2(f, T); if (f === T || dd < splash * splash) this._damage(f, f === T ? dmg : dmg * 0.4, w.dmgType, e, grp); }
          this.events.push({ k: 'melee', f: e.id, t: T.id });
        } else {
          // bala o misil: se lanza hacia el punto (con error) y colisiona físicamente
          const salvo = w.def.salvo || 1, sp = w.def.speed;
          for (let si = 0; si < salvo; si++) {
            const so = salvo > 1 ? (this.rng() * 2 - 1) * 22 : 0;                    // las salvas se abren en abanico
            const ax = T.x + px * (off + so) - e.x, ay = T.y + py * (off + so) - e.y, al = Math.sqrt(ax * ax + ay * ay) || 1;
            const p = { id: this.nextPid++, kind: kind === 'missile' ? 'missile' : 'bolt', color: w.def.color, side: e.side, from: e.id, gid: e.gid,
              x: e.x + e.hx * e.rad, y: e.y + e.hy * e.rad, vx: ax / al * sp, vy: ay / al * sp, speed: sp, dmg: dmg / salvo, dmgType: w.dmgType, target: kind === 'missile' ? T : null,
              life: (range * 1.35) / sp, big: w.type === 'torpedo' };
            this.projs.push(p);
          }
          this.events.push({ k: 'fire', f: e.id, c: w.def.color });
        }
      }
    }

    _blockedBy(x1, y1, x2, y2) {
      for (const o of this.obstacles) if (segCircle(x1, y1, x2, y2, o.x, o.y, o.r)) return true;
      return false;
    }

    _pointDefense(e, foes) {
      e.pdCd -= DT; if (e.pdCd > 0) return;
      const n = Math.max(0.2, this._units(e));
      const pdv = e.pd * n;
      let used = false;
      // 1) intercepta misiles enemigos cercanos
      for (const p of this.projs) {
        if (p.kind !== 'missile' || p.side === e.side || p.dead) continue;
        const dx = p.x - e.x, dy = p.y - e.y;
        if (dx * dx + dy * dy > 190 * 190) continue;
        const chance = clamp(pdv * 0.018 / NUM_K, 0, 0.55) / (p.big ? 1.5 : 1);
        if (this.rng() < chance) { p.dead = true; used = true; this.events.push({ k: 'icpt', x: p.x, y: p.y, f: e.id }); }
      }
      // 2) dispara contra cazas enemigos
      let tgt = null, bd = 150 * 150;
      for (const f of foes) if (f.role === 'fighter') { const d = dist2(e, f); if (d < bd) { bd = d; tgt = f; } }
      if (tgt) { this._damage(tgt, pdv * 0.9 * this.dpsK * 1.1, 'energia', e, this.groups[e.gid]); used = true; this.events.push({ k: 'beam', f: e.id, t: tgt.id, c: 'pd', h: 1 }); }
      e.pdCd = used ? 0.5 : 0;
    }

    _projectiles(live) {
      const foesBy = { A: live.filter(e => e.side === 'B' && !e.dead), B: live.filter(e => e.side === 'A' && !e.dead) };
      for (const p of this.projs) {
        if (p.dead) continue;
        if (p.kind === 'missile' && p.target && !p.target.dead && !p.target.esc) {
          // guiado: gira hacia el objetivo
          const dx = p.target.x - p.x, dy = p.target.y - p.y, d = Math.sqrt(dx * dx + dy * dy) || 1;
          const k = 0.38;
          let nx = p.vx / p.speed + (dx / d - p.vx / p.speed) * k, ny = p.vy / p.speed + (dy / d - p.vy / p.speed) * k;
          const l = Math.sqrt(nx * nx + ny * ny) || 1; p.vx = nx / l * p.speed; p.vy = ny / l * p.speed;
        }
        const x0 = p.x, y0 = p.y;
        p.x += p.vx * DT; p.y += p.vy * DT; p.life -= DT;
        if (this._blockedBy(x0, y0, p.x, p.y)) { p.dead = true; this.events.push({ k: 'rock', x: p.x, y: p.y }); continue; }
        // colisión con cualquier enemigo en el trayecto
        let hit = null, ht = 2;
        for (const f of foesBy[p.side]) {
          if (f.dead || f.esc) continue;
          const t = segCircleT(x0, y0, p.x, p.y, f.x, f.y, f.rad + 3);
          if (t != null && t < ht) { ht = t; hit = f; }
        }
        if (hit) {
          p.dead = true;
          const from = this.groups[p.gid];
          this._damage(hit, p.dmg, p.dmgType, { id: p.from, gid: p.gid }, from);
          this.events.push({ k: 'hit', t: hit.id, x: p.x, y: p.y, c: p.color, big: p.big ? 1 : 0 });
        } else if (p.life <= 0 || p.x < -80 || p.x > ARENA.w + 80 || p.y < -80 || p.y > ARENA.h + 80) p.dead = true;
      }
      this.projs = this.projs.filter(p => !p.dead);
    }

    /** Aplica daño: escudo -> casco (con blindaje) */
    _damage(e, dmg, dmgType, src, srcGrp) {
      if (e.dead || dmg <= 0) return;
      let left = dmg;
      if (e.sh > 0) {
        const frac = dmgType === 'energia' ? 1 : dmgType === 'explosivo' ? 0.5 : 0.3;
        const abs = Math.min(e.sh, left * frac);
        e.sh -= abs; left -= abs;
        if (e.sh <= 0 && abs > 0) this.events.push({ k: 'shdown', t: e.id });
        else if (abs > 0) this.events.push({ k: 'shhit', t: e.id });
      }
      if (left > 0) {
        const K = (10 * e.size + 20) * NUM_K;
        const def = dmgType === 'cinetico' ? e.armor : dmgType === 'explosivo' ? e.armor * 0.5 : e.armor * 0.4;
        left = left * K / (K + def);
        e.hp -= left;
        // v3: el casco danado deja ciegas, lentas o mudas a las naves (no solo las destruye)
        if (!e.static && e.hpMax > 0) {
          const f = left / e.hpMax * 2.2, r = this.rng();
          const key = r < 0.45 ? 'arms' : r < 0.75 ? 'motor' : 'sens';
          const before = e.mod[key];
          e.mod[key] = Math.max(0.05, before - f);
          if (before > 0.5 && e.mod[key] <= 0.5) this.events.push({ k: 'mod', id: e.id, m: key });
        }
      }
      if (srcGrp) srcGrp.dealt += dmg;
      e.lastHitBy = srcGrp ? srcGrp.gid : null;
    }

    _upkeep(e, foes) {
      if (e.static && e.kind === 'ship' && !e.special.length && e.shMax <= 0) return;
      if (e.shMax > 0 && e.sh < e.shMax) e.sh = Math.min(e.shMax, e.sh + e.shMax * SHIELD_REGEN * DT * (this.env === 'nebula' ? 0.5 : 1));
      if (e.special.indexOf('regen') >= 0 && e.hp < e.hpMax) e.hp = Math.min(e.hpMax, e.hp + e.hpMax * 0.001 * DT);
      if (e.special.indexOf('emp') >= 0) {
        e.empCd -= DT;
        if (e.empCd <= 0) {
          e.empCd = 14;
          let hits = 0;
          for (const f of foes) if (dist2(e, f) < 300 * 300) { f.sh *= 0.15; for (const w of f.weapons) w.cd += 2.5; hits++; }
          this.events.push({ k: 'emp', x: e.x, y: e.y, f: e.id, n: hits });
        }
      }
      if (!e.noHeat && e.heat > 0) {                 // enfriamiento (mas rapido si esta bloqueado: ventila)
        e.heat = Math.max(0, e.heat - e.cool * (e.locked ? 1.5 : 1) * DT);
        if (e.locked && e.heat <= HEAT_RESUME) { e.locked = false; this.events.push({ k: 'cool', id: e.id }); }
      }
      // Rendicion: un barco muy danado, sin armas o sobrecalentado, con enemigos cerca, arria bandera (el ganador se queda con el botin)
      if (!e.static && e.kind === 'ship' && e.role !== 'fighter' && !e.surr && e.hp / e.hpMax < 0.2 && (e.mod.arms < 0.4 || e.locked)) {
        const grp = this.groups[e.gid];
        if (!grp.monster && !grp.station && grp.tactic !== 'retreat') {
          let near = false; for (const f of foes) if (dist2(e, f) < 300 * 300) { near = true; break; }
          if (near && this.rng() < 0.06) { e.surr = true; e.esc = true; this.events.push({ k: 'surr', id: e.id, x: e.x, y: e.y }); }
        }
      }
      if (e.hangar > 0 && e.launched < 3 && this.t >= e.nextLaunch) {
        const grp = this.groups[e.gid];
        const per = Math.max(1, Math.round(e.hangar / 3));
        const s = this._makeEnt(grp, 'strike', STRIKE_STATS, per);
        s.x = e.x + e.hx * 20; s.y = e.y + (e.launched % 2 ? 14 : -14); s.hx = e.hx; s.hy = e.hy;
        grp.ents.push(s); this.ents.push(s); e.launched++; e.nextLaunch = this.t + 7;
        this.events.push({ k: 'launch', f: e.id, id: s.id });
      }
    }

    _kill(e) {
      e.dead = true; e.hp = 0;
      const grp = this.groups[e.gid];
      if (e.kind === 'ship') grp.lost += e.w0;
      // atribuye bajas al grupo que dio el último golpe
      if (e.lastHitBy != null && this.groups[e.lastHitBy] && e.kind === 'ship') this.groups[e.lastHitBy].kills += e.w0;
      this.events.push({ k: 'boom', id: e.id, x: e.x, y: e.y, s: e.size, dv: e.devoured ? 1 : 0 });
    }

    _checkEnd() {
      const a = this.alive('A').length, b = this.alive('B').length;
      const pendA = this.pending.some(p => p.side === 'A'), pendB = this.pending.some(p => p.side === 'B');
      let w = null;
      if (!a && !pendA && !b && !pendB) w = 'draw';
      else if (!a && !pendA) w = 'B';
      else if (!b && !pendB) w = 'A';
      else if (this.t >= this.maxTime) {
        const ha = this.hpFrac('A'), hb = this.hpFrac('B');
        w = ha > hb * 1.12 ? 'A' : hb > ha * 1.12 ? 'B' : 'draw';
        this.timeout = true;
      }
      if (w) {
        this.over = { winner: w, t: this.t, timeout: !!this.timeout };
        for (const e of this.ents) if (e.kind === 'strike' && !e.dead) { e.dead = true; }
        this.events.push({ k: 'over', winner: w });
      }
    }
    hpFrac(side) {
      let hp = 0, max = 0;
      for (const e of this.ents) if (e.side === side && e.kind !== 'strike' && !e.esc) { hp += Math.max(0, e.hp); max += e.hpMax; }
      return max ? hp / max : 0;
    }

    /* ---------- salida ---------- */
    /** Unidades supervivientes de un grupo (suma de unidades vivas de sus entidades) */
    survivors(gid) {
      const g = this.groups[gid];
      let alive = 0, escaped = 0, surrendered = 0;
      for (const e of g.ents) {
        if (e.kind !== 'ship' || e.dead) continue;
        const u = this._units(e);
        const n = u > 0 ? Math.max(1, Math.round(u)) : 0;
        if (e.surr) surrendered += n; else if (e.esc) escaped += n; else alive += n;
      }
      alive = Math.min(g.count, alive); escaped = Math.min(g.count - alive, escaped); surrendered = Math.min(g.count - alive - escaped, surrendered);
      return { alive, escaped, surrendered };
    }
    result() {
      const out = { winner: this.over ? this.over.winner : null, duration: Math.round(this.t), timeout: !!(this.over && this.over.timeout), A: [], B: [] };
      for (const g of this.groups) {
        const s = this.survivors(g.gid);
        out[g.side].push({ gid: g.gid, name: g.name, owner: g.owner, hull: g.hull, start: g.start, end: s.alive + s.escaped, escaped: s.escaped, surrendered: s.surrendered,
          dealt: Math.round(g.dealt), kills: Math.round(g.kills), fleetId: g.fleetId, designId: g.designId, planetId: g.planetId, isPlanet: g.isPlanet, station: g.station, monster: g.monster });
      }
      return out;
    }
    groupsMeta() {
      return this.groups.map(g => ({ gid: g.gid, side: g.side, owner: g.owner, name: g.name, hull: g.hull, count: g.start, isPlanet: g.isPlanet, station: g.station, monster: g.monster, fleetId: g.fleetId, designId: g.designId,
        size: g.stats.size, role: g.stats.role }));
    }
    /** Estado completo para dibujar (compacto) */
    snapshot() {
      const r = n => Math.round(n * 10) / 10;
      const ents = [];
      for (const e of this.ents) {
        if (e.dead || e.esc) continue;
        ents.push([e.id, e.gid, e.kind === 'strike' ? 1 : 0, r(e.x), r(e.y), Math.round(e.hx * 100) / 100, Math.round(e.hy * 100) / 100,
          Math.round(100 * clamp(e.hp / e.hpMax, 0, 1)), e.shMax > 0 ? Math.round(100 * clamp(e.sh / e.shMax, 0, 1)) : -1,
          Math.max(1, Math.round(this._units(e))), (this.groups[e.gid].tactic === 'retreat' ? 1 : 0), r(e.rad), Math.round(100 * Math.min(1, e.heat)), e.locked ? 1 : 0,
          Math.round(100 * e.mod.motor), Math.round(100 * e.mod.arms), Math.round(100 * e.mod.sens)]);
      }
      return {
        t: Math.round(this.t * 10) / 10, tick: this.tick, gv: this.gv, ents,
        projs: this.projs.map(p => [p.id, KIND_CODE[p.kind], r(p.x), r(p.y), r(p.vx), r(p.vy), p.big ? 1 : 0, p.big ? 4 : (COLOR_CODE[p.color] != null ? COLOR_CODE[p.color] : 0)]),
        ev: this.events, over: this.over,
        hp: { A: Math.round(this.hpFrac('A') * 100), B: Math.round(this.hpFrac('B') * 100) },
        orders: this.groups.map(g => [g.gid, g.tactic, g.focus])
      };
    }
    meta() {
      return { arena: ARENA, env: this.env, obstacles: this.obstacles, bh: this.bh, seed: this.setup.seed, groups: this.groupsMeta(), maxTime: this.maxTime };
    }
  }

  /* ---------- geometría ---------- */
  function segCircle(x1, y1, x2, y2, cx, cy, r) { return segCircleT(x1, y1, x2, y2, cx, cy, r) != null; }
  /** Parámetro t (0..1) del primer contacto del segmento con el círculo, o null */
  function segCircleT(x1, y1, x2, y2, cx, cy, r) {
    const dx = x2 - x1, dy = y2 - y1, fx = x1 - cx, fy = y1 - cy;
    const a = dx * dx + dy * dy;
    if (a < 1e-9) return (fx * fx + fy * fy <= r * r) ? 0 : null;
    const b = 2 * (fx * dx + fy * dy), c = fx * fx + fy * fy - r * r;
    if (c <= 0) return 0;
    const disc = b * b - 4 * a * c;
    if (disc < 0) return null;
    const s = Math.sqrt(disc), t = (-b - s) / (2 * a);
    return t >= 0 && t <= 1 ? t : null;
  }

  /** Re-simula un informe guardado { setup, orders, reinf } (para repeticiones) */
  function replayFrom(report) {
    const sim = new BattleSim(report.setup);
    sim._replayOrders = (report.orders || []).slice().sort((a, b) => a.tick - b.tick); sim._oi = 0;
    sim._replayReinf = (report.reinf || []).slice().sort((a, b) => a.tick - b.tick); sim._ri = 0;
    return sim;
  }
  /** Avanza un paso aplicando órdenes y refuerzos grabados para ese tick */
  function replayStep(sim) {
    const r = sim._replayReinf, o = sim._replayOrders;
    while (sim._ri < r.length && r[sim._ri].tick <= sim.tick) { const x = r[sim._ri++]; sim.addReinforcements(x.side, x.groups, x.delay); }
    while (sim._oi < o.length && o[sim._oi].tick <= sim.tick) { const x = o[sim._oi++]; sim.order(x.gid, x.o); }
    return sim.step();
  }

  return { BattleSim, NUM_K, ARENA, DT, WEAPON, COLOR_CODE, makeRng, replayFrom, replayStep, STRIKE_STATS };
});
