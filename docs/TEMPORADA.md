# TEMPORADA, RITMO Y VICTORIA

Código: [`server/season.js`](../server/season.js) · reglas en `GD.RULES` (`public/shared/gamedata.js`) · estado en `world.season`.

## Objetivo
Una temporada (partida) debe **terminar de forma natural en 14-21 días**. No hay un reloj que la corte a los 21 días: termina cuando se cumple la condición de victoria; el balance (economía, tiempos, distancias, piratas, crisis) está calibrado para que eso ocurra en esa ventana. Existe un **tope duro de 28 días** (`seasonMaxDays`; `0` lo desactiva) por si hay jugadores pasivos.

## Victoria
- Gana la **última nación o la última alianza en pie**: se agrupan los supervivientes (cada alianza es un grupo; sin alianza = grupo propio). Si solo queda 1 grupo y tiene algún humano → `status: 'ended'`, `winner`.
- **Una IA no puede ganar**: si lo que queda son solo naciones IA → `status: 'void'` (temporada anulada) con noticia.
- Tope de 28 días: gana el grupo humano con más **puntos de dominio** (`Season.score`): planetas×120 + población×10 + PIB/120 + técnicas×12 + poder de flota/150 (+20 si ganó una batalla); con la escala ×10 de v3 se divide población, PIB y poder entre `NUM_K` (la puntuación es la misma).
- Al terminar, `handleAction` rechaza todo con "La temporada terminó"; el cliente muestra el modal de victoria con el ranking final.
- Siguiente temporada: `POST /api/admin/new-season {key}` (mundo nuevo, conserva cuentas, `season.number++`). `POST /api/admin/reset` borra todo.
- La comprobación se hace tras cada eliminación y cada ciclo (`Season.check()`).

## Fases (según progreso = días/`seasonDays`)
| Fase | Rango | Qué pasa |
|---|---|---|
| I · Expansión | 0-28 % (≈ días 0-5) | Se anexan planetas libres, protección de novatos, piratas débiles. Las IA no atacan el primer día. |
| II · Conflicto | 28-62 % (≈ 5-11) | Se acaban los planetas libres, guerras, incursiones frecuentes. |
| III · Crisis | 62-100 % (≈ 11-18) | Despierta el **Devorador estelar**; el nivel de los piratas llega a 4-5. |

## Protección de novatos
48 h desde la creación (`protectionHours`): nadie puede declararte la guerra ni invadirte, y tú no puedes declarar guerras; piratas/Devorador evitan sus sistemas. Se puede renunciar (acción `endProtection`, botón en Imperio). La UI muestra el contador y los escudos en las listas.

## Colapso del gobierno (acelera el final)
Si **cae la capital** de una nación que aún tiene más planetas, su gobierno se tambalea durante `govCollapseHours` (6 h): cada ciclo cada planeta tiene un `govCollapseChance` (22 %) de **rebelarse** y pasar a ser independiente (se puede anexar). Se detiene nombrando una **nueva capital** (Imperio > Planetas, acción `setCapital`; las IA lo hacen solas). Efecto buscado: tomar la capital pesa mucho y las naciones no se eternizan defendiendo colonias sueltas, lo que ayuda a que la temporada termine en 14-21 días. Valores en `GD.RULES`.

## Bloqueo y conquista (v3)
Una flota armada quieta sobre un planeta enemigo lo **bloquea** (PIB 0, estabilidad -5/ciclo): asfixiar a un rival ya no exige invadir. La conquista es una campaña por rondas (ver [GUERRA_TERRESTRE.md](GUERRA_TERRESTRE.md)). Los **sistemas clave** (+25 % PIB) de cada región son los puntos más disputados.

## Ritmo (valores por defecto, `GAME_SPEED=1`)
| Concepto | Valor |
|---|---|
| Ciclo económico (PIB, investigación, producción de extractores) | **1 hora** (`cycleSeconds`) |
| Salto hiperespacial (velocidad 5) | 540 s × factor de distancia (0.6-2.2); portal ×0.4; cruzar el mapa ≈ 1 h |
| Fabricar unidades | `H.build × 14` s por unidad (escala `count^0.75`): corbeta ≈ 10 min, acorazado ≈ 75 min |
| Diseñar nave / componente | `devMinutes × 10` / `total/8 × 6` min: crucero 3 h, acorazado 5 h |
| Árbol tecnológico | costes ×3 (`TECH_COST_K`); con la especialización solo se llega al 23-55 % del árbol |
| Batalla | 3-6 min (duelos) · 20-26 min (flotas medias) · hasta 30 min (masivas) |
| Campaña terrestre | ~5 min (invasión típica) + bombardeo previo ≤ 4 min |
| Protección de novatos | 48 h |
`GAME_SPEED=N` divide **todos** esos tiempos por N (desarrollo y pruebas).

## Validación del ritmo
`npm run simulate -- --days 28 --bots 9 --humans 6` simula la temporada entera en ~2 min. Ver resultados y límites en [BALANCE.md](BALANCE.md).
