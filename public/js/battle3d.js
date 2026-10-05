/* =====================================================================
 * VISOR 3D DE BATALLAS EN TIEMPO REAL
 * ---------------------------------------------------------------------
 * Dibuja las "instantáneas" (frames) que produce el simulador
 * (shared/battlesim.js): las del servidor en directo, o las que genera
 * localmente la repetición de un informe.
 *
 *   viewer.setMeta(meta)         arena, entorno, obstáculos, grupos
 *   viewer.pushFrame(frame)      llega un frame nuevo (cada 0.5 s de batalla)
 *   viewer.onPick(fn)            toque sobre una nave: fn(entInfo)
 *
 * Técnicas (todo "flat / low-poly / cell-shading"):
 *   - Los modelos de nave se FUSIONAN en pocas mallas (1 por material) y
 *     se clonan por instancia: 100 naves ≈ 1000 draw calls, apto para móvil.
 *   - Interpolación entre frames con un pequeño retardo (jitter buffer).
 *   - Efectos con sprites aditivos: disparos, impactos, escudos, explosiones
 *     en cadena, humo en naves dañadas, pulso EMP, agujero negro, asteroides.
 *   - Cámara automática que encuadra la acción + sacudida en explosiones.
 * ===================================================================== */
import * as THREE from '../vendor/three.module.js';
import { makeShip, animateFlames, toon, withOutline } from './ships3d.js';
import { InteractiveScene, addCosmos, makePlanet } from './render3d.js';

const S = 0.14;                                   // unidades de arena -> unidades de mundo
let VS = 1.75, VK = 1;                            // exageración visual de las naves (se leen mejor en un móvil); baja en batallas masivas (setMeta)
const WX = x => (x - 500) * S, WZ = y => (y - 280) * S;
const PROJ_COLORS = [0xffd166, 0xbff4ff, 0xff4dff, 0xffffff, 0xff9d4d, 0x7cf4ff, 0xff3b4a, 0x80d8ff, 0x7cf4ff, 0xffb86b];   // tracer, rail, plasma, missile, torpedo, laser, maw, ion, pulse, swarm
const LASER_COLORS = { laser: 0x7cf4ff, pd: 0xfff2a8, tracer: 0xffd166, rail: 0xbff4ff, plasma: 0xff4dff, maw: 0xff3b4a, ion: 0x80d8ff, pulse: 0xa8fbff, swarm: 0xffb86b };
const REL_COLOR = { mine: 0x57cc99, ally: 0x4cc9f0, war: 0xef476f, neutral: 0xcfd8dc };
const MAX_FX = 220;

/* ---------- Texturas y geometrías compartidas ---------- */
let _dot = null;
function softDot() {
  if (_dot) return _dot;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'), g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.3, 'rgba(255,255,255,.55)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  return (_dot = new THREE.CanvasTexture(c));
}
let _ringTex = null;
function ringTex() {
  if (_ringTex) return _ringTex;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 40, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.7, 'rgba(255,255,255,.9)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return (_ringTex = new THREE.CanvasTexture(c));
}
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(1, 1, 1, 6, 1).rotateX(Math.PI / 2),    // eje Z, largo 1
  ico: new THREE.IcosahedronGeometry(1, 0),
  ring: new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
  shield: new THREE.IcosahedronGeometry(1, 2),
  cone: new THREE.ConeGeometry(1, 2.4, 6).rotateX(Math.PI / 2)
};
const countTex = {};
function countSprite(n) {
  const key = Math.min(n, 999);
  if (!countTex[key]) {
    const c = document.createElement('canvas'); c.width = 96; c.height = 48;
    const x = c.getContext('2d'); x.font = 'bold 30px Rajdhani, sans-serif'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 6; x.strokeStyle = 'rgba(5,8,14,.9)'; x.strokeText('×' + key, 48, 26); x.fillStyle = '#e8f6ff'; x.fillText('×' + key, 48, 26);
    countTex[key] = new THREE.CanvasTexture(c);
  }
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: countTex[key], transparent: true, depthWrite: false, depthTest: false }));
  sp.scale.set(2.2, 1.1, 1); sp.renderOrder = 10;
  return sp;
}

