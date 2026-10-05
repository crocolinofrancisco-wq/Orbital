# ROADMAP

Estado: ✅ hecho · 🟡 parcial · ⬜ pendiente · ❌ descartado. Orden = prioridad sugerida dentro de cada fase.

## Fase 1 — Base (hecha en la sesión anterior)
✅ cuentas, nación y bandera, economía por ciclo, edificios, mercado, tecnologías, diseñador de componentes y naves, licencias con regalías, flotas, invasión terrestre, guerras, alianzas, ofertas, chat (global/alianza/privado/guerra), UI móvil-first, mapa 3D low-poly.

## Fase 2 — v0.2 (esta sesión, 2026-10-04) ✅
✅ Batalla en tiempo real con visuales, órdenes, retirada, refuerzos y repetición determinista · ✅ HUD de batalla móvil/PC · ✅ aviso "BATALLA — ver en vivo" ·
✅ Objetos espaciales (portales de agujero negro, cinturones ricos, nebulosas, ruinas, guaridas) · ✅ Piratas por clanes con guaridas e incursiones · ✅ Criaturas (Leviatán, Medusa, Enjambre, Devorador-jefe) ·
✅ Naciones IA de relleno con personalidad · ✅ Temporada (fases, protección de novatos, victoria por nación/alianza, IA no gana) · ✅ Ritmo de 1 h/ciclo y todo reescalado ·
✅ Persistencia con adaptador D1 · ✅ Rutas seguras y portales opt-in · ✅ Simulador de temporada para balance · ✅ Documentación.

## Fase 2b — v0.3 (2026-10-04) ✅
✅ Batallas de 3-30 min y hasta ~300 naves visibles · ✅ calor, módulos, rendiciones · ✅ armas nuevas (pulsos, iones, enjambre, radiadores, artillería de asedio) · ✅ 2 especialidades de investigación + mercado de unidades (sin licencias) ·
✅ guerra terrestre por fases (bloqueo, bombardeo, escudo, campaña por rondas) · ✅ mapa de 44 sistemas con sistemas clave y pasos estratégicos · ✅ escala numérica ×10 · ✅ documentación.
Ideas de los videos aún sin hacer: peaje/efecto de los **pasos estratégicos**, casco de **portanaves con salidas limitadas** (cadencia de lanzamiento), **naves fábrica** que acompañan a la flota, **submarinos/corsarios sigilosos**, **tripulación entrenada y armas sin probar** (fiabilidad por experiencia),
**guerra electrónica/hackeo de naves con IA**, **hangares y arcos de fuego** por cara de la nave, civiles/rehenes y enemigo oculto en la campaña terrestre, mostrar la campaña terrestre sobre el planeta en el mapa 3D.

## Fase 3 — Producción (siguiente)
1. ⬜ **Playtest real con 8-10 personas** durante 3-4 días con `GAME_SPEED=6` y ajustar: ritmo de conquista, potencia de IA/piratas, costes. *Ver advertencia en BALANCE.md: el ritmo solo se validó con jugadores simulados.*
2. ⬜ **D1 normalizado**: tablas `users, nations, planets, fleets, designs, reports, chat…` con escritura incremental (hoy es un snapshot completo cada 60 s). Alternativa a evaluar: Workers + **Durable Object** por mundo (sockets + estado) con D1 para histórico.
3. ⬜ **Panel de administración** (nueva temporada, expulsar, silenciar, ver quejas) y moderación del chat (filtro más serio, reportes).
4. ⬜ **PWA / notificaciones push** ("te atacan", "terminó tu investigación", "batalla"): imprescindible con ciclos de 1 h.
5. ⬜ **Daño persistente y reparación** de flotas tras batallas (hoy se curan al terminar; con módulos dañados y batallas de 30 min tendría sentido).
5b. ⬜ **El Consorcio podría vender unidades** (a precio alto) para que ningún jugador sin proveedores quede bloqueado, y **entregas interceptables** por piratas/enemigos.
6. ⬜ **Tutorial interactivo** (hoy hay guía + objetivos) y pantalla de bienvenida de temporada.
7. ⬜ Persistir batallas en curso (hoy se cancelan al reiniciar).
8. ⬜ Optimización: `statsOf` con caché, `viewFor` incremental (diffs) cuando haya >20 jugadores.
9. ⬜ Accesibilidad: modo daltónico, textos grandes, reducir efectos.
10. ⬜ i18n (español hoy; inglés después).

## Las 10 ideas creativas (propuestas al usuario)
| # | Idea | Estado |
|---|---|---|
| 1 | **Portales de agujero negro con riesgo** | ✅ hecho (opt-in, hasta 12 % de bajas) |
| 2 | **Leviatán de asteroides** (botín repartido por daño) | ✅ hecho |
| 3 | **Eventos de temporada** (púlsar, supernova, invasión de IA antigua) | 🟡 solo la crisis del Devorador; faltan púlsares/supernova |
| 4 | ~~Contrabando y mercado negro con "calor" diplomático~~ | ❌ **descartada por el usuario**: los demás jugadores son humanos y no se les puede forzar a enojarse |
| 5 | **Mercenarios y flotas de alquiler** (si no pagas, se vuelven en tu contra) | ⬜ motor de traiciones; usar flotas NPC contratables |
| 6 | **Espionaje y sabotaje** (satélites, sabotaje de extractores, rumores falsos) | ⬜ además arreglaría "composición desconocida" de flotas ajenas |
| 7 | **Reliquias de los antiguos** (tecnología única por temporada) | 🟡 ruinas dan botín; falta la tecnología única |
| 8 | **Clips de batalla compartibles** (GIF/vídeo para TikTok) | ⬜ el motor ya permite repetir: grabar el canvas con `MediaRecorder` |
| 9 | **Tratados con consecuencias** (no agresión, rutas comerciales, vasallaje, guerras de coalición) | ⬜ |
| 10 | **Capitán de flota con nombre, experiencia y anécdotas** | ⬜ ideal para el rol (countryballs) |

### Más ideas sueltas (de esta sesión)
Campos de anomalías y restos de naves recuperables · tormentas de iones que se mueven · nido de leviatanes que crece si nadie lo mata · clanes pirata que se pelean entre sí ·
IA que responde mensajes privados y contraoferta · modo espectador global con lista de "batallas destacadas" · replays públicos en el chat · temporadas temáticas.

## Deuda técnica / cosas frágiles
- `ai.js`: el pipeline de invasión falla a menudo (`embark`); las IA acumulan recursos sin gastarlos.
- Pantalla de tecnologías y diseñador: no se revisaron en esta sesión (siguen como en v0.1).
- `viewFor` manda todos los diseños/componentes visibles en cada actualización: crece con la partida.
- Sin límite de IP real en registro (solo rate-limit por IP en memoria).
- v3 usa 44 sistemas por defecto (hasta 120 con nombres generados). En la simulación de 24 días un jugador ambicioso llegó a ~30 planetas hacia el día 7 y hubo **1 sola eliminación en 21 días** con jugadores simulados: la caída de naciones sigue dependiendo de humanos (ver BALANCE.md §5).
- `moveFleet` falla con "ya está en ese sistema" miles de veces en la simulación (las IA reenvían flotas que ya llegaron): inofensivo pero ruido.
