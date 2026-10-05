/* =====================================================================
 * ALMACENAMIENTO DEL MUNDO (adaptadores)
 * ---------------------------------------------------------------------
 * El servidor guarda TODO el mundo como un JSON. Dos adaptadores:
 *
 *   file  (por defecto)  data/world.json   -> desarrollo y pruebas
 *   d1    Cloudflare D1  vía API REST      -> producción (STORAGE=d1)
 *
 * Variables de entorno para D1:
 *   STORAGE=d1
 *   CF_ACCOUNT_ID   id de la cuenta de Cloudflare
 *   D1_DATABASE_ID  id de la base D1 (créala con `wrangler d1 create orbital`)
 *   CF_API_TOKEN    token con permiso "D1 Edit"
 *   D1_CHUNK_CHARS  (opcional) tamaño máx. de cada fragmento, 90000 por defecto
 *
 * POR QUÉ FRAGMENTOS: D1 limita el tamaño de fila (2 MB) y de sentencia
 * (100 KB). Guardamos el JSON comprimido (gzip + base64) partido en trozos
 * en la tabla world_chunks y una fila world_meta que apunta a la última
 * versión completa (escritura "en dos fases": primero los trozos, luego
 * el puntero; así una caída a mitad de guardado nunca corrompe el mundo).
 *
 * LIMITACIÓN CONOCIDA (ver docs/ROADMAP.md fase 3): es un "snapshot", no
 * una base relacional. Para >100 jugadores conviene normalizar en tablas
 * (users, nations, planets, fleets...) y guardar solo los cambios.
 * El esquema SQL está en db/schema.sql.
 * ===================================================================== */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ---------- Adaptador de archivo ---------- */
function fileStorage(dataDir) {
  const FILE = path.join(dataDir, 'world.json');
  return {
    kind: 'file',
    async load() {
      if (!fs.existsSync(FILE)) return null;
      const txt = fs.readFileSync(FILE, 'utf8');
      return txt.trim() ? JSON.parse(txt) : null;
    },
    async save(world) {
      if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
      fs.writeFileSync(FILE + '.tmp', JSON.stringify(world));
      fs.renameSync(FILE + '.tmp', FILE);
    },
    async wipe() { if (fs.existsSync(FILE)) fs.unlinkSync(FILE); }
  };
}

/* ---------- Adaptador Cloudflare D1 (API REST) ---------- */
function d1Storage(opts) {
  const account = opts.accountId, db = opts.databaseId, token = opts.token;
  const doFetch = opts.fetch || globalThis.fetch;
  const CHUNK = Number(opts.chunkChars || 90000);
  const url = `https://api.cloudflare.com/client/v4/accounts/${account}/d1/database/${db}/query`;
  let schemaReady = false;

  async function query(sql, params) {
    const res = await doFetch(url, { method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ sql, params: params || [] }) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.success === false) throw new Error('D1: ' + (json.errors && json.errors[0] ? json.errors[0].message : res.status));
    const r = json.result && json.result[0];
    return (r && r.results) || [];
  }
  async function ensureSchema() {
    if (schemaReady) return;
    await query('CREATE TABLE IF NOT EXISTS world_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL)');
    await query('CREATE TABLE IF NOT EXISTS world_chunks (save_id INTEGER NOT NULL, part INTEGER NOT NULL, data TEXT NOT NULL, PRIMARY KEY (save_id, part))');
    schemaReady = true;
  }
  return {
    kind: 'd1',
    async load() {
      await ensureSchema();
      const meta = await query("SELECT v FROM world_meta WHERE k = 'current'");
      if (!meta.length) return null;
      const m = JSON.parse(meta[0].v);
      const rows = await query('SELECT data FROM world_chunks WHERE save_id = ? ORDER BY part', [m.saveId]);
      if (rows.length !== m.parts) throw new Error('D1: faltan fragmentos (' + rows.length + '/' + m.parts + ')');
      const gz = Buffer.from(rows.map(r => r.data).join(''), 'base64');
      return JSON.parse(zlib.gunzipSync(gz).toString('utf8'));
    },
    async save(world) {
      await ensureSchema();
      const b64 = zlib.gzipSync(Buffer.from(JSON.stringify(world))).toString('base64');
      const saveId = Date.now();
      const parts = Math.ceil(b64.length / CHUNK);
      for (let i = 0; i < parts; i++) await query('INSERT INTO world_chunks (save_id, part, data) VALUES (?, ?, ?)', [saveId, i, b64.slice(i * CHUNK, (i + 1) * CHUNK)]);
      await query("INSERT INTO world_meta (k, v) VALUES ('current', ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", [JSON.stringify({ saveId, parts, bytes: b64.length, version: world.version, cycle: world.cycle, at: saveId })]);
      await query('DELETE FROM world_chunks WHERE save_id <> ?', [saveId]);
    },
    async wipe() { await ensureSchema(); await query('DELETE FROM world_chunks'); await query('DELETE FROM world_meta'); }
  };
}

function create(dataDir, env) {
  env = env || process.env;
  if ((env.STORAGE || 'file') === 'd1') {
    for (const k of ['CF_ACCOUNT_ID', 'D1_DATABASE_ID', 'CF_API_TOKEN']) if (!env[k]) throw new Error('STORAGE=d1 requiere la variable ' + k);
    return d1Storage({ accountId: env.CF_ACCOUNT_ID, databaseId: env.D1_DATABASE_ID, token: env.CF_API_TOKEN, chunkChars: env.D1_CHUNK_CHARS });
  }
  return fileStorage(dataDir);
}

module.exports = { create, fileStorage, d1Storage };
