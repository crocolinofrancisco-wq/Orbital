# HANDOFF — empieza aquí (para humanos y otras IAs)

> Última actualización: 2026-10-04 (v0.3: batallas masivas con calor/módulos/rendición, especialización + mercado de unidades, guerra terrestre por fases, mapa 44 sistemas, escala ×10).
> Este archivo es el hilo conductor. Si cambias algo importante, **actualiza este archivo y `CHANGELOG.md`**.

## 1. Qué es esto
**Orbital Domination**: juego multijugador de navegador (móvil primero, también PC) ambientado en un futuro sci-fi tipo Star Wars.
Heredero espiritual de *Global Domination* (mapgame de Discord): se controla una nación, hay un PIB que se cobra por ciclo,
se diseñan armas/naves propias y se comercian, hay diplomacia y guerra. Cambios clave respecto al original:
**la guerra es una simulación** (no rol humano) y **el juego es HTML**, sin Discord.

Público: adolescentes 13-18 que juegan rol de countryballs en TikTok. → **simple de jugar, difícil de dominar**, muy social
(chat global/alianza/privado/guerra, alianzas, traiciones). Estilo UI: capturas de `StyleInspiration/`. Gráficos 3D: flat + low-poly + cell-shading.
Una partida (temporada) debe terminar de forma natural en **14-21 días**.

Tres grandes apartados: **Tycoon** (Imperio), **Diplomático-bélico** (Mapa/Militar/Social), **Proyectos** (tecnología, diseño de armas y naves).

## 2. Cómo arrancarlo
```bash
cd "webapp (1)/webapp"
npm install            # express + socket.io (three.js ya está vendorizado en public/vendor)
npm run dev            # http://localhost:3100  · todo va x20 · 8 IA de relleno
npm start              # ritmo REAL de temporada (ciclo = 1 h), puerto 3000
npm test               # batalla + terrestre (v2) + almacenamiento (D1 simulado) + mundo completo + guerra terrestre + mercado/especialización
npm run simulate -- --days 20 --humans 4      # temporada completa en segundos (herramienta de balance)
node server/tests/live.test.js                # extremo a extremo por sockets (arranca su propio servidor)
```
Variables de entorno: ver [OPERACION.md](OPERACION.md). Windows PowerShell: `$env:GAME_SPEED=60; npm run dev`.
En Windows `node` no entiende rutas `/c/...`: usa rutas relativas.

## 3. Mapa del código
```
server/
  index.js        Express + Socket.IO. Vistas por jugador (viewFor), chat, sockets de batalla, admin, bucles (1 s lógica / 250 ms batallas).
  game.js         REGLAS: nación, economía, edificios, mercado, proyectos, flotas, invasión, diplomacia, tick(), handleAction().
  battles.js      Batallas EN VIVO: detección, avance en tiempo real, refuerzos, órdenes, bajas, botín, informes.
  npcs.js         Piratas (3 clanes, guaridas, incursiones) y criaturas (Leviatán, Medusa, Enjambre, Devorador), ruinas, bloqueos.
  ai.js           Naciones IA de relleno (personalidades; usan las MISMAS acciones que un jugador).
  season.js       Ritmo, fases, protección de novatos, puntos de dominio, victoria / temporada anulada.
  galaxy.js       Generación del mapa (grafo) con agujeros negros/portales, cinturones, nebulosas, ruinas, guaridas; rutas (Dijkstra).
  state.js        Mundo en memoria + guardado vía adaptador. storage.js: archivo | Cloudflare D1 (REST).
  combat.js       Ronda de combate terrestre (`groundRound`, pura) y el viejo `resolveGroundBattle`.
  ground.js       v3: bloqueo, bombardeo orbital, escudo planetario y campaña terrestre por rondas (ver docs/GUERRA_TERRESTRE.md).
  tools/simulate.js   Simulador de temporada completa (reloj falso). start-dev.js: arranque de desarrollo.
  tests/          battle · combat · storage · world · ground · market · live (e2e) · smoke · tune-npc (herramienta).
public/
  shared/         gamedata.js (BALANCE: fuente de verdad)  battlesim.js (SIMULADOR de batalla, cliente+servidor)  icons.js (iconos procedurales)
  js/             app.js (login, topbar, avisos)  core.js (socket, helpers, tokens :icono:)  render3d.js (mapa, sistema, objetos espaciales)
                  ships3d.js (naves y criaturas low-poly)  battle3d.js (visor 3D de batallas)  views/ (map, empire, projects, military, social, battle)
  css/style.css   Estilos (mobile-first)
db/schema.sql     Esquema D1.        docs/   Esta documentación.
```
Regla de oro: **el servidor es la autoridad**. El cliente solo pide acciones (`socket.emit('action', {type, data})`) y dibuja el estado.

