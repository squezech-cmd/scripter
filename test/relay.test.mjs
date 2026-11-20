// 🧪 Headless-тест зала онлайн: хост + присяжный по WebSocket.
// Проверяет: создание/вход в зал, рассылку состояния, голоса, чат, комки, инфо-API и статику.
import { createGameServer, lanIPs } from '../server/room-server.mjs';
import WebSocket from 'ws';

let failed = 0;
const ok = (name, cond) => {
  console.log((cond ? '✅' : '❌') + ' ' + name);
  if(!cond) failed++;
};
const waitFor = (ws, pred, label, timeoutMs = 4000) => new Promise((resolve, reject) => {
  const t0 = Date.now();
  const handler = (data) => {
    let msg = null; try { msg = JSON.parse(String(data)); } catch(e){ return; }
    if(pred(msg)) { cleanup(); resolve(msg); }
  };
  const iv = setInterval(() => {
    if(Date.now() - t0 > timeoutMs) { cleanup(); reject(new Error('таймаут: ' + label)); }
  }, 50);
  const cleanup = () => { clearInterval(iv); ws.off('message', handler); };
  ws.on('message', handler);
});
const connect = (url) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  ws.once('open', () => resolve(ws));
  ws.once('error', reject);
});

const game = createGameServer({ port: 0, host: '127.0.0.1' });
await game.start();
const port = game.server.address().port;
const url = `ws://127.0.0.1:${port}/ws`;
console.log(`— тестовый зал на порту ${port} —`);

// --- инфо-API ---
const info = await fetch(`http://127.0.0.1:${port}/api/info`).then(r => r.json());
ok('/api/info отдаёт JSON с ips и port', info && Array.isArray(info.ips) && typeof info.port === 'number');
ok('lanIPs() возвращает массив', Array.isArray(lanIPs()));

// --- статика ---
const html = await fetch(`http://127.0.0.1:${port}/`).then(r => r.text());
ok('index.html отдаётся сервером', html.includes('GUILTY'));
const juror = await fetch(`http://127.0.0.1:${port}/juror.html`).then(r => r.text());
ok('juror.html отдаётся сервером', juror.includes('ЗАЛ СУДА'));

// --- хост создаёт зал ---
const host = await connect(url);
host.send(JSON.stringify({ t:'create', name:'Хост' }));
const created = await waitFor(host, m => m.t === 'created', 'created');
ok('хост создал зал, код из 5 символов', /^[A-Z2-9]{5}$/.test(created.room || ''));
const room = created.room;

// --- присяжный присоединяется ---
const juror2 = await connect(url);
juror2.send(JSON.stringify({ t:'join', room, name:'Вася-Присяжный' }));
const joined = await waitFor(juror2, m => m.t === 'joined' || m.t === 'error', 'joined');
ok('присяжный вошёл в зал', joined.t === 'joined');
const playersMsg = await waitFor(host, m => m.t === 'players' && m.players.length === 2, 'players');
ok('хост видит обоих игроков', playersMsg.players.length === 2 && playersMsg.players.some(p => p.host));

// --- состояние суда доходит до телефона ---
host.send(JSON.stringify({ t:'state', state: { caseTitle:'Кража носка', phase:'voting', pros:12, def:9, chaos:30, caseNum:2 } }));
const stateMsg = await waitFor(juror2, m => m.t === 'state', 'state');
ok('снимок состояния дошёл до присяжного', stateMsg.state && stateMsg.state.caseTitle === 'Кража носка');

// --- голоса (подписываемся до отправки, чтобы не пропустить рассылку) ---
const votesOnJurorP = waitFor(juror2, m => m.t === 'votes', 'votes-juror');
const votesOnHostP = waitFor(host, m => m.t === 'votes', 'votes-host');
juror2.send(JSON.stringify({ t:'vote', guilty: true }));
const votesOnJuror = await votesOnJurorP;
ok('присяжный видит счёт голосов (1 виновен)', votesOnJuror.guilty === 1 && votesOnJuror.innocent === 0);
const votesOnHost = await votesOnHostP;
ok('хост видит голос присяжного по имени', votesOnHost.voters?.[0]?.name === 'Вася-Присяжный' && votesOnHost.voters[0].guilty === true);

// --- чат ---
juror2.send(JSON.stringify({ t:'chat', text:'Виновен, конечно!' }));
const chatOnHost = await waitFor(host, m => m.t === 'chat' && m.text === 'Виновен, конечно!', 'chat-host');
ok('сообщение из чата дошло до хоста', chatOnHost.from === 'Вася-Присяжный');
juror2.send(JSON.stringify({ t:'chat', text:'<script>alert(1)</script>' }));
const chatScript = await waitFor(host, m => m.t === 'chat' && m.text.includes('script'), 'chat-sanitize');
ok('чат не рушится на HTML (экранирует клиент)', typeof chatScript.text === 'string');

// --- комок долетает до хоста ---
juror2.send(JSON.stringify({ t:'ball' }));
const ballOnHost = await waitFor(host, m => m.t === 'ball', 'ball');
ok('комок от присяжного дошёл до хоста', ballOnHost.from === 'Вася-Присяжный');

// --- несуществующий зал ---
const stranger = await connect(url);
stranger.send(JSON.stringify({ t:'join', room: 'ZZZZZ', name:'Тумблинг' }));
const errMsg = await waitFor(stranger, m => m.t === 'error', 'error');
ok('неверный код — понятная ошибка', /не найден/i.test(errMsg.msg || ''));

// --- хост отключается — зал закрыт ---
host.close();
const closed = await waitFor(juror2, m => m.t === 'closed', 'closed');
ok('при уходе хоста присяжный получает «зал закрыт»', !!closed.msg);

await game.close();

if(failed){ console.error(`\nRELAY TEST FAILED: ${failed} проверок(и) упали`); process.exit(1); }
console.log('\nRELAY TEST RESULT: OK');
process.exit(0);
