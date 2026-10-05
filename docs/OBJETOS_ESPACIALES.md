# OBJETOS ESPACIALES

Generación: [`server/galaxy.js`](../server/galaxy.js) · Dibujo: `public/js/render3d.js` (`decorateSystem`, `buildSystem`, `makeBlackHole`, `makeBeltRing`, `makeNebulaCloud`, `makeRuinsMarker`, `makeLairMarker`) · Efecto en batalla: `battlesim.js` (`env`).
Con 44 sistemas (por defecto, v3): 2 parejas de agujeros negros, 4 cinturones, 4 nebulosas, 4 ruinas, 4 guaridas pirata, **4 sistemas clave** (uno por constelación) y los **pasos estratégicos** que haya; el resto son estrellas normales (los nombres son reproducibles por semilla). El generador escala hasta 120 sistemas.

| Objeto | Cómo se ve | Efecto en el juego | Efecto en batalla |
|---|---|---|---|
| **Agujero negro** (siempre en pareja) | esfera negra + disco de acreción naranja/violeta + halo; en la galaxia, **arco violeta animado** entre la pareja | Sin planetas. Su **portal** conecta con el otro agujero: salto 2.5× más rápido (peso 0.4) pero cada travesía puede **destruir hasta un 12 %** de la flota. **Opt-in**: las rutas automáticas lo evitan; al mandar una flota, si ahorra ≥20 % se pregunta | Atrae naves a menos de 250 u y las **devora** a menos de 22 u |
| **Cinturón de asteroides** | anillo instanciado de rocas que gira; en el mapa, un campo de rocas | Un "planeta" cinturón (`biome:'asteroides'`): yacimiento **×3** de aleaciones/cristales/exóticos, solo extractores (hasta 5), plantas y baterías. Lo custodia un **Leviatán**: no se puede anexar con él vivo | 7 rocas en el centro que **bloquean balas y misiles** (no rayos) |
| **Nebulosa** | nubes violetas/azules + niebla en la vista de sistema | Aquí merodean **medusas** | Alcance ×0.72, puntería −12 %, velocidad −15 %, escudos regeneran la mitad |
| **Ruinas antiguas** | restos flotantes con baliza dorada | Botín **único** (₡40-70k, 40-80 exóticos, 120-240 PI…) para quien mantenga una flota 20 min sin enemigos; custodiadas por un Enjambre centinela | — |
| **Sistema clave** (v3) | marcado en los datos (`hub`); uno por constelación, el más central y mejor conectado | **+25 % PIB** a los planetas que tengas ahí; no se funda capital en él (se disputa) | — |
| **Paso estratégico** (v3) | marcado en los datos (`choke`) | Si cae, una parte del mapa queda aislada. Hoy solo se marca (idea: peaje) | — |
| **Guarida pirata** | estación octogonal con luz roja | Ver [ENEMIGOS.md](ENEMIGOS.md): botín grande, incursiones | Estación fija con baterías y misiles |

## Notas de implementación
- Un sistema tiene `kind` (`star|blackhole`), `features[]` (`asteroids|nebula|ruins|lair|blackhole`), `portal` (id del otro agujero), `guard` (criatura custodia, privado), `ruin`, `lair`.
  `viewFor` oculta `guard` y el botín de las ruinas al cliente.
- Las capitales no se fundan en sistemas con rasgos peligrosos.
- El **tiempo de salto** depende de la distancia (`jumpFactor`: 0.6-2.2, portal 0.4). `findPath` usa Dijkstra con pesos, evita portales salvo permiso y rodea sistemas con enemigos NPC (`hazardSystems`) si hay alternativa.
- Ideas pendientes: campos de anomalías, restos de naves recuperables, pulsares, tormentas de iones que se mueven (ROADMAP).
