/* =====================================================================
 * RENDER 3D — estilo flat / low-poly / cell-shading (toon)
 * ---------------------------------------------------------------------
 * - MeshToonMaterial con gradiente de 3 tonos = cell-shading barato.
 * - Contornos con la técnica de "casco invertido" (BackSide).
 * - Fondo de COSMOS procedural: textura de nebulosas generada en canvas
 *   + campo de estrellas 3D (Points) con parallax + nebulosas en el plano.
 * - Naves: ver js/ships3d.js (proa = +Z, se orientan con lookAt()).
 * - Un solo WebGLRenderer compartido para miniaturas cacheadas.
 *
 * Escenas exportadas:
 *   buildGalaxy()     mapa de la galaxia (sistemas, hiperrutas, flotas en viaje)
 *   buildSystem()     un sistema (estrella, órbitas, planetas, flotas)
 *   buildShipPreview() preview giratorio del diseñador
 *   (las batallas en vivo/repetición están en js/battle3d.js)
 * ===================================================================== */
import * as THREE from '../vendor/three.module.js';
import { makeShip, animateFlames, toon, withOutline, HULL_SCALE } from './ships3d.js';

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function dispose(obj) { obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

/* =====================================================================
 * COSMOS (fondo)
 * ===================================================================== */
let cosmosTex = null;
/** Textura de fondo: nebulosas suaves + estrellas finas, generada una vez */
function cosmosTexture() {
  if (cosmosTex) return cosmosTex;
  const S = 1024, c = document.createElement('canvas'); c.width = c.height = S;
  const x = c.getContext('2d');
  const r = rng(1337);
  const bg = x.createLinearGradient(0, 0, S, S);
  bg.addColorStop(0, '#04060c'); bg.addColorStop(0.5, '#070a14'); bg.addColorStop(1, '#05040b');
  x.fillStyle = bg; x.fillRect(0, 0, S, S);
  // Nebulosas: muchas manchas radiales superpuestas en "lighter"
  x.globalCompositeOperation = 'lighter';
  const neb = [[63, 46, 140], [20, 90, 120], [120, 30, 90], [30, 60, 140], [90, 50, 30]];
  for (let i = 0; i < 70; i++) {
    const col = neb[Math.floor(r() * neb.length)];
    // agrupamos las manchas en 3 "brazos" para que parezca una nebulosa real
    const arm = i % 3, t = r();
    const cx = S * (0.15 + arm * 0.33 + (t - 0.5) * 0.35), cy = S * (0.25 + t * 0.55 + Math.sin(t * 6 + arm) * 0.08);
    const rad = S * (0.05 + r() * 0.18);
    const g = x.createRadialGradient(cx, cy, 0, cx, cy, rad);
    g.addColorStop(0, `rgba(${col[0]},${col[1]},${col[2]},${0.10 + r() * 0.08})`);
    g.addColorStop(1, 'rgba(0,0,0,0)');
    x.fillStyle = g; x.fillRect(cx - rad, cy - rad, rad * 2, rad * 2);
  }
  x.globalCompositeOperation = 'source-over';
  // Estrellas pequeñas
  for (let i = 0; i < 1600; i++) {
    const a = r() * r();
    x.fillStyle = `rgba(${220 + r() * 35},${225 + r() * 30},255,${0.25 + a * 0.75})`;
    const sz = r() < 0.97 ? 1 : 2;
    x.fillRect(r() * S, r() * S, sz, sz);
  }
  // Algunas estrellas brillantes con destello en cruz
  for (let i = 0; i < 18; i++) {
    const px = r() * S, py = r() * S, l = 4 + r() * 7;
    x.strokeStyle = 'rgba(200,235,255,.55)'; x.lineWidth = 1;
    x.beginPath(); x.moveTo(px - l, py); x.lineTo(px + l, py); x.moveTo(px, py - l); x.lineTo(px, py + l); x.stroke();
    x.fillStyle = '#fff'; x.fillRect(px - 1, py - 1, 2, 2);
  }
  cosmosTex = new THREE.CanvasTexture(c);
  cosmosTex.colorSpace = THREE.SRGBColorSpace;
  return cosmosTex;
}
let softDotTex = null;
export function softDot() {
  if (softDotTex) return softDotTex;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const x = c.getContext('2d'); const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.25, 'rgba(255,255,255,.6)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 64);
  softDotTex = new THREE.CanvasTexture(c); return softDotTex;
}
/**
 * Añade el cosmos a una escena.
 * center: punto central; radius: radio del cascarón de estrellas.
 */
export function addCosmos(scene, center, radius, opts) {
  opts = opts || {};
  scene.background = cosmosTexture();
  const r = rng(opts.seed || 7);
  const N = opts.stars || 1400;
  const pos = new Float32Array(N * 3), col = new Float32Array(N * 3);
  const tint = [new THREE.Color(0xcfe9ff), new THREE.Color(0xffffff), new THREE.Color(0xffe2b8), new THREE.Color(0xb8c8ff)];
  for (let i = 0; i < N; i++) {
    // distribución en cascarón esférico (parallax al desplazar la cámara)
    const u = r() * 2 - 1, th = r() * Math.PI * 2, rr = radius * (0.7 + r() * 0.3);
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = center.x + Math.cos(th) * s * rr; pos[i * 3 + 1] = center.y + u * rr * 0.8 - radius * 0.15; pos[i * 3 + 2] = center.z + Math.sin(th) * s * rr;
    const c = tint[Math.floor(r() * tint.length)]; col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  const pts = new THREE.Points(g, new THREE.PointsMaterial({ size: opts.starSize || 2.2, sizeAttenuation: false, vertexColors: true, map: softDot(), transparent: true, depthWrite: false, fog: false }));
  pts.userData.cosmos = true;
  scene.add(pts);
  // Nebulosas planas (sprites aditivos enormes y tenues) por debajo del plano de juego
  if (opts.nebulae) {
    const colors = [0x5b3a9e, 0x1d6f8c, 0x8c2f6b, 0x2d4aa0];
    for (let i = 0; i < opts.nebulae; i++) {
      const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: colors[i % colors.length], transparent: true, opacity: 0.16 + r() * 0.1, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      const sc = radius * (0.25 + r() * 0.35);
      sp.scale.set(sc, sc, 1);
      sp.position.set(center.x + (r() - 0.5) * radius * 0.9, center.y - 60 - r() * 80, center.z + (r() - 0.5) * radius * 0.9);
      scene.add(sp);
    }
  }
  return pts;
}

/* =====================================================================
 * PLANETAS Y ESTRELLAS
 * ===================================================================== */
export function makePlanet(planet, biome) {
  const r = rng(planet.seed || 1);
  const g = new THREE.IcosahedronGeometry(1, 3).toNonIndexed();
  const pal = biome.palette.map(c => new THREE.Color(c));
  const pos = g.attributes.position;
  const colors = [];
  const v = new THREE.Vector3(), cen = new THREE.Vector3();
  const blobs = Array.from({ length: 8 }, () => ({ c: new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(), s: 0.35 + r() * 0.5 }));
  const isGas = planet.biome === 'gaseoso';
  // Color por CARA (centro del triángulo) para un look facetado limpio
  for (let i = 0; i < pos.count; i += 3) {
    cen.set(0, 0, 0);
    for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, i + k); cen.add(v); }
    cen.multiplyScalar(1 / 3).normalize();
    let h = 0;
    for (const b of blobs) h = Math.max(h, 1 - cen.distanceTo(b.c) / b.s);
    let col;
    if (isGas) col = pal[((Math.floor((cen.y + 1) * 3.5 + Math.sin(cen.x * 4) * 0.5) % 3) + 3) % 3];   // (el índice podía ser negativo en el polo sur y rompía la ficha de los gigantes gaseosos)
    else if (Math.abs(cen.y) > 0.86 && planet.biome !== 'volcanico' && planet.biome !== 'desertico') col = pal[2];
    else col = h > 0.15 ? (h > 0.55 ? pal[1].clone().lerp(pal[2], 0.25) : pal[1]) : pal[0];
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(pos, i + k);
      const hv = (!isGas && h > 0.15) ? 1 + h * 0.07 : 1;
      v.normalize().multiplyScalar(hv); pos.setXYZ(i + k, v.x, v.y, v.z);
      colors.push(col.r, col.g, col.b);
    }
  }
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals();
  const mesh = new THREE.Mesh(g, toon(0xffffff, { vertexColors: true }));
  withOutline(mesh, 0.04);
  // Atmósfera (halo fresnel barato: esfera BackSide translúcida)
  const atm = new THREE.Mesh(new THREE.IcosahedronGeometry(1.12, 2), new THREE.MeshBasicMaterial({ color: pal[isGas ? 1 : 0].clone().lerp(new THREE.Color(0xffffff), 0.4), transparent: true, opacity: 0.18, side: THREE.BackSide, depthWrite: false }));
  mesh.add(atm);
  if (isGas || r() < 0.15) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.85, 32), toon(pal[2], { side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    ring.rotation.x = Math.PI / 2.4; mesh.add(ring);
  }
  return mesh;
}
export function makeStar(color, size) {
  size = size || 1;
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.IcosahedronGeometry(size, 1), new THREE.MeshBasicMaterial({ color })));
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo.scale.set(size * 5, size * 5, 1); g.add(halo);
  const halo2 = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color, transparent: true, opacity: 0.25, depthWrite: false, blending: THREE.AdditiveBlending }));
  halo2.scale.set(size * 11, size * 11, 1); g.add(halo2);
  return g;
}

