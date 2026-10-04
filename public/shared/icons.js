/* =====================================================================
 * ORBITAL DOMINATION — ICONOS PROCEDURALES (SVG)
 * ---------------------------------------------------------------------
 * Reemplazan a los emojis. Estilo: línea fina "HUD sci-fi", relleno
 * translúcido, esquinas geométricas, color = currentColor (heredan el
 * color del texto) salvo los recursos, que tienen color propio.
 *
 * USO:
 *   - En cualquier texto del juego escribe un token  :nombre:
 *     (ej. ":war: Guerra declarada"). core.js convierte automáticamente
 *     los tokens en <svg> cuando aparecen en la página (también los que
 *     vienen del servidor: noticias, notificaciones, chat).
 *   - En JS: Icons.svg('war')  -> string <svg>
 *   - Icons.has('war') -> true/false
 *
 * Muchos iconos se GENERAN con funciones (polígonos regulares, estrellas,
 * siluetas simétricas de naves a partir de un "perfil"), así es fácil
 * crear variantes nuevas sin dibujar a mano.
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Icons = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---------- Generadores ---------- */
  const f2 = v => Math.round(v * 100) / 100;
  /** Polígono regular de n lados */
  function ngon(n, r, cx, cy, rotDeg) {
    cx = cx == null ? 12 : cx; cy = cy == null ? 12 : cy; rotDeg = rotDeg == null ? -90 : rotDeg;
    const p = [];
    for (let i = 0; i < n; i++) { const a = (rotDeg + 360 / n * i) * Math.PI / 180; p.push(f2(cx + Math.cos(a) * r) + ',' + f2(cy + Math.sin(a) * r)); }
    return p.join(' ');
  }
  /** Estrella de n puntas */
  function starPts(n, R, r, cx, cy, rotDeg) {
    cx = cx == null ? 12 : cx; cy = cy == null ? 12 : cy; rotDeg = rotDeg == null ? -90 : rotDeg;
    const p = [];
    for (let i = 0; i < n * 2; i++) { const a = (rotDeg + 180 / n * i) * Math.PI / 180; const rr = i % 2 ? r : R; p.push(f2(cx + Math.cos(a) * rr) + ',' + f2(cy + Math.sin(a) * rr)); }
    return p.join(' ');
  }
  /**
   * Silueta simétrica vista desde arriba (nariz hacia arriba).
   * profile = [[y, medioAncho], ...] de la nariz a la cola.
   */
  function sym(profile) {
    const right = profile.map(([y, w]) => f2(12 + w) + ',' + f2(y));
    const left = profile.slice().reverse().map(([y, w]) => f2(12 - w) + ',' + f2(y));
    return right.concat(left).join(' ');
  }
  const FILL = 'fill="currentColor" fill-opacity=".22"';
  const SOLID = 'fill="currentColor" stroke="none"';
  const poly = (pts, extra) => `<polygon points="${pts}" ${extra || FILL}/>`;
  const circ = (cx, cy, r, extra) => `<circle cx="${cx}" cy="${cy}" r="${r}" ${extra || ''}/>`;
  const path = (d, extra) => `<path d="${d}" ${extra || ''}/>`;
  const line = (x1, y1, x2, y2) => `<path d="M${x1} ${y1}L${x2} ${y2}"/>`;
  /** Marco hexagonal "HUD" alrededor de un contenido */
  const hexFrame = inner => poly(ngon(6, 10.5, 12, 12, -90), 'fill="currentColor" fill-opacity=".10"') + inner;
  /** Planeta base con decoración interior (para biomas) */
  const planetWith = deco => `<clipPath id="pc"><circle cx="12" cy="12" r="8.5"/></clipPath>` + circ(12, 12, 8.5, FILL) + `<g clip-path="url(#pc)">${deco}</g>`;

  /* ---------- Siluetas de naves (perfiles) ---------- */
  const HULL_PROFILES = {
    caza:       [[3, 0], [8, 1.4], [12, 1.6], [15, 8], [18, 8], [17.5, 2], [20, 1.6]],
    bombardero: [[3, 0], [7, 2], [11, 2.4], [13, 9], [17, 9], [17, 3], [20.5, 2.6]],
    dron:       [[4, 0], [12, 7], [16, 3], [20, 0]],
    corbeta:    [[2.5, 0], [9, 2.2], [17, 3], [19, 4], [21, 2]],
    transporte: [[3, 0], [5, 2.5], [6, 4.5], [19, 4.5], [21, 3]],
    fragata:    [[2.5, 0], [8, 2.5], [11, 5], [15, 5], [17, 3], [21, 3]],
    destructor: [[2, 0], [19, 7.5], [21, 5], [21, 3]],
    crucero:    [[2, 0], [6, 2.5], [10, 3], [12, 6], [16, 6], [17, 4], [21.5, 4]],
    portanaves: [[3, 1.5], [3.5, 4.5], [20, 5], [21, 3.5]],
    acorazado:  [[1.5, 0], [17, 8.5], [19, 8.5], [19.5, 6], [21.5, 6]]
  };
  const hullIcon = (k, extra) => poly(sym(HULL_PROFILES[k])) + (extra || '');

  /* ---------- Diccionario de iconos ---------- */
  const I = {
    // ===== Recursos / economía =====
    credits: circ(12, 12, 9, FILL) + path('M15.6 8.6a5 5 0 1 0 0 6.8') + line(12, 5, 12, 19),
    research: `<ellipse cx="12" cy="12" rx="9.5" ry="3.6"/><ellipse cx="12" cy="12" rx="9.5" ry="3.6" transform="rotate(60 12 12)"/><ellipse cx="12" cy="12" rx="9.5" ry="3.6" transform="rotate(-60 12 12)"/>` + circ(12, 12, 1.8, SOLID),
    energia: poly('13.5,2 5,13.5 11,13.5 9.5,22 19,10 13,10', 'fill="currentColor" fill-opacity=".35"'),
    aleaciones: poly(ngon(6, 9.5)) + circ(12, 12, 3.6) + line(12, 2.5, 12, 5),
    helio3: `<rect x="7" y="5" width="10" height="15.5" rx="3" ${FILL}/>` + path('M10 2.5h4M9.5 5V2.5M14.5 5V2.5') + path('M12 9.5c-1.6 2-2.4 3.2-2.4 4.3a2.4 2.4 0 0 0 4.8 0c0-1.1-.8-2.3-2.4-4.3z', SOLID),
    cristales: poly('12,2 20,9 12,22 4,9') + path('M4 9h16M8 9l4-7 4 7M8 9l4 13 4-13'),
    exoticos: circ(12, 12, 3.5, 'fill="currentColor" fill-opacity=".5"') + '<ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(30 12 12)"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(-30 12 12)"/>',
    compuestos: `<rect x="7" y="7" width="10" height="10" rx="1" ${FILL}/>` + path('M9.5 7V3.5M12 7V3.5M14.5 7V3.5M9.5 17v3.5M12 17v3.5M14.5 17v3.5M7 9.5H3.5M7 12H3.5M7 14.5H3.5M17 9.5h3.5M17 12h3.5M17 14.5h3.5') + `<rect x="10" y="10" width="4" height="4" ${SOLID}/>`,
    pop: circ(8.5, 8, 3, FILL) + path('M3 19c0-3.3 2.4-5.5 5.5-5.5S14 15.7 14 19') + circ(16, 9, 2.5, FILL) + path('M15 13.8c3.5-.6 6 1.6 6 4.7'),
    price: poly('3,11 11,3 21,3 21,13 13,21', FILL) + circ(16.5, 7.5, 1.6),
    evasion: circ(10, 13, 6.5, FILL) + path('M12.5 10.8a3 3 0 1 0 0 4.4') + path('M15 5l5-2.5M17.5 3H20v2.5'),
    bank: poly('2.5,9 12,3 21.5,9', FILL) + path('M4.5 10.5v7M9 10.5v7M15 10.5v7M19.5 10.5v7M2.5 20.5h19M3.5 18.5h17'),
    market: path('M3 4h2.5l2.4 10.5h10.6L21 7H6.4') + poly('7.9,14.5 18.5,14.5 21,7 6.4,7', FILL) + circ(9.5, 18.5, 1.6) + circ(16.5, 18.5, 1.6),
    chart: `<rect x="4" y="13" width="3.5" height="7" ${FILL}/><rect x="10.2" y="8" width="3.5" height="12" ${FILL}/><rect x="16.5" y="4" width="3.5" height="16" ${FILL}/>` + line(2.5, 21, 21.5, 21),
    job: `<rect x="3" y="7.5" width="18" height="12" rx="1.5" ${FILL}/>` + path('M9 7.5V5h6v2.5M3 12.5h18'),
    crime: `<rect x="2.5" y="8.5" width="10" height="7" rx="3.5" transform="rotate(-30 7.5 12)"/><rect x="11.5" y="8.5" width="10" height="7" rx="3.5" transform="rotate(-30 16.5 12)" ${FILL}/>`,
    box: poly('12,2.5 20.5,7 20.5,17 12,21.5 3.5,17 3.5,7', FILL) + path('M3.5 7L12 11.5 20.5 7M12 11.5v10'),
    balance: line(12, 3, 12, 20) + path('M8 20.5h8M4 6.5h16') + path('M4 6.5L1.5 13h5zM20 6.5L17.5 13h5z', FILL) + circ(12, 4.5, 1.4, SOLID),

    // ===== Navegación / UI =====
    galaxy: path('M12 12m-1.5 0a1.5 1.5 0 1 0 3 0a3.5 3.5 0 1 0 -7 0a5.5 5.5 0 1 0 11 0a7.5 7.5 0 1 0 -15 0') + circ(12, 12, 1.2, SOLID),
    gov: poly('2.5,8.5 12,3 21.5,8.5', FILL) + path('M5 10.5v7M9.6 10.5v7M14.4 10.5v7M19 10.5v7M3 20.5h18M4 18.5h16'),
    chat: path('M3.5 5h17v11h-9l-5 4v-4h-3z', FILL) + path('M7.5 9h9M7.5 12h6'),
    close: path('M6 6l12 12M18 6L6 18'),
    check: path('M4 12.5l5 5L20 6.5'),
    ok: circ(12, 12, 9, FILL) + path('M7.5 12.5l3 3 6-6.5'),
    x: circ(12, 12, 9, FILL) + path('M8.5 8.5l7 7M15.5 8.5l-7 7'),
    arrow: path('M4 12h15M14 7l5 5-5 5'),
    back: path('M20 12H5M10 7l-5 5 5 5'),
    right: path('M4 12h15M14 7l5 5-5 5'),
    send: poly('3,3 21,12 3,21 6.5,12', FILL) + line(6.5, 12, 13, 12),
    home: poly('3,11 12,3.5 21,11', FILL) + path('M5.5 9.5V20.5h13V9.5M10 20.5v-5.5h4v5.5'),
    gear: poly(starPts(8, 10, 7.6, 12, 12, -90), FILL) + circ(12, 12, 3.2),
    build: path('M14.5 4.5a4.5 4.5 0 0 0-5.6 5.6L3.5 15.5l5 5 5.4-5.4a4.5 4.5 0 0 0 5.6-5.6l-2.8 2.8-2.8-.8-.8-2.8z', FILL),
    wrench: path('M14.5 4.5a4.5 4.5 0 0 0-5.6 5.6L3.5 15.5l5 5 5.4-5.4a4.5 4.5 0 0 0 5.6-5.6l-2.8 2.8-2.8-.8-.8-2.8z', FILL),
    crane: path('M5 21V4h2v17M3 21h8M7 5h13l-2 3H7M16.5 8v5') + `<rect x="14.5" y="13" width="4" height="3" ${FILL}/>`,
    lock: `<rect x="5" y="10.5" width="14" height="10" rx="1.5" ${FILL}/>` + path('M8 10.5V7.5a4 4 0 0 1 8 0v3') + line(12, 14.5, 12, 17),
    unlock: `<rect x="5" y="10.5" width="14" height="10" rx="1.5" ${FILL}/>` + path('M8 10.5V7.5a4 4 0 0 1 7.6-1.7') + line(12, 14.5, 12, 17),
    time: path('M6 2.5h12M6 21.5h12M7.5 2.5c0 5 9 5.5 9 9.5s-9 4.5-9 9.5M16.5 2.5c0 5-9 5.5-9 9.5s9 4.5 9 9.5') + poly('9,19.5 15,19.5 12,15.5', SOLID),
    scroll: path('M6 3h9.5L19 6.5V21H6z', FILL) + path('M15.5 3v3.5H19M9 10h7M9 13.5h7M9 17h4.5'),
    mail: `<rect x="2.5" y="5" width="19" height="14" rx="1.5" ${FILL}/>` + path('M2.5 6l9.5 7 9.5-7'),
    news: `<rect x="3" y="4" width="15" height="16" rx="1" ${FILL}/>` + path('M18 8h3v10.5a1.5 1.5 0 0 1-3 0M6 8h9M6 11.5h9M6 15h5'),
    inbox: path('M3 13l3-8.5h12L21 13v7H3z', FILL) + path('M3 13h5.5l1.5 2.5h4l1.5-2.5H21'),
    in: path('M3 14v6h18v-6') + path('M12 3v11M7.5 9.5L12 14l4.5-4.5'),
    out: path('M3 14v6h18v-6') + path('M12 14V3M7.5 7.5L12 3l4.5 4.5'),
    pin: path('M12 21.5s-7-6.5-7-12a7 7 0 0 1 14 0c0 5.5-7 12-7 12z', FILL) + circ(12, 9.5, 2.5),
    map: poly('2.5,5.5 8.5,3.5 15.5,6 21.5,4 21.5,18.5 15.5,20.5 8.5,18 2.5,20', FILL) + path('M8.5 3.5V18M15.5 6v14.5'),
    compass: circ(12, 12, 9.5, FILL) + poly('12,4.5 14.2,12 12,19.5 9.8,12', 'fill="currentColor" fill-opacity=".55"') + line(9.8, 12, 14.2, 12),
    eye: path('M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z', FILL) + circ(12, 12, 3) + circ(12, 12, 1, SOLID),
    stop: `<rect x="6" y="6" width="12" height="12" rx="1" ${FILL}/>`,
    split: path('M12 21v-7M12 14L6 6M12 14l6-8M3.5 6.5L6 6l.5 2.5M20.5 6.5L18 6l-.5 2.5'),
    trash: path('M4 6.5h16M9 6.5V4h6v2.5M6 6.5l1 14h10l1-14', FILL) + path('M10 10v7M14 10v7'),
    user: circ(12, 8, 4, FILL) + path('M4 21c0-4.4 3.6-7.5 8-7.5s8 3.1 8 7.5'),
    exit: path('M10 3.5H4.5v17H10') + path('M9 12h12M17 8l4 4-4 4'),
    sound: poly('3,9 7.5,9 13,4.5 13,19.5 7.5,15 3,15', FILL) + path('M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12'),
    mute: poly('3,9 7.5,9 13,4.5 13,19.5 7.5,15 3,15', FILL) + path('M16.5 9.5l5 5M21.5 9.5l-5 5'),
    warn: poly('12,2.5 22,20.5 2,20.5', FILL) + path('M12 9v5.5') + circ(12, 17.5, 1, SOLID),
    alert: path('M5.5 19v-6.5a6.5 6.5 0 0 1 13 0V19', FILL) + path('M3 19.5h18M12 2v2.5M3.5 6l1.8 1.8M20.5 6l-1.8 1.8') + `<rect x="10.5" y="11" width="3" height="5" ${SOLID}/>`,
    megaphone: path('M3 9.5h4l10-5v15l-10-5H3z', FILL) + path('M7 14.5l1.5 6h3L10 15.5M20 9.5v5'),
    ruler: `<rect x="2" y="8" width="20" height="8" rx="1" ${FILL}/>` + path('M6 8v3.5M10 8v4.5M14 8v3.5M18 8v4.5'),
    dice: `<rect x="3.5" y="3.5" width="17" height="17" rx="3" ${FILL}/>` + circ(8, 8, 1.3, SOLID) + circ(16, 16, 1.3, SOLID) + circ(12, 12, 1.3, SOLID) + circ(16, 8, 1.3, SOLID) + circ(8, 16, 1.3, SOLID),
    info: circ(12, 12, 9.5, FILL) + path('M12 10.5v6.5') + circ(12, 7.3, 1.1, SOLID),
    plus: path('M12 5v14M5 12h14'),
    star: poly(starPts(5, 9.5, 4.2), 'fill="currentColor" fill-opacity=".35"'),
    crown: poly('3,18 2,7 8,11.5 12,4.5 16,11.5 22,7 21,18', FILL) + line(3, 20.5, 21, 20.5),
    trophy: path('M7 3.5h10v5a5 5 0 0 1-10 0z', FILL) + path('M7 5H3.5c0 3 1.5 4.5 3.7 4.8M17 5h3.5c0 3-1.5 4.5-3.7 4.8M12 13.5V18M8 21h8M9.5 18h5'),
    medal: poly('8,2.5 11,9 13,9 16,2.5', FILL) + circ(12, 15, 6, FILL) + poly(starPts(5, 3.4, 1.5, 12, 15), SOLID),
    flag: line(5, 21.5, 5, 2.5) + path('M5 3.5h13l-2.5 4.5 2.5 4.5H5', FILL),
    conquest: line(5, 21.5, 5, 2.5) + path('M5 3.5h13l-2.5 4.5 2.5 4.5H5', 'fill="currentColor" fill-opacity=".7"'),
    peace: path('M4.5 20C9 18 14.5 12 17 4.5') + path('M8.5 16.5c-2.5-.2-4-1.6-4.3-3.6 2.4-.2 4 1 4.3 3.6zM11.5 13c-2.3-.8-3.4-2.4-3.2-4.4 2.3.5 3.5 2.1 3.2 4.4zM14 9.2c-1.9-1.4-2.4-3.2-1.6-5 2 1 2.6 2.9 1.6 5zM10.7 18c.7-2.3 2.4-3.4 4.4-3.1-.6 2.3-2.2 3.4-4.4 3.1zM13.8 14.6c1.2-2.1 3-2.8 5-2.2-1 2.1-2.9 2.8-5 2.2z', FILL),
    skull: path('M12 2.5c-4.7 0-8 3.3-8 7.8 0 2.7 1.3 4.6 3 5.7v4.5h10V16c1.7-1.1 3-3 3-5.7 0-4.5-3.3-7.8-8-7.8z', FILL) + circ(8.8, 10.8, 2, SOLID) + circ(15.2, 10.8, 2, SOLID) + path('M10 20.5v-2.5M14 20.5v-2.5'),
    ruin: path('M3 20.5h18M5 20.5V10l4-3 2 2 2-2.5 3 3.5v10.5', FILL) + path('M9 20.5v-4h3v4M14.5 13.5h2'),
    house: path('M2.5 11L8 6l5.5 5M4 10v10h8V10') + path('M11.5 13.5L16 9.5l5.5 5V20h-9', FILL) + path('M2 20.5h20'),
    satellite: `<rect x="9" y="9" width="6" height="6" transform="rotate(45 12 12)" ${FILL}/>` + path('M3 9l4.5-4.5 3 3L6 12zM21 15l-4.5 4.5-3-3L18 12z', FILL) + path('M15.5 4.5a4 4 0 0 1 4 4M15.5 1.5a7 7 0 0 1 7 7'),
    heart: path('M12 20.5S3 15 3 8.8A4.7 4.7 0 0 1 12 6.5a4.7 4.7 0 0 1 9 2.3C21 15 12 20.5 12 20.5z', FILL),
    hullhp: poly(ngon(6, 9.5), FILL) + path('M12 5.5v13M6.4 8.7l11.2 6.6M17.6 8.7L6.4 15.3'),
    speed: path('M3 15a9 9 0 0 1 18 0', FILL) + path('M12 15l4.5-6') + circ(12, 15, 1.5, SOLID) + path('M5 21h14'),
    power: poly('12,2 21,7 21,17 12,22 3,17 3,7', FILL) + poly('13,6 8,13 11.5,13 10.5,18 16,10.5 12.5,10.5', SOLID),
    planet: circ(12, 12, 6.5, FILL) + '<ellipse cx="12" cy="12" rx="10.5" ry="3.6" transform="rotate(-20 12 12)"/>',
    globe: circ(12, 12, 9.5, FILL) + '<ellipse cx="12" cy="12" rx="4" ry="9.5"/>' + path('M2.5 12h19M4 7h16M4 17h16'),
    biome: planetWith(path('M3 10c3 0 4-3 7-2s2 4 5 4 3-3 7-2v12H3z', 'fill="currentColor" fill-opacity=".45"')),

    // ===== Militar / diplomacia =====
    war: path('M4 3.5l12.5 12.5M3.5 4V3.5H4M20 3.5L7.5 16M20.5 4V3.5H20') + path('M14 18.5l4.5-4.5M10 18.5L5.5 14M16 16l3.5 3.5M8 16l-3.5 3.5'),
    fleet: poly(sym([[2, 0], [10, 2.5], [17, 3.5], [19.5, 7], [21.5, 7], [21, 3]])) + line(12, 8, 12, 15),
    battle: poly(starPts(9, 10.5, 4.6), 'fill="currentColor" fill-opacity=".35"') + circ(12, 12, 2, SOLID),
    ally: circ(8.5, 12, 6) + circ(15.5, 12, 6, FILL),
    shield: path('M12 2.5l8.5 3v6c0 5-3.5 8.8-8.5 10.5C7 20.3 3.5 16.5 3.5 11.5v-6z', FILL) + path('M12 6v12M7 10.5h10'),
    troops: path('M3.5 15.5c0-5.5 3.7-9.5 8.5-9.5s8.5 4 8.5 9.5z', FILL) + path('M2 15.5h20M9 6.5v-2h6v2M6 18.5h12'),
    target: circ(12, 12, 9) + circ(12, 12, 5, FILL) + circ(12, 12, 1.4, SOLID) + path('M12 1.5v4M12 18.5v4M1.5 12h4M18.5 12h4'),
    dagger: path('M12 2l2 3v10h-4V5z', FILL) + path('M7 15h10M12 15v3.5') + circ(12, 20.5, 1.6),
    tower: path('M8 21.5l1.5-11h5l1.5 11z', FILL) + `<rect x="7.5" y="6.5" width="9" height="4" rx="1" ${FILL}/>` + path('M14 7.5l6-4.5M5 21.5h14'),
    radar: path('M4.5 17.5a9 9 0 0 1 9-12.5z', FILL) + path('M9 13l6.5-6.5M4.5 17.5l-1.5 4h7M17 3.5a4 4 0 0 1 3.5 3.5M16.5.5a7 7 0 0 1 7 7') + circ(16, 6, 1.2, SOLID),
    signal: path('M4 20v-3M8.5 20v-6M13 20v-9M17.5 20V8', 'stroke-width="2.4"') + path('M3 8l4-3.5 3.5 3 4-4 3 2.5 3.5-3'),
    scope: path('M3 12a9 9 0 0 1 9-9M3 12a9 9 0 0 0 9 9') + path('M7 12a5 5 0 0 1 5-5M7 12a5 5 0 0 0 5 5') + path('M12 12h10M18 9l3 3-3 3'),
    close_range: poly(starPts(6, 8, 3.5), 'fill="currentColor" fill-opacity=".45"') + path('M2 2l4 4M22 2l-4 4M2 22l4-4M22 22l-4-4'),
    order: poly(ngon(4, 9.5, 12, 12, 0), FILL) + path('M8 12h8M13 8.5l3.5 3.5-3.5 3.5'),
    invade: line(6, 21.5, 6, 6) + path('M6 6.5h11l-2 3.5 2 3.5H6', 'fill="currentColor" fill-opacity=".55"') + path('M3 21.5h18') + path('M14 2v3M12.5 3.5h3'),
    attack: path('M12 2.5l4.5 9.5H7.5z', 'fill="currentColor" fill-opacity=".45"') + path('M12 12v9.5M7.5 17.5L12 22l4.5-4.5'),
    siege: circ(12, 12, 6, FILL) + circ(12, 12, 10.5, 'stroke-dasharray="2.5 2.5"') + path('M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3'),

    // ===== Laboratorio / proyectos =====
    lab: path('M9 2.5h6M10 2.5v6L4 19.5a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 8.5v-6') + path('M6.5 15h11l2.5 4.5a1.5 1.5 0 0 1-1.3 2H5.3a1.5 1.5 0 0 1-1.3-2z', FILL),
    chip: `<rect x="5" y="5" width="14" height="14" rx="1.5" ${FILL}/>` + path('M9 5V2M15 5V2M9 22v-3M15 22v-3M5 9H2M5 15H2M22 9h-3M22 15h-3') + poly(ngon(6, 3.2), SOLID),
    engine: path('M8 2.5h8l-1 6H9z', FILL) + path('M9 8.5c-1.5 3-2.5 5.5-2.5 8A5.5 5.5 0 0 0 12 22a5.5 5.5 0 0 0 5.5-5.5c0-2.5-1-5-2.5-8') + path('M12 12c-1.2 1.8-2 3.3-2 4.6a2 2 0 0 0 4 0c0-1.3-.8-2.8-2-4.6z', SOLID),
    fighter: hullIcon('caza'),

    // ===== Biomas =====
    bio_continental: planetWith(path('M2 10c3 0 3.5-3 6.5-2.5S11 11 14 10s3-4 7-3v6c-3 0-3.5 3-6.5 3s-3 3-6 3-4-2-6.5-2z', 'fill="currentColor" fill-opacity=".5"')),
    bio_oceanico: planetWith(path('M2 9c2.5-1.5 4.5 1.5 7 0s4.5 1.5 7 0 4.5 1.5 7 0M2 13c2.5-1.5 4.5 1.5 7 0s4.5 1.5 7 0 4.5 1.5 7 0M2 17c2.5-1.5 4.5 1.5 7 0s4.5 1.5 7 0 4.5 1.5 7 0')),
    bio_desertico: planetWith(path('M1 14c4-4 7-4 11 0s7 4 11 0v10H1z', 'fill="currentColor" fill-opacity=".45"') + path('M1 10c4-3 7-3 11 0')),
    bio_helado: circ(12, 12, 8.5, FILL) + path('M12 5v14M5.9 8.5l12.2 7M18.1 8.5L5.9 15.5M10.5 6.5L12 8l1.5-1.5M10.5 17.5L12 16l1.5 1.5'),
    bio_volcanico: planetWith(poly('3,22 10,9 12.5,12 15,8 21,22', 'fill="currentColor" fill-opacity=".5"') + path('M12.5 12l-1 4 1.5 3')),
    bio_selvatico: planetWith(path('M12 21V11M12 11c-3 0-5-2-5-4.5 2.5 0 5 1.5 5 4.5zM12 13.5c3 0 5-2 5-4.5-2.5 0-5 1.5-5 4.5z', 'fill="currentColor" fill-opacity=".55"')),
    bio_gaseoso: planetWith(path('M2 8h20M2 11.5h20M2 15h20', 'stroke-width="2.2" stroke-opacity=".6"')) + '<ellipse cx="12" cy="12" rx="11" ry="3" transform="rotate(-15 12 12)"/>',
    bio_ecumenopolis: planetWith(path('M3 20V13h3v-3h3v5h2V8h3v6h2v-4h3v3h3v7z', 'fill="currentColor" fill-opacity=".55"') + circ(9.5, 7, .8, SOLID) + circ(15, 6, .8, SOLID)),

    // ===== Cascos (siluetas generadas desde perfiles) =====
    h_caza: hullIcon('caza'),
    h_bombardero: hullIcon('bombardero'),
    h_dron: hullIcon('dron', circ(12, 12, 2, SOLID)),
    h_corbeta: hullIcon('corbeta', line(12, 9, 12, 16)),
    h_transporte: hullIcon('transporte', path('M9 9h6M9 12.5h6M9 16h6')),
    h_fragata: hullIcon('fragata', line(12, 7, 12, 17)),
    h_destructor: hullIcon('destructor', poly(sym([[9, 0], [17, 2.5], [17, 0]]), SOLID)),
    h_crucero: hullIcon('crucero', path('M12 6v13M9.5 13h5')),
    h_portanaves: hullIcon('portanaves', path('M12 5v13M10 7l2-2 2 2') + `<rect x="15.5" y="11" width="2" height="4" ${SOLID}/>`),
    h_acorazado: hullIcon('acorazado', poly(sym([[6, 0], [15, 3.5], [17, 3.5], [17, 0]]), SOLID) + circ(12, 12, 1.2)),
    h_infanteria: circ(12, 5.5, 2.8, FILL) + path('M8 21l1-8-2 1-1.5-4 4.5-2h4l4.5 2-1.5 4-2-1 1 8') + line(17, 9, 21, 5),
    h_blindado: path('M2.5 14.5l3-6h11l5 3v3z', FILL) + path('M2 17.5h20') + path('M5 20h14', 'stroke-dasharray="1.5 2"') + path('M12 8.5V6h4'),
    h_tanque: path('M2 15l2.5-4h15l2.5 4z', FILL) + `<rect x="8" y="7" width="7" height="4" rx="1" ${FILL}/>` + path('M15 8.5h7M3 18h18'),
    h_mecha: `<rect x="7" y="4" width="10" height="7" rx="1.5" ${FILL}/>` + path('M9 11l-2 5 1 5M15 11l2 5-1 5M7 6.5H3v4M17 6.5h4v4M10 7h4'),

    // ===== Componentes =====
    c_laser: path('M2 12h5', 'stroke-width="3"') + path('M7 12h15', 'stroke-dasharray="3 1.5"') + circ(7, 12, 2.5, FILL),
    c_canon: `<rect x="2.5" y="9" width="8" height="7" rx="1" ${FILL}/>` + path('M10.5 11h11M10.5 14h11') + circ(6.5, 12.5, 1.4, SOLID),
    c_railgun: path('M2 8.5h18M2 15.5h18', 'stroke-width="2.2"') + path('M5 12h2M10 12h2M15 12h7') + poly('19,9.5 22,12 19,14.5', SOLID),
    c_misil: path('M3 21l3-6 9-9a3 3 0 0 1 4-1 3 3 0 0 1-1 4l-9 9z', FILL) + path('M6 15l3 3M5 13l-2.5.5M11 19l-.5 2.5'),
    c_torpedo: path('M2.5 12c0-2 1.5-3.5 3.5-3.5h11c2.5 0 4.5 1.5 5 3.5-.5 2-2.5 3.5-5 3.5H6c-2 0-3.5-1.5-3.5-3.5z', FILL) + path('M6 8.5L3 5M6 15.5L3 19M17 8.5v7'),
    c_plasma: circ(9, 12, 5, FILL) + circ(9, 12, 2, SOLID) + path('M14 9.5l8-2.5M14 14.5l8 2.5M14.5 12H22'),
    c_rifle: path('M2 10h15l3-1.5V11h2v2h-5l-2 1.5h-3l-1 4.5H8l1-4.5H4l-2-2z', FILL),
    c_blindaje: `<rect x="3" y="4" width="8" height="5" ${FILL}/><rect x="13" y="4" width="8" height="5" ${FILL}/><rect x="3" y="15" width="8" height="5" ${FILL}/><rect x="13" y="15" width="8" height="5" ${FILL}/>` + `<rect x="7" y="9.5" width="10" height="5" ${FILL}/>`,
    c_escudo: circ(12, 12, 9.5, 'stroke-dasharray="3 2" ' + FILL) + circ(12, 12, 5.5) + circ(12, 12, 1.5, SOLID),
    c_pd: circ(12, 12, 9) + path('M12 3v18M3 12h18') + circ(12, 12, 4, FILL) + path('M17 6.5l1.5-1.5M6 18l-1.5 1.5'),
    c_armadura: path('M8 3l4 2 4-2 4 3-2 5v9.5H6V11L4 6z', FILL) + path('M12 5v15.5M8 11h8'),
    c_motor: path('M8 2.5h8l-1 6H9z', FILL) + path('M9 8.5c-1.5 3-2.5 5.5-2.5 8A5.5 5.5 0 0 0 12 22a5.5 5.5 0 0 0 5.5-5.5c0-2.5-1-5-2.5-8'),
    c_sensor: path('M4.5 17.5a9 9 0 0 1 9-12.5z', FILL) + path('M9 13l6.5-6.5M4.5 17.5l-1.5 4h7') + circ(16, 6, 1.2, SOLID),
    c_ecm: path('M4 20v-3M8.5 20v-6M13 20v-9M17.5 20V8', 'stroke-width="2.4"') + path('M3 8l4-3.5 3.5 3 4-4 3 2.5 3.5-3'),

    // ===== Edificios =====
    b_extractor: path('M12 2.5v10M8 6.5l4 6 4-6') + poly('6,12.5 18,12.5 16,21.5 8,21.5', FILL) + path('M3 21.5h18'),
    b_planta: hexFrame(poly('13,5 7.5,13 11.5,13 10.5,19 16.5,11 12.5,11', 'fill="currentColor" fill-opacity=".5"')),
    b_fabrica: path('M2.5 21V11l5 3.5V11l5 3.5V11l5 3.5V4h3v17z', FILL) + path('M2.5 21h19M6 18h2M11 18h2M16 18h2'),
    b_comercio: `<rect x="9" y="9" width="6" height="6" transform="rotate(45 12 12)" ${FILL}/>` + path('M3 9l4.5-4.5 3 3L6 12zM21 15l-4.5 4.5-3-3L18 12z', FILL) + circ(12, 12, 10.5, 'stroke-dasharray="1.5 3"'),
    b_laboratorio: path('M9 2.5h6M10 2.5v6L4 19.5a1.5 1.5 0 0 0 1.3 2h13.4a1.5 1.5 0 0 0 1.3-2L14 8.5v-6') + path('M6.5 15h11l2.5 4.5a1.5 1.5 0 0 1-1.3 2H5.3a1.5 1.5 0 0 1-1.3-2z', FILL),
    b_astillero: path('M5 21V4h2v17M3 21h8M7 5h13l-2 3H7M16.5 8v4') + poly(sym([[12, 0], [17, 2], [19, 2]]).replace(/(\d+\.?\d*),/g, (m, x) => f2(+x + 4.5) + ','), FILL),
    b_cuartel: poly('8,2.5 11,9 13,9 16,2.5', FILL) + circ(12, 15, 6, FILL) + poly(starPts(5, 3.4, 1.5, 12, 15), SOLID),
    b_bateria: path('M8 21.5l1.5-11h5l1.5 11z', FILL) + `<rect x="7.5" y="6.5" width="9" height="4" rx="1" ${FILL}/>` + path('M14 7.5l6-4.5M5 21.5h14'),
    b_escudo: path('M2.5 20a9.5 9.5 0 0 1 19 0', FILL) + path('M5.5 20a6.5 6.5 0 0 1 13 0', 'stroke-dasharray="2 2"') + path('M1.5 20.5h21'),
    b_vivienda: path('M2.5 11L8 6l5.5 5M4 10v10h8V10') + path('M11.5 13.5L16 9.5l5.5 5V20h-9', FILL) + path('M2 20.5h20'),

    // ===== Ramas tecnológicas =====
    t_economia: circ(12, 12, 9, FILL) + path('M15.6 8.6a5 5 0 1 0 0 6.8') + line(12, 5, 12, 19),
    t_cazas: hullIcon('caza'),
    t_naves: hullIcon('destructor'),
    t_terrestre: path('M3.5 15.5c0-5.5 3.7-9.5 8.5-9.5s8.5 4 8.5 9.5z', FILL) + path('M2 15.5h20M9 6.5v-2h6v2M6 18.5h12'),
    t_armas: poly(starPts(9, 10.5, 4.6), 'fill="currentColor" fill-opacity=".35"') + circ(12, 12, 2, SOLID),
    t_defensa: path('M12 2.5l8.5 3v6c0 5-3.5 8.8-8.5 10.5C7 20.3 3.5 16.5 3.5 11.5v-6z', FILL) + path('M12 6v12M7 10.5h10'),
    t_sistemas: poly(starPts(8, 10, 7.6), FILL) + circ(12, 12, 3.2),
    t_orbital: circ(12, 12, 5, FILL) + circ(12, 12, 10, 'stroke-dasharray="2 2.5"') + circ(19.1, 4.9, 1.6, SOLID)
  };
  // Alias útiles
  I.ships = I.fleet; I.space = I.galaxy; I.army = I.troops; I.license = I.scroll;
  I.ship_line = I.h_destructor;

  /** Color propio de algunos iconos (recursos y estados) */
  const COLORS = {
    credits: '#ffd166', energia: '#ffd166', aleaciones: '#c9d1d9', helio3: '#4cc9f0', cristales: '#c77dff', exoticos: '#80ffdb', compuestos: '#ff8fab',
    research: '#7cd5ff', war: '#ef476f', battle: '#ff7b54', skull: '#ef476f', peace: '#90e0b0', ok: '#57cc99', check: '#57cc99', x: '#ef476f',
    warn: '#ffd166', alert: '#ef476f', star: '#ffd166', crown: '#ffd166', trophy: '#ffd166', dagger: '#ef476f', conquest: '#ef476f',
    c_laser: '#ff5d73', c_plasma: '#c77dff', c_escudo: '#4cc9f0', b_planta: '#ffd166', b_escudo: '#4cc9f0', heart: '#ef476f', hullhp: '#ef476f', power: '#ffd166'
  };

  let uidN = 0;
  /**
   * @param {string} name   nombre del icono
   * @param {object} [o]    { size: '1.15em', color: '#fff', cls: '' }
   */
  function svg(name, o) {
    o = o || {};
    let body = I[name];
    if (!body) return '';
    // clipPath necesita id único por instancia
    if (body.indexOf('id="pc"') >= 0) { const id = 'pc' + (uidN++); body = body.replace('id="pc"', `id="${id}"`).replace('url(#pc)', `url(#${id})`); }
    const color = o.color || COLORS[name];
    const size = o.size || '1.15em';
    return `<svg class="icon ${o.cls || ''}" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"${color ? ` style="color:${color}"` : ''} aria-hidden="true">${body}</svg>`;
  }
  function has(name) { return Object.prototype.hasOwnProperty.call(I, name); }
  function list() { return Object.keys(I); }

  return { svg, has, list, ngon, starPts, sym, HULL_PROFILES };
});
