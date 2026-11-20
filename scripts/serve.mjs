// 🧦 GUILTY AS SOCK! — Scripter Edition
// Локальный запуск: `npm start` → http://localhost:8080
// Плюс зал онлайн: друзья заходят на /juror.html по коду комнаты.
import { createGameServer, lanIPs } from '../server/room-server.mjs';

const port = Number(process.env.PORT || 8080);

const game = createGameServer({ port });
game.start().then(() => {
  const ips = lanIPs();
  console.log('');
  console.log('🧦 GUILTY AS SOCK! — Scripter Edition');
  console.log(`   Игра:        http://localhost:${port}`);
  for(const ip of ips) console.log(`   С телефона:  http://${ip}:${port}  (друзья в той же Wi-Fi)`);
  console.log(`   Присяжные:   http://localhost:${port}/juror.html`);
  console.log('');
  console.log('   В игре: 🌐 ИГРАТЬ С ДРУЗЬЯМИ → «Создать зал» → друзьям ссылку и код');
  console.log('   Остановить: Ctrl+C');
  console.log('');
}).catch(err => {
  console.error('Не удалось запустить сервер:', err.message);
  process.exit(1);
});
