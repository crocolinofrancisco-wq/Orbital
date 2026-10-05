# BATALLAS EN TIEMPO REAL — especificación del motor (v3)

> v3: batallas de **3 a 30 minutos**, hasta ~300 naves en pantalla, **calor**, **daño por módulos**, **rendiciones**, armas nuevas (pulsos, iones, enjambre) y escala numérica ×10.

Código: [`public/shared/battlesim.js`](../public/shared/battlesim.js) (motor, cliente+servidor) · [`server/battles.js`](../server/battles.js) (integración con el mundo) ·
[`public/js/battle3d.js`](../public/js/battle3d.js) (visor 3D) · [`public/js/views/battle.js`](../public/js/views/battle.js) (HUD).
Pruebas: `server/tests/battle.test.js`, `world.test.js`, `live.test.js`. Herramienta de balance NPC: `server/tests/tune-npc.js`.

## 1. Ciclo de vida
1. **Detección** (`Battles.scan`, 1 s): en cada sistema se buscan flotas con naves + defensas planetarias + estación de guarida. Se forman dos bandos:
   - Si hay piratas/criaturas presentes y alguien más → A = todos los no-NPC, B = NPC (siempre hostiles a todos y amigos entre sí).
   - Si no, por cada **guerra activa**: A = atacantes presentes, B = defensores presentes.
   - Planetas y estaciones solos no inician combate (hace falta al menos una flota con naves).
2. **Creación**: `new BattleSim(setup)`; las flotas quedan bloqueadas (`f.battle = id`). Aviso a los humanos implicados (`event {type:'battle', phase:'start'}`) y noticia global.
3. **Avance**: cada 0,5 s de reloj real = 1 paso (`DT`). `BATTLE_SPEED` lo acelera (tests). Se emite un *frame* por paso a la sala `b:<id>`.
4. **Refuerzos**: cada 1 s se buscan flotas libres en el sistema que sean afines a un bando (en guerra con el otro) → entran por el borde de su bando tras 5 s (`addReinforcements`). Contra NPC, todos ayudan al bando de los jugadores.
5. **Fin**: un bando sin entidades activas (o tiempo agotado). Se aplican bajas a las flotas, retirada de los que escaparon (flota nueva "Retirada de …" que salta al sistema vecino y no puede ser enganchada 2 min), tropas sin transporte mueren, botín (ver §7) y se guarda el **informe**.
6. **Enfriamiento** 25 s por sistema antes de poder iniciar otra batalla.

## 2. El simulador
- **Arena** 1000×560. Bando A entra por la izquierda, B por la derecha. Planetas/estaciones son entidades estáticas del lado defensor.
- **Entidad** = 1 a pocas unidades iguales (`_chunks`): 3 por entidad si son cazas/drones, 2 si `size < 4`, **1 nave = 1 entidad** desde corbeta hacia arriba. Escalado global si pasa de `MAX_ENTS = 320`. Así una flota de 150 naves se ve como ~120 naves (v2 las agrupaba en ~7 bultos). Pierde unidades según `hp/hpMax`; su daño escala con las unidades que le quedan.
- **Movimiento**: velocidad = `stats.speed × 4.2` u/s. Táctica por *grupo*:
  - `attack`: se acerca hasta su alcance preferido (`pref` = alcance medio ponderado por daño × 0.82; cazas ×0.55) y los cazas orbitan al objetivo corrigiendo la distancia (`radial`) y cambiando de sentido al topar con un borde de la arena (si no se apilaban o se quedaban pegados a la pared).
  - `hold`: no se mueve; dispara a lo que entre en alcance. `kite`: mantiene su distancia ideal alejándose si se acercan. `retreat`: huye hacia su borde y **tras 20 s** (`RETREAT_SPOOL`) salta fuera (los motores de salto cargan mientras le siguen disparando).
  - `focus`: grupo enemigo prioritario (si queda alguno vivo).
  - Selección de objetivo automática: el más cercano; los cazas prefieren cazas; armas anticapital prefieren naves grandes.
