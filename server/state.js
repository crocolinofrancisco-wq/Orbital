/* =====================================================================
 * ESTADO DEL MUNDO + PERSISTENCIA
 * ---------------------------------------------------------------------
 * Todo el mundo vive en memoria (un objeto) y se guarda cada pocos
 * segundos mediante un ADAPTADOR (server/storage.js): archivo local en
 * desarrollo, Cloudflare D1 en producción (STORAGE=d1).
 * Toda lectura/escritura pasa por este módulo para que migrar a tablas
 * normalizadas sea fácil (ver docs/ROADMAP.md).
 *
 * Lo que NO se guarda (se reconstruye): batallas en curso (si el servidor
 * se reinicia, las flotas vuelven a su estado previo al choque).
 * ===================================================================== */
const path = require('path');
const { generateGalaxy } = require('./galaxy.js');
const GD = require('../public/shared/gamedata.js');
const Storage = require('./storage.js');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const WORLD_VERSION = 4;

let world = null;
let storage = Storage.create(DATA_DIR);
function setStorage(s) { storage = s; }
function uid(prefix) { return prefix + (world.seq++).toString(36); }

function newWorld() {
  const seed = Math.floor(Math.random() * 1e9);
  const g = generateGalaxy(seed, Number(process.env.SYSTEMS || 44));
  const w = {
    version: WORLD_VERSION, seed, createdAt: Date.now(), cycle: 0, nextCycleAt: 0, seq: 1000,
    season: { number: 1, startedAt: Date.now(), status: 'running', winner: null, endedAt: null, reason: null, crisis: null },
    systems: g.systems, planets: g.planets,
    users: {},        // userId -> { id, username, passHash, salt, nationId, createdAt }  (los bots usan { bot: true })
    sessions: {},     // token -> userId
    nations: {},      // incluye humanos, bots (n.bot) y NPC (piratas/monstruos: n.npc)
    components: {},   // componentes diseñados (incluye los del Consorcio y los de NPC)
    designs: {},      // diseños de naves/tropas
    fleets: {},
    buildQueue: [],
    deliveries: [],   // unidades compradas en el Mercado que viajan hacia el comprador
    alliances: {},
    wars: {},
    offers: {},       // ofertas comerciales privadas
    market: {},       // ofertas entre jugadores: recursos y unidades ya fabricadas
    npcPrices: {},    // precio dinámico del Consorcio por recurso
    chat: {},         // canal -> [mensajes]
    news: [],         // noticias galácticas
    reports: {},      // informes de batalla (con setup + órdenes para repetir en 3D)
    npcState: {}      // temporizadores de reaparición de criaturas, incursiones, etc.
  };
  for (const c of GD.BASE_COMPONENTS) w.components[c.id] = Object.assign({ owner: null, status: 'ready', public: !c.hidden }, c);
  for (const d of GD.BASE_DESIGNS) w.designs[d.id] = Object.assign({ owner: null, status: 'ready', public: !d.npc }, d);
  for (const r in GD.RESOURCES) w.npcPrices[r] = { aleaciones: 40, energia: 35, helio3: 50, cristales: 90, exoticos: 160, compuestos: 70 }[r];
  return w;
}

/** Arranque asíncrono: carga del adaptador (archivo o D1) o crea un mundo nuevo */
async function init() {
  try {
    const data = await storage.load();
    if (data) {
      if (data.version !== WORLD_VERSION) { console.warn('[state] versión distinta (' + data.version + '), se crea un mundo nuevo'); world = newWorld(); }
      else { world = data; console.log('[state] mundo cargado (' + storage.kind + '). Ciclo', world.cycle, '-', Object.keys(world.nations).length, 'naciones'); }
      if (world.seq == null) world.seq = 1000;
      return world;
    }
  } catch (e) { console.error('[state] error leyendo el mundo, se crea uno nuevo:', e.message); }
  world = newWorld();
  await save();
  console.log('[state] mundo nuevo creado con semilla', world.seed, '(' + storage.kind + ')');
  return world;
}

let saving = null, again = false;
/** Guarda sin solaparse: si ya hay un guardado en curso, encadena otro al terminar */
function save() {
  if (!world) return Promise.resolve();
  if (saving) { again = true; return saving; }
  saving = storage.save(world).catch(e => console.error('[state] error guardando:', e.message)).then(() => {
    saving = null;
    if (again) { again = false; return save(); }
  });
  return saving;
}

function get() { return world; }
/** Mundo nuevo (admin / nueva temporada / tests). Conserva las cuentas de usuario humanas. */
function reset(opts) {
  opts = opts || {};
  const old = world;
  world = newWorld();
  if (old && opts.keepUsers) {
    for (const u of Object.values(old.users)) if (!u.bot) { u.nationId = null; world.users[u.id] = u; }
    world.sessions = old.sessions;
    world.season.number = (old.season ? old.season.number : 0) + 1;
    world.seq = Math.max(world.seq, old.seq || 0);
  }
  return world;
}
function wipeStorage() { return storage.wipe ? storage.wipe() : Promise.resolve(); }

module.exports = { init, save, get, reset, uid, setStorage, wipeStorage, newWorld, WORLD_VERSION, DATA_DIR };
