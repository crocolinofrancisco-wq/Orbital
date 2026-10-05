/* =====================================================================
 * ORBITAL DOMINATION — DATOS DEL JUEGO (compartido cliente + servidor)
 * ---------------------------------------------------------------------
 * Este archivo es la "fuente de verdad" del balance del juego.
 * Se carga en el navegador (window.GameData) y en Node (require).
 * Para balancear el juego, edita SOLO este archivo (ver docs/BALANCE.md).
 * ===================================================================== */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.GameData = factory();
})(typeof self !== 'undefined' ? self : this, function () {

  /* ---------------------------------------------------------------
   * RECURSOS
   * Reemplazan a: Energía, Petróleo, Metales comunes, Joyas, Litio,
   * Uranio, Metales raros y Compuestos del Global Domination original.
   * Se redujeron a 6 para que un adolescente los memorice rápido.
   * --------------------------------------------------------------- */
  const RESOURCES = {
    energia:    { name: 'Energía',        icon: ':energia:', color: '#ffd166', desc: 'Alimenta escudos, láseres y edificios.' },
    aleaciones: { name: 'Aleaciones',     icon: ':aleaciones:', color: '#adb5bd', desc: 'Metal estructural. Cascos, blindaje y edificios.' },
    helio3:     { name: 'Helio-3',        icon: ':helio3:', color: '#4cc9f0', desc: 'Combustible de motores y reactores de fusión.' },
    cristales:  { name: 'Cristales',      icon: ':cristales:', color: '#c77dff', desc: 'Lentes de láser y armas de energía. Muy comerciable.' },
    exoticos:   { name: 'Materia exótica',icon: ':exoticos:', color: '#80ffdb', desc: 'Rara. Hiperimpulsores, escudos y tecnología avanzada.' },
    compuestos: { name: 'Compuestos',     icon: ':compuestos:', color: '#ff8fab', desc: 'Electrónica, sensores y misiles.' }
  };

  /* ---------------------------------------------------------------
   * BIOMAS DE PLANETA
   * palette: colores para el render low-poly (agua/tierra/detalle)
   * popMult: multiplicador de población máxima
   * resources: recursos que puede tener como yacimiento
   * --------------------------------------------------------------- */
  const BIOMES = {
    continental: { name: 'Continental', icon: ':bio_continental:', popMult: 1.3, palette: ['#2a6f97', '#52b788', '#f1faee'], resources: ['aleaciones', 'compuestos', 'energia'] },
    oceanico:    { name: 'Oceánico',    icon: ':bio_oceanico:', popMult: 0.9, palette: ['#1d3557', '#457b9d', '#a8dadc'], resources: ['helio3', 'compuestos'] },
    desertico:   { name: 'Desértico',   icon: ':bio_desertico:', popMult: 0.7, palette: ['#bc6c25', '#dda15e', '#fefae0'], resources: ['cristales', 'energia', 'aleaciones'] },
    helado:      { name: 'Helado',      icon: ':bio_helado:', popMult: 0.5, palette: ['#caf0f8', '#90e0ef', '#ffffff'], resources: ['helio3', 'exoticos'] },
    volcanico:   { name: 'Volcánico',   icon: ':bio_volcanico:', popMult: 0.4, palette: ['#370617', '#d00000', '#ffba08'], resources: ['aleaciones', 'exoticos', 'energia'] },
    selvatico:   { name: 'Selvático',   icon: ':bio_selvatico:', popMult: 1.1, palette: ['#1b4332', '#40916c', '#95d5b2'], resources: ['compuestos', 'cristales'] },
    gaseoso:     { name: 'Gigante gaseoso', icon: ':bio_gaseoso:', popMult: 0.2, palette: ['#7f5539', '#e6ccb2', '#b08968'], resources: ['helio3', 'energia'] },
    asteroides:  { name: 'Cinturón de asteroides', icon: ':bio_asteroides:', popMult: 0.06, palette: ['#3b3f45', '#7d848c', '#c9b79c'], resources: ['aleaciones', 'cristales', 'exoticos'], belt: true },
    ecumenopolis:{ name: 'Ecumenópolis',icon: ':bio_ecumenopolis:', popMult: 2.0, palette: ['#343a40', '#ffd60a', '#adb5bd'], resources: ['compuestos', 'aleaciones'] }
  };

  /* ---------------------------------------------------------------
   * EDIFICIOS (apartado TYCOON)
   * Como en el original: compras una estructura y produce cada ciclo.
   * cost: créditos + recursos | upkeep: créditos por ciclo
   * produces: recurso por ciclo (solo si el planeta tiene ese yacimiento
   *           cuando needsDeposit = true)
   * --------------------------------------------------------------- */
  const BUILDINGS = {
    extractor:  { name: 'Extractor',          icon: ':b_extractor:', cost: { credits: 4000 }, upkeep: 150, needsDeposit: true, produces: 40,
                  desc: 'Extrae el recurso del yacimiento del planeta. +40 por ciclo.' },
    planta:     { name: 'Planta de fusión',   icon: ':b_planta:', cost: { credits: 5000, helio3: 20 }, upkeep: 150, produceRes: 'energia', produces: 35,
                  desc: 'Produce +35 Energía por ciclo en cualquier planeta.' },
    fabrica:    { name: 'Complejo industrial',icon: ':b_fabrica:', cost: { credits: 6000, aleaciones: 30 }, upkeep: 200, jobs: 0.04, gdp: 0.10,
                  desc: '+10% PIB del planeta y reduce el desempleo.' },
    comercio:   { name: 'Puerto comercial',   icon: ':b_comercio:', cost: { credits: 7000, aleaciones: 20 }, upkeep: 250, jobs: 0.02, gdp: 0.15,
                  desc: '+15% PIB del planeta. Base del comercio interestelar.' },
    laboratorio:{ name: 'Laboratorio',        icon: ':b_laboratorio:', cost: { credits: 6000, compuestos: 25 }, upkeep: 300, research: 6,
                  desc: '+6 Puntos de Investigación (PI) por ciclo.' },
    astillero:  { name: 'Astillero orbital',  icon: ':b_astillero:', cost: { credits: 10000, aleaciones: 60 }, upkeep: 400, max: 1,
                  desc: 'Permite fabricar naves en este planeta.' },
    cuartel:    { name: 'Academia militar',   icon: ':b_cuartel:', cost: { credits: 5000, aleaciones: 20 }, upkeep: 200, max: 1,
                  desc: 'Permite entrenar tropas y vehículos terrestres.' },
    bateria:    { name: 'Batería orbital',    icon: ':b_bateria:', cost: { credits: 8000, aleaciones: 50, energia: 20 }, upkeep: 250, requiresTech: 'o_bateria',
                  defense: { kinetic: 30, hp: 400 }, desc: 'Defensa fija que dispara a flotas enemigas en órbita.' },
    escudo:     { name: 'Escudo planetario',  icon: ':b_escudo:', cost: { credits: 12000, exoticos: 30, energia: 40 }, upkeep: 400, requiresTech: 'o_escudo', max: 1,
                  defense: { shield: 60, hp: 600 }, desc: 'Escudo que protege al planeta y sus baterías.' },
    vivienda:   { name: 'Distrito residencial',icon: ':b_vivienda:', cost: { credits: 3500 }, upkeep: 100, popCap: 0.15,
                  desc: '+15% población máxima del planeta. Más gente = más PIB.' }
  };

  /* ---------------------------------------------------------------
   * ÁRBOL TECNOLÓGICO
   * cost: Puntos de Investigación (PI)  |  req: ids previos
   * unlocks: { hull | component | building | bonus }
   * branch: rama visual del árbol
   * Las tecnologías con cost 0 se conocen desde el inicio.
   * --------------------------------------------------------------- */
  /* ESPECIALIZACION (v3): las ramas con spec:true solo se pueden investigar si la nacion eligio esa
   * especialidad (RULES.specSlots = 2 ranuras). Lo demas hay que COMPRARLO a otra nacion ya fabricado
   * (ver "Mercado de unidades" en game.js). Las tecnologias con cost 0 las conoce todo el mundo. */
  const TECH_BRANCHES = {
    economia:   { name: 'Economía',        icon: ':t_economia:', desc: 'Abierta para todos: PIB, minería, investigación.' },
    energia:    { name: 'Energía',         icon: ':t_energia:', spec: true, desc: 'Láseres, pulsos, cañones de iones, plasma y escudos.' },
    balistica:  { name: 'Balística',       icon: ':t_balistica:', spec: true, desc: 'Cañones, cañón de riel, blindaje y defensa puntual.' },
    misiles:    { name: 'Misiles',         icon: ':t_misiles:', spec: true, desc: 'Misiles, torpedos y enjambres de misiles.' },
    sistemas:   { name: 'Sistemas',        icon: ':t_sistemas:', spec: true, desc: 'Sensores, guerra electrónica, radiadores, reactores e hiperimpulsor.' },
    naves:      { name: 'Naves de línea',  icon: ':t_naves:', spec: true, desc: 'Fragatas, destructores, cruceros, portanaves y acorazados.' },
    cazas:      { name: 'Cazas estelares', icon: ':t_cazas:', spec: true, desc: 'Bombarderos y enjambres de drones.' },
    terrestre:  { name: 'Fuerzas terrestres', icon: ':t_terrestre:', spec: true, desc: 'Blindados, tanques, exo-caminantes y artillería.' },
    orbital:    { name: 'Orbital',         icon: ':t_orbital:', spec: true, desc: 'Baterías y escudo planetario.' }
  };

  const TECHS = [
    // ECONOMIA (abierta)
    { id: 'e_mineria',   branch: 'economia', name: 'Minería automatizada', cost: 20, req: [], unlocks: { bonus: { extraction: 0.25 } }, desc: '+25% producción de extractores.' },
    { id: 'e_comercio',  branch: 'economia', name: 'Rutas comerciales', cost: 30, req: [], unlocks: { bonus: { gdp: 0.10 } }, desc: '+10% PIB nacional.' },
    { id: 'e_burocracia',branch: 'economia', name: 'Burocracia digital', cost: 40, req: ['e_comercio'], unlocks: { bonus: { evasion: -0.05 } }, desc: '-5% evasión fiscal.' },
    { id: 'e_ia',        branch: 'economia', name: 'Gobierno asistido por IA', cost: 80, req: ['e_burocracia'], unlocks: { bonus: { stability: 0.05, research: 0.15 } }, desc: '+5% estabilidad y +15% investigación.' },
    { id: 'e_mineria2',  branch: 'economia', name: 'Minería de asteroides', cost: 70, req: ['e_mineria'], unlocks: { bonus: { extraction: 0.35 } }, desc: '+35% producción de extractores.' },
    // ENERGIA
    { id: 'w_laser',     branch: 'energia', name: 'Láser', cost: 0, req: [], unlocks: { component: 'laser' }, desc: 'Arma de energía. Precisa a media distancia.' },
    { id: 'w_pulso',     branch: 'energia', name: 'Láser de pulsos', cost: 30, req: ['w_laser'], unlocks: { component: 'pulso' }, desc: 'Ráfagas rápidas que calientan poco la nave. Ideal para batallas largas.' },
    { id: 'w_ion',       branch: 'energia', name: 'Cañón de iones', cost: 45, req: ['w_laser'], unlocks: { component: 'ion' }, desc: 'Devora escudos y a veces bloquea las armas enemigas. Poco daño al casco.' },
    { id: 'd_escudo',    branch: 'energia', name: 'Escudos deflectores', cost: 30, req: ['w_laser'], unlocks: { component: 'escudo' }, desc: 'Absorben daño de energía.' },
    { id: 'w_plasma',    branch: 'energia', name: 'Cañón de plasma', cost: 70, req: ['w_pulso'], unlocks: { component: 'plasma' }, desc: 'Energía brutal a corta distancia. Calienta muchísimo.' },
    // BALISTICA
    { id: 'w_canon',     branch: 'balistica', name: 'Cañón automático', cost: 0, req: [], unlocks: { component: 'canon' }, desc: 'Arma cinética simple. Barata y casi no calienta.' },
    { id: 'd_blindaje',  branch: 'balistica', name: 'Blindaje', cost: 0, req: [], unlocks: { component: 'blindaje' }, desc: 'Placas que frenan daño cinético.' },
    { id: 'w_rail',      branch: 'balistica', name: 'Cañón de riel', cost: 30, req: ['w_canon'], unlocks: { component: 'railgun' }, desc: 'Proyectil cinético a velocidad extrema. Largo alcance.' },
    { id: 'd_pd',        branch: 'balistica', name: 'Defensa puntual', cost: 25, req: ['w_canon'], unlocks: { component: 'pd' }, desc: 'Intercepta misiles, torpedos y cazas.' },
    // MISILES
    { id: 'w_misil',     branch: 'misiles', name: 'Misiles', cost: 25, req: [], unlocks: { component: 'misil' }, desc: 'Explosivos guiados de largo alcance. Interceptables.' },
    { id: 'w_torpedo',   branch: 'misiles', name: 'Torpedos', cost: 45, req: ['w_misil'], unlocks: { component: 'torpedo' }, desc: 'Explosivo pesado, devastador contra naves grandes.' },
    { id: 'w_enjambre',  branch: 'misiles', name: 'Misiles en enjambre', cost: 55, req: ['w_misil'], unlocks: { component: 'enjambre' }, desc: 'Salvas de 5 misiles pequeños que saturan la defensa puntual.' },
    // SISTEMAS
    { id: 's_motor',     branch: 'sistemas', name: 'Motor iónico', cost: 0, req: [], unlocks: { component: 'motor' }, desc: 'Propulsión básica.' },
    { id: 's_sensores',  branch: 'sistemas', name: 'Sensores', cost: 15, req: [], unlocks: { component: 'sensor' }, desc: 'Mejoran la puntería de toda la flota.' },
    { id: 's_ecm',       branch: 'sistemas', name: 'Guerra electrónica', cost: 35, req: ['s_sensores'], unlocks: { component: 'ecm' }, desc: 'Reducen la puntería enemiga.' },
    { id: 's_radiador',  branch: 'sistemas', name: 'Radiadores', cost: 30, req: ['s_motor'], unlocks: { component: 'radiador' }, desc: 'Disipan el calor: la nave aguanta más tiempo disparando antes de sobrecalentarse.' },
    { id: 's_reactor',   branch: 'sistemas', name: 'Reactor de fusión compacto', cost: 40, req: ['s_motor'], unlocks: { bonus: { componentCap: 10 } }, desc: '+10 puntos máximos al diseñar componentes.' },
    { id: 's_hiper',     branch: 'sistemas', name: 'Hiperimpulsor mejorado', cost: 50, req: ['s_motor'], unlocks: { bonus: { fleetSpeed: 0.3 } }, desc: 'Flotas 30% más rápidas en hiperespacio.' },
    { id: 's_nanotec',   branch: 'sistemas', name: 'Nanotecnología', cost: 110, req: ['s_reactor'], unlocks: { bonus: { componentCap: 15 } }, desc: '+15 puntos máximos al diseñar componentes.' },
    // NAVES
    { id: 'n_corbeta',   branch: 'naves', name: 'Corbeta', cost: 0, req: [], unlocks: { hull: 'corbeta' }, desc: 'Nave de patrulla ligera.' },
    { id: 'n_transporte',branch: 'naves', name: 'Transporte de tropas', cost: 0, req: [], unlocks: { hull: 'transporte' }, desc: 'Lleva tropas para invadir planetas.' },
    { id: 'n_fragata',   branch: 'naves', name: 'Fragata', cost: 20, req: ['n_corbeta'], unlocks: { hull: 'fragata' }, desc: 'Escolta versátil. Ideal para defensa puntual.' },
    { id: 'n_destructor',branch: 'naves', name: 'Destructor', cost: 40, req: ['n_fragata'], unlocks: { hull: 'destructor' }, desc: 'Nave de ataque rápida y muy armada.' },
    { id: 'n_crucero',   branch: 'naves', name: 'Crucero', cost: 70, req: ['n_destructor'], unlocks: { hull: 'crucero' }, desc: 'Nave capital polivalente.' },
    { id: 'n_portanaves',branch: 'naves', name: 'Portanaves', cost: 90, req: ['n_crucero'], unlocks: { hull: 'portanaves' }, desc: 'Lanza escuadrones de cazas en combate.' },
    { id: 'n_acorazado', branch: 'naves', name: 'Acorazado', cost: 140, req: ['n_crucero'], unlocks: { hull: 'acorazado' }, desc: 'El rey de la línea de batalla. Lento y carísimo.' },
    // CAZAS
    { id: 'c_caza',      branch: 'cazas', name: 'Caza estelar', cost: 0, req: [], unlocks: { hull: 'caza' }, desc: 'Casco de caza monoplaza.' },
    { id: 'c_bombardero',branch: 'cazas', name: 'Bombardero estelar', cost: 25, req: ['c_caza'], unlocks: { hull: 'bombardero' }, desc: 'Caza pesado capaz de llevar torpedos.' },
    { id: 'c_dron',      branch: 'cazas', name: 'Enjambre de drones', cost: 45, req: ['c_caza'], unlocks: { hull: 'dron' }, desc: 'Drones baratos y desechables. Saturan defensas.' },
    // TERRESTRE
    { id: 't_infanteria',branch: 'terrestre', name: 'Infantería', cost: 0, req: [], unlocks: { hull: 'infanteria' }, desc: 'Escuadrón de soldados.' },
    { id: 'w_terrestre', branch: 'terrestre', name: 'Armas de infantería', cost: 0, req: [], unlocks: { component: 'rifle' }, desc: 'Rifles bláster para tropas.' },
    { id: 'd_armadura',  branch: 'terrestre', name: 'Armadura personal', cost: 0, req: [], unlocks: { component: 'armadura' }, desc: 'Protección para tropas.' },
    { id: 't_blindado',  branch: 'terrestre', name: 'Blindado repulsor', cost: 20, req: ['t_infanteria'], unlocks: { hull: 'blindado' }, desc: 'Vehículo flotante de apoyo.' },
    { id: 't_tanque',    branch: 'terrestre', name: 'Tanque pesado', cost: 45, req: ['t_blindado'], unlocks: { hull: 'tanque' }, desc: 'Rompe defensas planetarias.' },
    { id: 't_artilleria',branch: 'terrestre', name: 'Artillería de asedio', cost: 55, req: ['t_blindado'], unlocks: { hull: 'artilleria' }, desc: 'Pega fuerte a las defensas desde lejos y apaga los generadores de escudo planetario.' },
    { id: 't_mecha',     branch: 'terrestre', name: 'Exo-caminante', cost: 80, req: ['t_tanque'], unlocks: { hull: 'mecha' }, desc: 'Mecha de asalto. Muy caro, muy fuerte.' },
    // ORBITAL
    { id: 'o_bateria',   branch: 'orbital', name: 'Baterías orbitales', cost: 20, req: [], unlocks: { building: 'bateria' }, desc: 'Defensa planetaria fija.' },
    { id: 'o_escudo',    branch: 'orbital', name: 'Escudo planetario', cost: 60, req: ['o_bateria'], unlocks: { building: 'escudo' }, desc: 'Gran escudo que cubre el planeta. Hay que apagar su generador con tropas.' }
  ];

  // Con ciclos de 1 hora el árbol debe durar días: multiplicamos el coste en PI (ver docs/BALANCE.md)
  const TECH_COST_K = 3;
  TECHS.forEach(t => { if (t.cost > 0) t.cost = Math.round(t.cost * TECH_COST_K); });

  /* ---------------------------------------------------------------
   * CASCOS (TIPOS DE PROYECTO)
   * Equivalen a "Tipos de proyecto" de la hoja Proyectos original.
   * domain: 'space' (naves) | 'ground' (tropas/vehículos)
   * role:   'fighter' (evasivo, cazas) | 'line' | 'transport' | 'carrier' | 'ground'
   * slots: cuántos componentes de cada tipo admite
   * minSlots: componentes mínimos requeridos
   * base: stats de casco | cost: precio unitario base | devCost: coste de
   * desarrollar el proyecto | devMinutes: tiempo de desarrollo
   * build: segundos de fabricación por unidad (se escala con cantidad)
   * --------------------------------------------------------------- */
  const HULLS = {
    caza:       { name: 'Caza estelar', icon: ':h_caza:', domain: 'space', role: 'fighter', size: 1, slots: { arma: 1, defensa: 1, motor: 1, sistema: 0 }, minSlots: { arma: 1, motor: 1 },
                  base: { hp: 30, speed: 10 }, cost: { credits: 600, aleaciones: 2 }, upkeep: 15, devCost: 4000, devMinutes: 3, build: 20 },
    bombardero: { name: 'Bombardero', icon: ':h_bombardero:', domain: 'space', role: 'fighter', size: 2, slots: { arma: 2, defensa: 1, motor: 1, sistema: 0 }, minSlots: { arma: 1, motor: 1 },
                  base: { hp: 55, speed: 8 }, cost: { credits: 1100, aleaciones: 4 }, upkeep: 25, devCost: 7000, devMinutes: 5, build: 30 },
    dron:       { name: 'Dron de enjambre', icon: ':h_dron:', domain: 'space', role: 'fighter', size: 0.5, slots: { arma: 1, defensa: 0, motor: 1, sistema: 0 }, minSlots: { arma: 1, motor: 1 },
                  base: { hp: 12, speed: 12 }, cost: { credits: 200, compuestos: 1 }, upkeep: 4, devCost: 5000, devMinutes: 4, build: 6 },
    corbeta:    { name: 'Corbeta', icon: ':h_corbeta:', domain: 'space', role: 'line', size: 4, slots: { arma: 2, defensa: 1, motor: 1, sistema: 1 }, minSlots: { arma: 1, motor: 1 },
                  base: { hp: 160, speed: 7 }, cost: { credits: 2500, aleaciones: 10 }, upkeep: 60, devCost: 6000, devMinutes: 4, build: 45 },
    transporte: { name: 'Transporte de tropas', icon: ':h_transporte:', domain: 'space', role: 'transport', size: 5, slots: { arma: 0, defensa: 2, motor: 1, sistema: 0 }, minSlots: { motor: 1 },
                  base: { hp: 200, speed: 6, capacity: 10 }, cost: { credits: 2200, aleaciones: 12 }, upkeep: 50, devCost: 5000, devMinutes: 3, build: 45 },
    fragata:    { name: 'Fragata', icon: ':h_fragata:', domain: 'space', role: 'line', size: 8, slots: { arma: 3, defensa: 2, motor: 1, sistema: 1 }, minSlots: { arma: 1, motor: 1 },
                  base: { hp: 380, speed: 6 }, cost: { credits: 5000, aleaciones: 25 }, upkeep: 120, devCost: 12000, devMinutes: 8, build: 80 },
    destructor: { name: 'Destructor', icon: ':h_destructor:', domain: 'space', role: 'line', size: 14, slots: { arma: 4, defensa: 2, motor: 2, sistema: 1 }, minSlots: { arma: 2, motor: 1 },
                  base: { hp: 700, speed: 6 }, cost: { credits: 9000, aleaciones: 45, helio3: 10 }, upkeep: 220, devCost: 20000, devMinutes: 12, build: 120 },
    crucero:    { name: 'Crucero', icon: ':h_crucero:', domain: 'space', role: 'line', size: 25, slots: { arma: 5, defensa: 3, motor: 2, sistema: 2 }, minSlots: { arma: 2, motor: 1 },
                  base: { hp: 1400, speed: 5 }, cost: { credits: 16000, aleaciones: 80, helio3: 20 }, upkeep: 400, devCost: 35000, devMinutes: 18, build: 180 },
    portanaves: { name: 'Portanaves', icon: ':h_portanaves:', domain: 'space', role: 'carrier', size: 35, slots: { arma: 2, defensa: 3, motor: 2, sistema: 2 }, minSlots: { motor: 1 },
                  base: { hp: 1800, speed: 4, hangar: 12 }, cost: { credits: 22000, aleaciones: 110, helio3: 25 }, upkeep: 550, devCost: 45000, devMinutes: 22, build: 220 },
    acorazado:  { name: 'Acorazado', icon: ':h_acorazado:', domain: 'space', role: 'line', size: 50, slots: { arma: 8, defensa: 4, motor: 2, sistema: 2 }, minSlots: { arma: 3, motor: 2 },
                  base: { hp: 3200, speed: 3 }, cost: { credits: 40000, aleaciones: 200, helio3: 40, exoticos: 10 }, upkeep: 900, devCost: 70000, devMinutes: 30, build: 320 },
    /* --- Criaturas (solo NPC, ver server/npcs.js). npcOnly: nunca aparecen en el diseñador --- */
    leviatan:   { name: 'Leviatán de roca', icon: ':h_leviatan:', npcOnly: true, domain: 'space', role: 'monster', size: 70, slots: { arma: 4, defensa: 2, motor: 1, sistema: 0 }, minSlots: {},
                  base: { hp: 10000, speed: 2.5 }, special: ['regen'], cost: { credits: 30000 }, upkeep: 0, devCost: 0, devMinutes: 0, build: 0,
                  bounty: { credits: 36000, resources: { exoticos: 40, cristales: 60 }, research: 60 } },
    plaga:      { name: 'Dron centinela', icon: ':h_plaga:', npcOnly: true, domain: 'space', role: 'fighter', size: 0.6, slots: { arma: 1, defensa: 0, motor: 1, sistema: 0 }, minSlots: {},
                  base: { hp: 16, speed: 9 }, special: [], cost: { credits: 400 }, upkeep: 0, devCost: 0, devMinutes: 0, build: 0, bounty: { credits: 260, resources: {}, research: 0 } },
    medusa:     { name: 'Medusa de plasma', icon: ':h_medusa:', npcOnly: true, domain: 'space', role: 'monster', size: 22, slots: { arma: 3, defensa: 1, motor: 1, sistema: 0 }, minSlots: {},
                  base: { hp: 7000, speed: 4 }, special: ['emp'], cost: { credits: 14000 }, upkeep: 0, devCost: 0, devMinutes: 0, build: 0,
                  bounty: { credits: 16000, resources: { energia: 120, helio3: 80 }, research: 30 } },
    devorador:  { name: 'Devorador estelar', icon: ':h_devorador:', npcOnly: true, domain: 'space', role: 'monster', size: 95, slots: { arma: 6, defensa: 2, motor: 1, sistema: 0 }, minSlots: {},
                  base: { hp: 48000, speed: 2 }, special: ['regen', 'emp'], cost: { credits: 90000 }, upkeep: 0, devCost: 0, devMinutes: 0, build: 0,
                  bounty: { credits: 120000, resources: { exoticos: 150, cristales: 150, compuestos: 100 }, research: 250 } },
    infanteria: { name: 'Escuadrón de infantería', icon: ':h_infanteria:', domain: 'ground', role: 'ground', size: 1, slots: { arma: 1, defensa: 1, motor: 0, sistema: 0 }, minSlots: { arma: 1 },
                  base: { hp: 40, speed: 0 }, cost: { credits: 300 }, upkeep: 8, devCost: 2000, devMinutes: 2, build: 10 },
    blindado:   { name: 'Blindado repulsor', icon: ':h_blindado:', domain: 'ground', role: 'ground', size: 2, slots: { arma: 2, defensa: 1, motor: 1, sistema: 0 }, minSlots: { arma: 1, motor: 1 },
                  base: { hp: 120, speed: 0 }, cost: { credits: 1200, aleaciones: 5 }, upkeep: 25, devCost: 6000, devMinutes: 4, build: 25 },
    tanque:     { name: 'Tanque pesado', icon: ':h_tanque:', domain: 'ground', role: 'ground', size: 3, slots: { arma: 2, defensa: 2, motor: 1, sistema: 1 }, minSlots: { arma: 1, motor: 1 },
                  base: { hp: 260, speed: 0 }, cost: { credits: 2500, aleaciones: 12 }, upkeep: 45, devCost: 10000, devMinutes: 6, build: 40 },
    artilleria: { name: 'Artillería de asedio', icon: ':h_artilleria:', domain: 'ground', role: 'ground', size: 3, siege: true, slots: { arma: 2, defensa: 1, motor: 1, sistema: 0 }, minSlots: { arma: 1, motor: 1 },
                  base: { hp: 180, speed: 0 }, cost: { credits: 2800, aleaciones: 14 }, upkeep: 50, devCost: 9000, devMinutes: 6, build: 45 },
    mecha:      { name: 'Exo-caminante', icon: ':h_mecha:', domain: 'ground', role: 'ground', size: 5, slots: { arma: 3, defensa: 2, motor: 1, sistema: 1 }, minSlots: { arma: 2, motor: 1 },
                  base: { hp: 520, speed: 0 }, cost: { credits: 5500, aleaciones: 25, exoticos: 3 }, upkeep: 90, devCost: 18000, devMinutes: 10, build: 70 }
  };

  // Tiempos pensados para ciclos de 1 hora (una partida dura semanas). Ver docs/BALANCE.md
  const BUILD_TIME_K = 14, DEV_TIME_K = 10;
  Object.keys(HULLS).forEach(k => { const h = HULLS[k]; h.build = Math.round(h.build * BUILD_TIME_K); h.devMinutes = Math.round(h.devMinutes * DEV_TIME_K); });

  /* ---------------------------------------------------------------
   * TIPOS DE COMPONENTE
   * El jugador DISEÑA componentes repartiendo puntos entre:
   *   potencia   -> stat principal (daño, blindaje, escudo...)
   *   fiabilidad -> probabilidad de funcionar en cada ronda
   *   eficiencia -> abarata la unidad y el mantenimiento
   * Los puntos máximos dependen de la tecnología (COMPONENT_BASE_CAP + bonus).
   *
   * dmgType: 'energia' (lo frena el escudo) | 'cinetico' (lo frena el blindaje)
   *          | 'explosivo' (lo intercepta la defensa puntual)
   * range: eficiencia por fase de combate [largo, medio, corto]
   * --------------------------------------------------------------- */
  const COMPONENT_BASE_CAP = 30;
  const COMPONENT_TYPES = {
    laser:    { name: 'Láser',            icon: ':c_laser:', slot: 'arma', dmgType: 'energia',   range: [0.5, 1.0, 1.0], perPoint: 1.0, cost: { credits: 40, cristales: 0.4 } },
    canon:    { name: 'Cañón automático', icon: ':c_canon:', slot: 'arma', dmgType: 'cinetico',  range: [0.3, 0.8, 1.2], perPoint: 1.0, cost: { credits: 25, aleaciones: 0.3 } },
    railgun:  { name: 'Cañón de riel',    icon: ':c_railgun:', slot: 'arma', dmgType: 'cinetico',  range: [1.1, 1.0, 0.6], perPoint: 1.1, cost: { credits: 60, aleaciones: 0.5, energia: 0.3 } },
    misil:    { name: 'Lanzamisiles',     icon: ':c_misil:', slot: 'arma', dmgType: 'explosivo', range: [1.2, 0.8, 0.3], perPoint: 1.3, cost: { credits: 55, compuestos: 0.5 } },
    torpedo:  { name: 'Tubo de torpedos', icon: ':c_torpedo:', slot: 'arma', dmgType: 'explosivo', range: [0.4, 1.0, 1.1], perPoint: 1.8, cost: { credits: 80, compuestos: 0.6, helio3: 0.3 }, antiCapital: 1.5 },
    plasma:   { name: 'Cañón de plasma',  icon: ':c_plasma:', slot: 'arma', dmgType: 'energia',   range: [0.1, 0.7, 1.5], perPoint: 1.5, cost: { credits: 90, exoticos: 0.3, energia: 0.5 } },
    pulso:    { name: 'Láser de pulsos', icon: ':c_pulso:', slot: 'arma', dmgType: 'energia',   range: [0.5, 1.0, 0.9], perPoint: 0.95, cost: { credits: 55, cristales: 0.5 } },
    ion:      { name: 'Cañón de iones',   icon: ':c_ion:', slot: 'arma', dmgType: 'energia',   range: [0.6, 1.0, 0.8], perPoint: 1.0, cost: { credits: 65, cristales: 0.3, energia: 0.4 } },
    enjambre: { name: 'Misiles en enjambre', icon: ':c_enjambre:', slot: 'arma', dmgType: 'explosivo', range: [1.1, 0.9, 0.4], perPoint: 1.2, cost: { credits: 70, compuestos: 0.7 } },
    maw:      { name: 'Mandíbulas', icon: ':c_maw:', npcOnly: true, slot: 'arma', dmgType: 'cinetico', range: [0.1, 0.8, 1.4], perPoint: 1.0, cost: { credits: 1 } },
    spit:     { name: 'Escupe-plasma', icon: ':c_plasma:', npcOnly: true, slot: 'arma', dmgType: 'energia', range: [0.8, 1.0, 0.8], perPoint: 1.0, cost: { credits: 1 } },
    rifle:    { name: 'Rifle bláster',    icon: ':c_rifle:', slot: 'arma', dmgType: 'ground',    range: [1, 1, 1], perPoint: 1.0, cost: { credits: 8 }, groundOnly: true },
    blindaje: { name: 'Blindaje',         icon: ':c_blindaje:', slot: 'defensa', stat: 'armor',  perPoint: 1.0, cost: { credits: 20, aleaciones: 0.5 } },
    escudo:   { name: 'Escudo deflector', icon: ':c_escudo:', slot: 'defensa', stat: 'shield', perPoint: 1.0, cost: { credits: 45, exoticos: 0.1, energia: 0.3 } },
    pd:       { name: 'Defensa puntual',  icon: ':c_pd:', slot: 'defensa', stat: 'pd',     perPoint: 1.0, cost: { credits: 35, compuestos: 0.3 } },
    armadura: { name: 'Armadura personal',icon: ':c_armadura:', slot: 'defensa', stat: 'armor',  perPoint: 1.0, cost: { credits: 6 }, groundOnly: true },
    motor:    { name: 'Motor',            icon: ':c_motor:', slot: 'motor',   stat: 'speed',  perPoint: 0.15, cost: { credits: 25, helio3: 0.3 } },
    sensor:   { name: 'Sensores',         icon: ':c_sensor:', slot: 'sistema', stat: 'sensors',perPoint: 1.0, cost: { credits: 40, compuestos: 0.3 } },
    radiador: { name: 'Radiadores',        icon: ':c_radiador:', slot: 'sistema', stat: 'cooling', perPoint: 1.0, cost: { credits: 35, aleaciones: 0.4 } },
    ecm:      { name: 'Guerra electrónica',icon: ':c_ecm:', slot: 'sistema', stat: 'ecm',   perPoint: 1.0, cost: { credits: 45, compuestos: 0.4 } }
  };

  /* ---------------------------------------------------------------
   * REGLAS GENERALES (tiempos, economía, combate)
   * --------------------------------------------------------------- */
  const RULES = {
    startCredits: 60000,
    startResearch: 20,
    startResources: { energia: 80, aleaciones: 150, helio3: 60, cristales: 30, exoticos: 10, compuestos: 50 },
    startPopulation: 8,          // millones en el planeta capital
    gdpPerMillion: 2500,         // créditos de PIB por millón de habitantes por ciclo (antes de impuestos)
    maxTax: 0.6,
    jumpSeconds: 540,            // segundos por salto hiperespacial con velocidad 5 (cruzar el mapa ≈ 1 h)
    cycleSeconds: 3600,          // un ciclo económico = 1 hora
    seasonDays: 18,              // duración OBJETIVO de una temporada (el balance busca 14-21 días)
    seasonMaxDays: 28,           // tope duro: si nadie ganó, gana quien tenga más puntos de dominio (0 = sin tope)
    protectionHours: 48,         // protección de novatos: nadie puede declararte guerra
    maxNations: 20,              // tope de naciones (humanos + IA de relleno)
    battleMaxSeconds: 1800,      // una batalla termina sí o sí a los 30 minutos (las grandes llegan casi hasta ahí)
    specSlots: 2,                // ranuras de especialización: solo puedes investigar a fondo 2 ramas (ver TECH_BRANCHES)
    deliveryJumpFactor: 1,       // las compras de unidades llegan tras el tiempo de viaje entre sistemas x este factor
    govCollapseHours: 6,         // si cae la capital, durante estas horas las colonias pueden rebelarse...
    govCollapseChance: 0.22,     // ...con esta probabilidad por ciclo y planeta (se detiene nombrando nueva capital)
    annexCostPerMillion: 2500,   // coste de anexión pacífica de un planeta independiente
    annexGrowth: 0.25,           // cada planeta que ya tienes encarece la anexión un 25 % (frena la bola de nieve)
    warDeclareCooldown: 0,       // (futuro) espera antes de que una guerra sea efectiva
    betrayalStabilityHit: 0.15,  // castigo por traicionar a un aliado
    chatMaxLength: 300,
    chatHistory: 120
  };

  /* ---------------------------------------------------------------
   * ESCALA x10 (v3, "por estetica"): todas las cantidades del juego (creditos, recursos, puntos de
   * investigacion, poblacion, puntos de casco, dano, blindaje, escudo...) se multiplican por NUM_K al
   * cargar. Las tablas de arriba siguen escritas en valores base (mas faciles de razonar); el balance
   * NO cambia porque todo escala a la vez. Lo que NO se escala: tiempos, velocidades, cantidades de
   * unidades, porcentajes y puntos de diseno (potencia/fiabilidad/eficiencia).
   * Si cambias NUM_K, cambia tambien NUM_K en shared/battlesim.js (test: battle.test.js lo comprueba).
   * --------------------------------------------------------------- */
  const NUM_K = 10;
  const mulCost = c => { for (const k in c) c[k] *= NUM_K; };
  for (const b of Object.values(BUILDINGS)) {
    mulCost(b.cost); b.upkeep *= NUM_K;
    if (b.produces) b.produces *= NUM_K;
    if (b.research) b.research *= NUM_K;
    if (b.defense) for (const k in b.defense) b.defense[k] *= NUM_K;
  }
  TECHS.forEach(t => { t.cost *= NUM_K; });
  for (const h of Object.values(HULLS)) {
    mulCost(h.cost); h.upkeep *= NUM_K; h.devCost *= NUM_K; h.base.hp *= NUM_K;
    if (h.bounty) { h.bounty.credits *= NUM_K; h.bounty.research *= NUM_K; for (const r in h.bounty.resources) h.bounty.resources[r] *= NUM_K; }
  }
  for (const t of Object.values(COMPONENT_TYPES)) { mulCost(t.cost); if (t.slot === 'arma' || (t.stat && t.stat !== 'speed')) t.perPoint *= NUM_K; }
  RULES.startCredits *= NUM_K; RULES.startResearch *= NUM_K; RULES.startPopulation *= NUM_K;
  for (const r in RULES.startResources) RULES.startResources[r] *= NUM_K;

  /* ---------------------------------------------------------------
   * DISEÑOS BASE (del "Consorcio Galáctico")
   * Pocos y mediocres a propósito: el atractivo es que los jugadores
   * diseñen y vendan los suyos (igual que en Global Domination).
   * --------------------------------------------------------------- */
  const BASE_COMPONENTS = [
    { id: 'bc_laser',   type: 'laser',    name: 'Láser L-1 Consorcio',      points: { potencia: 10, fiabilidad: 10, eficiencia: 5 } },
    { id: 'bc_canon',   type: 'canon',    name: 'Cañón C-1 Consorcio',      points: { potencia: 10, fiabilidad: 10, eficiencia: 5 } },
    { id: 'bc_blind',   type: 'blindaje', name: 'Placas B-1 Consorcio',     points: { potencia: 10, fiabilidad: 10, eficiencia: 5 } },
    { id: 'bc_motor',   type: 'motor',    name: 'Motor iónico M-1',         points: { potencia: 10, fiabilidad: 10, eficiencia: 5 } },
    { id: 'bc_rifle',   type: 'rifle',    name: 'Rifle R-1 Consorcio',      points: { potencia: 10, fiabilidad: 10, eficiencia: 5 } },
    { id: 'bc_armad',   type: 'armadura', name: 'Armadura A-1 Consorcio',   points: { potencia: 10, fiabilidad: 10, eficiencia: 5 } },
    /* --- Componentes de NPC (piratas y criaturas). hidden: no se listan para los jugadores --- */
    { id: 'pc_canon',  type: 'canon',    name: 'Cañón de chatarra',  points: { potencia: 14, fiabilidad: 12, eficiencia: 0 }, hidden: true },
    { id: 'pc_laser',  type: 'laser',    name: 'Láser robado',       points: { potencia: 14, fiabilidad: 12, eficiencia: 0 }, hidden: true },
    { id: 'pc_misil',  type: 'misil',    name: 'Misil pirata',       points: { potencia: 14, fiabilidad: 10, eficiencia: 0 }, hidden: true },
    { id: 'pc_blind',  type: 'blindaje', name: 'Placas soldadas',    points: { potencia: 14, fiabilidad: 12, eficiencia: 0 }, hidden: true },
    { id: 'pc_escudo', type: 'escudo',   name: 'Escudo saqueado',    points: { potencia: 14, fiabilidad: 12, eficiencia: 0 }, hidden: true },
    { id: 'pc_pd',     type: 'pd',       name: 'Defensa improvisada',points: { potencia: 12, fiabilidad: 12, eficiencia: 0 }, hidden: true },
    { id: 'pc_motor',  type: 'motor',    name: 'Motor trucado',      points: { potencia: 14, fiabilidad: 12, eficiencia: 0 }, hidden: true },
    { id: 'pe_rail',   type: 'railgun',  name: 'Riel de élite',      points: { potencia: 22, fiabilidad: 14, eficiencia: 0 }, hidden: true },
    { id: 'pe_laser',  type: 'laser',    name: 'Láser de élite',     points: { potencia: 22, fiabilidad: 14, eficiencia: 0 }, hidden: true },
    { id: 'pe_plasma', type: 'plasma',   name: 'Plasma de élite',    points: { potencia: 22, fiabilidad: 14, eficiencia: 0 }, hidden: true },
    { id: 'pe_torp',   type: 'torpedo',  name: 'Torpedo de élite',   points: { potencia: 22, fiabilidad: 14, eficiencia: 0 }, hidden: true },
    { id: 'mc_maw',    type: 'maw',      name: 'Mandíbulas',         points: { potencia: 9,  fiabilidad: 40, eficiencia: 0 }, hidden: true },
    { id: 'mc_spit',   type: 'spit',     name: 'Escupe-plasma',      points: { potencia: 7,  fiabilidad: 30, eficiencia: 0 }, hidden: true },
    { id: 'mc_hide',   type: 'blindaje', name: 'Coraza viva',        points: { potencia: 16, fiabilidad: 30, eficiencia: 0 }, hidden: true },
    { id: 'mc_field',  type: 'escudo',   name: 'Campo de plasma',    points: { potencia: 16, fiabilidad: 30, eficiencia: 0 }, hidden: true },
    { id: 'mc_zap',    type: 'laser',    name: 'Descarga',           points: { potencia: 9,  fiabilidad: 30, eficiencia: 0 }, hidden: true },
    { id: 'mc_motor',  type: 'motor',    name: 'Propulsión orgánica',points: { potencia: 10, fiabilidad: 30, eficiencia: 0 }, hidden: true }
  ];
  const BASE_DESIGNS = [
    { id: 'bd_caza',  hull: 'caza',       name: 'Caza "Avispa"',       components: ['bc_laser', 'bc_blind', 'bc_motor'] },
    { id: 'bd_corb',  hull: 'corbeta',    name: 'Corbeta "Centinela"', components: ['bc_canon', 'bc_laser', 'bc_blind', 'bc_motor'] },
    { id: 'bd_trans', hull: 'transporte', name: 'Transporte "Mula"',   components: ['bc_blind', 'bc_motor'] },
    { id: 'bd_inf',   hull: 'infanteria', name: 'Milicia estándar',    components: ['bc_rifle', 'bc_armad'] },
    /* --- Diseños de NPC (public:false -> el jugador solo los ve en flotas visibles) --- */
    { id: 'pd_raider',   hull: 'caza',       name: 'Saqueador',            components: ['pc_canon', 'pc_motor'], npc: true },
    { id: 'pd_hunter',   hull: 'caza',       name: 'Cazador pirata',       components: ['pc_laser', 'pc_blind', 'pc_motor'], npc: true },
    { id: 'pd_corsair',  hull: 'corbeta',    name: 'Corsario',             components: ['pc_canon', 'pc_laser', 'pc_blind', 'pc_motor'], npc: true },
    { id: 'pd_missile',  hull: 'corbeta',    name: 'Lanzamisiles pirata',  components: ['pc_misil', 'pc_misil', 'pc_pd', 'pc_motor'], npc: true },
    { id: 'pd_frigate',  hull: 'fragata',    name: 'Fragata corsaria',     components: ['pc_canon', 'pc_laser', 'pc_laser', 'pc_blind', 'pc_escudo', 'pc_motor'], npc: true },
    { id: 'pd_destroyer',hull: 'destructor', name: 'Destructor renegado',  components: ['pe_rail', 'pe_rail', 'pe_laser', 'pe_laser', 'pc_blind', 'pc_escudo', 'pc_motor', 'pc_motor'], npc: true },
    { id: 'pd_dread',    hull: 'acorazado',  name: 'Acorazado del Señor Pirata', components: ['pe_rail', 'pe_rail', 'pe_rail', 'pe_plasma', 'pe_plasma', 'pe_torp', 'pe_laser', 'pe_laser', 'pc_blind', 'pc_blind', 'pc_escudo', 'pc_pd', 'pc_motor', 'pc_motor'], npc: true },
    { id: 'md_leviatan', hull: 'leviatan',   name: 'Leviatán de roca',     components: ['mc_maw', 'mc_maw', 'mc_spit', 'mc_spit', 'mc_hide', 'mc_motor'], npc: true },
    { id: 'md_plaga',    hull: 'plaga',      name: 'Dron centinela',       components: ['mc_zap', 'mc_motor'], npc: true },
    { id: 'md_medusa',   hull: 'medusa',     name: 'Medusa de plasma',     components: ['mc_zap', 'mc_zap', 'mc_spit', 'mc_field', 'mc_motor'], npc: true },
    { id: 'md_devorador',hull: 'devorador',  name: 'Devorador estelar',    components: ['mc_maw', 'mc_maw', 'mc_maw', 'mc_spit', 'mc_spit', 'mc_spit', 'mc_hide', 'mc_field', 'mc_motor'], npc: true }
  ];

  /* ---------------------------------------------------------------
   * FÓRMULAS COMPARTIDAS
   * --------------------------------------------------------------- */

  /** Suma objetos de coste {credits, recurso...} */
  function addCost(a, b, mult) {
    const out = Object.assign({}, a);
    for (const k in b) out[k] = (out[k] || 0) + b[k] * (mult == null ? 1 : mult);
    return out;
  }
  function roundCost(c) {
    const o = {};
    for (const k in c) { const v = k === 'credits' ? Math.round(c[k]) : Math.ceil(c[k] * 10) / 10; if (v > 0) o[k] = v; }
    return o;
  }

  /** Stats y coste de un componente diseñado */
  function componentStats(comp) {
    const t = COMPONENT_TYPES[comp.type];
    const p = comp.points || {};
    const pot = p.potencia || 0, fia = p.fiabilidad || 0, efi = p.eficiencia || 0;
    const reliability = Math.min(0.98, 0.6 + fia * 0.012);       // 60% .. 98%
    const costMult = Math.max(0.4, 1 + pot / 10 - efi * 0.02);   // eficiencia abarata
    const value = pot * t.perPoint;
    return {
      type: comp.type, slot: t.slot, dmgType: t.dmgType || null, stat: t.stat || null,
      value: value, reliability: reliability,
      unitCost: roundCost(addCost({}, t.cost, costMult)),
      upkeep: Math.max(1, Math.round(t.cost.credits * costMult * 0.03))
    };
  }

  /** Coste de desarrollo de un componente (proyecto) */
  function componentDevCost(comp) {
    const p = comp.points || {};
    const total = (p.potencia || 0) + (p.fiabilidad || 0) + (p.eficiencia || 0);
    return { credits: (1500 + total * total * 6) * NUM_K, minutes: Math.max(1, Math.round(total / 8)) * 6 };
  }

  /**
   * Calcula stats completos de un diseño de nave/tropa.
   * compLookup(id) -> objeto componente diseñado
   */
  function designStats(design, compLookup) {
    const h = HULLS[design.hull];
    const s = {
      hull: design.hull, domain: h.domain, role: h.role, size: h.size,
      hp: h.base.hp, speed: h.base.speed, capacity: h.base.capacity || 0, hangar: h.base.hangar || 0, special: h.special || [],
      armor: 0, shield: 0, pd: 0, sensors: 0, ecm: 0, cooling: 0,
      weapons: [], groundAttack: 0, groundDefense: 0, reliability: 1,
      unitCost: Object.assign({}, h.cost), upkeep: h.upkeep
    };
    let relSum = 0, relN = 0;
    for (const cid of design.components || []) {
      const c = compLookup(cid);
      if (!c) continue;
      const cs = componentStats(c);
      const t = COMPONENT_TYPES[c.type];
      s.unitCost = addCost(s.unitCost, cs.unitCost, Math.max(1, h.size * 0.5));
      s.upkeep += cs.upkeep;
      relSum += cs.reliability; relN++;
      if (t.slot === 'arma') {
        if (h.domain === 'ground') s.groundAttack += cs.value * (1 + h.size * 0.4);
        else s.weapons.push({ type: c.type, dmgType: t.dmgType, range: t.range, dmg: cs.value * Math.max(1, h.size * 0.6), rel: cs.reliability, antiCapital: t.antiCapital || 1 });
      } else if (t.stat === 'speed') {
        s.speed += cs.value;
      } else if (t.stat) {
        const scaled = cs.value * (t.stat === 'sensors' || t.stat === 'ecm' || t.stat === 'cooling' ? 1 : Math.max(1, h.size * 0.5));
        s[t.stat] += scaled;
        if (h.domain === 'ground' && t.stat === 'armor') s.groundDefense += cs.value * (1 + h.size * 0.4);
      }
    }
    if (h.domain === 'ground') { s.groundDefense += h.base.hp / 10; s.groundAttack = Math.round(s.groundAttack); s.groundDefense = Math.round(s.groundDefense); }
    s.reliability = relN ? relSum / relN : 1;
    s.unitCost = roundCost(s.unitCost);
    s.upkeep = Math.round(s.upkeep);
    s.power = powerRating(s);
    return s;
  }

  /** Valor de combate aproximado (para mostrar "Poder" en la UI) */
  function powerRating(s) {
    if (s.domain === 'ground') return Math.round(s.groundAttack + s.groundDefense);
    const atk = s.weapons.reduce((a, w) => a + w.dmg * w.rel, 0);
    const def = s.hp / 10 + s.armor + s.shield + s.pd;
    return Math.round(atk * 2 + def);
  }

  /** Validación de un diseño (devuelve string de error o null) */
  function validateDesign(design, compLookup) {
    const h = HULLS[design.hull];
    if (!h) return 'Casco inválido';
    const count = { arma: 0, defensa: 0, motor: 0, sistema: 0 };
    for (const cid of design.components || []) {
      const c = compLookup(cid);
      if (!c) return 'Componente desconocido';
      const t = COMPONENT_TYPES[c.type];
      if (t.groundOnly && h.domain !== 'ground') return t.name + ' solo sirve para tropas';
      if (h.domain === 'ground' && !t.groundOnly && t.slot !== 'motor' && t.slot !== 'sistema' && t.slot !== 'defensa') {
        // Los vehículos terrestres pueden montar armas espaciales "ligeras" como apoyo
        if (h.hull === 'infanteria') return 'La infantería solo usa armas personales';
      }
      count[t.slot]++;
    }
    for (const k in count) if (count[k] > (h.slots[k] || 0)) return 'Demasiados componentes de tipo ' + k;
    for (const k in (h.minSlots || {})) if (count[k] < h.minSlots[k]) return 'Faltan componentes de tipo ' + k + ' (mínimo ' + h.minSlots[k] + ')';
    return null;
  }

  /** Coste de desarrollo de un diseño de casco */
  function designDevCost(design) {
    const h = HULLS[design.hull];
    return { credits: h.devCost, minutes: h.devMinutes };
  }

  /** Coste de anexar un planeta independiente dado cuántos planetas ya tiene la nación */
  function annexCost(planet, owned) { return Math.round((5000 * NUM_K + planet.pop * RULES.annexCostPerMillion) * (1 + RULES.annexGrowth * Math.max(0, (owned || 1) - 1))); }

  /** Bandera: genera SVG a partir de config {layout, colors[3], emblem} */
  const FLAG_LAYOUTS = ['horizontal', 'vertical', 'cruz', 'diagonal', 'triangulo', 'centro', 'franja'];
  const FLAG_EMBLEMS = ['ninguno', 'estrella', 'circulo', 'anillo', 'planeta', 'luna', 'rombo', 'triangulo'];
  function flagSVG(flag, w, h) {
    w = w || 60; h = h || 40;
    const c = (flag && flag.colors) || ['#1d3557', '#e63946', '#f1faee'];
    const L = (flag && flag.layout) || 'horizontal';
    const E = (flag && flag.emblem) || 'ninguno';
    let b = '';
    if (L === 'horizontal') b = `<rect width="60" height="40" fill="${c[0]}"/><rect y="13.3" width="60" height="13.4" fill="${c[1]}"/><rect y="26.7" width="60" height="13.3" fill="${c[2]}"/>`;
    else if (L === 'vertical') b = `<rect width="60" height="40" fill="${c[0]}"/><rect x="20" width="20" height="40" fill="${c[1]}"/><rect x="40" width="20" height="40" fill="${c[2]}"/>`;
    else if (L === 'cruz') b = `<rect width="60" height="40" fill="${c[0]}"/><rect x="22" width="10" height="40" fill="${c[1]}"/><rect y="15" width="60" height="10" fill="${c[1]}"/><rect x="24" width="6" height="40" fill="${c[2]}"/><rect y="17" width="60" height="6" fill="${c[2]}"/>`;
    else if (L === 'diagonal') b = `<rect width="60" height="40" fill="${c[0]}"/><polygon points="60,0 60,40 0,40" fill="${c[1]}"/><polygon points="48,0 60,0 12,40 0,40" fill="${c[2]}"/>`;
    else if (L === 'triangulo') b = `<rect width="60" height="20" fill="${c[0]}"/><rect y="20" width="60" height="20" fill="${c[1]}"/><polygon points="0,0 26,20 0,40" fill="${c[2]}"/>`;
    else if (L === 'centro') b = `<rect width="60" height="40" fill="${c[0]}"/><rect x="12" y="8" width="36" height="24" fill="${c[1]}"/>`;
    else b = `<rect width="60" height="40" fill="${c[0]}"/><rect y="16" width="60" height="8" fill="${c[1]}"/>`;
    const ec = L === 'centro' ? c[2] : (L === 'triangulo' ? c[0] : c[2]);
    const cx = L === 'triangulo' ? 9 : 30;
    let e = '';
    if (E === 'estrella') e = `<polygon fill="${ec}" stroke="#0008" stroke-width=".6" points="${starPts(cx, 20, 9, 4)}"/>`;
    else if (E === 'circulo') e = `<circle cx="${cx}" cy="20" r="7" fill="${ec}" stroke="#0008" stroke-width=".6"/>`;
    else if (E === 'anillo') e = `<circle cx="${cx}" cy="20" r="7" fill="none" stroke="${ec}" stroke-width="2.5"/>`;
    else if (E === 'planeta') e = `<circle cx="${cx}" cy="20" r="5.5" fill="${ec}"/><ellipse cx="${cx}" cy="20" rx="11" ry="3" fill="none" stroke="${ec}" stroke-width="1.6" transform="rotate(-20 ${cx} 20)"/>`;
    else if (E === 'luna') e = `<circle cx="${cx}" cy="20" r="7" fill="${ec}"/><circle cx="${cx + 3}" cy="18" r="6" fill="${L === 'centro' ? c[1] : c[1]}"/>`;
    else if (E === 'rombo') e = `<polygon points="${cx},11 ${cx + 8},20 ${cx},29 ${cx - 8},20" fill="${ec}" stroke="#0008" stroke-width=".6"/>`;
    else if (E === 'triangulo') e = `<polygon points="${cx},11 ${cx + 8},27 ${cx - 8},27" fill="${ec}" stroke="#0008" stroke-width=".6"/>`;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 40" width="${w}" height="${h}" preserveAspectRatio="none">${b}${e}</svg>`;
  }
  function starPts(cx, cy, R, r) {
    const p = [];
    for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5; const rr = i % 2 ? r : R; p.push((cx + Math.cos(a) * rr).toFixed(1) + ',' + (cy + Math.sin(a) * rr).toFixed(1)); }
    return p.join(' ');
  }

  /** "Planetball": la bandera dentro de una esfera con ojos (guiño a countryballs) */
  function ballSVG(flag, size, mood) {
    size = size || 48;
    const id = 'b' + Math.random().toString(36).slice(2, 8);
    const inner = flagSVG(flag, 60, 40).replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const eyes = mood === 'angry'
      ? '<path d="M17 17 L27 21" stroke="#000" stroke-width="2"/><path d="M43 17 L33 21" stroke="#000" stroke-width="2"/><ellipse cx="23" cy="24" rx="4" ry="4.5" fill="#fff" stroke="#000"/><ellipse cx="37" cy="24" rx="4" ry="4.5" fill="#fff" stroke="#000"/>'
      : '<ellipse cx="23" cy="22" rx="4.5" ry="5.5" fill="#fff" stroke="#000" stroke-width="1"/><ellipse cx="37" cy="22" rx="4.5" ry="5.5" fill="#fff" stroke="#000" stroke-width="1"/>';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 60 60" width="${size}" height="${size}"><defs><clipPath id="${id}"><circle cx="30" cy="30" r="27"/></clipPath></defs><g clip-path="url(#${id})"><g transform="translate(-15,0) scale(1.5)">${inner}</g></g><circle cx="30" cy="30" r="27" fill="none" stroke="#000" stroke-width="2.5"/>${eyes}</svg>`;
  }

  return {
    RESOURCES, BIOMES, BUILDINGS, TECH_BRANCHES, TECHS, HULLS, COMPONENT_TYPES, COMPONENT_BASE_CAP,
    NUM_K, RULES, BASE_COMPONENTS, BASE_DESIGNS, FLAG_LAYOUTS, FLAG_EMBLEMS,
    addCost, roundCost, componentStats, componentDevCost, designStats, powerRating, validateDesign, designDevCost,
    flagSVG, ballSVG, annexCost,
    techById: (id) => TECHS.find(t => t.id === id)
  };
});
