// 🧦 GUILTY AS SOCK! — Scripter Edition
// Локальный запуск: `npm start` → https://localhost:8080
// HTTPS нужен для голосового чата (браузеры дают микрофон только в защищённом контексте).
// Если что-то не так с сертификатом: GAS_HTTP=1 npm start  (но войса на Wi-Fi не будет)
import { createGameServer, lanIPs } from '../server/room-server.mjs';

const port = Number(process.env.GAS_PORT || process.env.PORT || 8080);

const game = createGameServer({ port });
game.start().then(() => {
  const scheme = game.scheme;
  const ips = lanIPs();
  console.log('');
  console.log('🧦 GUILTY AS SOCK! — Scripter Edition');
  console.log(`   Игра:        ${scheme}://localhost:${port}`);
  for(const ip of ips) console.log(`   С телефона:  ${scheme}://${ip}:${port}`);
  console.log(`   Присяжные:   ${scheme}://localhost:${port}/juror.html`);
  console.log('');
  if(scheme === 'https'){
    console.log('   ⚠️  Сертификат самоподписанный: браузер покажет предупреждение —');
    console.log('      «Дополнительно» → «Перейти на сайт». Так и надо (это локальная игра).');
    console.log('   🎙️  После входа в зал игра сама запросит микрофон — разреши.');
  }
  console.log('');
  console.log('   В игре: 🌐 ИГРАТЬ С ДРУЗЬЯМИ → «Создать зал» → друзьям ссылку и код');
  console.log('   Остановить: Ctrl+C');
  console.log('');
}).catch(err => {
  console.error('Не удалось запустить сервер:', err.message);
  console.error('Порт занят? Попробуй так: GAS_PORT=8081 npm start');
  process.exit(1);
});
