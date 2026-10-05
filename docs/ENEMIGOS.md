# ENEMIGOS NPC: PIRATAS Y CRIATURAS

Código: [`server/npcs.js`](../server/npcs.js) · datos en `public/shared/gamedata.js` (cascos `npcOnly`, componentes `pc_*/pe_*/mc_*`, diseños `pd_*/md_*`) · modelos 3D en `public/js/ships3d.js`.
Son dos "naciones" NPC (`n.npc`): `pirates` y `monsters`. **Hostiles con todo el mundo y amigas entre sí** (`atWar`). Siempre visibles en el mapa para todos. Un NPC nunca puede ser objetivo de una declaración de guerra ni recibir ofertas.

## 1. Piratas del Vacío — tres clanes
| Clan | Estilo | Composición (nivel L) |
|---|---|---|
| Cometa Negro | enjambres de cazas baratos | `3+2L` saqueadores, `1+L` cazadores, corsarios y, desde L4, fragata |
| Saqueadores de Helio | misiles + defensa puntual | `1+L` lanzamisiles, corsarios, saqueadores, fragatas desde L3 |
| Hermandad del Vacío | fragatas y destructores | corsarios, fragatas, destructores desde L3 y **acorazado** del Señor Pirata en L5 |

- **Nivel de amenaza** (1-5): sube con el avance de la temporada (`threatLevel`). Siempre hay bandas débiles para novatos (variación aleatoria −1/+1).
- **Patrullas**: flotas en sistemas libres corrientes (sin rasgos, no adyacentes a capitales). Objetivo: `0.9×naciones` (3-9).
- **Guaridas** (`system.lair`): estación fija en la periferia con casco 2600, escudo, PD, baterías y misiles; flota de guardia que se rearma a las 6 h. Destruir la estación da ₡22 000×nivel + recursos y los piratas tardan 48 h en reconstruirla (nivel +1).
- **Incursiones** (a partir del día 2, cada 8-16 h, más frecuentes con los días): una flota sale de una guarida hacia uno de los 3 sistemas peor defendidos con planetas de una nación **sin protección**. Avisa a los dueños. Si se queda en órbita **bloquea el PIB** de ese sistema (`NPC.blockaded`). Se dispersa sola a las 14 h.
- **Rutas**: las flotas de jugadores/IA evitan por defecto los sistemas con NPC (`hazardSystems`).

## 2. Criaturas
| Criatura | Dónde | Habilidad | Botín por unidad |
|---|---|---|---|
| **Leviatán de roca** (10 000 PV, mandíbulas 3.5 s + escupe-plasma, regenera) | guardián de cada **cinturón de asteroides** | mordisco con salpicadura | ₡36 000, exóticos 40, cristales 60, 60 PI |
| **Enjambre centinela** (22+8L drones) | custodia **ruinas** | volumen y velocidad; la PD los destroza | ₡260/dron |
| **Medusa de plasma** (7 000 PV, escudo) | nebulosas; **merodea** a sistemas libres vecinos cada 6-12 h | **pulso EMP** cada 14 s (escudos ×0.15) | ₡16 000, energía 120, helio-3 80, 30 PI |
| **Devorador estelar** (48 000 PV, regenera, EMP) | **jefe de la fase III**: despierta al 62 % de la temporada y avanza hacia los sistemas habitados sin protección | mandíbulas ×3 + plasma ×3 | ₡120 000, exóticos/cristales 150, compuestos 100, 250 PI |

Reaparecen tras 40 h (Leviatán), 24 h (Medusa) y 20 h (Enjambre) de ser destruidos. El Devorador solo aparece una vez por temporada.
Los modelos 3D son animados (serpiente que ondula, medusa que pulsa, tentáculos articulados, drones con rotores).

## 3. Balance de referencia (`server/tests/tune-npc.js`)
Flota "pequeña" (4 corbetas + 8 cazas) gana a patrullas de nivel 1-2; "media" (fragatas+corbetas+cazas+2 destructores) vence a un Leviatán en ~100 s con bajas; "grande" (3 cruceros+3 destructores+…) lo mata en ~70 s; **2 flotas grandes** hacen falta para el Devorador (~100 s): obliga a coordinarse (alianza).
Si cambias números de NPC, ejecuta `node server/tests/tune-npc.js` y revisa duración/bajas.

## 4. Extender
Nueva criatura: ver recetas en [HANDOFF.md](HANDOFF.md) §7. Ideas: nido de leviatanes que crece si nadie lo mata, mercenarios pirata contratables (ROADMAP), clanes que se pelean entre sí.
