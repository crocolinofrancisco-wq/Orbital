/* =====================================================================
 * TEMPORADA: ritmo, fases, protección de novatos y condición de victoria
 * ---------------------------------------------------------------------
 * Una temporada busca durar 14-21 días (RULES.seasonDays = 18 de objetivo).
 * NO termina por reloj: termina cuando solo queda UNA nación o UNA alianza
 * en pie. Dos salvaguardas:
 *   - Si lo que queda son solo IA, la temporada se declara "anulada":
 *     una IA nunca puede ganar (ver docs/IA.md).
 *   - Tope duro RULES.seasonMaxDays (28): gana quien tenga más puntos de
 *     dominio (solo jugadores humanos). 0 = sin tope.
 * Fases (según el progreso de la temporada):
 *   I   Expansión  (0-28%)   protección de novatos, piratas débiles
 *   II  Conflicto  (28-62%)  las guerras se calientan, incursiones frecuentes
 *   III Crisis     (62-100%) despierta el Devorador estelar
 * ===================================================================== */
const GD = require('../public/shared/gamedata.js');

let X = null;
function attach(ctx) { X = ctx; }

const DAY_MS = () => 86400000 / X.TS;
const seasonStart = () => X.W().season.startedAt;
/** Días transcurridos (fraccionarios) */
function days() { return Math.max(0, (X.now() - seasonStart()) / DAY_MS()); }
function progress() { return days() / GD.RULES.seasonDays; }
function phase() {
  const p = progress();
  if (p < 0.28) return { id: 1, name: 'I · Expansión' };
  if (p < 0.62) return { id: 2, name: 'II · Conflicto' };
  return { id: 3, name: 'III · Crisis' };
}
function isProtected(n) {
  if (!n || n.npc) return false;
  return X.now() < n.createdAt + GD.RULES.protectionHours * 3600000 / X.TS;
}
function protectedUntil(n) { return n.createdAt + GD.RULES.protectionHours * 3600000 / X.TS; }

/** Puntos de dominio (desempate de fin de temporada y ranking en vivo) */
function score(n) {
  const w = X.W();
  const e = X.computeEconomy(n);
  const planets = Object.values(w.planets).filter(p => p.owner === n.id).length;
  const fleetPower = Object.values(w.fleets).filter(f => f.owner === n.id).reduce((a, f) => a + X.fleetInfo(f).power, 0);
  const K = GD.NUM_K;   // pob., PIB y poder vienen x10
  return Math.round(planets * 120 + e.pop * 10 / K + e.gdp / (120 * K) + n.techs.length * 12 + fleetPower / (150 * K) + (n.flags && n.flags.battleWon ? 20 : 0));
}
function standings() {
  const w = X.W();
  return Object.values(w.nations).filter(n => n.alive && !n.npc).map(n => ({ id: n.id, name: n.name, bot: !!n.bot, alliance: n.alliance, score: score(n) })).sort((a, b) => b.score - a.score);
}

/** Agrupa a los supervivientes: cada alianza es un grupo; sin alianza = grupo propio */
function survivorGroups() {
  const w = X.W();
  const groups = {};
  for (const n of Object.values(w.nations)) if (n.alive && !n.npc) { const k = n.alliance ? 'a:' + n.alliance : 'n:' + n.id; (groups[k] = groups[k] || []).push(n); }
  return Object.values(groups);
}

function end(status, winner, reason) {
  const w = X.W(), se = w.season;
  if (se.status !== 'running') return;
  se.status = status; se.winner = winner; se.reason = reason; se.endedAt = X.now();
  se.final = standings().slice(0, 10);
  X.emit().dirty();
}

function check() {
  const w = X.W(), se = w.season;
  if (se.status !== 'running') return;
  const groups = survivorGroups();
  const humans = Object.values(w.nations).filter(n => n.alive && !n.npc && !n.bot);
  if (!groups.length) return end('void', null, 'Todas las naciones cayeron');
  if (groups.length === 1) {
    const g = groups[0];
    if (!g.some(n => !n.bot)) {
      X.news(':robot: Solo quedan naciones controladas por IA. La temporada queda anulada: ninguna IA puede ganar.', 'victory');
      return end('void', null, 'Solo quedan IA');
    }
    const al = g[0].alliance ? w.alliances[g[0].alliance] : null;
    const winner = al ? { type: 'alliance', id: al.id, name: '[' + al.tag + '] ' + al.name, members: g.map(n => n.id) } : { type: 'nation', id: g[0].id, name: g[0].name, members: [g[0].id] };
    X.news(':crown: ' + winner.name + ' DOMINA LA GALAXIA. ¡Fin de la temporada ' + se.number + '!', 'victory');
    return end('ended', winner, 'Última nación o alianza en pie');
  }
  const max = GD.RULES.seasonMaxDays;
  if (max && days() >= max) {
    const st = standings().filter(s => !s.bot);
    if (!st.length) return end('void', null, 'Sin jugadores');
    // gana el grupo humano con más puntos (una alianza suma a sus miembros humanos)
    const top = st[0];
    const n = w.nations[top.id];
    const al = n.alliance ? w.alliances[n.alliance] : null;
    const winner = al ? { type: 'alliance', id: al.id, name: '[' + al.tag + '] ' + al.name, members: Object.values(w.nations).filter(x => x.alliance === al.id && x.alive).map(x => x.id) } : { type: 'nation', id: n.id, name: n.name, members: [n.id] };
    X.news(':crown: Tope de temporada: ' + winner.name + ' gana por puntos de dominio.', 'victory');
    return end('ended', winner, 'Tope de ' + max + ' días: gana por puntos');
  }
  void humans;
}

/** Resumen para el cliente */
function view() {
  const se = X.W().season;
  const ph = phase();
  return { number: se.number, status: se.status, winner: se.winner, reason: se.reason, endedAt: se.endedAt, startedAt: se.startedAt, day: Math.floor(days()) + 1,
    days: GD.RULES.seasonDays, maxDays: GD.RULES.seasonMaxDays, progress: Math.min(1, progress()), phase: ph, crisis: se.crisis ? { awake: se.crisis.awake, at: se.crisis.at } : null, final: se.final || null };
}

module.exports = { attach, days, progress, phase, isProtected, protectedUntil, score, standings, check, end, view };
