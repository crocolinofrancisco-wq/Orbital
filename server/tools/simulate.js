/* =====================================================================
 * SIMULADOR DE TEMPORADA (herramienta de balance, sin servidor ni red)
 * ---------------------------------------------------------------------
 *   node server/tools/simulate.js [--days 20] [--bots 9] [--humans 4] [--skill 0.9] [--seed N] [--dt 20] [--quiet]
 *
 * Simula una temporada completa en segundos: reloj falso (Date.now),
 * naciones IA de relleno y "jugadores simulados" (IA con alta competencia
 * que representan a humanos). Imprime cada día: naciones vivas, planetas,
 * PIB, batallas, piratas/criaturas abatidas, y el resultado final.
 * Sirve para comprobar que el balance cumple el objetivo: la temporada
 * debe tender a terminar entre los días 14 y 21 (docs/BALANCE.md).
 * ===================================================================== */
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 ? Number(args[i + 1]) : d; };
const DAYS = opt('days', 20), BOTS = opt('bots', 9), HUMANS = opt('humans', 4), SKILL = opt('skill', 0.9), DT = opt('dt', 20);
const QUIET = args.includes('--quiet');
process.env.AI_COUNT = String(BOTS);
const S = require('../state.js');
const GD = require('../../public/shared/gamedata.js');
const realNow = Date.now;
let T = realNow(); Date.now = () => T;
const G = require('../game.js');
const w = S.reset(); G.resetBattles();
G.setEmitter({ chat: () => {} });
G.bootstrap({ bots: BOTS });
const humans = [];
for (let i = 0; i < HUMANS; i++) {
  w.users['h' + i] = { id: 'h' + i, username: 'sim' + i };
  const n = G.createNation('h' + i, { name: 'Jugador ' + (i + 1), flag: { layout: 'horizontal', emblem: 'estrella', colors: ['#ffffff', '#3366ff', '#ff3366'] } }, { silent: true });
  G.AI.drive(n, SKILL); humans.push(n);
}
// Contadores de acciones (éxitos y errores) para detectar fallos de la IA
const counts = {}, errs = {};
G.hooks.action = (n, type, r) => {
  const k = (n.bot ? 'ia:' : 'sim:') + type;
  if (r.ok) counts[k] = (counts[k] || 0) + 1; else { const e = k + ' → ' + r.error; errs[e] = (errs[e] || 0) + 1; }
};
const alive = () => Object.values(w.nations).filter(n => n.alive && !n.npc);
const planetsOf = n => Object.values(w.planets).filter(p => p.owner === n.id).length;
let lastDay = -1, battles = 0, origNews = null;
const stats = { monsterKills: 0, lairKills: 0, wars: 0, invasions: 0 };
const startReal = realNow();
const maxTicks = DAYS * 86400 / DT;
for (let i = 0; i < maxTicks; i++) {
  T += DT * 1000;
  G.tick();
  G.regenDefenses();
  const day = Math.floor((T - w.season.startedAt) / 86400000);
  if (day !== lastDay) {
    lastDay = day;
    const a = alive();
    const top = a.map(n => ({ n, p: planetsOf(n) })).sort((x, y) => y.p - x.p).slice(0, 3).map(x => (x.n.bot ? '🤖' : '👤') + x.n.name.slice(0, 12) + ':' + x.p).join(' ');
    const hum = humans.filter(h => h.alive).length;
    if (!QUIET || day % 5 === 0 || w.season.status !== 'running') console.log('día ' + String(day).padStart(2), '| vivas', String(a.length).padStart(2), '(humanos', hum + ')', '| planetas ocupados', Object.values(w.planets).filter(p => p.owner).length + '/' + Object.keys(w.planets).length,
      '| guerras', Object.values(w.wars).filter(x => x.active).length, '| informes', Object.keys(w.reports).length, '| fase', G.Season.phase().name, '| top', top);
  }
  if (w.season.status !== 'running') break;
}
const se = w.season;
console.log('\n=== RESULTADO ===');
console.log('estado:', se.status, '| día final:', Math.floor((T - se.startedAt) / 86400000), '| ganador:', se.winner ? se.winner.name : '-', '| motivo:', se.reason || '-');
console.log('naciones vivas:', alive().map(n => (n.bot ? '[IA] ' : '') + n.name + ' (' + planetsOf(n) + ' planetas)').join(', '));
console.log('ranking:', G.Season.standings().slice(0, 6).map(s => (s.bot ? '[IA] ' : '') + s.name + ' ' + s.score).join(' | '));
console.log('batallas registradas:', Object.keys(w.reports).length, '| tiempo real:', ((realNow() - startReal) / 1000).toFixed(1) + ' s');
if (!QUIET || true) {
  console.log('\nAcciones con éxito:', Object.entries(counts).sort().map(([k, v]) => k + '=' + v).join('  '));
  console.log('Errores más comunes:'); Object.entries(errs).sort((a, b) => b[1] - a[1]).slice(0, 14).forEach(([k, v]) => console.log('  ' + String(v).padStart(5), k.slice(0, 150)));
  const kinds = {}; for (const r of Object.values(w.reports)) kinds[r.kind + ':' + (r.winner === 'A' ? 'A' : r.winner === 'B' ? 'B' : r.winner)] = (kinds[r.kind + ':' + (r.winner === 'A' ? 'A' : r.winner === 'B' ? 'B' : r.winner)] || 0) + 1;
  console.log('informes:', JSON.stringify(kinds), '| noticias de conquista:', w.news.filter(x => x.text.includes('conquist')).length);
  console.log('guerra terrestre:', JSON.stringify(G.Ground.stats));
  console.log('guerra terrestre:', JSON.stringify(G.Ground.stats));
}
Date.now = realNow;
