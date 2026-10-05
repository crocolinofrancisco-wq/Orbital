# DECISIONES DE DISEÑO (y por qué)

Registro de decisiones con su justificación. Añade al final lo que decidas; si revocas algo, no lo borres: táchalo y explica por qué.
Formato: **Decisión** — *Por qué* — *Alternativas descartadas*.

> Nota de honestidad: la carpeta `docs/` estaba vacía cuando continué el desarrollo (la fase 1 la hizo otra IA, Genspark).
> Las decisiones de la **Parte A** las he **deducido leyendo el código y las capturas**; las de la **Parte B** son mías (sesión 2026-10-04).

---

## Parte A — Fase 1 (heredado, deducido del código)
| # | Decisión | Por qué |
|---|---|---|
| A1 | **Node + Express + Socket.IO, cliente HTML/JS sin build, sin minificar** | El usuario quiere editar el HTML a mano; sin bundler no hay barrera. Tiempo real "gratis" con sockets. |
| A2 | **Servidor autoritativo**: el cliente solo pide acciones | Evita trampas en un juego competitivo y social. |
| A3 | `shared/gamedata.js` = fuente de verdad del balance, cargado en cliente y servidor | Un único archivo que tocar para balancear; el cliente muestra los mismos números que usa el servidor. |
| A4 | Cuentas usuario+contraseña (scrypt), **sin email** | Público de 13-18: no pedir datos personales. Filtro de insultos y límite de mensajes en el chat. |
| A5 | **Mapa como grafo** de sistemas unidos por hiperrutas | Crea fronteras y cuellos de botella con reglas simples; fácil de entender en móvil. |
| A6 | 6 recursos (energía, aleaciones, helio-3, cristales, materia exótica, compuestos) | El original tenía 8; se redujo para que un adolescente los memorice. |
| A7 | Piedra-papel-tijera: ENERGÍA↔escudo, CINÉTICO↔blindaje, EXPLOSIVO↔defensa puntual | "Simple de jugar, difícil de dominar". Inspirado en los vídeos de combate espacial realista de `VideoInspirations/`. |
| A8 | Diseño de componentes con puntos (potencia/fiabilidad/eficiencia) y cascos con ranuras | Conserva lo que más gustaba del original: crear armas propias y venderlas (licencias con regalías del 10 %). |
| A9 | Banderas SVG + "planetball" (bandera en una esfera con ojos) | Guiño a los countryballs. |
| A10 | Iconos SVG procedurales con tokens `:nombre:` en vez de emojis | Pedido explícito del usuario; coherentes con la estética HUD. |
| A11 | Gráficos 3D low-poly con `MeshToonMaterial` + contorno por casco invertido | Estilo pedido; barato para móvil. Convención: proa = +Z. |

---

## Parte B — Sesión v0.2 (2026-10-04)

### B1. Batalla en tiempo real, simulada por el servidor, visible en vivo
**Decisión**: simulación 2D por pasos de 0,5 s (`public/shared/battlesim.js`), 1–5 min reales, con proyectiles físicos, escudos, misiles interceptables, retirada, refuerzos y entornos.
*Por qué*: el usuario se quejó de que las batallas eran "casi instantáneas" y quería ver disparos, explosiones y movimiento. Un modelo por rondas no da eso.
*Por qué 2D y no 3D*: la lógica es más simple, determinista y barata (100 naves); la vista sigue siendo 3D (inclinada), que es lo que importa al jugador.
*Por qué módulo compartido y determinista*: la **repetición** de un informe se obtiene volviendo a simular en el cliente con `{semilla, órdenes}` (unos pocos KB) en vez de guardar cientos de KB de frames por batalla (D1 limita el tamaño). Test: `world.test.js` comprueba que la repetición es idéntica.
*Entidades = "escuadrones"*: una entidad representa varias unidades iguales y pierde unidades al perder casco (200 cazas ≠ 200 objetos). Tope 140 entidades para móvil.
*Duración objetivo*: 1–3 min (tuneada con `tests/battle.test.js`), tope duro de 5 min (`battleMaxSeconds`); al agotarse, el bando que no gana rompe contacto (evita bucles infinitos de reenganche).
*Alternativas descartadas*: simular en el cliente (trampas), por rondas con animación (era lo que había), grabar frames (demasiado peso).

