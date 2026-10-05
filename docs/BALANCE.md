# BALANCE

Fuente de verdad: [`public/shared/gamedata.js`](../public/shared/gamedata.js) (cliente y servidor leen el mismo archivo). Para tocar el balance edita **solo ese archivo** (salvo la tabla de armas del simulador: `battlesim.js`, y las reglas de NPC: `npcs.js`).

> **v3 — escala ×10.** Todas las cantidades (créditos, recursos, PI, población, PV, daño…) se multiplican por `GD.NUM_K = 10` al cargar `gamedata.js` (ver [ESPECIALIZACION.md](ESPECIALIZACION.md) §4). Las fórmulas y tablas de abajo están escritas en **valores base**: multiplica por 10 lo que verás en el juego (costes, PIB, PV, daño, poder). Proporciones, tiempos, velocidades y nº de unidades no cambian.

## 1. Economía (por ciclo = 1 hora)
```
PIB del planeta   = población(M) × 2500 × (1 + bono_tecnología + Σ edificio.gdp×nº) × (0.6 + 0.4×estabilidad)     [0 si hay bloqueo pirata]
desempleo         = clamp(0.16 − empleos/población, 0.02, 0.40)
evasión fiscal    = clamp(0.04 + 0.30×impuesto + 0.20×criminalidad + bono, 0.01, 0.60)
popularidad       = clamp(1.05 − 1.3×impuesto − desempleo − 0.4×criminalidad − 0.02×traiciones, 0, 1)
estabilidad       → se mueve un 30 % hacia la popularidad cada ciclo (+bono tecnología)
ingreso impuestos = PIB × (1 − desempleo) × impuesto × (1 − evasión)
neto              = impuestos − mantenimiento de edificios − mantenimiento de unidades
crecimiento pob.  = 3 % × estabilidad × (1 − pob/tope)   por ciclo
```
Inicio (valores base): ₡60 000, 20 PI, 8 M de población, capital con extractor+fábrica+astillero+academia+laboratorio → **≈ +₡4 900 por ciclo** (≈ ₡118 k/día). **Lo que ves en el juego: ₡600 000, 200 PI, 80 M y ≈ +₡49 000 por ciclo.**
Edificios: coste ×1.15 por cada edificio igual ya construido; huecos = `tamaño×4 + 2`; extractores ≤ `2×tamaño` (cinturón: 5, ×3 de yacimiento).
Anexión pacífica: `(₡5 000·NUM_K + población×2 500) × (1 + 0.25×(planetas_que_ya_tienes − 1))` (`GD.annexCost`; hace falta flota o planeta en el sistema, y sin piratas/criaturas). El factor frena la **bola de nieve**: en una simulación sin él, un jugador ambicioso llegó a 26 planetas el día 5 (y con 0.15 todavía a 25: por eso 0.25).
Investigación: laboratorio +6 PI/ciclo (+2 base) × (1 + bonos). Costes de tecnologías ×3 (`TECH_COST_K`). **El árbol entero vale ≈ 4 755 PI base (47 550 en pantalla)**, pero con la **especialización** (2 ramas + Economía) una nación llega como máximo al 55 % (≈ 26 400 PI en pantalla; mínimo 23 %): el resto se compra hecho a otros (ver [ESPECIALIZACION.md](ESPECIALIZACION.md)). Coste por rama (en pantalla): Economía 7 200 · Energía 5 250 · Balística 1 650 · Misiles 3 750 · Sistemas 8 400 · Naves 10 800 · Cazas 2 100 · Terrestre 6 000 · Orbital 2 400.
Mercado del Consorcio: compra ×1.1, venta ×0.8 del precio dinámico (cada operación lo mueve `amount/4000`; vuelve un 10 % por ciclo a su base).

