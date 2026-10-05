# NACIONES IA DE RELLENO

Código: [`server/ai.js`](../server/ai.js). Se crean al empezar el mundo (`AI_COUNT`, por defecto 9; la partida típica busca ~10 naciones, tope 20).
Son naciones **completas** (`n.bot = true`, `n.ai = {...}`) que llaman a `handleAction` igual que un jugador: mismas reglas, costes y tiempos. **No hacen trampas ni tienen bonos.**

## 1. Qué hacen (todo lo que hace un jugador)
| Área | Comportamiento |
|---|---|
| Economía | Controlan impuestos (bajan si hay inestabilidad, suben con superávit). Construyen extractores (más si falta ese recurso), plantas, fábricas, comercio, laboratorios, vivienda, y según personalidad baterías/escudos. Mantienen una reserva de créditos. Venden excedentes enormes al Consorcio. |
| Investigación | Eligen **2 especialidades** según personalidad (`SPEC_PREF`) y solo investigan ahí, con pesos de rama y ruido. |
| Proyectos | Diseñan **componentes** con puntos razonables (no óptimos) y **naves** rellenando ranuras con lo que tienen; **venden unidades** excedentes en el Mercado (personalidades sociales) y **compran** cascos que no pueden fabricar si les sobra el dinero. |
| Producción militar | Mantienen un poder objetivo que crece con planetas y con el avance de la temporada; fabrican por relación poder/coste con ruido; guarnecen con infantería. |
| Expansión | Anexan planetas libres; envían una "Colonizadora" (2 cazas) a sistemas cercanos **sin enemigos**; se detienen al superar el apetito (ver §3). |
| Guerra | Declaran guerra con prudencia, preparan transportes+tropas, invaden por misión, piden la paz si van perdiendo o la guerra se alarga; acuden a defender sistemas amenazados solo si creen ganar. Cazan piratas/criaturas cercanas con ventaja clara. |
| Diplomacia | Aceptan/rechazan ofertas (comercio justo, paz, invitaciones), fundan alianzas e invitan, ofrecen intercambios de excedente por faltante, y los **oportunistas** pueden traicionar a un aliado débil. |
| Chat | Mensajes ocasionales en el global (etiquetados "IA"). |

## 2. Personalidades
`mercader`, `cientifico`, `tortuga`, `oportunista`, `belicista` (ver `PERSONAS`): pesos de economía/ciencia/militar/sociabilidad/defensa/agresión/traición.
Se reparten en rotación al crear los bots. El nombre y el lema de cada IA muestran su rol ("· IA Mercader").

## 3. Por qué nunca ganan (debilidad en la lógica, no en números)
1. **Información limitada**: solo ven lo que su niebla de guerra permite; estiman el poder enemigo con ruido ±20-40 %.
2. **Atención limitada**: piensan cada 4-10 min y hacen 3-6 acciones por turno.
3. **Prudencia**: no atacan sin ~2.2× de superioridad estimada, solo mantienen una guerra ofensiva y no atacan al jugador más fuerte (si hay >1 humano). Cooldown de 36 h entre guerras. Nada de guerras el primer día.
4. **Apetito acotado**: dejan de expandirse al superar la media humana (`planetas ≥ mediana_humana×1.25+2`) o el techo `3 + 10×progreso`.
5. **Diseños mediocres**: reparten puntos sin explotar contrapartidas y no eligen armas según la flota rival.
6. **Se retiran pronto** en batalla (`retreatAt` 30-45 %) y **aceptan la paz con facilidad**.
7. **Salvaguarda final** (`season.js`): si solo quedan IA, la temporada se anula; una IA jamás figura como ganadora.
Ajuste global: `AI_SKILL` (0-1, por defecto 0.55): reparte la competencia entre 0.8× y 1.2× por bot.

## 3b. Guerra terrestre (v3)
`campaigns()`: elige asedio/asalto según la ventaja y se retira si pierde. La misión de invasión bombardea (precisión) antes de desembarcar. No eligen el modo de bombardeo ni usan el bloqueo a propósito (aunque una flota quieta lo provoca).

## 4. Transparencia
La UI etiqueta las naciones IA (`:robot: IA`) en rankings, listas, chat y fichas. Un humano puede aceptar o ignorar sus ofertas como las de cualquiera.
Si hace falta sitio para un jugador nuevo con 20 naciones, se **retira la IA más débil** (`makeRoomForHuman`, sus planetas quedan independientes).

## 5. Herramientas y depuración
- `AI_DEBUG=1 node server/tools/simulate.js ...` imprime las decisiones de guerra de la IA.
- `simulate.js` también crea "jugadores simulados" (`persona 'jugador'`, ambiciosos y sin las limitaciones de prudencia) para medir el ritmo de la temporada.
- Contadores de acciones y errores al final de la simulación: revisa siempre los errores más comunes (señalan lógica rota de la IA).

## 6. Limitaciones conocidas / mejoras
- El pipeline de invasión (producir transporte+tropas, juntarlos, viajar) es el punto más frágil: muchos intentos de `embark` fallan por falta de tropas/transportes en el sistema.
- Las IA no usan portales ni responden a mensajes privados; no coordinan ataques entre sí.
- No adaptan sus diseños a lo que usa el enemigo (a propósito).
- Idea: que las IA reaccionen al chat (respuestas simples) y a las ofertas con contraofertas.