/* =====================================================================
 * MINIATURAS (renderer compartido)
 * ===================================================================== */
let thumbRenderer = null;
const thumbCache = new Map();
function getThumbRenderer() {
  if (!thumbRenderer) { thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true }); thumbRenderer.setSize(192, 192); }
  return thumbRenderer;
}
function lights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const d = new THREE.DirectionalLight(0xffffff, 1.7); d.position.set(-3, 3, 4); scene.add(d);
  const rim = new THREE.DirectionalLight(0x6fb6ff, 0.6); rim.position.set(4, -1, -3); scene.add(rim);
}
export function planetThumb(planet, biome) {
  const key = 'p' + planet.seed + planet.biome;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const R = getThumbRenderer();
  const scene = new THREE.Scene(); lights(scene);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50); cam.position.set(0, 0, planet.biome === 'gaseoso' ? 7 : 4.8);
  const p = makePlanet(planet, biome); p.rotation.set(0.3, 0.6, 0); scene.add(p);
  R.render(scene, cam);
  const url = R.domElement.toDataURL(); thumbCache.set(key, url); dispose(scene);
  return url;
}
/** colors: array de colores de bandera o número */
export function shipThumb(hullId, colors) {
  const key = 's' + hullId + JSON.stringify(colors);
  if (thumbCache.has(key)) return thumbCache.get(key);
  const R = getThumbRenderer();
  const scene = new THREE.Scene(); lights(scene);
  const s = makeShip(hullId, colors);
  // vista 3/4 desde delante-arriba (se ve la proa a la izquierda-abajo)
  s.rotation.y = -Math.PI * 0.72; scene.add(s);
  const box = new THREE.Box3().setFromObject(s); const size = box.getSize(new THREE.Vector3()).length(); const c = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(32, 1, 0.1, 100);
  cam.position.set(c.x, c.y + size * 0.75, c.z + size * 1.25); cam.lookAt(c);
  R.render(scene, cam);
  const url = R.domElement.toDataURL(); thumbCache.set(key, url); dispose(scene);
  return url;
}

