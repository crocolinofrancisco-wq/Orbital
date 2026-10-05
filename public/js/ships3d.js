/* =====================================================================
 * MODELOS 3D DE NAVES Y TROPAS (low-poly + cell-shading)
 * ---------------------------------------------------------------------
 * CONVENCIÓN DE EJES (¡importante!):
 *   +Z = PROA / morro (hacia donde avanza la nave)
 *   -Z = POPA (aquí van los propulsores que brillan)
 *   +Y = arriba (puente de mando)
 * Para orientar una nave hacia un punto usa  obj.lookAt(punto)  : en
 * three.js lookAt() en objetos que NO son cámara apunta el eje +Z local
 * hacia el objetivo, así que la proa mira al destino y los motores
 * quedan atrás. (Antes los modelos tenían la proa en -Z y por eso
 * "iban marcha atrás").
 *
 * Cada nave se construye con un mini "kit de piezas":
 *   wedge()   casco en cuña (estilo destructor estelar) con biselado
 *   hullBox() bloque de casco biselado
 *   tower()   puente / torre de mando
 *   engines() grupo de toberas con brillo y "llama" animable
 *   turret()  torreta con cañón(es)
 *   wing()    ala/aleta en placa
 * Los colores salen de la bandera de la nación: color primario (casco),
 * secundario (franjas/acentos) y un gris oscuro para detalles.
 * ===================================================================== */
import * as THREE from '../vendor/three.module.js';