- **Armas** (`WEAPON`): alcance real, cadencia y proyectil.

  | tipo | alcance | cadencia | calor/disparo | proyectil |
  |---|---|---|---|---|
  | laser | 330 | 1.0 s | 0.018 | rayo instantáneo (precisión por sensores) |
  | **pulso** (láser de pulsos) | 290 | 0.35 s | 0.0045 | rayo rápido; mismo daño/s con 1/4 de calor |
  | **ion** (cañón de iones) | 300 | 1.2 s | 0.014 | rayo: drena 2.2× el daño del escudo, solo 35 % al casco, 22 % de retrasar las armas del objetivo 0.9 s |
  | canon | 240 | 0.5 s | 0.006 | bala 560 u/s |
  | railgun | 480 | 2.5 s | 0.030 | bala 1000 u/s |
  | misil | 540 | 3.0 s | 0.012 | misil guiado 170 u/s (interceptable) |
  | **enjambre** | 470 | 4.0 s | 0.020 | salva de **5 misiles** pequeños en abanico (daño/5 c/u) que saturan la defensa puntual |
  | torpedo | 440 | 5.0 s | 0.030 | misil lento 100 u/s, daño ×`antiCapital` |
  | plasma | 180 | 1.4 s | 0.050 | bala 300 u/s |
  | maw (criaturas) | 150 | 3.5 s | 0 | mordisco con salpicadura 40 % a 70 u |
  | spit (criaturas) / bat (baterías, estaciones) | 360 / 400 | 2.2 / 2.0 s | 0 | bala |

  Daño por disparo = `dmg × bandaRango × dpsK × cadencia × unidades × anticapital × (0.3 + 0.7·módulo_armas)`, con `dpsK = DPS_K(0.05) × clamp(55 / unidades_totales, 0.17, 1)` (**saturación del campo de batalla**: con más naves hay fuego cruzado, objetivos tapados y sobredaño, así un duelo de 20 naves dura minutos y una flota de 300 llega a ~30 min). La *banda de rango* reutiliza el array `range[3]` del componente (lejos >350 / medio 150-350 / cerca <150), conservando el equilibrio de la versión por rondas. Fiabilidad = probabilidad de disparar en cada ciclo.
- **Puntería**: error lateral = `(1 − precisión) × 0.5 × distancia`; precisión = `0.8 + (sensores − ecm)×0.01/NUM_K − (1 − módulo_sensores)×0.25` (0.25-0.97), −12 % en nebulosa, ×0.6 contra cazas desde naves grandes. Las balas **colisionan físicamente** con cualquier enemigo del trayecto (un disparo fallado puede dar a otro).
- **Daño**: 1) escudo (reserva = `shield × unidades × 6`, regenera 0.3 %/s): absorbe 100 % energía, 50 % explosivo, 30 % cinético. 2) casco con mitigación `K/(K+def)`, `K = (10·size+20)·NUM_K`, def = blindaje (cinético), blindaje×0.5 (explosivo) o ×0.4 (energía).
- **Defensa puntual (PD)**: cada ciclo, intercepta misiles enemigos en 190 u (prob. `pd×unidades×0.018/NUM_K`, máx. 55 %; /1.5 vs torpedos; cada misil de un enjambre se intercepta por separado) y dispara a cazas en 150 u.
- **Portanaves**: lanzan 3 escuadrones de cazas (entidades `strike`, no cuentan como bajas ni supervivientes).
- **Calor (v3)**: cada disparo suma `heat` a la nave (tabla de armas). Enfría `0.014·√(size/4)·(1+radiadores/(12·NUM_K))` por segundo. Por encima de 0.8 la cadencia cae un 25 %; al llegar a 1 las **armas se bloquean** (evento `hot`) hasta bajar de 0.55 (ventila ×1.5 más rápido). Criaturas, estaciones y cazas lanzados no tienen calor. Los **radiadores** (rama Sistemas) y las armas frías (pulsos, cañones, misiles) lo evitan; el plasma y los láseres en masa se bloquean.
- **Módulos (v3)**: cada nave tiene `mod{motor, arms, sens}` (1 = intacto). Cada impacto al casco (tras el blindaje) daña un módulo al azar (45 % armas, 30 % motor, 25 % sensores) en `daño/hpMax×2.2`. Motor → velocidad ×(0.35+0.65m); armas → daño ×(0.3+0.7m); sensores → puntería. Evento `mod` al bajar de 50 %.
- **Rendición (v3)**: un barco no-caza con <20 % de casco y armas <40 % o sobrecalentado, con enemigos a <300 u, arría bandera con 6 %/paso (evento `surr`). Sale del combate, **se pierde para su dueño** y el vencedor se queda con el **50 % de su valor** (`battles.salvage`). No se rinden criaturas, estaciones ni quien está en retirada.
- **Especiales**: `regen` (0.1 %/s del casco), `emp` (cada 14 s: escudos ×0.15 y armas +2.5 s de enfriamiento en 300 u).
- **Entornos**: `asteroids` (7 rocas en el centro que bloquean balas y misiles, no rayos), `nebula` (alcance ×0.72, −12 % puntería, regeneración de escudos ×0.5, −15 % velocidad), `blackhole` (atracción en 250 u y destrucción a <22 u).
- **Fin**: sin entidades activas (cuentan refuerzos pendientes). Tiempo máx. `GD.RULES.battleMaxSeconds` = **1800 s**: gana el bando con ≥1.12× casco restante; el que no gana **rompe contacto** (se retira). Empate → ambos se retiran.