### B2. Órdenes: 4 tácticas + objetivo prioritario (no micro-gestión)
**Decisión**: por escuadrón: **Atacar / Mantener / Distancia / Retirada**, más "concentrar el fuego" tocando un enemigo; botón de **retirada total**.
*Por qué*: es lo máximo que se maneja bien con un pulgar y mantiene el "simple de jugar, difícil de dominar" (cuándo retirarse, a quién disparar, qué armas llevar). Control por *escuadrón/flota*, no por nave.
*Retirada*: carga el salto 12 s *mientras te siguen disparando*; así no es un botón "gratis" y tiene riesgo.
*Humanos desconectados*: su flota pelea en "Atacar" (no se pierde la batalla por no estar). Bots/NPC tienen piloto automático (retirada si van perdiendo).

### B3. Ritmo de temporada: ciclo de 1 h y todo reescalado
**Decisión**: `cycleSeconds = 3600`; saltos 9 min×distancia (portal ×0,4); tiempos de producción ×14, de diseño ×10, tecnologías ×3; protección de novatos 48 h.
*Por qué*: el usuario pide que la partida dure 14–21 días y antes un ciclo era 5 min (el árbol tecnológico se completaba en horas y no había temporada). Con 1 h/ciclo cada sesión corta de móvil (3-5 al día) tiene algo que hacer: cobrar, mejorar, mandar flotas.
*Cómo se valida*: `server/tools/simulate.js` simula una temporada entera en segundos (ver [BALANCE.md](BALANCE.md)). **Límite**: solo se puede validar con jugadores simulados; hay que playtestear con humanos.

### B4. Victoria: última nación **o alianza** en pie; una IA nunca gana
**Decisión**: gana el último grupo (nación sola o todos los supervivientes de una alianza). Si lo que queda son solo IA → temporada **anulada**. Tope duro a 28 días: gana por puntos de dominio (solo humanos).
*Por qué*: lo pidió el usuario (alianzas incluidas). El tope evita temporadas infinitas si hay jugadores pasivos (el usuario dijo "calcula que tarde 14–21 días", no "corta a los 21"; por eso es tope blando y desactivable con `seasonMaxDays: 0`).
*Alianza ganadora con IA aliada*: ganan juntos (las IA no cuentan como ganadoras pero tampoco impiden la victoria).

### B5. Protección de novatos
**Decisión**: 48 h sin poder ser atacado ni declarar guerras; se puede renunciar (`endProtection`). Piratas e incursiones evitan a protegidos.
*Por qué*: nuevos jugadores a mitad de temporada sin esto se quedan sin juego el primer día; es el punto de abandono típico en este género.

### B6. Naciones IA de relleno
**Decisión**: IA completas (mismas acciones que un jugador), 5 personalidades, debilidad **en la lógica** y no en números (ver [IA.md](IA.md)). Etiquetadas "IA" en la UI. Si hace falta sitio para un humano (tope 20 naciones) se retira la IA más débil.
*Por qué*: el usuario quiere naciones relleno "coherentes, inteligentes y capaces de hacer todo lo que hacen los jugadores", pero que nunca ganen "sin debilidad hardcodeada". Transparencia (etiqueta IA) por honestidad con menores y para que el roleplay sepa con quién habla.
*Alternativas descartadas*: bots con bonos negativos de economía (el usuario lo rechazó), bots invisibles que se hacen pasar por humanos.

### B7. Objetos espaciales con efecto de juego (no solo decoración)
**Decisión**: agujeros negros en parejas = **portales** (atajo ×2,5 con riesgo de perder hasta 12 % de la flota; **opt-in**), cinturones de asteroides ricos (yacimiento ×3 + Leviatán guardián), nebulosas (alcance −28 %, puntería −12 %, escudos regeneran la mitad), ruinas (botín único si te quedas 20 min), guaridas pirata. En batalla: asteroides bloquean balas, nebulosa degrada, el agujero negro atrae y devora.
*Por qué*: cada objeto cambia la decisión del jugador (ruta, dónde pelear, qué conquistar). Portales opt-in porque perder naves sin avisar sería frustrante para 13-18.
*Rutas seguras*: `moveFleet` rodea sistemas con enemigos NPC si hay alternativa (evita suicidios involuntarios; lo vi en la simulación: las IA mandaban naves por sistemas con guaridas).