/* ---------- Materiales ---------- */
const gradientMap = (() => {
  const data = new Uint8Array([60, 60, 60, 255, 150, 150, 150, 255, 255, 255, 255, 255]);
  const t = new THREE.DataTexture(data, 3, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
})();
const matCache = new Map();
export function toon(color, opts) {
  const key = (typeof color === 'object' ? color.getHexString() : color) + JSON.stringify(opts || {});
  if (!opts && matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshToonMaterial(Object.assign({ color, gradientMap }, opts || {}));
  if (!opts) matCache.set(key, m);
  return m;
}
const outlineMat = new THREE.MeshBasicMaterial({ color: 0x07090c, side: THREE.BackSide });
export function withOutline(mesh, thickness) {
  const o = new THREE.Mesh(mesh.geometry, outlineMat);
  o.scale.setScalar(1 + (thickness || 0.05));
  o.userData.outline = true;
  mesh.add(o);
  return mesh;
}
const glowMats = {};
function glow(color) {
  color = color || 0x5fd8ff;
  return glowMats[color] || (glowMats[color] = new THREE.MeshBasicMaterial({ color }));
}
const flameMat = new THREE.MeshBasicMaterial({ color: 0x9ae8ff, transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });

/** Geometría facetada (no indexada) para look low-poly */
function facet(g) { const n = g.index ? g.toNonIndexed() : g; n.computeVertexNormals(); return n; }

/* ---------- Kit de piezas ---------- */
function part(parent, geo, mat, pos, rot, outline) {
  const m = new THREE.Mesh(facet(geo), mat);
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  if (outline !== false) withOutline(m, 0.045);
  parent.add(m);
  return m;
}
/**
 * Cuña: proa en +Z. len = largo, w = ancho de popa, h = alto.
 * Perfil de diamante aplanado con cubierta superior elevada.
 */
function wedgeGeo(len, w, h, noseW) {
  noseW = noseW || 0;
  const z0 = -len / 2, z1 = len / 2;
  const v = [
    // popa (z0): rectángulo biselado
    -w, 0, z0, -w * 0.8, h, z0, w * 0.8, h, z0, w, 0, z0, w * 0.8, -h * 0.6, z0, -w * 0.8, -h * 0.6, z0,
    // proa (z1)
    -noseW, 0, z1, noseW, 0, z1, 0, h * 0.15, z1, 0, -h * 0.1, z1
  ];
  const idx = [
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5,       // popa
    1, 6, 8, 1, 8, 2, 2, 8, 7, 2, 7, 3,        // cubierta superior
    0, 6, 1, 3, 7, 7,                          // laterales
    5, 9, 6, 5, 6, 0, 4, 7, 9, 4, 3, 7, 5, 4, 9 // panza
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  g.setIndex(idx);
  return g;
}
function wedge(parent, mat, len, w, h, pos, noseW) {
  const m = new THREE.Mesh(facet(wedgeGeo(len, w, h, noseW)), mat);
  m.material.side = THREE.DoubleSide;
  if (pos) m.position.set(pos[0], pos[1], pos[2]);
  withOutline(m, 0.035); parent.add(m); return m;
}
function hullBox(parent, mat, sx, sy, sz, pos, bevel) {
  // caja con biselado barato: cilindro de 8 lados escalado
  const g = new THREE.CylinderGeometry(0.5, 0.5, 1, bevel || 8, 1);
  g.rotateX(Math.PI / 2); g.rotateZ(Math.PI / 8);
  const m = part(parent, g, mat, pos);
  m.scale.set(sx, sy, sz);
  return m;
}
function tower(parent, mat, darkMat, s, pos) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]);
  part(g, new THREE.BoxGeometry(0.9 * s, 0.6 * s, 1.0 * s), mat, [0, 0.3 * s, 0]);
  part(g, new THREE.BoxGeometry(0.5 * s, 0.5 * s, 0.6 * s), mat, [0, 0.8 * s, -0.1 * s]);
  // "puente" con ventanas brillantes
  part(g, new THREE.BoxGeometry(1.5 * s, 0.22 * s, 0.4 * s), darkMat, [0, 1.15 * s, 0]);
  part(g, new THREE.BoxGeometry(1.3 * s, 0.06 * s, 0.05 * s), glow(0xbff4ff), [0, 1.15 * s, 0.21 * s], null, false);
  // esferas de escudo (guiño a Star Wars)
  part(g, new THREE.IcosahedronGeometry(0.18 * s, 0), darkMat, [0.55 * s, 1.4 * s, -0.05 * s]);
  part(g, new THREE.IcosahedronGeometry(0.18 * s, 0), darkMat, [-0.55 * s, 1.4 * s, -0.05 * s]);
  parent.add(g); return g;
}
/** Toberas en la popa (-Z). Devuelve las llamas para animarlas. */
function engines(parent, darkMat, list, r, z, color) {
  const flames = [];
  for (const [x, y] of list) {
    const noz = new THREE.CylinderGeometry(r * 0.8, r, r * 1.2, 8); noz.rotateX(Math.PI / 2);
    part(parent, noz, darkMat, [x, y, z]);
    const core = new THREE.CircleGeometry(r * 0.75, 8);
    const c = new THREE.Mesh(core, glow(color)); c.position.set(x, y, z - r * 0.61); c.rotation.y = Math.PI; parent.add(c);
    const fl = new THREE.ConeGeometry(r * 0.7, r * 3.2, 8, 1, true); fl.rotateX(-Math.PI / 2); fl.translate(0, 0, -r * 1.6);
    const f = new THREE.Mesh(fl, flameMat); f.position.set(x, y, z - r * 0.6); parent.add(f);
    f.userData.flame = true; flames.push(f);
  }
  return flames;
}
function turret(parent, mat, darkMat, s, pos, barrels) {
  const g = new THREE.Group(); g.position.set(pos[0], pos[1], pos[2]);
  const base = new THREE.CylinderGeometry(0.35 * s, 0.42 * s, 0.22 * s, 6);
  part(g, base, mat, [0, 0.11 * s, 0]);
  barrels = barrels || 2;
  for (let i = 0; i < barrels; i++) {
    const b = new THREE.CylinderGeometry(0.05 * s, 0.05 * s, 0.7 * s, 5); b.rotateX(Math.PI / 2);
    part(g, b, darkMat, [(i - (barrels - 1) / 2) * 0.16 * s, 0.2 * s, 0.4 * s]);
  }
  parent.add(g); return g;
}
function wing(parent, mat, pts, thick, y) {
  // pts: contorno 2D en el plano XZ
  const shape = new THREE.Shape(); shape.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i][0], pts[i][1]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.rotateX(Math.PI / 2); g.translate(0, (y || 0) + thick / 2, 0);
  return part(parent, g, mat);
}
const mirror = pts => pts.map(([x, z]) => [-x, z]);

/* ---------- Paletas ---------- */
function palette(colors) {
  const c = (colors || ['#b8c4cc', '#e63946', '#f1faee']).map(x => new THREE.Color(x));
  // Casco: color principal aclarado/desaturado para que se lea "metal pintado"
  const hull = c[0].clone().lerp(new THREE.Color(0xc9d2da), 0.45);
  const accent = c[1].clone();
  return { hull: toon(hull), accent: toon(accent), dark: toon(0x2c333b), mid: toon(0x7d8893) };
}

