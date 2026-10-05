# CHANGELOG

## 0.3.1 — 2026-10-04 (cazas atascados + tráiler)
**Arreglado**
- **Cazas que se quedaban parados** (`battlesim.js > _think`): al estar a menos de ~1.04× de su distancia preferida solo orbitaban, sin corregir el radio (acababan apilados en un punto, como en la captura del usuario) y, pegados a un borde de la arena, empujaban contra la pared sin avanzar. Ahora combinan órbita + corrección radial (`(d - pref)/pref`) y **invierten el sentido de giro** al acercarse a cualquier borde. Medido con 270 cazas: los cazas sin avance por pared pasaron de 4 por ventana a 0; quedan 1-4 de ~100 en el equilibrio a distancia de tiro dentro de la multitud. La duración de la batalla masiva no cambia (30 min).
- Sobre el "límite de cazas": no hay tope por flota; solo el global `MAX_ENTS = 320` entidades (3 cazas por entidad) y los portanaves lanzan como máximo 3 escuadrones.

**Nuevo**
- **Tráiler** de 86 s: `public/trailer.html` (guion en [TRAILER.md](TRAILER.md)). Usa el simulador y el visor 3D reales.

## 0.3.0 — 2026-10-04 (batallas masivas, especialización, guerra terrestre, escala ×10)
Pedido del usuario: más masivo (más países, más naves, batallas de 30 min), números ×10 por estética, conquista y batalla terrestre con más sustancia, más armas e investigación con **especialización** (comprar lo demás a otros) y ideas de los videos de `VideoInspirations/`.

**Nuevo**
- **Batallas masivas**: 1 nave = 1 entidad (hasta `MAX_ENTS` 320), `DPS_K` 0.05 y saturación del campo de batalla → duelos de 3-6 min, flotas medias 20-26 min, **150 vs 150 ≈ 30 min**. Tope de batalla 1800 s. (BATALLAS.md)
- **Calor** (armas bloqueadas al sobrecalentarse), **módulos** (motor/armas/sensores se dañan por separado) y **rendición** con botín (50 % del valor). HUD con barra de calor, ticker y vapor/anillos en el visor 3D.
- **Armas nuevas**: láser de pulsos, cañón de iones, misiles en enjambre; componente radiador; casco artillería de asedio. Iconos nuevos.
- **Especialización**: 9 ramas (8 con candado), 2 ranuras por nación; árbol reorganizado en Energía/Balística/Misiles/Sistemas/Naves/Cazas/Terrestre/Orbital + Economía abierta (ESPECIALIZACION.md).
- **Mercado de unidades**: se compran unidades ya fabricadas con entrega por viaje al planeta elegido, reventa, y lista de especialistas. **Sin licencias.**
- **Guerra terrestre por fases**: bloqueo (PIB 0), bombardeo (precisión/saturación), escudo planetario que se apaga con tropas, campaña por rondas con posturas, refuerzos y retirada; panel en la ficha del planeta (GUERRA_TERRESTRE.md).
- **Mapa**: 44 sistemas (hasta 120), sistemas clave por región (+25 % PIB), pasos estratégicos marcados.
- **Escala numérica ×10** (`GD.NUM_K`).
- Tests: `ground.test.js`, `market.test.js`; `battle.test.js` ampliado (armas nuevas, calor, módulos, rendición, batalla masiva, escala). Laboratorio `/dev-battle.html` con escenarios masivos.

**Cambiado**
- `battleMaxSeconds` 300 → 1800; `RETREAT_SPOOL` 12 → 20 s; el tiempo agotado se decide con ≥1.12× de casco; regeneración de escudos y criaturas reducida (daño más lento).
- Invadir ya no es instantáneo: `invade` desembarca y empieza una campaña; la misión "Invadir" bombardea antes de desembarcar.
- `WORLD_VERSION` 4 (los mundos anteriores se descartan).
- Puntuación de temporada, umbrales de IA, daño de defensas planetarias, etc. ajustados a la escala ×10.