/* =====================================================================
 * ESCENA INTERACTIVA (arrastrar = desplazar, pellizcar/rueda = zoom)
 * ===================================================================== */
export class InteractiveScene {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = Object.assign({ tilt: 0.9, minZoom: 30, maxZoom: 900, zoom: 600, center: [500, 500], pan: true, bounds: [-100, 1100] }, opts);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x05070c);
    this.scene = new THREE.Scene();
    lights(this.scene);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 8000);
    this.target = new THREE.Vector3(this.opts.center[0], 0, this.opts.center[1]);
    this.zoom = this.opts.zoom;
    this.clickables = [];
    this.onPick = null; this.onFrame = null; this.running = false;
    this._bindInput();
    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    this.resize();
  }
  /** Libera el listener de resize (cuando se destruye la escena) */
  dispose() { this.running = false; window.removeEventListener('resize', this._onResize); this.renderer.dispose(); }
  resize() {
    if (!this.canvas.parentElement) return;
    const r = this.canvas.parentElement.getBoundingClientRect();
    this.viewW = r.width; this.viewH = r.height;
    if (!r.width) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix();
    if (this.insetBottom) this.camera.setViewOffset(r.width, r.height, 0, this.insetBottom / 2, r.width, r.height);
    else this.camera.clearViewOffset();
  }
  updateCamera() {
    this.zoom = Math.max(this.opts.minZoom, Math.min(this.opts.maxZoom, this.zoom));
    const t = this.opts.tilt;
    this.camera.position.set(this.target.x, Math.sin(t) * this.zoom, this.target.z + Math.cos(t) * this.zoom);
    this.camera.lookAt(this.target);
  }
  _bindInput() {
    const c = this.canvas, pts = new Map();
    let lastDist = 0, moved = 0, down = null;
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; down = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId); const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastDist) this.zoom *= lastDist / d; lastDist = d; moved += 10; if (this.onUser) this.onUser();
      } else if (this.opts.pan) {
        const k = this.zoom / this.canvas.clientHeight * 0.9;
        this.target.x -= dx * k; this.target.z -= dy * k / Math.sin(this.opts.tilt);
        const [lo, hi] = this.opts.bounds;
        this.target.x = Math.max(lo, Math.min(hi, this.target.x)); this.target.z = Math.max(lo, Math.min(hi, this.target.z));
        moved += Math.abs(dx) + Math.abs(dy); if (this.onUser && Math.abs(dx) + Math.abs(dy) > 1) this.onUser();
      }
    });
    const up = e => { pts.delete(e.pointerId); if (pts.size < 2) lastDist = 0; if (down && moved < 8 && pts.size === 0) this._pick(e.clientX, e.clientY); down = null; };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoom *= e.deltaY > 0 ? 1.12 : 0.89; if (this.onUser) this.onUser(); }, { passive: false });
  }
  _pick(x, y) {
    const r = this.canvas.getBoundingClientRect();
    const v = new THREE.Vector2(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(v, this.camera);
    const hits = ray.intersectObjects(this.clickables, true);
    let obj = hits[0] && hits[0].object;
    while (obj && !obj.userData.pick) obj = obj.parent;
    if (this.onPick) this.onPick(obj ? obj.userData.pick : null);
  }
  project(vec3) {
    const v = vec3.clone().project(this.camera);
    return { x: (v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - v.y) / 2 * this.canvas.clientHeight, visible: v.z < 1 && v.x > -1.2 && v.x < 1.2 && v.y > -1.2 && v.y < 1.2 };
  }
  clear() {
    for (let i = this.scene.children.length - 1; i >= 0; i--) { const o = this.scene.children[i]; if (!o.isLight) { this.scene.remove(o); dispose(o); } }
    this.clickables = []; this.onFrame = null; this.scene.fog = null;
  }
  start() {
    if (this.running) return;
    this.running = true;
    const loop = (t) => {
      if (!this.running) return;
      this.updateCamera();
      if (this.onFrame) this.onFrame(t);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }
  stop() { this.running = false; }
}

/* =====================================================================
 * MAPA GALÁCTICO
 * ===================================================================== */

/* =====================================================================
 * OBJETOS ESPACIALES (agujeros negros, cinturones, nebulosas, ruinas, guaridas)
 * Cada función devuelve un THREE.Group; si tiene userData.anim(t) se anima
 * desde el bucle de la escena. Ver docs/OBJETOS_ESPACIALES.md
 * ===================================================================== */
const CREATURES = ['leviatan', 'plaga', 'medusa', 'devorador', 'estacion'];
let ringTexture = null;
function ringTex() {
  if (ringTexture) return ringTexture;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 30, 64, 64, 62);
  g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.45, 'rgba(255,255,255,.95)'); g.addColorStop(0.75, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  return (ringTexture = new THREE.CanvasTexture(c));
}
/** Agujero negro: esfera negra + disco de acreción + halo violeta */
export function makeBlackHole(size) {
  const g = new THREE.Group();
  g.add(new THREE.Mesh(new THREE.SphereGeometry(size * 0.55, 20, 14), new THREE.MeshBasicMaterial({ color: 0x000000 })));
  const mk = (col, s) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ map: ringTex(), color: col, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide })); m.scale.set(s, 1, s); g.add(m); return m; };
  const d1 = mk(0xffa24d, size * 3.2), d2 = mk(0xb388ff, size * 5.2); d1.rotation.z = 0.12; d2.rotation.z = -0.1;
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xb388ff, transparent: true, opacity: 0.7, depthWrite: false, blending: THREE.AdditiveBlending })); halo.scale.set(size * 9, size * 9, 1); g.add(halo);
  g.userData.anim = t => { d1.rotation.y = t * 0.0009; d2.rotation.y = -t * 0.0005; halo.material.opacity = 0.55 + Math.sin(t * 0.002) * 0.12; };
  return g;
}
/** Nube de nebulosa: sprites aditivos grandes y tenues */
export function makeNebulaCloud(radius, seed) {
  const g = new THREE.Group(), r = rng(seed || 5), cols = [0x8a4dd6, 0x2f7fa8, 0xc0509c];
  for (let i = 0; i < 6; i++) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: cols[i % 3], transparent: true, opacity: 0.2 + r() * 0.12, depthWrite: false, blending: THREE.AdditiveBlending }));
    sp.scale.setScalar(radius * (1.2 + r() * 1.2)); sp.position.set((r() - 0.5) * radius * 1.1, (r() - 0.5) * 6, (r() - 0.5) * radius * 1.1); g.add(sp);
  }
  return g;
}
/** Cinturón de asteroides (instanciado): anillo de rocas que gira despacio */
export function makeBeltRing(radius, count, seed, width) {
  const r = rng(seed || 9), geo = new THREE.DodecahedronGeometry(1, 0), inst = new THREE.InstancedMesh(geo, toon(0x8a7f70), count);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3(), pos = new THREE.Vector3();
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, rr = radius + (r() - 0.5) * (width || 14);
    pos.set(Math.cos(a) * rr, (r() - 0.5) * 4, Math.sin(a) * rr * 0.9); e.set(r() * 6, r() * 6, r() * 6); q.setFromEuler(e); sc.setScalar(0.35 + r() * r() * 1.5);
    m.compose(pos, q, sc); inst.setMatrixAt(i, m);
  }
  const g = new THREE.Group(); g.add(inst);
  g.userData.anim = t => { g.rotation.y = t * 0.00003; };
  return g;
}
/** Ruinas: restos flotantes con una baliza dorada */
export function makeRuinsMarker(size) {
  const g = new THREE.Group(), r = rng(21), dark = toon(0x3b3f47), gold = toon(0xb8923a);
  for (let i = 0; i < 7; i++) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.4 + r() * 1.2, 0.2 + r() * 0.3, 0.6 + r() * 1.6), i % 3 ? dark : gold); withOutline(m, 0.06);
    const a = r() * 6.28, d = size * (0.4 + r() * 0.7); m.position.set(Math.cos(a) * d, (r() - 0.5) * size * 0.6, Math.sin(a) * d); m.rotation.set(r() * 3, r() * 3, r() * 3); g.add(m);
  }
  const beacon = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xffd166, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); beacon.scale.setScalar(size * 1.6); g.add(beacon);
  g.userData.anim = t => { g.rotation.y = t * 0.00012; beacon.material.opacity = 0.55 + Math.sin(t * 0.004) * 0.35; };
  return g;
}
/** Marca de guarida pirata para el mapa de la galaxia: estación pequeña con luz roja */
export function makeLairMarker() {
  const g = new THREE.Group(), st = makeShip('estacion'); st.scale.setScalar(1.7); g.add(st);
  const pulse = new THREE.Sprite(new THREE.SpriteMaterial({ map: softDot(), color: 0xff3b4a, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })); pulse.scale.setScalar(26); g.add(pulse);
  g.userData.anim = t => { pulse.material.opacity = 0.35 + Math.sin(t * 0.005) * 0.25; animateFlames(st, t, 1); };
  return g;
}
/** Icono 3D de un sistema con sus rasgos especiales (mapa galáctico) */
function decorateSystem(g, sys, anims) {
  const f = sys.features || [];
  if (f.includes('nebula')) { const n = makeNebulaCloud(70, sys.x * 7 + sys.y); n.position.y = 2; g.add(n); }
  if (f.includes('asteroids')) { const b = makeBeltRing(34, 70, sys.x + sys.y * 3, 8); b.position.y = 1; g.add(b); anims.push(b.userData.anim); }
  if (f.includes('ruins') && !(sys.ruin && sys.ruin.claimedBy)) { const rm = makeRuinsMarker(14); rm.position.set(30, 8, 22); g.add(rm); anims.push(rm.userData.anim); }
  if (f.includes('lair') && sys.lair && !sys.lair.destroyed) { const lm = makeLairMarker(); lm.position.set(-30, 10, 22); g.add(lm); anims.push(lm.userData.anim); }
}
/** Escala un modelo de criatura/estación para que ocupe ~ size unidades */
export function fitModel(obj, size) {
  const b = new THREE.Box3().setFromObject(obj), v = b.getSize(new THREE.Vector3());
  const m = Math.max(v.x, v.y, v.z) || 1; obj.scale.multiplyScalar(size / m); return obj;
}