### B8. Piratas y criaturas: enemigos distintos con roles distintos
**Decisión**: piratas (3 clanes con composición propia, guaridas destruibles, **incursiones** que bloquean la economía de un sistema) y criaturas (Leviatán de roca, Medusa de plasma con EMP, Enjambre centinela, y el **Devorador estelar** como jefe de la fase de crisis).
*Por qué*: el usuario echaba de menos piratas ("no vi ninguno") y pidió enemigos ambientales (serpientes gigantes en asteroides). Bug detectado: en el cliente los piratas figuraban como "neutral" (no en guerra), por eso no aparecían en Objetivos ni se podían atacar con el botón; ahora `relation()` devuelve `war` para NPC y siempre son visibles.
*Devorador*: da un motivo para unirse en alianzas a mitad de temporada y evita el "valle" de la fase II.

### B9. Persistencia en Cloudflare D1 vía REST, como *snapshot* troceado
**Decisión**: el mundo (JSON gzip+base64) se guarda en `world_chunks` (trozos ≤ 90 KB) + `world_meta` (puntero a la última versión completa). Escritura en 2 fases; el servidor Node sigue siendo el que corre el juego.
*Por qué*: el usuario eligió D1. El servidor necesita sockets persistentes y estado en memoria, algo que Workers por sí solos no dan bien (haría falta Durable Objects: ver ROADMAP). Con snapshot se migra sin reescribir el juego y la lógica sigue en un solo proceso.
*Límites conocidos*: D1 limita fila (2 MB) y sentencia (100 KB) → troceado; guardado cada 60 s en D1 (cada 20 s en archivo) para no gastar filas escritas. No se pudo probar contra D1 real (sin credenciales): se probó con un D1 simulado (`storage.test.js`). Para >100 jugadores conviene normalizar tablas (ROADMAP fase 3).

### B10. UI de batalla pensada para el pulgar
**Decisión**: overlay a pantalla completa; arriba reloj y barras de casco; abajo panel con **tus escuadrones**, 4 botones grandes y chips de enemigos; tocar una nave de la escena también selecciona/marca. Aviso rojo "BATALLA — Ver en vivo" en cualquier pantalla. En móvil el encuadre se desplaza para que la acción quede sobre el panel.
*Por qué*: móvil es el foco; el panel inferior es la zona del pulgar. Las naves se dibujan ×1,75 más grandes que su radio real (exageración típica de juegos tácticos) para leerse en pantallas pequeñas. Modelos fusionados por material para mantener los draw calls bajos.

### B11. Cosas que el usuario descartó
- **Idea "mercado negro con calor diplomático"**: *no*. Los demás jugadores son humanos, no se les puede forzar a enojarse; "probablemente no les importaría". Registrado en ROADMAP como descartada. (Las IA tampoco lo usan.)

---
## Fase 3 (v0.3, 2026-10-04): batallas masivas, especialización, guerra terrestre, escala ×10

### C1. Batallas largas y masivas (hasta ~300 naves, hasta 30 min)
**Decisión**: una entidad del simulador es ahora **1 nave** desde corbeta hacia arriba (cazas de 3 en 3); `MAX_ENTS` 140 → 320; `DPS_K` 0.20 → 0.05 y un factor de **saturación del campo de batalla** (`dpsK = DPS_K × clamp(55/unidades, 0.17, 1)`); `battleMaxSeconds` 300 → 1800.
*Por qué*: el usuario pidió "50, 100 o 200 naves y batallas de 30 minutos al menos, más épico". Medido: la duración dependía casi solo de `DPS_K` y no del tamaño (160 vs 160 ≈ 4 min), así que se añadió la saturación (justificada como fuego cruzado/objetivos tapados). CPU no es problema: 30 min de batalla de 234 entidades cuestan ~0.2 s en total. Ancho de banda: ~10 KB/frame × 2/s por espectador.
*Alternativa descartada*: simular cada nave suelta con más resolución (la web móvil sufriría y no cambia el juego).
**D1 no es el cuello de botella**: las batallas viven en RAM; el informe guarda solo `simSetup + orders` (pocos KB) y se re-simula.

