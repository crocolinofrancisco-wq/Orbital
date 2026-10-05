# ESPECIALIZACIÓN, MERCADO DE UNIDADES Y ESCALA ×10 (v3)

## 1. No puedes investigarlo todo
Idea del usuario: "te especializas en una rama y después tienes que comprar lo demás a otros". Reglas:
- Cada nación elige **2 especialidades** (`RULES.specSlots`) entre las ramas con `spec: true` de `GD.TECH_BRANCHES`:
  **Energía** (láser, pulsos, iones, plasma, escudos), **Balística** (cañón, riel, blindaje, defensa puntual), **Misiles** (misil, torpedo, enjambre),
  **Sistemas** (sensores, guerra electrónica, radiadores, reactor, hiperimpulsor, nano), **Naves de línea** (fragata…acorazado), **Cazas** (bombardero, drones),
  **Terrestre** (blindado, tanque, artillería de asedio, mecha) y **Orbital** (baterías, escudo planetario). **Economía** es abierta para todos.
- Lo que cuesta 0 PI lo conoce todo el mundo (láser, cañón, blindaje, motor, corbeta, caza, transporte, infantería): nadie queda desarmado.
- Acción `chooseSpec {branches:[a,b]}`. Se puede **corregir mientras no hayas investigado nada** de pago en esas ramas; después queda fija toda la temporada.
- `actResearch` rechaza ramas ajenas. Los requisitos entre ramas se eliminaron (antes `w_plasma` pedía `s_reactor`, etc.) para que ninguna rama dependa de otra.
- La IA elige 2 ramas según su personalidad (`SPEC_PREF` en `ai.js`) y solo investiga ahí.
- La UI: banner "Elige tus 2 especialidades" en Proyectos > Investigación, candados en las ramas ajenas y lista "Especialistas de la galaxia" en el Mercado (quién domina qué).

**Por qué**: crea dependencia entre jugadores (alianzas de especialistas, comercio, chantaje, traiciones) sin forzar nada: es el motor social que pide el público 13-18.
Se evita el "todos investigan lo mismo" y las partidas dejan de ser una carrera por completar el árbol.

## 2. Se compra el producto, no la tecnología (decisión del usuario)
**No hay licencias.** El que sabe fabricar, fabrica y **vende las unidades ya hechas**. Se eliminó todo el sistema de licencias de diseño de v0.1 (`n.licenses`, regalías, ofertas con `designId`).
- `canBuildDesign`: solo tus diseños y los públicos del Consorcio. `canUseComponent`: solo los tuyos y los públicos.
- Una unidad comprada pertenece a un diseño ajeno: `statsOf` la calcula igual y combate normal, pero **no puedes fabricar más** de ese diseño.
- **Mercado** (`w.market`, ofertas `kind:'resource'|'units'`):
  - `marketPost {kind:'units', fleetId, designId, count, price}`: las unidades salen de una flota quieta (depósito/escrow); el **precio es total** del lote.
  - `marketBuy {id, planetId}`: el comprador paga, el vendedor cobra al momento y el pedido viaja desde el sistema del vendedor hasta el planeta elegido
    (`w.deliveries`; tiempo = suma de saltos × `RULES.deliveryJumpFactor`, mínimo 30 s/`GAME_SPEED`). Llega como flota ("Flota de X" / "Guarnición X").
  - `marketCancel`: devuelve las unidades a una flota del vendedor en su sistema.
  - Se pueden **revender** unidades compradas.
- Entregas: no son interceptables (v3); si el planeta destino cae, llegan a la capital o a otro planeta.
- IA (`sellUnits`/`buyUnits`): venden excedentes (30 % de un lote ≥10) con margen 15-40 %; compran cascos que no pueden fabricar si les sobra dinero y la relación poder/precio es buena.
- Objetivos del jugador: "Vende unidades" (`flags.soldUnits`), "Compra unidades" (`flags.boughtUnits`), "Elige especialidades".

## 3. Armas nuevas y calor (ver [BATALLAS.md](BATALLAS.md))
Láser de **pulsos** (poco calor), cañón de **iones** (drena escudos), misiles en **enjambre** (saturan la defensa puntual), **radiadores** (disipan calor) y artillería de asedio (terrestre).

## 4. Escala ×10 (estética)
Todas las cantidades se multiplican por `GD.NUM_K = 10` **al cargar `gamedata.js`**: créditos, recursos, PI, población, puntos de casco, daño, blindaje, escudo, sensores, disipación, costes, mantenimientos, botines.
Se hizo en los **datos** (no solo en pantalla) para que lo que ves sea exactamente lo que usa el servidor (mensajes, precios, entradas de formularios) sin conversiones.
- NO se escalan: tiempos, velocidades, unidades (cuántas naves), porcentajes, puntos de diseño (potencia/fiabilidad/eficiencia), ratios.
- Las fórmulas que mezclan una cantidad con una constante se ajustaron: `K` de mitigación (`(10·size+20)·NUM_K`), defensa puntual y puntería (`/NUM_K`), enfriamiento, estaciones de guarida, defensas planetarias,
  dureza del bombardeo, generadores de escudo, puntuación de temporada (`season.js`), umbrales de las IA (`ai.js`), potencia estimada de defensas (`npcs.js`), precios por lote del Consorcio, límites de compra.
- `DPS_K` **no** se divide: daño y vida suben a la vez, la duración de las batallas no cambia.
- `BattleSim.NUM_K` (en `battlesim.js`) debe ser igual a `GD.NUM_K`: `battle.test.js` lo comprueba.
- Cambiar `NUM_K` a 1 devuelve la escala original (comprobado: mismos resultados de batalla). Cambiarlo requiere subir `WORLD_VERSION`.
