/* =====================================================================
 * RENDER 3D — estilo flat / low-poly / cell-shading (toon)
 * ---------------------------------------------------------------------
 * - MeshToonMaterial con gradiente de 3 tonos = cell-shading barato.
 * - Contornos ("outline") con la técnica de casco invertido (BackSide),
 *   que funciona en cualquier móvil sin post-procesado.
 * - Geometrías con pocos polígonos + flatShading.
 * - Un solo WebGLRenderer compartido para miniaturas (planetas/naves)
 *   que se cachean como imágenes: ahorra batería y memoria en móviles.
 * ===================================================================== */
import * as THREE from '../vendor/three.module.js';

/* ---------- Materiales toon ---------- */
const gradientMap = (() => {
  const data = new Uint8Array([70, 70, 70, 255, 160, 160, 160, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
})();
export function toon(color, opts) {
  return new THREE.MeshToonMaterial(Object.assign({ color, gradientMap }, opts || {}));
}
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x0a0c0f, side: THREE.BackSide });
export function withOutline(mesh, thickness) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(1 + (thickness || 0.06));
  mesh.add(o);
  return mesh;
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/* ---------- Planeta low-poly ---------- */
export function makePlanet(planet, biome) {
  const r = rng(planet.seed || 1);
  const g = new THREE.IcosahedronGeometry(1, 3);
  const pal = biome.palette.map(c => new THREE.Color(c));
  const pos = g.attributes.position;
  const colors = [];
  const v = new THREE.Vector3();
  // Ruido simple por "manchas": continentes como esferas aleatorias
  const blobs = Array.from({ length: 7 }, () => ({ c: new THREE.Vector3(r() * 2 - 1, r() * 2 - 1, r() * 2 - 1).normalize(), s: 0.35 + r() * 0.5 }));
  const isGas = planet.biome === 'gaseoso';
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    let h = 0;
    for (const b of blobs) h = Math.max(h, 1 - v.distanceTo(b.c) / b.s);
    let col;
    if (isGas) col = pal[Math.floor((v.y + 1) * 3.5 + r() * 0.4) % 3];
    else if (Math.abs(v.y) > 0.86 && planet.biome !== 'volcanico' && planet.biome !== 'desertico') col = pal[2];
    else col = h > 0.15 ? pal[1] : pal[0];
    if (!isGas && h > 0.15) v.multiplyScalar(1 + h * 0.08);
    pos.setXYZ(i, v.x, v.y, v.z);
    colors.push(col.r, col.g, col.b);
  }
  const ng = g.toNonIndexed ? g : g;
  ng.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  ng.computeVertexNormals();
  const mesh = new THREE.Mesh(ng, toon(0xffffff, { vertexColors: true }));
  withOutline(mesh, 0.05);
  if (isGas || r() < 0.15) {
    const ring = new THREE.Mesh(new THREE.RingGeometry(1.35, 1.8, 24), toon(pal[2], { side: THREE.DoubleSide }));
    ring.rotation.x = Math.PI / 2.4;
    mesh.add(ring);
  }
  return mesh;
}

export function makeStar(color, size) {
  const m = new THREE.Mesh(new THREE.IcosahedronGeometry(size || 1, 1), new THREE.MeshBasicMaterial({ color }));
  const halo = new THREE.Mesh(new THREE.IcosahedronGeometry((size || 1) * 1.35, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18 }));
  m.add(halo);
  return m;
}

