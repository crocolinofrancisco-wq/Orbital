# OPERACIÓN: variables de entorno, D1, despliegue

## Variables de entorno
| Variable | Por defecto | Qué hace |
|---|---|---|
| `PORT` | 3000 (`npm run dev`: 3100) | Puerto HTTP |
| `STORAGE` | `file` | `file` (data/world.json) o `d1` (Cloudflare D1) |
| `DATA_DIR` | `webapp/data` | Carpeta del archivo de mundo (tests la cambian) |
| `GAME_SPEED` | 1 (`npm run dev`: 20) | Acelera TODO el juego N veces (viajes, producción, investigación, protección, ciclo) |
| `TICK_SECONDS` | `3600 / GAME_SPEED` | Duración del ciclo económico (solo para forzar otro valor) |
| `JUMP_SECONDS` | 540 | Segundos base por salto (anula `RULES.jumpSeconds`) |
| `SYSTEMS` | 44 | Sistemas al crear un mundo (hasta 120; si faltan nombres se generan con letra griega) |
| `GROUND_ROUND_S` | 20 | Segundos por ronda de la guerra terrestre (bombardeo y campañas), antes de `GAME_SPEED` |
| `AI_COUNT` | 9 | Naciones IA de relleno al crear el mundo |
| `AI_SKILL` | 0.55 | Competencia de las IA (0-1) |
| `BATTLE_SPEED` | 1 | Multiplica la velocidad de las batallas (tests) |
| `ADMIN_KEY` | — | Clave para `/api/admin/*` (sin ella los endpoints responden 403) |
| `CF_ACCOUNT_ID`, `D1_DATABASE_ID`, `CF_API_TOKEN`, `D1_CHUNK_CHARS` | — / — / — / 90000 | Cloudflare D1 (ver abajo) |

## Persistencia en Cloudflare D1
**Estado (2026-10-04):** la base `orbital` ya está creada en la cuenta del usuario (`D1_DATABASE_ID=5784e5bd-7913-42f9-93e0-c85d51218864`, `CF_ACCOUNT_ID=bb7dae741a179bcf84be126dc8bfa9d9`) y el esquema aplicado. Falta el **API token** (D1 → Edit) y arrancar el servidor con `STORAGE=d1`. Solo hay un mundo a la vez.
1. Crear la base: `npx wrangler d1 create orbital` (anota el `database_id`).
2. (Opcional) aplicar el esquema: `npx wrangler d1 execute orbital --remote --file=db/schema.sql` (el servidor también crea las tablas solo).
3. Crear un **API token** de Cloudflare con permiso *D1 → Edit* (cuenta).
4. Arrancar con:
   ```bash
   STORAGE=d1 CF_ACCOUNT_ID=... D1_DATABASE_ID=... CF_API_TOKEN=... ADMIN_KEY=... npm start
   ```
Cómo guarda: el mundo (JSON) se comprime (gzip+base64), se parte en trozos ≤ 90 KB en `world_chunks`, y al final se actualiza `world_meta.current` (puntero) y se borran los trozos antiguos. Una caída a mitad de guardado deja intacta la versión anterior. Guardado cada 60 s en D1 (20 s en archivo) y al cerrar (SIGINT/SIGTERM).
**Probado solo con un D1 simulado** (`server/tests/storage.test.js`): valida troceado, reemplazo, recuperación tras caída. Antes de producción, probar contra un D1 real y vigilar los límites de la API REST (peticiones/seg, filas escritas) → si molesta, subir `D1_CHUNK_CHARS` (máx. seguro ≈ 90 000 por el límite de 100 KB por sentencia) o guardar cada vez menos.
Por qué el servidor sigue siendo Node y no un Worker: ver [DECISIONES.md](DECISIONES.md) B9 y la fase 3 del [ROADMAP.md](ROADMAP.md).

## Despliegue sugerido
Necesita un proceso Node **persistente** (sockets + estado en memoria): VPS pequeño, Fly.io, Railway o Render (plan con servicio siempre activo). Con `pm2`/systemd y reinicio automático. Poner detrás de HTTPS (Cloudflare proxy o Caddy) porque los websockets lo agradecen y las PWA lo exigen. **Un solo proceso por mundo** (el estado vive en memoria).

## Tareas de administración
```bash
# Nueva temporada (conserva cuentas)
curl -X POST http://HOST/api/admin/new-season -H "Content-Type: application/json" -d '{"key":"TU_ADMIN_KEY"}'
# Borrar todo
curl -X POST http://HOST/api/admin/reset -H "Content-Type: application/json" -d '{"key":"TU_ADMIN_KEY"}'
# Salud
curl http://HOST/api/health
```
Backups: con `STORAGE=file`, copiar `data/world.json`. Con D1: `npx wrangler d1 export orbital --remote --output backup.sql`.

## Pruebas rápidas
`npm test` (unitarias + mundo), `node server/tests/live.test.js` (e2e con servidor propio), `npm run simulate` (temporada), `node server/tests/tune-npc.js` (NPC).