/* =====================================================================
 * MODELOS
 * ===================================================================== */
const BUILDERS = {
  caza(g, P) {
    hullBox(g, P.hull, 0.45, 0.35, 2.0, [0, 0, 0.2]);
    part(g, new THREE.ConeGeometry(0.22, 0.9, 6).rotateX(Math.PI / 2), P.hull, [0, 0, 1.6]);
    part(g, new THREE.IcosahedronGeometry(0.2, 0).scale(1, 0.8, 1.6), P.dark, [0, 0.22, 0.6]); // cabina
    wing(g, P.accent, [[0.2, 0.4], [1.5, -0.3], [1.5, -0.7], [0.2, -0.6]], 0.06);
    wing(g, P.accent, mirror([[0.2, 0.4], [1.5, -0.3], [1.5, -0.7], [0.2, -0.6]]).reverse(), 0.06);
    part(g, new THREE.BoxGeometry(0.06, 0.06, 0.8), P.dark, [1.5, 0, 0]);
    part(g, new THREE.BoxGeometry(0.06, 0.06, 0.8), P.dark, [-1.5, 0, 0]);
    return engines(g, P.dark, [[0, 0]], 0.2, -0.9);
  },
  bombardero(g, P) {
    hullBox(g, P.hull, 0.9, 0.5, 2.4, [0, 0, 0]);
    part(g, new THREE.ConeGeometry(0.42, 0.9, 6).rotateX(Math.PI / 2), P.hull, [0, 0, 1.6]);
    part(g, new THREE.IcosahedronGeometry(0.26, 0).scale(1, 0.7, 1.4), P.dark, [0, 0.3, 0.9]);
    wing(g, P.accent, [[0.4, 0.6], [1.9, 0.1], [1.9, -0.9], [0.4, -0.9]], 0.1);
    wing(g, P.accent, mirror([[0.4, 0.6], [1.9, 0.1], [1.9, -0.9], [0.4, -0.9]]).reverse(), 0.1);
    part(g, new THREE.CylinderGeometry(0.12, 0.12, 0.9, 6).rotateX(Math.PI / 2), P.dark, [0.9, -0.15, 0]); // torpedos
    part(g, new THREE.CylinderGeometry(0.12, 0.12, 0.9, 6).rotateX(Math.PI / 2), P.dark, [-0.9, -0.15, 0]);
    return engines(g, P.dark, [[0.25, 0], [-0.25, 0]], 0.2, -1.25);
  },
  dron(g, P) {
    part(g, new THREE.OctahedronGeometry(0.5, 0).scale(1, 0.45, 1.4), P.hull, [0, 0, 0]);
    part(g, new THREE.IcosahedronGeometry(0.16, 0), glow(0xff5d73), [0, 0.12, 0.45], null, false); // "ojo"
    wing(g, P.accent, [[0.2, 0.2], [1.0, -0.4], [0.3, -0.5]], 0.05);
    wing(g, P.accent, mirror([[0.2, 0.2], [1.0, -0.4], [0.3, -0.5]]).reverse(), 0.05);
    return engines(g, P.dark, [[0, 0]], 0.15, -0.7);
  },
  corbeta(g, P) {
    wedge(g, P.hull, 3.2, 0.7, 0.45, [0, 0, 0.2], 0.05);
    hullBox(g, P.mid, 0.8, 0.5, 1.2, [0, 0, -1.1]);
    part(g, new THREE.BoxGeometry(1.0, 0.05, 1.3), P.accent, [0, 0.47, -0.2]); // franja
    tower(g, P.hull, P.dark, 0.45, [0, 0.4, -0.7]);
    turret(g, P.hull, P.dark, 0.6, [0, 0.35, 0.5], 1);
    return engines(g, P.dark, [[0.25, 0], [-0.25, 0]], 0.2, -1.75);
  },
  transporte(g, P) {
    hullBox(g, P.hull, 1.3, 1.0, 2.6, [0, 0, 0], 6);
    part(g, new THREE.ConeGeometry(0.62, 0.8, 6).rotateX(Math.PI / 2), P.hull, [0, 0, 1.7]);
    for (let i = 0; i < 3; i++) { // módulos de carga
      part(g, new THREE.BoxGeometry(0.5, 0.5, 0.6), P.accent, [0.8, 0, 0.8 - i * 0.75]);
      part(g, new THREE.BoxGeometry(0.5, 0.5, 0.6), P.accent, [-0.8, 0, 0.8 - i * 0.75]);
    }
    part(g, new THREE.BoxGeometry(0.5, 0.25, 0.6), P.dark, [0, 0.6, 0.9]);
    return engines(g, P.dark, [[0.35, 0.15], [-0.35, 0.15], [0, -0.25]], 0.22, -1.45);
  },
  fragata(g, P) {
    hullBox(g, P.hull, 0.8, 0.55, 3.4, [0, 0, 0.3]);
    part(g, new THREE.ConeGeometry(0.42, 1.0, 8).rotateX(Math.PI / 2).scale(1, 0.7, 1), P.hull, [0, 0, 2.5]);
    // anillo de soporte con módulos laterales
    hullBox(g, P.mid, 2.2, 0.25, 0.9, [0, 0, -0.5]);
    hullBox(g, P.accent, 0.5, 0.5, 1.5, [1.1, 0, -0.4]);
    hullBox(g, P.accent, 0.5, 0.5, 1.5, [-1.1, 0, -0.4]);
    tower(g, P.hull, P.dark, 0.5, [0, 0.3, -0.6]);
    turret(g, P.hull, P.dark, 0.55, [0, 0.27, 1.2], 2);
    part(g, new THREE.BoxGeometry(0.04, 0.6, 0.04), P.dark, [0, 1.25, -0.6]); // antena
    return engines(g, P.dark, [[0, 0], [1.1, 0], [-1.1, 0]], 0.22, -1.45);
  },
  destructor(g, P) {
    wedge(g, P.hull, 5.6, 1.7, 0.55, [0, 0, 0.3], 0.06);
    wedge(g, P.mid, 3.2, 1.0, 0.35, [0, 0.45, -0.6], 0.1);
    part(g, new THREE.BoxGeometry(0.15, 0.06, 4.6), P.accent, [0, 0.6, 0.3]);   // franja central
    tower(g, P.hull, P.dark, 0.8, [0, 0.75, -1.6]);
    turret(g, P.hull, P.dark, 0.6, [0.6, 0.38, 0.0], 2); turret(g, P.hull, P.dark, 0.6, [-0.6, 0.38, 0.0], 2);
    turret(g, P.hull, P.dark, 0.5, [0.3, 0.45, 1.2], 2); turret(g, P.hull, P.dark, 0.5, [-0.3, 0.45, 1.2], 2);
    hullBox(g, P.dark, 1.9, 0.6, 0.4, [0, 0.05, -2.45]);
    return engines(g, P.dark, [[0.6, 0.05], [0, 0.05], [-0.6, 0.05]], 0.27, -2.75);
  },
  crucero(g, P) {
    hullBox(g, P.hull, 1.4, 0.9, 5.0, [0, 0, 0], 8);
    wedge(g, P.hull, 2.4, 0.75, 0.4, [0, 0, 3.3], 0.05);
    hullBox(g, P.mid, 3.2, 0.35, 1.6, [0, 0, -0.8]);
    hullBox(g, P.accent, 0.8, 0.8, 2.6, [1.6, 0, -0.9]);
    hullBox(g, P.accent, 0.8, 0.8, 2.6, [-1.6, 0, -0.9]);
    tower(g, P.hull, P.dark, 0.85, [0, 0.45, -1.4]);
    for (const z of [1.6, 0.5]) turret(g, P.hull, P.dark, 0.7, [0, 0.45, z], 3);
    turret(g, P.hull, P.dark, 0.5, [1.6, 0.4, 0], 2); turret(g, P.hull, P.dark, 0.5, [-1.6, 0.4, 0], 2);
    return engines(g, P.dark, [[0.35, 0], [-0.35, 0], [1.6, 0], [-1.6, 0]], 0.3, -2.7);
  },
  portanaves(g, P) {
    hullBox(g, P.hull, 2.6, 0.7, 6.0, [0, 0, 0], 4);
    part(g, new THREE.BoxGeometry(2.0, 0.08, 6.2), P.dark, [0, 0.38, 0.1]); // cubierta de vuelo
    for (let i = 0; i < 6; i++) part(g, new THREE.BoxGeometry(0.08, 0.02, 0.4), glow(0xffd166), [0, 0.43, 2.6 - i * 1.0], null, false);
    part(g, new THREE.BoxGeometry(1.4, 0.4, 0.2), glow(0x5fd8ff), [0, 0, 3.02], null, false); // boca del hangar
    hullBox(g, P.accent, 0.6, 0.5, 4.5, [1.5, -0.2, -0.2]); hullBox(g, P.accent, 0.6, 0.5, 4.5, [-1.5, -0.2, -0.2]);
    tower(g, P.hull, P.dark, 0.8, [1.2, 0.4, -1.4]);
    return engines(g, P.dark, [[0.7, 0], [-0.7, 0], [1.5, -0.2], [-1.5, -0.2]], 0.3, -3.15);
  },
  acorazado(g, P) {
    wedge(g, P.hull, 7.8, 2.4, 0.7, [0, 0, 0.3], 0.1);
    wedge(g, P.mid, 5.0, 1.5, 0.5, [0, 0.6, -0.7], 0.1);
    wedge(g, P.hull, 2.6, 0.9, 0.35, [0, 1.05, -1.9], 0.2);
    part(g, new THREE.BoxGeometry(0.2, 0.06, 6.6), P.accent, [0, 0.75, 0.3]);
    tower(g, P.hull, P.dark, 1.25, [0, 1.25, -2.6]);
    for (const [x, z] of [[0.9, 0.2], [-0.9, 0.2], [0.55, 1.6], [-0.55, 1.6], [1.3, -1.2], [-1.3, -1.2], [0.25, 2.8], [-0.25, 2.8]]) turret(g, P.hull, P.dark, 0.75, [x, 0.5, z], 3);
    hullBox(g, P.dark, 2.8, 0.8, 0.6, [0, 0.1, -3.55]);
    return engines(g, P.dark, [[0.95, 0.1], [0.32, 0.1], [-0.32, 0.1], [-0.95, 0.1], [0.6, 0.55], [-0.6, 0.55]], 0.32, -3.95);
  },
  /* ---------------- CRIATURAS Y ESTACIONES (NPC) ----------------
   * No usan colores de bandera. Cada una anima su cuerpo con
   * g.userData.anim(t) (se llama desde animateFlames). */
  leviatan(g) {
    // Serpiente de roca: cadena de segmentos que ondulan; cabeza en +Z
    const rock = toon(0x5a5148), rock2 = toon(0x7b6f61), moss = toon(0x2d6a4f), eye = glow(0xff7b54);
    const N = 14, segs = [];
    for (let i = 0; i < N; i++) {
      const k = i / (N - 1), r = 0.55 + Math.sin(Math.min(1, k * 1.4) * Math.PI * 0.5) * 0.95 - k * 0.55;
      const sg = new THREE.Group();
      const body = part(sg, new THREE.IcosahedronGeometry(1, 0).scale(1, 0.8, 1.15), i % 3 === 0 ? rock2 : rock, [0, 0, 0]); body.scale.setScalar(Math.max(0.5, r * 1.7));
      part(sg, new THREE.ConeGeometry(0.28 * r, 0.9 * r, 4), moss, [0, 0.95 * r, 0]);
      if (i % 2) { part(sg, new THREE.ConeGeometry(0.2 * r, 0.7 * r, 4).rotateZ(Math.PI / 2), rock2, [0.9 * r, 0.2, 0]); part(sg, new THREE.ConeGeometry(0.2 * r, 0.7 * r, 4).rotateZ(-Math.PI / 2), rock2, [-0.9 * r, 0.2, 0]); }
      g.add(sg); segs.push(sg);
    }
    const head = new THREE.Group();
    part(head, new THREE.IcosahedronGeometry(1.5, 0).scale(1, 0.75, 1.3), rock, [0, 0, 0]);
    const jawU = part(head, new THREE.ConeGeometry(0.9, 2.0, 5).rotateX(Math.PI / 2), rock2, [0, 0.18, 1.7]);
    const jawL = part(head, new THREE.ConeGeometry(0.8, 1.7, 5).rotateX(Math.PI / 2), rock2, [0, -0.3, 1.5]);
    for (const x of [0.6, -0.6]) part(head, new THREE.IcosahedronGeometry(0.22, 0), eye, [x, 0.5, 1.0], null, false);
    for (const [x, y] of [[0.4, -0.05], [-0.4, -0.05], [0.15, -0.05], [-0.15, -0.05]]) part(head, new THREE.ConeGeometry(0.1, 0.5, 4).rotateX(-Math.PI / 2), toon(0xf1faee), [x, y, 2.6], null, false);
    g.add(head);
    g.userData.anim = (t, boost) => {
      const sp = 0.0016 * (boost || 1);
      for (let i = 0; i < N; i++) {
        const k = i / (N - 1), z = -k * 11.5;
        segs[i].position.set(Math.sin(t * sp + k * 5.2) * (0.35 + k * 1.7), Math.sin(t * sp * 0.7 + k * 3) * 0.3, z);
        const dx = Math.cos(t * sp + k * 5.2) * (0.35 + k * 1.7) * 5.2 / 11.5;
        segs[i].rotation.y = Math.atan2(dx, 1) * -0.9;
      }
      head.position.set(Math.sin(t * sp) * 0.35, 0.1, 0.4);
      head.rotation.y = -Math.cos(t * sp) * 0.25;
      const open = 0.14 + Math.max(0, Math.sin(t * sp * 1.6)) * 0.22;
      jawU.rotation.x = Math.PI / 2 * 0 - open; jawL.rotation.x = open;
    };
    g.userData.anim(0);
    return [];
  },
  plaga(g) {
    // Dron centinela antiguo: cuerpo octaédrico, cuatro rotores y ojo rojo
    const metal = toon(0x4a4f57), plate = toon(0x8c1c2b), eye = glow(0xff3b4a);
    part(g, new THREE.OctahedronGeometry(0.55, 0).scale(1, 0.7, 1.2), metal, [0, 0, 0]);
    part(g, new THREE.IcosahedronGeometry(0.2, 0), eye, [0, 0.05, 0.62], null, false);
    const rotors = [];
    for (const [x, z] of [[0.8, 0.5], [-0.8, 0.5], [0.8, -0.5], [-0.8, -0.5]]) {
      part(g, new THREE.BoxGeometry(Math.abs(x), 0.06, 0.08), plate, [x / 2, 0, z / 2]);
      const r = part(g, new THREE.TorusGeometry(0.28, 0.05, 4, 8).rotateX(Math.PI / 2), plate, [x, 0, z], null, false); rotors.push(r);
    }
    g.userData.anim = (t) => { rotors.forEach((r, i) => { r.rotation.y = t * 0.02 * (i % 2 ? 1 : -1); }); };
    return [];
  },
  medusa(g) {
    // Medusa de plasma: campana translúcida, núcleo brillante y tentáculos que ondulan
    const bell = new THREE.MeshToonMaterial({ color: 0xc77dff, gradientMap, transparent: true, opacity: 0.7 });
    const core = glow(0xf3e6ff), tent = new THREE.MeshBasicMaterial({ color: 0x9d4edd, transparent: true, opacity: 0.85 });
    const dome = new THREE.Mesh(facet(new THREE.SphereGeometry(2.3, 8, 5, 0, Math.PI * 2, 0, Math.PI / 2)), bell); dome.scale.set(1, 0.8, 1.15); withOutline(dome, 0.03); g.add(dome);
    part(g, new THREE.IcosahedronGeometry(0.7, 0), core, [0, 0.6, 0], null, false);
    const tents = [];
    const T = 9;
    for (let i = 0; i < T; i++) {
      const a = i / T * Math.PI * 2, grp = new THREE.Group(); grp.position.set(Math.cos(a) * 1.9, 0, Math.sin(a) * 2.2);
      const m = new THREE.Mesh(facet(new THREE.CylinderGeometry(0.14, 0.04, 4.6, 5).translate(0, -2.3, 0)), tent); grp.add(m);
      g.add(grp); tents.push(grp);
    }
    g.userData.anim = (t) => {
      tents.forEach((tn, i) => { tn.rotation.x = Math.sin(t * 0.003 + i * 0.9) * 0.35; tn.rotation.z = Math.cos(t * 0.0026 + i * 1.3) * 0.3; });
      const pulse = 1 + Math.sin(t * 0.004) * 0.05; dome.scale.set(pulse, 0.8 / pulse, 1.15 * pulse);
    };
    g.userData.anim(0);
    return [];
  },
  devorador(g) {
    // Jefe: masa central con un gran ojo y seis tentáculos articulados
    const flesh = toon(0x3a1530), bone = toon(0xd9c9b4), eye = glow(0xff2e63), spike = toon(0x8c1c2b);
    part(g, new THREE.IcosahedronGeometry(3.2, 1).scale(1, 0.8, 1.2), flesh, [0, 0, 0]);
    const iris = part(g, new THREE.IcosahedronGeometry(1.0, 1), eye, [0, 0.6, 3.1], null, false);
    part(g, new THREE.TorusGeometry(1.3, 0.22, 5, 10), bone, [0, 0.6, 3.0], null, false);
    for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; part(g, new THREE.ConeGeometry(0.4, 1.8, 4), spike, [Math.cos(a) * 3.0, Math.sin(a) * 2.4, -0.4], [0, 0, a - Math.PI / 2]); }
    const arms = [];
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2, base = new THREE.Group(); base.position.set(Math.cos(a) * 2.6, Math.sin(a) * 2.0, -0.8);
      const segs = [];
      let parent = base;
      for (let j = 0; j < 5; j++) {
        const seg = new THREE.Group(); if (j) seg.position.set(0, 0, -1.8);
        part(seg, new THREE.CylinderGeometry(0.5 - j * 0.07, 0.6 - j * 0.07, 2.0, 5).rotateX(Math.PI / 2), j % 2 ? flesh : toon(0x4d1b3d), [0, 0, -0.9]);
        parent.add(seg); parent = seg; segs.push(seg);
      }
      base.rotation.y = Math.PI + Math.cos(a) * 0.5; base.rotation.x = Math.sin(a) * 0.5;
      g.add(base); arms.push(segs);
    }
    g.userData.anim = (t) => {
      arms.forEach((segs, k) => segs.forEach((s, j) => { s.rotation.x = Math.sin(t * 0.0021 + k * 1.1 + j * 0.6) * 0.3; s.rotation.y = Math.cos(t * 0.0017 + k + j * 0.5) * 0.3; }));
      const p = 1 + Math.sin(t * 0.005) * 0.12; iris.scale.set(p, p, p);
    };
    g.userData.anim(0);
    return [];
  },
  estacion(g) {
    // Estación fija (guarida pirata): anillo octogonal con torretas y púas
    const m = toon(0x3a2f3f), a = toon(0x8c1c2b), d = toon(0x20181f);
    part(g, new THREE.CylinderGeometry(2.2, 2.2, 0.9, 8), m, [0, 0, 0]);
    part(g, new THREE.TorusGeometry(3.4, 0.35, 5, 8).rotateX(Math.PI / 2), a, [0, 0, 0]);
    part(g, new THREE.CylinderGeometry(0.9, 1.4, 2.4, 6), d, [0, 1.3, 0]);
    part(g, new THREE.IcosahedronGeometry(0.5, 0), glow(0xff3b4a), [0, 2.7, 0], null, false);
    for (let i = 0; i < 8; i++) { const ang = i / 8 * Math.PI * 2; const tg = turret(g, a, d, 0.8, [Math.cos(ang) * 3.4, 0.4, Math.sin(ang) * 3.4], 2); tg.rotation.y = -ang + Math.PI / 2; part(g, new THREE.ConeGeometry(0.25, 1.4, 4), d, [Math.cos(ang + 0.4) * 3.6, -0.2, Math.sin(ang + 0.4) * 3.6], [Math.PI / 2, 0, 0]); }
    g.userData.anim = (t) => { g.rotation.y = t * 0.00008; };
    return [];
  },
  // ---- Fuerzas terrestres (miniaturas de diorama) ----
  infanteria(g, P) {
    for (const [x, z] of [[0, 0.3], [0.7, -0.3], [-0.7, -0.3]]) {
      const s = new THREE.Group(); s.position.set(x, 0, z);
      part(s, new THREE.BoxGeometry(0.36, 0.5, 0.24), P.hull, [0, 0.55, 0]);
      part(s, new THREE.IcosahedronGeometry(0.17, 0), P.accent, [0, 0.98, 0]);
      part(s, new THREE.BoxGeometry(0.06, 0.06, 0.55), P.dark, [0.2, 0.6, 0.25]);
      part(s, new THREE.BoxGeometry(0.13, 0.32, 0.13), P.dark, [0.1, 0.15, 0]); part(s, new THREE.BoxGeometry(0.13, 0.32, 0.13), P.dark, [-0.1, 0.15, 0]);
      g.add(s);
    }
    return [];
  },
  blindado(g, P) {
    hullBox(g, P.hull, 1.4, 0.55, 2.4, [0, 0.55, 0], 6);
    part(g, new THREE.BoxGeometry(0.8, 0.35, 0.9), P.accent, [0, 0.98, -0.1]);
    part(g, new THREE.CylinderGeometry(0.06, 0.06, 1.0, 5).rotateX(Math.PI / 2), P.dark, [0, 1.0, 0.75]);
    part(g, new THREE.BoxGeometry(1.5, 0.12, 2.0), glow(0x5fd8ff), [0, 0.2, 0], null, false); // repulsores
    return [];
  },
  tanque(g, P) {
    part(g, new THREE.BoxGeometry(1.8, 0.6, 2.6), P.hull, [0, 0.5, 0]);
    part(g, new THREE.BoxGeometry(0.45, 0.45, 2.8), P.dark, [0.95, 0.3, 0]); part(g, new THREE.BoxGeometry(0.45, 0.45, 2.8), P.dark, [-0.95, 0.3, 0]);
    part(g, new THREE.CylinderGeometry(0.55, 0.65, 0.45, 6), P.accent, [0, 1.0, -0.2]);
    part(g, new THREE.CylinderGeometry(0.1, 0.1, 1.8, 6).rotateX(Math.PI / 2), P.dark, [0, 1.05, 0.9]);
    return [];
  },
  mecha(g, P) {
    part(g, new THREE.BoxGeometry(1.2, 0.8, 0.9), P.hull, [0, 2.0, 0]);
    part(g, new THREE.BoxGeometry(0.5, 0.3, 0.4), glow(0xff5d73), [0, 2.1, 0.4], null, false);
    for (const x of [0.45, -0.45]) {
      part(g, new THREE.BoxGeometry(0.3, 0.9, 0.35), P.accent, [x, 1.15, 0]);
      part(g, new THREE.BoxGeometry(0.28, 0.9, 0.3), P.dark, [x, 0.45, 0.1]);
      part(g, new THREE.BoxGeometry(0.4, 0.12, 0.6), P.dark, [x, 0.05, 0.15]);
    }
    part(g, new THREE.BoxGeometry(0.25, 0.25, 1.0), P.dark, [0.8, 2.0, 0.35]); part(g, new THREE.BoxGeometry(0.25, 0.25, 1.0), P.dark, [-0.8, 2.0, 0.35]);
    return [];
  }
};