/* ---------- Naves low-poly procedurales según casco ---------- */
export function makeShip(hullId, color) {
  const g = new THREE.Group();
  const main = toon(color || 0xb8c4cc), dark = toon(0x39424c), glow = new THREE.MeshBasicMaterial({ color: 0x4cc9f0 });
  const add = (geo, mat, x, y, z, rx, ry, rz, sx, sy, sz) => {
    // Geometría no indexada + normales por cara = look low-poly facetado
    if (geo.index) { geo = geo.toNonIndexed(); geo.computeVertexNormals(); }
    const m = new THREE.Mesh(geo, mat); m.position.set(x || 0, y || 0, z || 0); m.rotation.set(rx || 0, ry || 0, rz || 0);
    if (sx) m.scale.set(sx, sy, sz); withOutline(m, 0.04); g.add(m); return m;
  };
  const cone = (r, h, s) => new THREE.ConeGeometry(r, h, s || 4);
  const box = (a, b, c) => new THREE.BoxGeometry(a, b, c);
  switch (hullId) {
    case 'caza': case 'dron':
      add(cone(0.35, 1.6, 4), main, 0, 0, 0, Math.PI / 2, 0, 0);
      add(box(2.2, 0.08, 0.6), dark, 0, 0, 0.3);
      add(box(0.08, 0.9, 0.5), dark, 1.1, 0, 0.3); add(box(0.08, 0.9, 0.5), dark, -1.1, 0, 0.3);
      add(new THREE.CylinderGeometry(0.12, 0.12, 0.2, 6), glow, 0, 0, 0.85, Math.PI / 2);
      break;
    case 'bombardero':
      add(box(0.8, 0.45, 2), main); add(box(2.6, 0.12, 0.9), dark, 0, 0, 0.3); add(cone(0.4, 0.8, 4), main, 0, 0, -1.4, -Math.PI / 2, 0, Math.PI / 4);
      break;
    case 'infanteria': case 'blindado': case 'tanque': case 'mecha':
      add(box(1.6, 0.5, 2.2), main); add(box(1, 0.5, 1), dark, 0, 0.5, 0.1); add(box(0.15, 0.15, 1.4), dark, 0, 0.55, -0.9);
      if (hullId === 'mecha') { add(box(0.3, 1.2, 0.3), dark, 0.6, -0.8, 0); add(box(0.3, 1.2, 0.3), dark, -0.6, -0.8, 0); }
      break;
    case 'transporte':
      add(box(1.2, 1, 2.6), main); add(box(0.6, 0.4, 0.6), dark, 0, 0.6, -0.8); add(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 6), glow, 0, 0, 1.45, Math.PI / 2);
      break;
    case 'portanaves':
      add(box(2, 0.5, 4.5), main); add(box(0.6, 0.8, 1), dark, 0.9, 0.6, 0.6); add(box(1.4, 0.1, 4), dark, 0, 0.3, 0);
      add(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 6), glow, 0.5, 0, 2.3, Math.PI / 2); add(new THREE.CylinderGeometry(0.3, 0.3, 0.3, 6), glow, -0.5, 0, 2.3, Math.PI / 2);
      break;
    default: { // naves de línea: cuña (estilo destructor estelar) escalada por tamaño
      const L = { corbeta: 2, fragata: 2.6, destructor: 3.2, crucero: 3.8, acorazado: 4.5 }[hullId] || 3;
      const wedge = new THREE.ConeGeometry(L * 0.42, L, 3);
      add(wedge, main, 0, 0, 0, -Math.PI / 2, 0, 0, 1, 1, 0.5);
      add(box(L * 0.18, L * 0.12, L * 0.25), dark, 0, L * 0.12, L * 0.25);
      const n = Math.max(1, Math.round(L / 1.5));
      for (let i = 0; i < n; i++) add(new THREE.CylinderGeometry(0.16, 0.2, 0.25, 6), glow, (i - (n - 1) / 2) * 0.45, 0, L / 2 + 0.05, Math.PI / 2);
    }
  }
  return g;
}

/* ---------- Renderer de miniaturas compartido ---------- */
let thumbRenderer = null;
const thumbCache = new Map();
function getThumbRenderer() {
  if (!thumbRenderer) {
    thumbRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    thumbRenderer.setSize(192, 192);
  }
  return thumbRenderer;
}
function lights(scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 0.55));
  const d = new THREE.DirectionalLight(0xffffff, 1.6); d.position.set(-3, 2, 4); scene.add(d);
}
/** Devuelve dataURL de un planeta (cacheado por seed+bioma) */
export function planetThumb(planet, biome) {
  const key = 'p' + planet.seed + planet.biome;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const R = getThumbRenderer();
  const scene = new THREE.Scene(); lights(scene);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50); cam.position.set(0, 0, planet.biome === 'gaseoso' ? 7 : 4.6);
  const p = makePlanet(planet, biome); p.rotation.set(0.3, 0.6, 0); scene.add(p);
  R.render(scene, cam);
  const url = R.domElement.toDataURL();
  thumbCache.set(key, url);
  dispose(scene);
  return url;
}
export function shipThumb(hullId, color) {
  const key = 's' + hullId + color;
  if (thumbCache.has(key)) return thumbCache.get(key);
  const R = getThumbRenderer();
  const scene = new THREE.Scene(); lights(scene);
  const cam = new THREE.PerspectiveCamera(35, 1, 0.1, 50); cam.position.set(4, 3.5, 5); cam.lookAt(0, 0, 0);
  const s = makeShip(hullId, color); scene.add(s);
  const box = new THREE.Box3().setFromObject(s); const size = box.getSize(new THREE.Vector3()).length();
  cam.position.multiplyScalar(size / 5.5); cam.lookAt(0, 0, 0);
  R.render(scene, cam);
  const url = R.domElement.toDataURL();
  thumbCache.set(key, url); dispose(scene);
  return url;
}
function dispose(obj) { obj.traverse(o => { if (o.geometry) o.geometry.dispose(); }); }