## 2. Tiempos
Ver tabla en [TEMPORADA.md](TEMPORADA.md#ritmo-valores-por-defecto-game_speed1). Constantes en `gamedata.js`: `BUILD_TIME_K=14`, `DEV_TIME_K=10`, `TECH_COST_K=3`, `RULES.jumpSeconds=540`, `RULES.cycleSeconds=3600`.
**Regla**: si cambias el ciclo, cambia a la vez saltos, producción y diseño, o el juego pierde su ritmo.

## 3. Combate
Piedra-papel-tijera y fórmulas en [BATALLAS.md](BATALLAS.md). Perillas: `DPS_K`, `SHIELD_POOL`, `SHIELD_REGEN`, `WEAPON{}`. Cascos y componentes en `gamedata.js` (`HULLS`, `COMPONENT_TYPES`).
Ground (invasión, v3): campaña por rondas (`combat.js > groundRound`, `GROUND_RF = 0.04`), milicia = `población×4×milFrac`, ventaja defensiva ×1.15. Ver [GUERRA_TERRESTRE.md](GUERRA_TERRESTRE.md). `resolveGroundBattle` (v0.2, 8 rondas instantáneas) se conserva solo para pruebas.
Batallas v3: perillas nuevas `HEAT_*`, saturación del campo de batalla, `MAX_ENTS` (ver [BATALLAS.md](BATALLAS.md)).
NPC: `server/tests/tune-npc.js` enfrenta flotas tipo jugador contra piratas y criaturas.

## 4. Cómo balancear (receta)
1. Cambia el valor en `gamedata.js` (o la constante).
2. `npm test` (comprueba que nada se rompe y que la repetición sigue siendo determinista).
3. `node server/tests/tune-npc.js` si tocaste combate o NPC.
4. `npm run simulate -- --days 24 --bots 9 --humans 6 --dt 30` y mira: ocupación de planetas por día, guerras, informes, **errores más comunes** de las IA.
5. Playtest real con `GAME_SPEED=6` (un día de juego ≈ 4 h).

## 5. Qué se validó (y qué NO) sobre "14-21 días"
Simulación (`npm run simulate -- --days 14 --bots 9 --humans 6 --dt 30`, 44 sistemas / ~170 planetas, 9 IA + 6 "jugadores simulados" ambiciosos), v0.3:

| Hito | Resultado observado |
|---|---|
| Expansión | los planetas libres se agotan hacia el **día 8-12** (83 % ocupado el día 12: el mapa es más grande que en v0.2). Un jugador simulado llegó a ~30 planetas hacia el día 7 (bola de nieve aún posible; `annexGrowth` solo la frena) |
| Batallas | 120+ informes en 14 días; flotas de 20-60 naves, minutos de duración; una IA gana ~75 % de sus combates contra NPC |
| **Conquista (nuevo)** | **55 desembarcos → 34 conquistas, 3 derrotas, 4 retiradas, 14 cancelados** en 14 días (1248 rondas terrestres, 679 rondas de bombardeo). En v0.2 había 1-2 conquistas en 24 días: el bombardeo previo + campaña por rondas arreglan el cuello de botella de la invasión (aun así `embark` falla mucho por falta de transporte/tropas) |
| Eliminación | **0 naciones eliminadas en 14 días** (1 en 21 días en una simulación previa de 24 días): los planetas cambian de mano pero ninguna nación llega a perderlos todos. El final de la temporada sigue dependiendo de humanos agresivos |
| Estabilidad técnica | 24 días × 15 naciones en ~5 min de CPU, sin excepciones; estado serializado ≈ 80-300 KB |
| Mercado de unidades | las IA publican y compran unidades (11-16 ofertas, 2 compras en 24 días): funciona pero casi no se usa; pendiente mejorar la heurística de compra |

**Conclusión honesta**: la economía y la expansión encajan con 14-21 días; la **conquista** ya fluye (v0.3), pero **el final de la partida (última nación o alianza en pie)** sigue sin validarse con humanos. Mecanismos que empujan al final: (1) escasez de planetas libres (~día 10); (2) **bloqueo** (PIB 0) y **bombardeo** como arma de asfixia; (3) **colapso del gobierno** al caer la capital; (4) el **Devorador** al 62 % de la temporada. Si en el playtest las partidas se alargan, palancas por orden de impacto:
1. subir `govCollapseChance` / `govCollapseHours`; 2. bajar `GROUND_RF`/costes de tropas (invadir más rápido) o subir el castigo de estabilidad del bloqueo (-5/ciclo); 3. aumentar `seasonMaxDays` o bajarlo a 24 (gana por puntos); 4. bajar `SYSTEMS` (menos territorio → más contacto); 5. incursiones piratas más frecuentes; 6. hacer que un bloqueo largo termine en rendición del planeta.
Si se acorta demasiado: bajar `govCollapseChance`, subir la protección de novatos, o subir `GROUND_RF`.

## 6. Valores de referencia (base; ×10 en pantalla)
| Casco | PV | velocidad | coste | fabricación (×14) |
|---|---|---|---|---|
| Caza | 30 | 10 | ₡600 | 280 s |
| Corbeta | 160 | 7 | ₡2 500 | 10 min |
| Fragata | 380 | 6 | ₡5 000 | 19 min |
| Destructor | 700 | 6 | ₡9 000 | 28 min |
| Crucero | 1 400 | 5 | ₡16 000 | 42 min |
| Portanaves | 1 800 | 4 | ₡22 000 | 51 min |
| Acorazado | 3 200 | 3 | ₡40 000 | 75 min |
(Son los valores base del casco; los componentes añaden coste y mantenimiento. Tiempos de unidades sueltas; `count^0.75` para lotes.)
