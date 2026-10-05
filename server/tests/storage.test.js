/* Prueba del almacenamiento: adaptador de archivo y adaptador Cloudflare D1 (con un D1 simulado en memoria).
 *   node server/tests/storage.test.js
 * El D1 simulado entiende exactamente las sentencias que usa server/storage.js, así se prueba
 * el troceado, la escritura en dos fases y la recuperación sin necesitar credenciales reales. */
const assert = require('assert');
const os = require('os'), fs = require('fs'), path = require('path');
const { d1Storage, fileStorage } = require('../storage.js');

function fakeD1() {
  const db = { meta: {}, chunks: [], calls: 0, failAfter: null };
  const fetch = async (url, init) => {
    db.calls++;
    const { sql, params } = JSON.parse(init.body);
    assert(/\/accounts\/acc\/d1\/database\/dbid\/query$/.test(url), 'URL de la API de D1');
    assert.strictEqual(init.headers.Authorization, 'Bearer tok');
    if (db.failAfter != null && db.calls > db.failAfter) return { ok: false, status: 500, json: async () => ({ success: false, errors: [{ message: 'caída simulada' }] }) };
    let results = [];
    if (/^CREATE TABLE/i.test(sql)) { /* nada */ }
    else if (/^SELECT v FROM world_meta/i.test(sql)) results = db.meta.current ? [{ v: db.meta.current }] : [];
    else if (/^SELECT data FROM world_chunks/i.test(sql)) results = db.chunks.filter(c => c.save_id === params[0]).sort((a, b) => a.part - b.part).map(c => ({ data: c.data }));
    else if (/^INSERT INTO world_chunks/i.test(sql)) { assert(params[2].length <= 90000, 'fragmento <= 90000'); db.chunks.push({ save_id: params[0], part: params[1], data: params[2] }); }
    else if (/^INSERT INTO world_meta/i.test(sql)) db.meta.current = params[0];
    else if (/^DELETE FROM world_chunks WHERE save_id <>/i.test(sql)) db.chunks = db.chunks.filter(c => c.save_id === params[0]);
    else if (/^DELETE FROM/i.test(sql)) { db.chunks = []; db.meta = {}; }
    else throw new Error('SQL inesperado: ' + sql);
    return { ok: true, status: 200, json: async () => ({ success: true, result: [{ results }] }) };
  };
  return { db, fetch };
}
const bigWorld = n => ({ version: 2, cycle: 7, seed: 5, blob: Array.from({ length: n }, (_, i) => ({ id: i, name: 'nación ' + i, nota: 'x'.repeat(40) + Math.random() })) });

(async () => {
  // --- D1: ida y vuelta con varios fragmentos ---
  const { db, fetch } = fakeD1();
  const st = d1Storage({ accountId: 'acc', databaseId: 'dbid', token: 'tok', fetch });
  assert.strictEqual(await st.load(), null, 'sin datos devuelve null');
  const w = bigWorld(9000);
  await st.save(w);
  assert(db.chunks.length > 1, 'el mundo debe trocearse (' + db.chunks.length + ' fragmentos)');
  const back = await st.load();
  assert.deepStrictEqual(back, w, 'ida y vuelta idéntica');
  console.log('D1: ida y vuelta OK con', db.chunks.length, 'fragmentos');

  // --- D1: un segundo guardado reemplaza al anterior y limpia fragmentos viejos ---
  const w2 = bigWorld(300); await st.save(w2);
  assert.deepStrictEqual(await st.load(), w2);
  assert(new Set(db.chunks.map(c => c.save_id)).size === 1, 'solo queda la última versión');
  console.log('D1: reemplazo y limpieza OK');

  // --- D1: caída a mitad de guardado => el mundo anterior sigue intacto ---
  const before = JSON.stringify(w2);
  db.failAfter = db.calls + 2;     // deja pasar 1-2 llamadas y luego falla
  let failed = false;
  try { await st.save(bigWorld(9000)); } catch (e) { failed = true; }
  assert(failed, 'el guardado debe fallar');
  db.failAfter = null;
  assert.strictEqual(JSON.stringify(await st.load()), before, 'el mundo previo no se corrompe');
  console.log('D1: recuperación tras caída OK');

  // --- Archivo ---
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'od-'));
  const fs1 = fileStorage(dir);
  assert.strictEqual(await fs1.load(), null);
  await fs1.save(w2); assert.deepStrictEqual(await fs1.load(), w2);
  fs.writeFileSync(path.join(dir, 'world.json'), '');   // archivo vacío = sin datos
  assert.strictEqual(await fs1.load(), null);
  console.log('Archivo: OK');
  console.log('OK');
})().catch(e => { console.error('FALLO', e); process.exit(1); });
