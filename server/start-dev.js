/* Arranque de desarrollo: todo el juego va GAME_SPEED veces más rápido y hay IA de relleno.
 *   npm run dev            (velocidad x20)
 *   GAME_SPEED=60 npm run dev
 * En Windows PowerShell:  $env:GAME_SPEED=60; npm run dev                                   */
process.env.GAME_SPEED = process.env.GAME_SPEED || '20';
process.env.AI_COUNT = process.env.AI_COUNT || '8';
process.env.PORT = process.env.PORT || '3100';
require('./index.js');
