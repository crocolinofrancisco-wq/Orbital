# TRÁILER (86 s)

Abrir `http://localhost:3100/trailer.html` (con `npm run dev`) y pulsar para empezar. No necesita login ni partida.
Controles: clic/espacio = pausa · `R` = reiniciar · `←/→` = escena anterior/siguiente · `?t=31` empieza en el segundo 31 · `?pause=5` se congela a los 5 s (para capturas).
Para grabarlo como video: pantalla completa (F11) y el grabador de pantalla del sistema. La página mantiene 16:9 con bandas negras en cualquier ventana.

## Guion y tiempos
| Segundos | Escena | Qué se ve | Subtítulo |
|---|---|---|---|
| 0-7 | Título | Mapa estelar tenue, logo y nombre | "Un mapgame espacial" |
| 7-19 | Galaxia | 8 naciones se expanden por 44 sistemas, rutas, convoyes, choques en rojo, sistemas clave con estrella dorada | "Funda tu nación" · "Controla los sistemas clave" |
| 19-31 | Especialización | 8 ramas (iconos reales), se eligen 2 y el resto se bloquea; luego una caja viaja de Vega a ti con precio | "No puedes investigarlo todo" · "Compra armas, no planos" |
| 31-39.5 | Batalla 20 vs 20 | **Simulación real**, visor 3D | "Batallas en tiempo real" |
| 39.5-50.5 | Batalla masiva | 150 vs 150 real, adelantada a los 5 min; HUD con naves y reloj | "Hasta 300 naves por batalla" |
| 50.5-60.5 | Fase tardía | La misma batalla a los 13 min: avisos de sobrecalentamiento, módulos dañados y rendiciones | "Calor, módulos y rendiciones" |
| 60.5-72.5 | Guerra terrestre | Bloqueo, bombardeo, escudo que cae, cápsulas de desembarco; barras de PIB/defensa/escudo/milicia | "Bloquea. Bombardea. Invade." |
| 72.5-80.5 | Social | Chat de alianza y traición + ranking del día 14 de 21 | "Alianzas, traiciones y mercado" |
| 80.5-86 | Final | "Última nación en pie" | — |

## Cómo está hecho
- Un solo archivo, sin build. Reloj maestro `requestAnimationFrame`; cada escena tiene `enter()` y `upd(local, T)`.
- Las batallas crean un `BattleSim` con la misma flota que `dev-battle.html` y lo **adelantan** en silencio (`ffSeconds`) hasta el momento deseado; luego avanza a 5-10× en un `setInterval`.
- Galaxia, guerra terrestre y social son animaciones 2D/HTML con los mismos iconos SVG (`Icons.svg`) y la estética de la UI (bordes finos claros, mayúsculas, Rajdhani). No dependen del servidor, así que los números son ilustrativos (a escala ×10).
- Los subtítulos están en el array `CAPS` al principio del script; cambiar tiempos de escena = editar `SCENES` y `CAPS`.
- Límite conocido: el avance rápido de la simulación bloquea el hilo ~0.2-1 s al entrar en cada corte de batalla.