**Arreglado**
- La ficha/miniatura de un **gigante gaseoso** podía romperse (índice de color negativo en el polo sur, `render3d.js`).
- La vista Militar lanzaba un error si se actualizaba antes de tener nación.
- `live.test.js` usa `BATTLE_SPEED=15` (las batallas ya no terminan en 5 min reales).

**Quitado**
- Licencias de diseño y regalías (`n.licenses`, ofertas con `designId`), requisitos de tecnología entre ramas distintas.

## 0.2.0 — 2026-10-04 (continuación en Claude Code)
Pedido del usuario: batallas largas y con visuales, más objetos espaciales, más enemigos (piratas visibles + criaturas ambientales), y que la partida dure 14-21 días. Respuestas del usuario: batallas en vivo con órdenes, victoria = última nación/alianza, Cloudflare D1, ~10 jugadores (tope 20) con IA de relleno "inteligente pero que nunca gane", trabajar sobre `webapp`.

**Nuevo**
- Motor de **batalla en tiempo real** (`public/shared/battlesim.js`, `server/battles.js`): proyectiles, escudos, PD, misiles interceptables, retirada con carga de salto, refuerzos, entornos, portanaves, especiales de criaturas. Repetición determinista.
- **Visor 3D** (`js/battle3d.js`) + **HUD** (`js/views/battle.js`): órdenes (Atacar/Mantener/Distancia/Retirada), foco de fuego, retirada total, ticker de bajas, cámara automática, modo repetición ×1/×2/×4. Aviso rojo global "BATALLA — ver en vivo". Pestaña Militar > En vivo.
- **Objetos espaciales**: agujeros negros (portales con riesgo), cinturones ricos, nebulosas, ruinas, guaridas pirata (`server/galaxy.js`, `render3d.js`).
- **Enemigos NPC** (`server/npcs.js`): piratas con 3 clanes, guaridas, incursiones y bloqueos; Leviatán, Medusa, Enjambre y **Devorador** (jefe de crisis); modelos 3D animados.
- **Temporada** (`server/season.js`): fases, protección de novatos 48 h, ranking de dominio, victoria por nación/alianza, temporada anulada si solo quedan IA, tope 28 días, colapso del gobierno al caer la capital.
- **Naciones IA** (`server/ai.js`): 5 personalidades, hacen todo lo que un jugador; etiqueta "IA".
- **Persistencia** (`server/storage.js`, `db/schema.sql`): adaptador archivo | Cloudflare D1 (REST, troceado, 2 fases).
- Herramientas: `server/tools/simulate.js` (temporada completa), `tests/{battle,combat,storage,world,live,smoke}.test.js`, `tests/tune-npc.js`, `npm run dev` (x20).
- Documentación completa en `docs/`.

**Cambiado**
- Ritmo: ciclo 5 min → **1 h**; salto 90 s → 540 s×distancia; producción ×14, diseño ×10, tecnologías ×3 (ver BALANCE.md).
- `findPath` ahora es Dijkstra con pesos por distancia, portales opt-in y rutas que evitan sistemas con enemigos.
- `relation()` del cliente: piratas y criaturas son siempre "en guerra" (antes figuraban como neutrales y no aparecían en Objetivos).
- El mundo es versión 2 (los mundos de v0.1 se descartan). `uid()` ahora es persistente (`world.seq`).
- `combat.js` solo contiene el combate terrestre.
- Anexar planetas cuesta un 25 % más por cada planeta que ya tienes (`GD.annexCost`) para frenar la bola de nieve.
- Al caer una capital, las colonias pueden rebelarse unas horas (colapso del gobierno).

**Arreglado**
- Los piratas no se veían ni se podían atacar desde Objetivos (ver arriba).
- Las IA mandaban naves por sistemas con guaridas y las perdían (rutas seguras + prudencia).
- Un listener de `resize` quedaba colgado al destruir escenas 3D (`InteractiveScene.dispose`).

**Quitado**
- Combate espacial por rondas (`resolveSpaceBattle`), `BattleReplay` (render3d), `war.test.js` (sustituido por `world.test.js`).

## 0.1.0 — fase 1 (Genspark)
Base del juego: servidor, economía, proyectos, flotas, diplomacia, chat, UI móvil, mapa 3D.