## 4. Flujo de datos
- `handleAction(nationId, type, data)` es la única puerta de entrada de reglas (jugadores y bots la usan igual). Lanza `GameError` → `{ok:false,error}`.
- `tick()` (1 s): ciclo económico (cada `TICK_SECONDS`), proyectos, producción, saltos de flota, `Battles.scan/step`, misiones de invasión, NPC, IA.
- Estado al cliente: `viewFor(nid)` cada 1.5 s si hubo cambios (`dirty`). Niebla de guerra simple; **piratas y criaturas se ven siempre**.
- Batallas: `battle:watch` → `meta` + frame; luego `battle:frame` 2/s por la sala `b:<id>`. Órdenes: acción `battleCmd`. Informe completo bajo demanda: `report:get`.
- Iconos: cualquier texto `:nombre:` (ver `shared/icons.js`) se convierte en SVG en el cliente (también los textos que manda el servidor).

## 5. Estado del proyecto
**Hecho (v0.2)**: batalla en tiempo real con visuales (disparos, escudos, explosiones, EMP, humo), órdenes tácticas, retirada, refuerzos,
repetición determinista; objetos espaciales (portales de agujero negro, cinturones ricos, nebulosas, ruinas, guaridas); piratas con clanes e incursiones;
criaturas (Leviatán, Medusa, Enjambre, Devorador-jefe); naciones IA de relleno con personalidad; temporada con fases, protección de novatos y
victoria "última nación o alianza en pie" (una IA nunca gana); ritmo de 1 h/ciclo; persistencia con adaptador D1; nuevo HUD; documentación.

**Hecho (v0.3)**: ver [CHANGELOG.md](CHANGELOG.md) y [DECISIONES.md](DECISIONES.md) fase 3 (C1-C7): batallas de hasta 30 min y ~300 naves con calor, módulos y rendiciones; armas nuevas; **2 especialidades de investigación** y mercado de **unidades** ya fabricadas (sin licencias; ver [ESPECIALIZACION.md](ESPECIALIZACION.md)); guerra terrestre por fases ([GUERRA_TERRESTRE.md](GUERRA_TERRESTRE.md)); mapa de 44 sistemas con sistemas clave; **escala numérica ×10** (`GD.NUM_K`).

**Pendiente / ideas** → [ROADMAP.md](ROADMAP.md). Lo más importante: playtest real para ajustar el balance (solo se validó con IA),
D1 normalizado, panel de administración, notificaciones push, y las ideas creativas no implementadas.

## 6. Cosas a tener en cuenta (trampas conocidas)
- `public/shared/*.js` se cargan en navegador **y** Node (patrón UMD). No uses `import`/APIs de navegador ahí.
- `battlesim.js` debe seguir siendo **determinista** (sin `Math.random`, sin trigonometría en la simulación). Si lo rompes, las repeticiones divergen. `server/tests/battle.test.js` y `world.test.js` lo comprueban.
- Cambiar el esquema del mundo → sube `WORLD_VERSION` en `state.js` (un mundo con otra versión se descarta). Hoy es la 4.
- **Escala ×10**: `gamedata.js` multiplica por `NUM_K` al cargar. Las constantes nuevas que mezclen una cantidad (PV, daño, créditos, población…) con un número fijo deben usar `GD.NUM_K` (ver ESPECIALIZACION.md §4). `battlesim.js` tiene su propia copia de `NUM_K`; `battle.test.js` comprueba que coinciden.
- **No hay licencias** (decisión del usuario): lo que no sabes fabricar se compra hecho en el Mercado. No reintroduzcas `n.licenses`.
- Los tiempos del juego están pensados para **ciclos de 1 hora**; `GAME_SPEED` escala *todo* (viajes, producción, investigación, protección…).
- Las batallas en curso no se persisten; al reiniciar el servidor las flotas vuelven al estado previo al choque.
- No se minifica nada a propósito (el usuario quiere editar el HTML/JS a mano).
- El tamaño del estado por jugador crece con `reports`; los informes completos (con repetición) se piden aparte (`report:get`). Tope 120 informes.
- Los textos del juego están en español; mantén el tono simple para 13-18 años.

## 7. Cómo añadir contenido (recetas)
- **Nuevo casco/arma/edificio/tecnología**: editar `public/shared/gamedata.js` (y un icono `h_*`/`c_*`/`b_*` en `icons.js`, y el modelo en `ships3d.js` si es casco). Ver [BALANCE.md](BALANCE.md).
- **Nueva criatura**: casco con `npcOnly:true` + componentes `mc_*` + diseño `md_*` en `gamedata.js`; builder en `ships3d.js` (con `g.userData.anim`); lógica de aparición en `npcs.js`; habilidad especial en `battlesim.js` (`special`). Ver [ENEMIGOS.md](ENEMIGOS.md).
- **Nuevo tipo de arma**: entrada en `COMPONENT_TYPES` (gamedata) + entrada en `WEAPON` (battlesim: alcance, cadencia, tipo de proyectil) + color en `battle3d.js`. Ver [BATALLAS.md](BATALLAS.md).
- **Nuevo objeto espacial**: generar en `galaxy.js`, dibujar en `render3d.js` (`decorateSystem`/`buildSystem`), efecto en `battlesim.js` (`env`) si afecta al combate. Ver [OBJETOS_ESPACIALES.md](OBJETOS_ESPACIALES.md).