/* ---------- Modelos fusionados (caché) ---------- */
const templates = new Map();
/** Fusiona todas las mallas estáticas de un modelo en una por material */
function bakeShip(model) {
  model.updateMatrixWorld(true);
  const buckets = new Map(), flames = [];
  model.traverse(o => {
    if (!o.isMesh) return;
    if (o.userData.flame) { flames.push(o); return; }
    const g = o.geometry.clone().applyMatrix4(o.matrixWorld);
    const key = o.material;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(g);
  });
  const root = new THREE.Group();
  for (const [mat, list] of buckets) {
    let total = 0; const nonIdx = list.map(g => g.index ? g.toNonIndexed() : g);
    for (const g of nonIdx) total += g.attributes.position.count;
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    let off = 0;
    for (const g of nonIdx) {
      pos.set(g.attributes.position.array, off * 3);
      if (g.attributes.normal) nor.set(g.attributes.normal.array, off * 3);
      off += g.attributes.position.count;
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(pos, 3)); mg.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    root.add(new THREE.Mesh(mg, mat));
  }
  for (const f of flames) { const c = f.clone(); c.userData.flame = true; root.add(c); }
  return root;
}
function shipInstance(hull, colors) {
  const anim = ['leviatan', 'plaga', 'medusa', 'devorador', 'estacion'].includes(hull);
  if (anim) { const m = makeShip(hull, colors); m.userData.radius = radiusOf(m); return m; }
  const key = hull + '|' + (colors || []).join(',');
  let t = templates.get(key);
  if (!t) {
    const m = makeShip(hull, colors);
    // flames: las mallas "flame" son hijas directas del casco; se conservan con su transformación local
    const flames = m.userData.flames || []; flames.forEach(f => { f.userData.flame = true; });
    delete m.userData.flames;
    t = bakeShip(m); t.userData.radius = radiusOf(m);
    templates.set(key, t);
  }
  const inst = t.clone(true);
  inst.userData.flames = inst.children.filter(c => c.userData.flame);
  inst.userData.radius = t.userData.radius;
  return inst;
}
function radiusOf(obj) {
  const b = new THREE.Box3().setFromObject(obj), v = b.getSize(new THREE.Vector3());
  return Math.max(v.x, v.z) / 2 || 1;
}

/* =====================================================================
 * EFECTOS
 * ===================================================================== */