/**
 * @param view     InteractiveScene
 * @param state    estado del servidor
 * @param nationInfo(id) -> { color: THREE.Color, colors: [hex...], rel: 'mine'|'ally'|'war'|'neutral' }
 * @param nowFn    () => tiempo del servidor (para interpolar viajes)
 */
export function buildGalaxy(view, state, nationInfo, nowFn) {
  view.clear();
  const S = state.systems;
  addCosmos(view.scene, new THREE.Vector3(500, 0, 500), 2600, { nebulae: 7, stars: 1800 });
  // Disco galáctico tenue bajo el plano de juego
  const disc = new THREE.Mesh(new THREE.CircleGeometry(780, 48), new THREE.MeshBasicMaterial({ color: 0x1a2a4a, transparent: true, opacity: 0.18, depthWrite: false }));
  disc.rotation.x = -Math.PI / 2; disc.position.set(500, -8, 500); view.scene.add(disc);
  // Hiperrutas: línea punteada + "flujo" animado de partículas
  const done = new Set(), lanes = [];
  const lineMat = new THREE.LineDashedMaterial({ color: 0xcfe9e6, dashSize: 8, gapSize: 6, transparent: true, opacity: 0.55 });
  for (const id in S) for (const l of S[id].links) {
    if (S[id].portal === l) continue;   // los portales se dibujan aparte
    const k = [id, l].sort().join('-'); if (done.has(k)) continue; done.add(k);
    const a = new THREE.Vector3(S[id].x, 0, S[id].y), b = new THREE.Vector3(S[l].x, 0, S[l].y);
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), lineMat); line.computeLineDistances(); view.scene.add(line);
    lanes.push([a, b]);
  }
  // Portales de agujero negro: arco violeta animado entre la pareja
  const portalLines = [];
  for (const id in S) if (S[id].portal && id < S[id].portal) {
    const A = S[id], B = S[S[id].portal];
    const mid = new THREE.Vector3((A.x + B.x) / 2, 90, (A.y + B.y) / 2);
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(A.x, 6, A.y), mid, new THREE.Vector3(B.x, 6, B.y));
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(curve.getPoints(40)), new THREE.LineDashedMaterial({ color: 0xb388ff, dashSize: 10, gapSize: 7, transparent: true, opacity: 0.8 }));
    line.computeLineDistances(); view.scene.add(line); portalLines.push(curve);
  }
  const portalDots = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(portalLines.length * 6 * 3), 3)),
    new THREE.PointsMaterial({ size: 9, map: softDot(), color: 0xe0c8ff, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending }));
  view.scene.add(portalDots);
  const anims = [];
  const flowN = lanes.length * 2;
  const flowPos = new Float32Array(flowN * 3);
  const flow = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(flowPos, 3)),
    new THREE.PointsMaterial({ size: 5, map: softDot(), color: 0x7fe3ff, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending }));
  view.scene.add(flow);
  // Sistemas
  for (const id in S) {
    const sys = S[id];
    const g = new THREE.Group(); g.position.set(sys.x, 0, sys.y); g.userData.pick = { type: 'system', id };
    const star = sys.kind === 'blackhole' ? makeBlackHole(7) : makeStar(sys.starColor, 7); star.position.y = 6; g.add(star);
    if (star.userData.anim) anims.push(star.userData.anim);
    decorateSystem(g, sys, anims);
    const owners = {};
    for (const pid of sys.planets) { const p = state.planets[pid]; if (p && p.owner) owners[p.owner] = (owners[p.owner] || 0) + 1; }
    const top = Object.keys(owners).sort((a, b) => owners[b] - owners[a])[0];
    if (top) {
      const info = nationInfo(top);
      const area = new THREE.Mesh(new THREE.CircleGeometry(48, 6), new THREE.MeshBasicMaterial({ color: info.color, transparent: true, opacity: 0.22, depthWrite: false }));
      area.rotation.x = -Math.PI / 2; g.add(area);
      const ring = new THREE.Mesh(new THREE.RingGeometry(46, 50, 6), new THREE.MeshBasicMaterial({ color: info.color }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.5; g.add(ring);
    }
    g.add(new THREE.Mesh(new THREE.SphereGeometry(30, 8, 6), new THREE.MeshBasicMaterial({ visible: false })));
    view.scene.add(g); view.clickables.push(g);
  }
  // Flotas: icono 3D (la nave más grande de la flota) + anillo de relación
  const fleetObjs = [];
  const bySys = {};
  for (const f of Object.values(state.fleets)) (bySys[f.system] = bySys[f.system] || []).push(f);
  const relColor = { mine: 0x57cc99, ally: 0x4cc9f0, war: 0xef476f, neutral: 0xcfd8dc };
  for (const sid in bySys) bySys[sid].forEach((f, i) => {
    const info = nationInfo(f.owner);
    const hull = mainHull(f, state);
    const holder = new THREE.Group();
    const ship = makeShip(hull, info.colors);
    if (CREATURES.includes(hull)) fitModel(ship, hull === 'plaga' ? 7 : 20); else ship.scale.setScalar(6 / Math.sqrt(HULL_SCALE[hull] || 1));
    holder.add(ship);
    const mark = new THREE.Mesh(new THREE.RingGeometry(7, 8.6, 20), new THREE.MeshBasicMaterial({ color: relColor[info.rel] || 0xffffff, side: THREE.DoubleSide, transparent: true, opacity: 0.9 }));
    mark.rotation.x = -Math.PI / 2; mark.position.y = -3; holder.add(mark);
    holder.userData.pick = { type: 'fleet', id: f.id };
    holder.add(new THREE.Mesh(new THREE.SphereGeometry(12, 6, 4), new THREE.MeshBasicMaterial({ visible: false })));
    holder.userData.f = f; holder.userData.ship = ship; holder.userData.slot = i;
    view.scene.add(holder); view.clickables.push(holder); fleetObjs.push(holder);
  });
  const tmp = new THREE.Vector3(), look = new THREE.Vector3();
  view.onFrame = (t) => {
    // partículas viajando por las hiperrutas
    for (let i = 0; i < flowN; i++) {
      const [a, b] = lanes[i >> 1]; const k = ((t * 0.00012 + i * 0.37) % 1);
      const dir = i & 1; tmp.lerpVectors(dir ? a : b, dir ? b : a, k);
      flowPos[i * 3] = tmp.x; flowPos[i * 3 + 1] = 0.5; flowPos[i * 3 + 2] = tmp.z;
    }
    flow.geometry.attributes.position.needsUpdate = true;
    for (const a of anims) a(t);
    { const pp = portalDots.geometry.attributes.position.array; let q = 0;
      portalLines.forEach((c, ci) => { for (let j = 0; j < 6; j++) { const u = ((t * 0.00022 + j / 6 + ci * 0.17) % 1); c.getPoint(u, tmp); pp[q++] = tmp.x; pp[q++] = tmp.y; pp[q++] = tmp.z; } });
      portalDots.geometry.attributes.position.needsUpdate = true; }
    const now = nowFn ? nowFn() : Date.now();
    for (const h of fleetObjs) {
      const f = h.userData.f, s0 = S[f.system];
      const next = f.path && f.path[0] && S[f.path[0]];
      if (next && f.nextJumpAt && f.jumpStartAt) {
        // En viaje: interpolamos entre el sistema actual y el siguiente, proa hacia el destino
        const k = Math.max(0, Math.min(1, (now - f.jumpStartAt) / (f.nextJumpAt - f.jumpStartAt)));
        h.position.set(s0.x + (next.x - s0.x) * k, 12, s0.y + (next.y - s0.y) * k);
        look.set(next.x, 12, next.y); h.lookAt(look);
        animateFlames(h.userData.ship, t, 1.6);
      } else {
        // En órbita del sistema: giran y miran en la dirección del movimiento (tangente)
        const a = h.userData.slot * 1.7 + t * 0.00035, r = 24 + h.userData.slot * 7;
        h.position.set(s0.x + Math.cos(a) * r, 12, s0.y + Math.sin(a) * r);
        look.set(s0.x + Math.cos(a + 0.2) * r, 12, s0.y + Math.sin(a + 0.2) * r); h.lookAt(look);
        animateFlames(h.userData.ship, t, 1);
      }
    }
  };
}
/** Casco más grande de una flota (para representarla en el mapa) */
export function mainHull(f, state) {
  if (!f.units) return f.info && f.info.space ? 'corbeta' : 'transporte';
  const order = ['devorador', 'leviatan', 'medusa', 'acorazado', 'portanaves', 'crucero', 'destructor', 'fragata', 'corbeta', 'transporte', 'bombardero', 'caza', 'dron', 'mecha', 'tanque', 'blindado', 'infanteria', 'plaga'];
  let best = 'corbeta', bi = 99;
  for (const d in f.units) { const D = state.designs[d]; if (!D) continue; const i = order.indexOf(D.hull); if (i >= 0 && i < bi) { bi = i; best = D.hull; } }
  return best;
}

/* =====================================================================
 * VISTA DE SISTEMA
 * ===================================================================== */
export function buildSystem(view, state, sysId, nationInfo, biomes) {
  view.clear();
  const sys = state.systems[sysId];
  addCosmos(view.scene, new THREE.Vector3(0, 0, 0), 1400, { nebulae: 3, stars: 1200, seed: sysId.length * 31 + (sys.x | 0) });
  const grid = new THREE.PolarGridHelper(170, 12, 8, 64, 0x223040, 0x1a2430); grid.position.y = -6;
  grid.material.transparent = true; grid.material.opacity = 0.45; view.scene.add(grid);
  const isBH = sys.kind === 'blackhole';
  const star = isBH ? makeBlackHole(15) : makeStar(sys.starColor, 11); view.scene.add(star);
  const sun = new THREE.PointLight(new THREE.Color(sys.starColor), isBH ? 0.6 : 1.2, 600, 0); view.scene.add(sun);
  const planets = [], anims = [], pois = [];
  if (star.userData.anim) anims.push(star.userData.anim);
  const feats = sys.features || [];
  if (feats.includes('nebula')) {
    view.scene.fog = new THREE.FogExp2(0x2a1346, 0.0016);
    const nc = makeNebulaCloud(210, sys.x * 3 + sys.y); nc.position.y = -10; view.scene.add(nc);
  }
  sys.planets.forEach((pid, i) => {
    const p = state.planets[pid];
    const r = 32 + i * 19;
    if (p.belt) {
      // Cinturón de asteroides: anillo de rocas; se toca el "ancla" invisible sobre el anillo
      const belt = makeBeltRing(r, 220, p.seed, 14); view.scene.add(belt); anims.push(belt.userData.anim);
      const holder = new THREE.Group(); holder.userData.pick = { type: 'planet', id: pid };
      if (p.owner) { const halo = new THREE.Mesh(new THREE.RingGeometry(7, 8.4, 24), new THREE.MeshBasicMaterial({ color: nationInfo(p.owner).color, side: THREE.DoubleSide })); halo.rotation.x = -Math.PI / 2; holder.add(halo); }
      holder.add(new THREE.Mesh(new THREE.SphereGeometry(13, 8, 6), new THREE.MeshBasicMaterial({ visible: false })));
      holder.userData.orbit = { r, a: (p.seed % 628) / 100, speed: 0 };
      view.scene.add(holder); view.clickables.push(holder); planets.push({ holder, pid, mesh: new THREE.Object3D() });
      return;
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.25, r + 0.25, 96), new THREE.MeshBasicMaterial({ color: 0xcfe9e6, side: THREE.DoubleSide, transparent: true, opacity: 0.45 }));
    ring.rotation.x = -Math.PI / 2; ring.scale.set(1, 0.9, 1); view.scene.add(ring);
    const mesh = makePlanet(p, biomes[p.biome]);
    const s = (p.biome === 'gaseoso' ? 5 : 3) + p.size * 1.2;
    mesh.scale.setScalar(s);
    const holder = new THREE.Group(); holder.add(mesh); holder.userData.pick = { type: 'planet', id: pid };
    if (p.owner) {
      const halo = new THREE.Mesh(new THREE.RingGeometry(s * 1.55, s * 1.75, 32), new THREE.MeshBasicMaterial({ color: nationInfo(p.owner).color, side: THREE.DoubleSide }));
      halo.rotation.x = -Math.PI / 2; holder.add(halo);
    }
    holder.add(new THREE.Mesh(new THREE.SphereGeometry(s * 2, 8, 6), new THREE.MeshBasicMaterial({ visible: false })));
    holder.userData.orbit = { r, a: (p.seed % 628) / 100, speed: 0.00005 / (1 + i * 0.4) };
    view.scene.add(holder); view.clickables.push(holder); planets.push({ holder, pid, mesh });
  });
  // Puntos de interés: portal (agujero negro), ruinas y guarida pirata
  const addPoi = (kind, obj, pos, label) => { obj.position.copy(pos); obj.userData.pick = { type: 'poi', id: kind, system: sysId }; obj.add(new THREE.Mesh(new THREE.SphereGeometry(11, 8, 6), new THREE.MeshBasicMaterial({ visible: false }))); view.scene.add(obj); view.clickables.push(obj); pois.push({ kind, obj, label }); if (obj.userData.anim) anims.push(obj.userData.anim); };
  if (isBH) {
    const gate = new THREE.Group();
    gate.add(new THREE.Mesh(new THREE.TorusGeometry(9, 0.8, 6, 24), new THREE.MeshBasicMaterial({ color: 0xb388ff })));
    const core = new THREE.Mesh(new THREE.CircleGeometry(8.2, 24), new THREE.MeshBasicMaterial({ color: 0x6b3fd1, transparent: true, opacity: 0.45, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); gate.add(core);
    gate.userData.anim = t => { core.rotation.z = t * 0.002; gate.rotation.y = Math.sin(t * 0.0006) * 0.4; };
    addPoi('portal', gate, new THREE.Vector3(70, 4, 20), 'Portal');
  }
  if (feats.includes('ruins')) { const rm = makeRuinsMarker(18); addPoi('ruins', rm, new THREE.Vector3(-62, 6, -40), 'Ruinas'); }
  if (feats.includes('lair') && sys.lair && !sys.lair.destroyed) { const st = makeShip('estacion'); fitModel(st, 30); addPoi('lair', st, new THREE.Vector3(58, 6, -52), 'Guarida pirata'); }
  // Flotas del sistema: formación en una órbita exterior
  const fleets = Object.values(state.fleets).filter(f => f.system === sysId);
  const outer = 32 + sys.planets.length * 19 + 14;
  const fleetObjs = fleets.map((f, i) => {
    const info = nationInfo(f.owner);
    const g = new THREE.Group();
    const hull = mainHull(f, state);
    const n = Math.min(5, Math.max(1, Math.round(Math.sqrt(f.info.count || 1))));
    if (CREATURES.includes(hull) && hull !== 'plaga') {
      const mo = makeShip(hull, info.colors); fitModel(mo, hull === 'devorador' ? 44 : hull === 'leviatan' ? 38 : 22); g.add(mo);
    } else if (hull === 'plaga') {
      const nn = Math.min(10, Math.max(3, Math.round(Math.sqrt(f.info.count || 1) * 2)));
      for (let k = 0; k < nn; k++) { const d = makeShip('plaga', info.colors); d.scale.setScalar(2.2); const a = k / nn * Math.PI * 2; d.position.set(Math.cos(a) * 7, (k % 3) - 1, Math.sin(a) * 7); d.rotation.y = -a; g.add(d); }
    } else for (let k = 0; k < n; k++) { // pequeña formación en "V"
      const sh = makeShip(k === 0 ? hull : 'caza', info.colors); sh.scale.setScalar(k === 0 ? 2.2 : 1.2);
      sh.position.set((k % 2 ? 1 : -1) * Math.ceil(k / 2) * 3.2, 0, -Math.ceil(k / 2) * 3.2); g.add(sh);
    }
    g.userData.pick = { type: 'fleet', id: f.id };
    g.add(new THREE.Mesh(new THREE.SphereGeometry(9, 6, 4), new THREE.MeshBasicMaterial({ visible: false })));
    g.userData.a0 = i / Math.max(1, fleets.length) * Math.PI * 2;
    view.scene.add(g); view.clickables.push(g);
    return g;
  });
  const look = new THREE.Vector3();
  view.onFrame = (t) => {
    for (const { holder, mesh } of planets) { const o = holder.userData.orbit; const a = o.a + t * o.speed; holder.position.set(Math.cos(a) * o.r, 0, Math.sin(a) * o.r * 0.9); mesh.rotation.y = t * 0.0003; }
    for (const g of fleetObjs) {
      const a = g.userData.a0 + t * 0.00008;
      g.position.set(Math.cos(a) * outer, 6, Math.sin(a) * outer * 0.9);
      look.set(Math.cos(a + 0.1) * outer, 6, Math.sin(a + 0.1) * outer * 0.9); g.lookAt(look);
      g.children.forEach(c => (c.userData.flames || c.userData.anim) && animateFlames(c, t, 1));
    }
    for (const a of anims) a(t);
  };
  return { planets, fleets: fleetObjs, pois };
}

/* =====================================================================
 * PREVIEW DEL DISEÑADOR
 * ===================================================================== */
export function buildShipPreview(view, hullId, colors) {
  view.clear();
  addCosmos(view.scene, new THREE.Vector3(0, 0, 0), 600, { stars: 500, starSize: 1.8 });
  const s = makeShip(hullId, colors);
  const box = new THREE.Box3().setFromObject(s); const len = box.getSize(new THREE.Vector3()).length();
  s.scale.setScalar(26 / len); view.scene.add(s);
  view.onFrame = (t) => { s.rotation.y = t * 0.0005; animateFlames(s, t, 1.2); };
}

/* La repetición/visor de batallas vive ahora en js/battle3d.js (simulación en tiempo real). */

export { THREE, makeShip };