### C2. Calor, módulos y rendición
**Decisión**: calor por nave (los disparos calientan; sobrecalentada = armas bloqueadas hasta enfriar), daño por módulos (motor/armas/sensores) y rendición automática de barcos destrozados con botín para el vencedor.
*Por qué*: salen de los videos ("el calor decide la guerra espacial", "lo normal es dejar la nave ciega e inutilizada, no destruirla"), el usuario dijo que no hay que tomárselo a pecho para no aburrir: se implementó como **mecánicas legibles** (barra de calor naranja, icono de vapor, ticker "motores dañados"), no como termodinámica real. Sostiene los combates de 30 min (ritmo propio) y diferencia las armas por algo más que el daño.

### C3. Armas nuevas: pulsos, iones, enjambre, radiadores, artillería de asedio
**Decisión**: 3 armas con identidad (pulso = frío y constante; ion = antiescudos que a veces bloquea armas; enjambre = satura la defensa puntual), un componente de sistema (radiador) y un casco terrestre (artillería de asedio, ×3 contra el generador del escudo).
*Por qué*: el usuario pidió "más tipos de armas y cosas por investigar". Cada una cambia una decisión de diseño (ver tabla en BATALLAS.md). La bomba cinética/relativista de los videos **se omitió** por indicación del usuario (nada de superarmas obligatorias).

### C4. Especialización + comercio de unidades (sin licencias)
**Decisión**: 2 ranuras de especialidad; el resto se compra **ya fabricado**; se eliminó el sistema de licencias de v0.1. Detalle en [ESPECIALIZACION.md](ESPECIALIZACION.md).
*Por qué*: lo pidió el usuario ("es importante que no puedas investigarlo todo… tengas que comprar lo demás a otros"); aclaró dos veces que **no se compra la tecnología ni la licencia: fabrica el otro y te vende**. Crea dependencias y diplomacia entre humanos sin forzar reacciones (compatible con el criterio de B11: nada depende de que un humano se enfade). Las IA también eligen especialidad y comercian, así el mercado nunca está vacío.
*Riesgo conocido*: un jugador sin proveedores queda corto de armas avanzadas; mitigado porque láser, cañón, blindaje, motor, corbeta, caza, transporte e infantería son gratis para todos. El Consorcio no vende unidades (podría hacerlo con precio alto; ver ROADMAP).

### C5. Guerra terrestre como secuencia: bloqueo → bombardeo → escudo → campaña
**Decisión**: ver [GUERRA_TERRESTRE.md](GUERRA_TERRESTRE.md). Invadir deja de ser instantáneo (campaña por rondas de ~20 s, minutos) y aparecen el bloqueo (PIB 0), el bombardeo (precisión vs saturación) y el escudo planetario que obliga a desembarcar.
*Por qué*: los videos insisten en que dominar la órbita casi gana la guerra y que las invasiones tienen sentido solo con escudo/ocultos/captura; además el usuario preguntó cuánto tarda conquistar y cómo son las batallas terrestres (eran un cálculo instantáneo).
*Efecto buscado en el ritmo*: el bloqueo da una forma barata de asfixiar a un rival y debería ayudar a que las temporadas terminen en 14-21 días. **No se pudo validar con humanos** (ver BALANCE.md §5).

### C6. Mapa más grande con regiones, sistemas clave y pasos estratégicos
**Decisión**: `SYSTEMS` 28 → 44 por defecto (hasta 120; nombres con letra griega si faltan); sistemas más juntos al crecer; un **sistema clave** por constelación (+25 % PIB para quien tenga planetas ahí, no se funda capital en él) y marcado de **pasos estratégicos** (`choke`) cuya pérdida parte el mapa.
*Por qué*: el usuario preguntó si el mapa aguanta más países (sí, es procedural) y el video de worldbuilding dice "no diseñes galaxias, diseña regiones y consecuencias; quien controla el paso controla el mundo". 44 sistemas ≈ 175 planetas para 20 naciones.
*Pendiente*: peaje/efecto real de los pasos estratégicos (hoy solo se marcan en los datos).

### C7. Escala numérica ×10 en los datos
**Decisión**: `NUM_K = 10` aplicado al cargar `gamedata.js` (no solo en pantalla). Detalle y lista de fórmulas ajustadas en [ESPECIALIZACION.md](ESPECIALIZACION.md) §4.
*Por qué*: lo pidió el usuario "por estética". Escalar solo la presentación habría dejado inconsistentes los mensajes del servidor y los formularios (precios que escribe el jugador). Comprobado: con `NUM_K=1` salen exactamente los resultados de batalla anteriores.
