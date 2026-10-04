/* =====================================================================
 * ESTADO DEL MUNDO + PERSISTENCIA
 * ---------------------------------------------------------------------
 * Fase 1: todo el mundo vive en memoria y se guarda en data/world.json
 * cada 20 s. Es simple, legible y suficiente para ~100 jugadores.
 * Fase futura: migrar a SQLite/Postgres (ver docs/ROADMAP.md). Toda la
 * lectura/escritura pasa por este módulo para que la migración sea fácil.
 * ===================================================================== */
const fs = require('fs');
const path = require('path');
const { generateGalaxy } = require('./galaxy.js');
const GD = require('../public/shared/gamedata.js');

const DATA_DIR = path.join(__dirname, '..', 'data');
const FILE = path.join(DATA_DIR, 'world.json');
const WORLD_VERSION = 1;

let world = null;
let seq = Date.now() % 100000;
function uid(prefix) { return prefix + (seq++).toString(36); }

function newWorld() {
  const seed = Math.floor(Math.random() * 1e9);
  const g = generateGalaxy(seed, Number(process.env.SYSTEMS || 26));
  const w = {
    version: WORLD_VERSION, seed, createdAt: Date.now(), cycle: 0, nextCycleAt: 0,
    systems: g.systems, planets: g.planets,
    users: {},        // userId -> { id, username, passHash, salt, nationId, createdAt }
    sessions: {},     // token -> userId
    nations: {},
    components: {},   // componentes diseñados (incluye los del Consorcio)
    designs: {},      // diseños de naves/tropas
    fleets: {},
    buildQueue: [],
    alliances: {},
    wars: {},
    offers: {},       // ofertas comerciales privadas
    market: {},       // órdenes de venta de recursos entre jugadores
    npcPrices: {},    // precio dinámico del Consorcio por recurso
    chat: {},         // canal -> [mensajes]
    news: [],         // noticias galácticas
    reports: {}       // informes de batalla
  };
  for (const c of GD.BASE_COMPONENTS) w.components[c.id] = Object.assign({ owner: null, status: 'ready', public: true }, c);
  for (const d of GD.BASE_DESIGNS) w.designs[d.id] = Object.assign({ owner: null, status: 'ready', public: true }, d);
  for (const r in GD.RESOURCES) w.npcPrices[r] = { aleaciones: 40, energia: 35, helio3: 50, cristales: 90, exoticos: 160, compuestos: 70 }[r];
  return w;
}

function load() {
  try {
    if (fs.existsSync(FILE)) {
      world = JSON.parse(fs.readFileSync(FILE, 'utf8'));
      if (world.version !== WORLD_VERSION) { console.warn('[state] versión distinta, se crea mundo nuevo'); world = newWorld(); }
      console.log('[state] mundo cargado. Ciclo', world.cycle, '-', Object.keys(world.nations).length, 'naciones');
      return world;
    }
  } catch (e) { console.error('[state] error leyendo world.json, se crea uno nuevo', e.message); }
  world = newWorld();
  save();
  console.log('[state] mundo nuevo creado con semilla', world.seed);
  return world;
}

let saving = false;
function save() {
  if (!world || saving) return;
  saving = true;
  try {
    if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(FILE + '.tmp', JSON.stringify(world));
    fs.renameSync(FILE + '.tmp', FILE);
  } catch (e) { console.error('[state] error guardando', e.message); }
  saving = false;
}

function get() { return world; }
function reset() { world = newWorld(); save(); return world; }

module.exports = { load, save, get, reset, uid };