/**
 * Crea una nave/tropa.
 * @param {string} hullId  id de GD.HULLS
 * @param {string[]|number} colors  colores de bandera ['#hex','#hex','#hex'] o un color
 * @returns THREE.Group con userData.flames (para animar)
 */
export function makeShip(hullId, colors) {
  if (typeof colors === 'number') colors = ['#' + colors.toString(16).padStart(6, '0'), '#7d8893', '#ffffff'];
  const P = palette(colors);
  const g = new THREE.Group();
  const b = BUILDERS[hullId] || BUILDERS.corbeta;
  g.userData.flames = b(g, P) || [];
  g.userData.hull = hullId;
  return g;
}
/** Anima el parpadeo de las llamas de propulsión */
export function animateFlames(ship, t, boost) {
  if (ship.userData.anim) ship.userData.anim(t, boost);
  const fl = ship.userData.flames; if (!fl) return;
  for (let i = 0; i < fl.length; i++) {
    const k = (boost || 1) * (0.85 + Math.sin(t * 0.03 + i * 1.7) * 0.15);
    fl[i].scale.set(1, 1, k);
  }
}
/** Tamaño visual aproximado de cada casco (para escalar en escenas) */
export const HULL_SCALE = { caza: 0.5, bombardero: 0.6, dron: 0.4, corbeta: 0.8, transporte: 0.85, fragata: 1, destructor: 1.3, crucero: 1.55, portanaves: 1.75, acorazado: 2.1, infanteria: 0.6, blindado: 0.7, tanque: 0.8, mecha: 0.9, leviatan: 2.6, plaga: 0.4, medusa: 1.5, devorador: 3.4, estacion: 1.6 };