class FX {
  constructor(scene) { this.scene = scene; this.list = []; }
  _add(obj, life, upd) {
    if (this.list.length > MAX_FX) { const o = this.list.shift(); this._kill(o); }
    this.scene.add(obj); this.list.push({ obj, life, age: 0, upd });
  }
  _kill(e) { this.scene.remove(e.obj); if (e.obj.material) e.obj.material.dispose(); }
  sprite(pos, size, color, life, opts) {
    opts = opts || {};
    const m = new THREE.SpriteMaterial({ map: opts.ring ? ringTex() : softDot(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: opts.opacity || 1 });
    const sp = new THREE.Sprite(m); sp.position.copy(pos); sp.scale.setScalar(size);
    const grow = opts.grow == null ? 1.6 : opts.grow, vel = opts.vel;
    this._add(sp, life, (e, k, dt) => { sp.scale.setScalar(size * (1 + (grow - 1) * k)); m.opacity = (opts.opacity || 1) * (1 - k); if (vel) sp.position.addScaledVector(vel, dt); });
    return sp;
  }
  flash(pos, size, color, life) { this.sprite(pos, size, color, life || 220, { grow: 0.4 }); }
  ring(pos, r0, r1, color, life) {
    const m = new THREE.MeshBasicMaterial({ map: ringTex(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(GEO.ring, m); mesh.position.copy(pos);
    this._add(mesh, life, (e, k) => { mesh.scale.setScalar(r0 + (r1 - r0) * k); m.opacity = 1 - k; });
  }
  sparks(pos, color, n, speed, life, size) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, e = (Math.random() - 0.3) * 1.2;
      const v = new THREE.Vector3(Math.cos(a) * speed * (0.4 + Math.random()), e * speed * 0.6, Math.sin(a) * speed * (0.4 + Math.random()));
      this.sprite(pos.clone(), size || 0.5, color, life * (0.6 + Math.random() * 0.6), { vel: v.multiplyScalar(0.001), grow: 0.2 });
    }
  }
  /** Línea luminosa entre dos puntos (rayo) */
  beam(a, b, color, life, width) {
    const len = a.distanceTo(b) || 0.01;
    const m = new THREE.MeshBasicMaterial({ color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const mesh = new THREE.Mesh(GEO.cyl, m);
    mesh.position.copy(a).add(b).multiplyScalar(0.5); mesh.lookAt(b); mesh.scale.set(width, width, len);
    this._add(mesh, life, (e, k) => { m.opacity = 1 - k * k; mesh.scale.x = mesh.scale.y = width * (1 - k * 0.6); });
  }
  smoke(pos, size, life, color) {
    const m = new THREE.SpriteMaterial({ map: softDot(), color: color || 0x3a4048, transparent: true, depthWrite: false, opacity: 0.55 });
    const sp = new THREE.Sprite(m); sp.position.copy(pos); sp.scale.setScalar(size);
    const v = new THREE.Vector3((Math.random() - 0.5) * 0.0006, 0.0008, (Math.random() - 0.5) * 0.0006);
    this._add(sp, life, (e, k, dt) => { sp.scale.setScalar(size * (1 + k * 2)); m.opacity = 0.55 * (1 - k); sp.position.addScaledVector(v, dt); });
  }
  /** Explosión de nave: bola de fuego + onda + chispas; las grandes encadenan explosiones secundarias */
  explosion(pos, size, view) {
    const s = Math.max(0.8, Math.sqrt(size) * 0.9 * S * 8);
    this.flash(pos, s * 5, 0xfff1c9, 260);
    const m = new THREE.MeshBasicMaterial({ color: 0xffb703, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
    const ball = new THREE.Mesh(GEO.ico, m); ball.position.copy(pos);
    this._add(ball, 650, (e, k) => { ball.scale.setScalar(s * (0.3 + k * 2.2)); m.opacity = 1 - k; m.color.setHSL(0.11 - k * 0.1, 1, 0.62 - k * 0.3); ball.rotation.y += 0.1; });
    this.ring(pos, s * 0.5, s * 4.5, 0xffd9a8, 520);
    this.sparks(pos, 0xffc866, Math.min(14, 5 + Math.round(s * 2)), 14 + s * 4, 700, 0.55 + s * 0.1);
    for (let i = 0; i < Math.min(8, 2 + Math.round(s)); i++) { // restos oscuros
      const v = new THREE.Vector3((Math.random() - 0.5), (Math.random() - 0.2) * 0.6, (Math.random() - 0.5)).multiplyScalar(0.012 * (0.5 + Math.random()));
      const dm = new THREE.MeshBasicMaterial({ color: 0x2a2f36, transparent: true });
      const deb = new THREE.Mesh(GEO.box, dm); deb.position.copy(pos); deb.scale.setScalar(0.18 + Math.random() * 0.3 * s * 0.4); deb.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      this._add(deb, 1100, (e, k, dt) => { deb.position.addScaledVector(v, dt); deb.rotation.x += 0.05; dm.opacity = 1 - k; });
    }
    if (view) view.shake = Math.max(view.shake || 0, Math.min(1.8, 0.15 + s * 0.18));
    if (size >= 14) for (let i = 0; i < Math.min(5, Math.round(size / 18) + 2); i++) {
      setTimeout(() => {
        const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * s * 1.6, (Math.random() - 0.5) * s * 0.6, (Math.random() - 0.5) * s * 1.6));
        this.flash(p, s * 3, 0xffe2a8, 240); this.ring(p, s * 0.3, s * 2.2, 0xffc866, 380); this.sparks(p, 0xffc866, 6, 10, 500, 0.5);
        if (view) view.shake = Math.max(view.shake || 0, 0.5);
      }, 160 + i * 190);
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const e = this.list[i]; e.age += dt;
      const k = Math.min(1, e.age / e.life);
      e.upd(e, k, dt);
      if (k >= 1) { this._kill(e); this.list.splice(i, 1); }
    }
  }
  clear() { for (const e of this.list) this._kill(e); this.list = []; }
}

/* =====================================================================
 * VISOR
 * ===================================================================== */
export class BattleViewer {
  /**
   * @param canvas
   * @param opts { nationInfo(owner)->{colors,color}, relOf(owner)->'mine'|'ally'|'war'|'neutral', delay, onFrameStats }
   */
  constructor(canvas, opts) {
    this.opts = Object.assign({ delay: 620 }, opts || {});
    this.view = new InteractiveScene(canvas, { pan: true, tilt: 0.95, zoom: 150, minZoom: 30, maxZoom: 420, center: [0, 0], bounds: [-120, 120] });
    this.view.renderer.setClearColor(0x04060c);
    this.scene = this.view.scene;
    this.fx = new FX(this.scene);
    this.ents = new Map(); this.projs = new Map(); this.groups = {}; this.gone = new Map();
    this.snaps = []; this.events = [];
    this.autoCam = true; this.shake = 0; this.selected = null; this.focus = null;
    this.pickCb = null; this.last = performance.now(); this.hpBars = true;
    this.view.onPick = p => { if (p && p.type === 'ent' && this.pickCb) this.pickCb(this.entInfo(p.id)); else if (!p && this.pickCb) this.pickCb(null); };
    this.view.onUser = () => { this.autoCam = false; if (this.onAutoCam) this.onAutoCam(false); };
    this.view.onFrame = t => this._frame(t);
    this.root = new THREE.Group(); this.scene.add(this.root);
    this.envObjs = [];
  }
  start() { this.view.resize(); this.view.start(); }
  destroy() { this.fx.clear(); this.view.dispose(); }
  /** Un panel tapa la parte baja de la pantalla: desplaza el encuadre para que la acción quede visible arriba */
  setBottomInset(px) { px = Math.round(px); if (this.view.insetBottom === px) return; this.view.insetBottom = px; this.view.resize(); }
  resetCamera() { this.autoCam = true; if (this.onAutoCam) this.onAutoCam(true); }

  /* ---------- escena estática ---------- */
  setMeta(meta) {
    // Batallas masivas: las naves se dibujan menos exageradas para que no se tapen entre sí (150 naves a ×1.75 eran una mancha)
    let N = 0; for (const g of (meta.groups || [])) if (!g.isPlanet && !g.station) N += (g.count || 1) * (g.role === 'fighter' ? 0.5 : 1);
    VS = Math.max(0.95, Math.min(1.75, 1.75 * Math.sqrt(70 / Math.max(1, N)))); VK = VS / 1.75;
    this.meta = meta; this.arena = meta.arena;
    for (const g of meta.groups) this.groups[g.gid] = g;
    addCosmos(this.scene, new THREE.Vector3(0, 0, 0), 900, { nebulae: meta.env === 'nebula' ? 7 : 3, stars: 900, seed: (meta.seed || 3) % 997 });
    // marco de la arena (sutil)
    const grid = new THREE.GridHelper(150, 15, 0x1d3a52, 0x12212e); grid.position.y = -2.2; grid.material.transparent = true; grid.material.opacity = 0.35; this.scene.add(grid);
    const env = meta.env;
    if (env === 'nebula') {
      this.scene.fog = new THREE.FogExp2(0x2a1346, 0.0075);
      for (let i = 0; i < 9; i++) { const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: i % 2 ? 0x8a4dd6 : 0x2f7fa8, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, fog: false })); sp.scale.set(70, 70, 1); sp.position.set((Math.random() - 0.5) * 120, -3 + Math.random() * 6, (Math.random() - 0.5) * 70); this.scene.add(sp); }
    }
    if (env === 'asteroids' && meta.obstacles) {
      this.rocks = meta.obstacles.map((o, i) => {
        const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), toon(i % 2 ? 0x6b6258 : 0x857a6c)); withOutline(m, 0.05);
        m.scale.set(o.r * S * 1.15, o.r * S * 0.85, o.r * S); m.position.set(WX(o.x), 0, WZ(o.y)); m.rotation.set(i, i * 2, 0); m.userData.spin = 0.0002 + (i % 4) * 0.00008; this.scene.add(m); return m;
      });
      for (let i = 0; i < 90; i++) { const d = new THREE.Mesh(GEO.ico, new THREE.MeshBasicMaterial({ color: 0x8a8070 })); d.scale.setScalar(0.12 + Math.random() * 0.2); d.position.set((Math.random() - 0.5) * 150, (Math.random() - 0.5) * 8, (Math.random() - 0.5) * 80); this.scene.add(d); }
    }
    if (env === 'blackhole' && meta.bh) {
      const bh = new THREE.Group(); bh.position.set(WX(meta.bh.x), 0, WZ(meta.bh.y));
      bh.add(new THREE.Mesh(new THREE.SphereGeometry(meta.bh.r * S * 1.2, 24, 16), new THREE.MeshBasicMaterial({ color: 0x000000 })));
      const diskMat = new THREE.MeshBasicMaterial({ map: ringTex(), color: 0xffa24d, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
      const disk = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), diskMat); disk.scale.set(16, 1, 16); bh.add(disk);
      const disk2 = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), diskMat.clone()); disk2.material.color.set(0xb388ff); disk2.scale.set(27, 1, 27); bh.add(disk2);
      const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xb388ff, transparent: true, opacity: 0.6, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.set(54, 54, 1); bh.add(halo);
      bh.userData.spin = [disk, disk2]; this.scene.add(bh); this.bhObj = bh;
    }
  }
  setGroups(groups) { for (const g of groups) this.groups[g.gid] = g; }

  /* ---------- datos ---------- */
  pushFrame(frame, wallTime) {
    const at = wallTime || performance.now();
    this.snaps.push({ at, f: frame });
    if (this.snaps.length > 6) this.snaps.shift();
    for (const ev of frame.ev || []) this.events.push({ at: at + this.opts.delay, ev });
    if (frame.over && this.onOver) { const o = frame.over; setTimeout(() => this.onOver(o), this.opts.delay + 500); }
    this.lastFrame = frame;
    this._syncEnts(frame);
  }
  entInfo(id) { const e = this.ents.get(id); return e ? { id, gid: e.gid, group: this.groups[e.gid], strike: e.strike, x: e.x, y: e.y, hp: e.hp, n: e.n } : null; }
  setSelected(gid) { this.selected = gid; }
  setFocus(gid) { this.focus = gid; }
  /** Crea/borra entidades según el frame más reciente (las posiciones se interpolan después) */
  _syncEnts(frame) {
    const seen = new Set();
    for (const a of frame.ents) {
      const [id, gid, strike, x, y, hx, hy, hp, sh, n, flags, rad, heat, locked, mMotor, mArms, mSens] = a;
      seen.add(id);
      let st = this.ents.get(id);
      if (!st) st = this._makeEnt(id, gid, strike, rad, x, y, hx, hy);
      st.gid = gid; st.hp = hp; st.sh = sh; st.n = n; st.retreat = flags & 1; st.heat = heat || 0; st.locked = !!locked; st.mods = [mMotor, mArms, mSens];
      if (st.n !== st.shownN) this._updateCount(st);
    }
    for (const [id, st] of this.ents) if (!seen.has(id)) { this._removeEnt(id, st); }
  }
  _makeEnt(id, gid, strike, rad, x, y, hx, hy) {
    const g = this.groups[gid] || { hull: 'corbeta', owner: null };
    const info = this.opts.nationInfo ? this.opts.nationInfo(g.owner) : { colors: ['#9aa', '#c44', '#fff'], color: new THREE.Color(0x999999) };
    const holder = new THREE.Group();
    let model, big = false;
    if (g.isPlanet) {
      model = makePlanet({ seed: (this.meta && this.meta.seed || 1) + gid * 77, biome: 'continental' }, { palette: ['#2a6f97', '#52b788', '#f1faee'] });
      model.userData.radius = 1; model.scale.setScalar(rad * S * 1.0 * 1.4); model.userData.planet = true;
    } else {
      model = shipInstance(strike ? 'caza' : (g.station ? 'estacion' : g.hull), info.colors);
      const target = Math.max(2.6 * VK, rad * S * 2.1 * VS);
      const r = model.userData.radius || 1;
      model.scale.setScalar(target / (2 * r) * (g.monster ? (g.hull === 'plaga' ? 1.2 : 1.9) : 1));
      big = rad > 18;
    }
    holder.add(model);
    const hit = new THREE.Mesh(new THREE.SphereGeometry(Math.max(2.2 * VK, rad * S * 1.5 * VS), 6, 4), new THREE.MeshBasicMaterial({ visible: false })); holder.add(hit);
    holder.userData.pick = { type: 'ent', id };
    holder.position.set(WX(x), 0, WZ(y));
    this.scene.add(holder); this.view.clickables.push(holder);
    // marcador de relación (anillo plano bajo la nave)
    const rel = this.opts.relOf ? this.opts.relOf(g.owner) : 'neutral';
    const ringMat = new THREE.MeshBasicMaterial({ map: ringTex(), color: REL_COLOR[rel] || 0xffffff, transparent: true, opacity: strike ? 0.35 : 0.8, depthWrite: false, blending: THREE.AdditiveBlending });
    const ring = new THREE.Mesh(GEO.ring, ringMat); ring.scale.setScalar(Math.max(2.0 * VK, rad * S * 1.35 * VS)); ring.position.y = -0.6; holder.add(ring);
    // escudo
    let shield = null;
    if (!strike) { shield = new THREE.Mesh(GEO.shield, new THREE.MeshBasicMaterial({ color: 0x6fd8ff, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide })); shield.scale.setScalar(Math.max(1.9 * VK, rad * S * 1.02 * VS)); shield.visible = false; holder.add(shield); }
    // barra de vida (billboard separado, no rota con la nave)
    const bar = new THREE.Group();
    const bw = Math.max(2.6 * VK, rad * S * 2.3 * VS);
    const bg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x07090c, transparent: true, opacity: 0.8, depthTest: false })); bg.center.set(0, 0.5); bg.scale.set(bw, 0.34, 1); bg.position.x = -bw / 2; bg.renderOrder = 9;
    const fg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x57cc99, depthTest: false })); fg.center.set(0, 0.5); fg.scale.set(bw, 0.2, 1); fg.position.x = -bw / 2; fg.renderOrder = 11;
    const sbar = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x6fd8ff, depthTest: false })); sbar.center.set(0, 0.5); sbar.scale.set(bw, 0.09, 1); sbar.position.set(-bw / 2, 0.19, 0); sbar.renderOrder = 12;
    bar.add(bg, fg, sbar); bar.visible = false; this.scene.add(bar);
    const st = { id, gid, strike, rad, holder, model, shield, ring, ringMat, bar, fg, sbar, bw, hit, x, y, hx, hy, tx: x, ty: y, thx: hx, thy: hy, hp: 100, sh: -1, n: 1, big, rel, born: performance.now(), flash: 0, bank: 0, smokeT: 0, ang: Math.atan2(hx, hy) };
    this.ents.set(id, st);
    // aparición: destello de entrada (refuerzos, lanzamientos)
    this.fx.flash(holder.position.clone(), Math.max(2, rad * S * 3), 0x9ae8ff, 320);
    return st;
  }
  _updateCount(st) {
    if (st.cnt) { st.holder.remove(st.cnt); st.cnt.material.dispose(); st.cnt = null; }
    st.shownN = st.n;
    if (st.n > 1 && !st.strike) { st.cnt = countSprite(st.n); st.cnt.position.set(0, Math.max(2.2, st.rad * S * 1.1 * VS) + 1.0, 0); st.holder.add(st.cnt); }
  }
  _removeEnt(id, st) {
    this.scene.remove(st.holder); this.scene.remove(st.bar);
    const i = this.view.clickables.indexOf(st.holder); if (i >= 0) this.view.clickables.splice(i, 1);
    this.gone.set(id, { gid: st.gid, n: st.n, strike: st.strike }); if (this.gone.size > 400) this.gone.delete(this.gone.keys().next().value);
    this.ents.delete(id);
  }

  /* ---------- bucle de dibujo ---------- */
  _interp() {
    const s = this.snaps, now = performance.now(), rt = now - this.opts.delay;
    if (!s.length) return null;
    let a = s[0], b = s[s.length - 1];
    if (s.length >= 2) { for (let i = s.length - 1; i > 0; i--) if (s[i - 1].at <= rt) { a = s[i - 1]; b = s[i]; break; } if (rt < s[0].at) { a = s[0]; b = s[0]; } }
    let k = b.at > a.at ? (rt - a.at) / (b.at - a.at) : 1;
    k = Math.max(0, Math.min(1, k));
    return { a: a.f, b: b.f, k };
  }
  _frame(t) {
    const now = performance.now(), dt = Math.min(80, now - this.last); this.last = now;
    const I = this._interp();
    if (I) this._apply(I, dt, t);
    // eventos vencidos
    while (this.events.length && this.events[0].at <= now) this._event(this.events.shift().ev);
    this.fx.update(dt);
    if (this.rocks) for (const r of this.rocks) { r.rotation.y += r.userData.spin * dt; r.rotation.x += r.userData.spin * 0.6 * dt; }
    if (this.bhObj) { this.bhObj.userData.spin[0].rotation.y += 0.0009 * dt; this.bhObj.userData.spin[1].rotation.y -= 0.0005 * dt; }
    if (this.autoCam) this._autoCam(dt);
    // sacudida: perturbación temporal de la cámara (no se acumula)
    if (this.shake > 0.01) {
      const c = this.view.camera, m = this.shake;
      c.position.x += (Math.random() - 0.5) * m; c.position.y += (Math.random() - 0.5) * m * 0.6; c.position.z += (Math.random() - 0.5) * m;
      this.shake *= 0.9;
    }
  }
  _apply(I, dt, t) {
    const posOf = new Map(); for (const e of I.a.ents) posOf.set(e[0], e);
    const next = new Map(); for (const e of I.b.ents) next.set(e[0], e);
    const k = I.k;
    for (const [id, st] of this.ents) {
      const A = posOf.get(id) || next.get(id), B = next.get(id) || A;
      if (!A) continue;
      const x = A[3] + (B[3] - A[3]) * k, y = A[4] + (B[4] - A[4]) * k;
      let hx = A[5] + (B[5] - A[5]) * k, hy = A[6] + (B[6] - A[6]) * k;
      const l = Math.hypot(hx, hy) || 1; hx /= l; hy /= l;
      const ang = Math.atan2(hx, hy);
      let da = ang - st.ang; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      st.bank += (Math.max(-0.5, Math.min(0.5, da * 2.2)) - st.bank) * 0.15;
      st.ang += da * 0.5;
      st.x = x; st.y = y;
      st.holder.position.set(WX(x), 0, WZ(y));
      if (!st.model.userData.planet) { st.holder.rotation.y = st.ang; st.model.rotation.z = st.bank * 0.7; }
      if (st.model.userData.flames || st.model.userData.anim) animateFlames(st.model, t, 1 + (st.retreat ? 1.2 : 0));
      // escudo y vida
      const hp = st.hp, sh = st.sh;
      if (st.shield) {
        const show = sh > 0 || st.flash > 0;
        st.shield.visible = show;
        if (show) { st.shield.material.opacity = (sh > 0 ? 0.025 + 0.06 * (sh / 100) : 0.01) + st.flash * 0.5; st.shield.material.color.setHex(sh > 25 ? 0x6fd8ff : 0xffb86b); st.flash = Math.max(0, st.flash - dt / 260); }
      }
      const showBar = (hp < 99 || sh >= 0 && sh < 99 || st.big || this.selected === st.gid || this.focus === st.gid) && !st.strike;
      st.bar.visible = showBar && this.hpBars;
      if (st.bar.visible) {
        st.bar.position.set(WX(x), Math.max(2.0, st.rad * S * 0.9 * VS) + 1.2, WZ(y));
        st.fg.scale.x = Math.max(0.001, st.bw * hp / 100);
        st.fg.material.color.setHex(hp > 55 ? 0x57cc99 : hp > 28 ? 0xffd166 : 0xef476f);
        st.sbar.visible = sh >= 0; if (sh >= 0) st.sbar.scale.x = Math.max(0.001, st.bw * sh / 100);
      }
      // anillo: pulso si está seleccionado / marcado
      const marked = this.selected === st.gid, focused = this.focus === st.gid;
      st.ringMat.opacity = (st.strike ? 0.3 : 0.75) + (marked ? 0.25 * Math.sin(t * 0.008) : 0);
      st.ringMat.color.setHex(focused ? 0xff7b54 : marked ? 0xffffff : REL_COLOR[st.rel] || 0xffffff);
      // sobrecalentada: expulsa vapor y su anillo se pone rojo (las armas esperan a enfriarse)
      if (st.locked && !st.strike && !st.model.userData.planet) {
        st.steamT = (st.steamT || 0) - dt;
        if (st.steamT <= 0) { st.steamT = 120 + Math.random() * 90; const p = st.holder.position.clone(); p.y += 0.6; p.x += (Math.random() - 0.5) * st.rad * S; this.fx.smoke(p, 0.7 + st.rad * S * 0.22, 700, 0xffd9c2); }
        st.ringMat.color.setHex(0xff7b54);
      }
      // humo / fuego en naves dañadas
      if (hp < 45 && !st.strike && !st.model.userData.planet) {
        st.smokeT -= dt;
        if (st.smokeT <= 0) { st.smokeT = 140 + Math.random() * 120 - (45 - hp) * 2; const p = st.holder.position.clone(); p.y += 0.5; p.x += (Math.random() - 0.5) * st.rad * S; this.fx.smoke(p, 0.8 + st.rad * S * 0.25, 900, hp < 22 ? 0x8a3a16 : 0x3a4048); if (hp < 22) this.fx.sprite(p, 0.9, 0xff8a3d, 260, { grow: 0.3 }); }
      }
    }
    // proyectiles
    const pa = new Map(); for (const p of I.a.projs) pa.set(p[0], p);
    const seen = new Set();
    for (const pb of I.b.projs) {
      const pA = pa.get(pb[0]) || pb;
      seen.add(pb[0]);
      let pr = this.projs.get(pb[0]);
      if (!pr) pr = this._makeProj(pb);
      const x = pA[2] + (pb[2] - pA[2]) * k, y = pA[3] + (pb[3] - pA[3]) * k;
      pr.obj.position.set(WX(x), 0, WZ(y));
      const vx = pb[4], vy = pb[5];
      if (vx || vy) pr.obj.rotation.y = Math.atan2(vx, vy);
      if (pr.trail) { pr.trailT -= dt; if (pr.trailT <= 0) { pr.trailT = pr.torp ? 60 : 85; this.fx.smoke(pr.obj.position.clone(), pr.torp ? 0.8 : 0.5, 520, pr.torp ? 0xffb066 : 0xd9dde2); } }
    }
    for (const [id, pr] of this.projs) if (!seen.has(id)) { this.scene.remove(pr.obj); pr.obj.traverse(o => { if (o.material) o.material.dispose(); }); this.projs.delete(id); }
  }
  _makeProj(p) {
    const code = p[7], color = PROJ_COLORS[code] != null ? PROJ_COLORS[code] : 0xffffff, missile = p[1] === 1, big = !!p[6];
    const g = new THREE.Group();
    if (missile) {
      const body = new THREE.Mesh(GEO.cone, new THREE.MeshBasicMaterial({ color: 0xe8eaee })); const sm = code === 9 ? 0.6 : 1; body.scale.set((big ? 0.45 : 0.28) * sm, (big ? 0.45 : 0.28) * sm, (big ? 0.7 : 0.5) * sm); g.add(body);
      const glowS = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); glowS.scale.setScalar(big ? 2.2 : 1.3); glowS.position.z = -0.5; g.add(glowS);
    } else {
      const m = new THREE.Mesh(GEO.cyl, new THREE.MeshBasicMaterial({ color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
      const len = code === 1 ? 2.6 : code === 2 ? 1.2 : 1.4, w = code === 2 ? 0.34 : code === 1 ? 0.12 : 0.15; m.scale.set(w, w, len); g.add(m);
      const gl = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.8 })); gl.scale.setScalar(code === 2 ? 1.6 : 0.9); g.add(gl);
    }
    g.position.y = 0.2; this.scene.add(g);
    const pr = { obj: g, trail: missile, torp: big, trailT: 0 };
    this.projs.set(p[0], pr);
    return pr;
  }

  /* ---------- eventos del simulador ---------- */
  _pos(id) { const e = this.ents.get(id); return e ? e.holder.position.clone().setY(0.4) : null; }
  _event(ev) {
    switch (ev.k) {
      case 'fire': { const p = this._pos(ev.f); if (p) this.fx.flash(p, 1.4, LASER_COLORS[ev.c] || 0xffd166, 120); break; }
      case 'beam': {
        const a = this._pos(ev.f), b = this._pos(ev.t); if (!a || !b) break;
        const color = LASER_COLORS[ev.c] || 0x7cf4ff, pd = ev.c === 'pd';
        if (!ev.h) { const o = (ev.o || 0) * S; b.x += o * 0.6; b.z += o * 0.4; }
        this.fx.beam(a, b, color, pd ? 110 : 200, pd ? 0.07 : 0.16);
        if (ev.h) { this.fx.flash(b, pd ? 0.9 : 1.6, color, 180); const t = this.ents.get(ev.t); if (t && t.sh > 0) t.flash = 1; }
        break;
      }
      case 'melee': { const b = this._pos(ev.t), a = this._pos(ev.f); if (b) { this.fx.sparks(b, 0xff3b4a, 12, 18, 600, 0.9); this.fx.ring(b, 0.5, 5, 0xff3b4a, 450); this.shake = Math.max(this.shake, 0.9); } if (a && b) this.fx.beam(a, b, 0xff3b4a, 260, 0.5); break; }
      case 'hit': {
        const p = new THREE.Vector3(WX(ev.x), 0.4, WZ(ev.y));
        const t = this.ents.get(ev.t); const shielded = t && t.sh > 0;
        const col = shielded ? 0x6fd8ff : (ev.c === 'plasma' ? 0xff4dff : 0xffb86b);
        this.fx.flash(p, ev.big ? 3.4 : 1.5, col, 200); this.fx.sparks(p, col, ev.big ? 8 : 3, 8, 380, 0.4);
        if (t && shielded) t.flash = 1;
        if (ev.big) { this.fx.ring(p, 0.5, 3.5, col, 360); this.shake = Math.max(this.shake, 0.35); }
        break;
      }
      case 'shdown': { const t = this.ents.get(ev.t); if (t) { this.fx.ring(t.holder.position.clone().setY(0.4), t.rad * S * VS, t.rad * S * VS * 2.4, 0x6fd8ff, 450); t.flash = 1; } break; }
      case 'icpt': { const p = new THREE.Vector3(WX(ev.x), 0.4, WZ(ev.y)); this.fx.flash(p, 2.2, 0xfff2a8, 220); this.fx.ring(p, 0.3, 2.2, 0xfff2a8, 300); this.fx.sparks(p, 0xfff2a8, 5, 9, 320, 0.35); break; }
      case 'rock': { const p = new THREE.Vector3(WX(ev.x), 0.4, WZ(ev.y)); this.fx.sparks(p, 0xb8a98f, 4, 6, 300, 0.3); break; }
      case 'boom': {
        const p = new THREE.Vector3(WX(ev.x), 0.4, WZ(ev.y));
        if (ev.dv) { this.fx.ring(p, 3, 0.2, 0xb388ff, 600); this.fx.flash(p, 3, 0xb388ff, 400); }
        else this.fx.explosion(p, ev.s || 1, this);
        break;
      }
      case 'emp': { const p = new THREE.Vector3(WX(ev.x), 0.6, WZ(ev.y)); this.fx.ring(p, 2, 300 * S * 2, 0xc77dff, 900); this.fx.flash(p, 12, 0xc77dff, 500); this.shake = Math.max(this.shake, 0.5); break; }
      case 'escape': { const p = new THREE.Vector3(WX(ev.x || 0), 0.5, WZ(ev.y || 0)); this.fx.flash(p, 5, 0x7cd5ff, 500); this.fx.ring(p, 1, 6, 0x7cd5ff, 500); break; }
      case 'hot': { const p = this._pos(ev.id); if (p) { this.fx.ring(p, 0.6, 3.2, 0xff7b54, 420); this.fx.flash(p, 2.4, 0xff7b54, 260); } break; }
      case 'mod': { const p = this._pos(ev.id); if (p) { this.fx.sparks(p, ev.m === 'motor' ? 0xffd166 : ev.m === 'arms' ? 0xff7b54 : 0x7cf4ff, 7, 9, 420, 0.4); this.fx.flash(p, 1.8, 0xffb86b, 200); } break; }
      case 'surr': { const p = new THREE.Vector3(WX(ev.x), 0.5, WZ(ev.y)); this.fx.ring(p, 0.8, 4, 0xf1faee, 700); this.fx.flash(p, 4, 0xf1faee, 500); break; }
      case 'launch': { const p = this._pos(ev.f); if (p) this.fx.flash(p, 3, 0xffd166, 300); break; }
      case 'reinf': if (this.onReinf) this.onReinf(ev.side); break;
    }
    if (this.onEvent) this.onEvent(ev);
  }

  /* ---------- cámara automática ---------- */
  _autoCam(dt) {
    let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9, n = 0;
    for (const st of this.ents.values()) { if (st.strike) continue; const x = st.holder.position.x, z = st.holder.position.z; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z); n++; }
    if (!n) return;
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2, ex = Math.max(34, maxX - minX + 16), ez = Math.max(20, maxZ - minZ + 12);
    const cam = this.view.camera, vf = cam.fov * Math.PI / 180, tv = Math.tan(vf / 2), th = tv * cam.aspect;
    const tilt = this.view.opts.tilt;
    const need = Math.max(ex / (2 * th), ez * Math.sin(tilt) / (2 * tv)) * 1.1 + 6;
    const kk = 1 - Math.pow(0.0015, dt / 1000);
    this.view.target.x += (cx - this.view.target.x) * kk; this.view.target.z += (cz - this.view.target.z) * kk;
    this.view.zoom += (Math.max(48, Math.min(this.view.opts.maxZoom, need)) - this.view.zoom) * kk;
  }
}