## 3. Determinismo (¡importante!)
Mismo `setup` + mismas órdenes (mismo `tick`) + mismos refuerzos = mismo resultado. Solo se usan `+ − × ÷ √` y un RNG mulberry32. No metas `Math.random`, `Math.sin/cos/atan2` ni orden de iteración no determinista en `step()`.
La **repetición** (`replayFrom` + `replayStep`) vuelve a simular en el navegador con `report.simSetup`, `report.orders`, `report.reinf`.

## 4. Frame (snapshot)
```js
{ t, tick, gv, ents:[[id,gid,esStrike,x,y,hx,hy,hp%,escudo%(-1 si no tiene),unidades,flags(1=retirada),radio, calor%, bloqueada(0/1), motor%, armas%, sensores%]],
  projs:[[id,0 bala|1 misil,x,y,vx,vy,grande,colorCode]], ev:[...eventos], over, hp:{A,B}, orders:[[gid,tactic,focus]] }
```
Eventos: `fire, beam{f,t,c,h}, melee, hit{x,y,c,big}, shhit/shdown{t}, icpt{x,y}, rock, boom{id,x,y,s,dv}, emp{x,y}, escape, launch, reinf, over`, y (v3) `hot{id}`, `cool{id}`, `mod{id,m}`, `surr{id,x,y}`.
Colores de proyectil (`COLOR_CODE`): tracer 0, rail 1, plasma 2, missile 3, torpedo 4, laser 5, maw 6, **ion 7, pulse 8, swarm 9**. Ancho de banda: un frame de 230 entidades ≈ 10 KB (2 por segundo y espectador).
Los grupos (`groupsMeta`) se envían aparte (`battle:groups`) cuando cambia `gv` (refuerzos).

## 5. Órdenes (API)
Acción `battleCmd` → `Battles.command(nationId, battleId, {fleetId|gid|all, tactic?, focus?})`. Solo se puede mandar lo propio. `focus: null` = objetivo automático.
Bots/NPC: `autoCommand` cada 5 s (piratas se retiran con <22 % de ventaja; criaturas nunca; bots según `ai.retreatAt`).

## 6. Visor 3D (`battle3d.js`)
- Frames con *jitter buffer* (retardo 620 ms) e interpolación de posición/rumbo; las naves se inclinan al girar.
- Modelos de `ships3d.js` **fusionados** (1 malla por material) y clonados por instancia; criaturas con animación propia (sin fusionar).
- Efectos: rayos, trazadoras, misiles con estela, destellos, anillos, chispas, humo en naves <45 % de casco, fuego <22 %, explosión con restos y cadena de secundarias en naves grandes, pulso EMP, warp de escape, burbuja de escudo que se enciende al recibir impactos, barras de casco/escudo, contador "×N".
- Cámara automática que encuadra la acción (se desactiva al tocar; botón para reactivar), sacudida con explosiones, desplazamiento por el panel inferior en móvil.

## 7. Botín y recompensas (`battles.rewards`)
- Piratas: 60 % del coste de las unidades destruidas. Criaturas: `GD.HULLS[h].bounty` por unidad (créditos, recursos raros, puntos de investigación). Guarida destruida: ₡220 000×nivel (22 000 base ×10) + cristales/compuestos.
- **Rendidos** (`battles.salvage`): el vencedor cobra el 50 % del coste de cada barco que arrió bandera, repartido por daño causado.
- Se reparte **por daño causado** entre los no-NPC del bando contrario.

## 8. Balance: perillas
`DPS_K` (velocidad global de la batalla), la saturación (`55`, `0.17`), `SHIELD_POOL`, `SHIELD_REGEN`, `HEAT_COOL/HEAT_RESUME/HEAT_THROTTLE`, `MOVE_K`, `RETREAT_SPOOL`, `MAX_ENTS`, tabla `WEAPON` (con `heat`), `BattleSim.maxTime`, `GD.RULES.battleMaxSeconds`.
Referencia v3 (`battle.test.js`, semilla 11): 5 cazas vs 5 cazas ≈ 6 min; 4 corbetas vs 12 cazas ≈ 5 min; 6 corbetas+8 cazas vs 3 fragatas ≈ 3.5 min; 2 cruceros vs 10 corbetas ≈ 40 s (los cruceros son muy superiores);
flotas medias 48 vs 48 ≈ 20-26 min; **150 vs 150 (234 entidades) ≈ 30 min** (llega al tope y gana quien tenga más casco). CPU: ~0.2 s por **toda** la batalla de 30 min en un PC normal (peor paso 1 ms): el servidor aguanta decenas de batallas.
El laboratorio visual `/dev-battle.html` incluye los escenarios "BATALLA MASIVA 150 vs 150" (usa ×4/×8), "Armas nuevas" y "Calor".
