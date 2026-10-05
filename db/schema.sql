-- Esquema de Cloudflare D1 para Orbital Domination (fase 1: snapshot del mundo).
-- Crear la base:   npx wrangler d1 create orbital
-- Aplicar el esquema:  npx wrangler d1 execute orbital --remote --file=db/schema.sql
-- (El servidor también ejecuta estos CREATE TABLE IF NOT EXISTS al arrancar.)
CREATE TABLE IF NOT EXISTS world_meta (
  k TEXT PRIMARY KEY,          -- 'current' apunta a la última versión completa
  v TEXT NOT NULL              -- JSON: { saveId, parts, bytes, version, cycle, at }
);
CREATE TABLE IF NOT EXISTS world_chunks (
  save_id INTEGER NOT NULL,    -- marca de tiempo del guardado
  part INTEGER NOT NULL,       -- orden del fragmento
  data TEXT NOT NULL,          -- fragmento del JSON del mundo (gzip + base64)
  PRIMARY KEY (save_id, part)
);