/* ---------- Vista interactiva (mapa galáctico / sistema / preview) ---------- */
/**
 * Escena con cámara orbital simple: arrastrar = desplazar, pinza/rueda = zoom.
 * Pensada para pulgares: no hay rotación libre (confunde en móvil).
 */
export class InteractiveScene {
  constructor(canvas, opts) {
    this.canvas = canvas;
    this.opts = Object.assign({ tilt: 0.9, minZoom: 30, maxZoom: 900, zoom: 600, center: [500, 500], pan: true }, opts);
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setClearColor(0x15181c);
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.Fog(0x15181c, 600, 2200);
    lights(this.scene);
    this.camera = new THREE.PerspectiveCamera(45, 1, 1, 5000);
    this.target = new THREE.Vector3(this.opts.center[0], 0, this.opts.center[1]);
    this.zoom = this.opts.zoom;
    this.clickables = [];
    this.onPick = null;
    this.onFrame = null;
    this.running = false;
    this._bindInput();
    this._resize = () => this.resize();
    window.addEventListener('resize', this._resize);
    this.resize();
  }
  resize() {
    const r = this.canvas.parentElement.getBoundingClientRect();
    if (!r.width) return;
    this.renderer.setSize(r.width, r.height, false);
    this.camera.aspect = r.width / r.height; this.camera.updateProjectionMatrix();
  }
  updateCamera() {
    this.zoom = Math.max(this.opts.minZoom, Math.min(this.opts.maxZoom, this.zoom));
    const t = this.opts.tilt;
    this.camera.position.set(this.target.x, Math.sin(t) * this.zoom, this.target.z + Math.cos(t) * this.zoom);
    this.camera.lookAt(this.target);
  }
  _bindInput() {
    const c = this.canvas;
    const pts = new Map();
    let lastDist = 0, moved = 0, down = null;
    c.addEventListener('pointerdown', e => { c.setPointerCapture(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); moved = 0; down = { x: e.clientX, y: e.clientY }; });
    c.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastDist) this.zoom *= lastDist / d;
        lastDist = d; moved += 10;
      } else if (this.opts.pan) {
        const k = this.zoom / this.canvas.clientHeight * 0.9;
        this.target.x -= dx * k; this.target.z -= dy * k / Math.sin(this.opts.tilt);
        this.target.x = Math.max(-100, Math.min(1100, this.target.x)); this.target.z = Math.max(-100, Math.min(1100, this.target.z));
        moved += Math.abs(dx) + Math.abs(dy);
      }
    });
    const up = e => {
      pts.delete(e.pointerId); if (pts.size < 2) lastDist = 0;
      if (down && moved < 8 && pts.size === 0) this._pick(e.clientX, e.clientY);
      down = null;
    };
    c.addEventListener('pointerup', up); c.addEventListener('pointercancel', up);
    c.addEventListener('wheel', e => { e.preventDefault(); this.zoom *= e.deltaY > 0 ? 1.12 : 0.89; }, { passive: false });
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
  /** Proyecta un punto 3D a coordenadas de pantalla (para etiquetas HTML) */
  project(vec3) {
    const v = vec3.clone().project(this.camera);
    return { x: (v.x + 1) / 2 * this.canvas.clientWidth, y: (1 - v.y) / 2 * this.canvas.clientHeight, visible: v.z < 1 };
  }
  clear() {
    for (let i = this.scene.children.length - 1; i >= 0; i--) {
      const o = this.scene.children[i];
      if (!o.isLight) { this.scene.remove(o); dispose(o); }
    }
    this.clickables = [];
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

/* ---------- Constructores de escenas ---------- */

/** Mapa galáctico: estrellas, hiperrutas punteadas y territorio por color de nación */
export function buildGalaxy(view, state, colorOf, myId) {
  view.clear();
  const S = state.systems;
  // Grilla de fondo (como la captura del sistema)
  const grid = new THREE.GridHelper(1400, 28, 0x2c333b, 0x22282e); grid.position.set(500, -2, 500); view.scene.add(grid);
  // Hiperrutas
  const done = new Set();
  const lineMat = new THREE.LineDashedMaterial({ color: 0xcfe9e6, dashSize: 8, gapSize: 6, transparent: true, opacity: 0.75 });
  for (const id in S) for (const l of S[id].links) {
    const k = [id, l].sort().join('-'); if (done.has(k)) continue; done.add(k);
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(S[id].x, 0, S[id].y), new THREE.Vector3(S[l].x, 0, S[l].y)]);
    const line = new THREE.Line(geo, lineMat); line.computeLineDistances(); view.scene.add(line);
  }
  // Sistemas
  for (const id in S) {
    const sys = S[id];
    const g = new THREE.Group(); g.position.set(sys.x, 0, sys.y); g.userData.pick = { type: 'system', id };
    const star = makeStar(sys.starColor, 9); star.position.y = 8; g.add(star);
    // Territorio: disco del color de la nación dominante del sistema
    const owners = {};
    for (const pid of sys.planets) { const p = state.planets[pid]; if (p && p.owner) owners[p.owner] = (owners[p.owner] || 0) + 1; }
    const top = Object.keys(owners).sort((a, b) => owners[b] - owners[a])[0];
    if (top) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(48, 6), new THREE.MeshBasicMaterial({ color: colorOf(top), transparent: true, opacity: 0.28 }));
      disc.rotation.x = -Math.PI / 2; g.add(disc);
      const ring = new THREE.Mesh(new THREE.RingGeometry(46, 50, 6), new THREE.MeshBasicMaterial({ color: colorOf(top) }));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.5; g.add(ring);
    }
    // Hitbox grande para dedos
    const hit = new THREE.Mesh(new THREE.SphereGeometry(30, 8, 6), new THREE.MeshBasicMaterial({ visible: false }));
    g.add(hit);
    view.scene.add(g); view.clickables.push(g);
  }
  // Flotas: pequeñas cuñas en órbita del sistema
  const bySys = {};
  for (const f of Object.values(state.fleets)) { (bySys[f.system] = bySys[f.system] || []).push(f); }
  const fleetMeshes = [];
  for (const sid in bySys) bySys[sid].forEach((f, i) => {
    const m = makeShip('corbeta', colorOf(f.owner)); m.scale.setScalar(4.5);
    m.userData.orbit = { cx: S[sid].x, cz: S[sid].y, r: 26 + i * 6, a: i * 1.7, mine: f.owner === myId };
    view.scene.add(m); fleetMeshes.push(m);
  });
  view.onFrame = (t) => {
    for (const m of fleetMeshes) { const o = m.userData.orbit; const a = o.a + t * 0.0004; m.position.set(o.cx + Math.cos(a) * o.r, 14, o.cz + Math.sin(a) * o.r); m.rotation.y = -a; }
  };
}

