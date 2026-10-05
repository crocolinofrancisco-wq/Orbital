# GUERRA TERRESTRE (v3): bloqueo, bombardeo y campaña de invasión

Código: [`server/ground.js`](../server/ground.js) (reglas) · [`server/combat.js`](../server/combat.js) (`groundRound`, ronda pura) · `server/game.js` (`actInvade`, `conquerPlanet`) ·
UI: ficha del planeta en [`public/js/views/map.js`](../public/js/views/map.js) (`warPanel`). Prueba: `server/tests/ground.test.js`.

## Por qué existe (justificación)
Los videos de referencia (`VideoInspirations/`) repiten una idea: **quien domina la órbita casi gana la guerra**. Se bloquea el comercio, se bombardea y los planetas se rinden;
las invasiones terrestres solo tienen sentido cuando hay un escudo planetario, el enemigo está escondido, se quiere capturar la infraestructura intacta o hay civiles.
En v0.2 invadir era un cálculo instantáneo de 8 rondas sin decisiones. Ahora es una **secuencia con elecciones** (y minutos de tensión), sin romper la regla del proyecto
de mantenerlo simple de jugar.

## La secuencia
1. **Ganar la órbita** (batalla espacial normal, ver [BATALLAS.md](BATALLAS.md)). Sin naves defensoras ni baterías activas.
2. **Bloqueo** (automático): una flota armada **quieta** en un sistema enemigo, sin ninguna nave del dueño o de sus aliados, bloquea sus planetas:
   PIB = 0 y la estabilidad cae 5 puntos por ciclo. Se calcula cada ~20 s (`refreshBlockades`). Con una batalla en curso en el sistema no hay bloqueo.
3. **Bombardeo** (orden de la flota, `bombard`): cada ronda (20 s / `GAME_SPEED`) debilita al planeta.
   - `ratio = fp / (fp + dureza)`; `fp` = Σ daño×fiabilidad de las armas de la flota; `dureza = (1500 + 200·edificios)·NUM_K + población·500`.
   - Suprime la defensa (`p.supp`, 0-1), reduce la milicia (`p.milFrac`) y mata tropas de la guarnición.
   - **Precisión** (×0.6 de efecto, daños colaterales ×0.2): conserva casi toda la población y los edificios para quien conquista.
   - **Saturación** (×1): rápido, pero reduce población, estabilidad y destruye edificios al azar. *Dilema*: destruir o capturar entero.
   - No se puede bombardear con **defensas orbitales activas** ni con el **escudo planetario en pie**.
4. **Escudo planetario**: tiene "puntos de generador" (`400·NUM_K` por edificio). Solo bajan desembarcando tropas: la mitad del daño de cada ronda va al generador y la
   **artillería de asedio** (casco `artilleria`, rama Terrestre) pega ×3 contra él. Al caer, el escudo queda apagado 6 h y se reactiva a media potencia.
5. **Campaña**: las tropas desembarcadas (`actInvade` → `Ground.land`) quedan en `p.camp` y combaten **una ronda cada ~20 s** contra las guarniciones del sistema
   (flotas quietas del dueño con unidades terrestres) y la milicia (`población × 4 × milFrac`). Defensor +15 %. Ronda pura: `groundRound(atk, def, milicia, {rng, stance, supp, shieldUp})`.
   - `GROUND_RF = 0.04`: fracción del poder que se convierte en daño por ronda (baja = campañas largas; ~5 min para una invasión típica de 40 infantes).
   - Posturas del atacante: **asalto** (daño ×1.35, bajas recibidas ×1.35) y **asedio** (daño ×0.75, bajas ×0.6). La supresión del bombardeo reduce el poder defensivo hasta -60 %.
   - Se puede **reforzar** (más desembarcos del mismo dueño) o **retirarse** (`groundWithdraw`: los supervivientes quedan como guarnición en órbita: sin transporte no se mueven).
   - Termina cuando el defensor no tiene tropas y la milicia está rota (**conquista**: `conquerPlanet`, el planeta pasa al atacante al 30 % de estabilidad y 85 % de población) o el atacante pierde todo (**derrota**).
   - El daño fraccionario se guarda entre rondas (`c.dmg` en la campaña, `f.gdmg` en las flotas defensoras); sin eso las bajas se pierden por redondeo.
6. Si cae una **capital**: `govFallen` (las colonias pueden rebelarse unas horas; ver [TEMPORADA.md](TEMPORADA.md)).

## Misión "Invadir" (automática)
La flota viaja, gana la órbita y, en lugar de desembarcar a ciegas, **bombardea en modo precisión** hasta suprimir ≥45 % la defensa (máx. ~12 rondas ≈ 4 min) y entonces
desembarca. Si hay escudo, desembarca de inmediato para apagarlo. Un jugador puede tomar el control en cualquier momento (parar el bombardeo, cambiar la postura, retirarse).

## Datos
- Planeta: `p.camp = {id, attacker, atk:{designId:n}, start, stance, round, startedAt, log:[{round,atk,def,militia,shield,au,du}], dmg}`, `p.supp`, `p.milFrac`, `p.shieldHp`, `p.shieldDownUntil`.
- Flota: `f.bombard = {planetId, mode, n}`. Informe al terminar: `reports[id] = {kind:'ground', rounds:[...], outcome:'won'|'lost'|'withdraw'|'cancel', start, end, duration}`.
- Vista del cliente: cada planeta visible lleva `p.g = Ground.info(p)` = `{blockade, supp%, militia%, shield:{pct,up}, camp:{attacker, stance, round, au, du, start, log(14)}}`.
- Acciones: `invade`, `groundStance`, `groundWithdraw`, `bombard`, `stopBombard`.
- Variable de entorno `GROUND_ROUND_S` (20): segundos por ronda antes de `GAME_SPEED`.

## IA
`ai.js > campaigns()`: elige asedio si va igualada, asalto con ventaja >1.5×, y se retira si le queda <30 % de las tropas y el defensor tiene más. Las IA no eligen el modo de bombardeo (usan el de la misión: precisión).

## Pendiente / ideas
Mostrar la campaña en el mapa (icono sobre el planeta), reportes terrestres con gráfica en Informes, tropas con experiencia, civiles/rehenes, túneles (enemigo oculto que obliga a reconocer antes de bombardear).