/** Vista de sistema: estrella central, órbitas elípticas y planetas */
export function buildSystem(view, state, sysId, colorOf, biomes) {
  view.clear();
  const sys = state.systems[sysId];
  const grid = new THREE.GridHelper(400, 20, 0x2c333b, 0x22282e); grid.position.y = -6; view.scene.add(grid);
  const star = makeStar(sys.starColor, 12); view.scene.add(star);
  const planets = [];
  sys.planets.forEach((pid, i) => {
    const p = state.planets[pid];
    const r = 30 + i * 18;
    const ring = new THREE.Mesh(new THREE.RingGeometry(r - 0.3, r + 0.3, 64), new THREE.MeshBasicMaterial({ color: 0xcfe9e6, side: THREE.DoubleSide, transparent: true, opacity: 0.6 }));
    ring.rotation.x = -Math.PI / 2; view.scene.add(ring);
    const mesh = makePlanet(p, biomes[p.biome]);
    const s = (p.biome === 'gaseoso' ? 5 : 3) + p.size * 1.2;
    mesh.scale.setScalar(s);
    const holder = new THREE.Group(); holder.add(mesh); holder.userData.pick = { type: 'planet', id: pid };
    if (p.owner) {
      const halo = new THREE.Mesh(new THREE.RingGeometry(s * 1.5, s * 1.75, 24), new THREE.MeshBasicMaterial({ color: colorOf(p.owner), side: THREE.DoubleSide }));
      halo.rotation.x = -Math.PI / 2; holder.add(halo);
    }
    const hit = new THREE.Mesh(new THREE.SphereGeometry(s * 2, 8, 6), new THREE.MeshBasicMaterial({ visible: false })); holder.add(hit);
    holder.userData.orbit = { r, a: (p.seed % 628) / 100, speed: 0.00006 / (1 + i * 0.4) };
    view.scene.add(holder); view.clickables.push(holder); planets.push({ holder, pid, mesh });
  });
  view.onFrame = (t) => {
    for (const { holder, mesh } of planets) { const o = holder.userData.orbit; const a = o.a + t * o.speed; holder.position.set(Math.cos(a) * o.r, 0, Math.sin(a) * o.r * 0.9); mesh.rotation.y = t * 0.0003; }
    star.rotation.y = t * 0.0002;
  };
  return planets;
}

/** Preview giratorio de una nave en el diseñador */
export function buildShipPreview(view, hullId, color) {
  view.clear();
  const s = makeShip(hullId, color); s.scale.setScalar(12); view.scene.add(s);
  view.onFrame = (t) => { s.rotation.y = t * 0.0006; };
}

export { THREE };
