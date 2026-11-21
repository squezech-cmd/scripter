// ============================================================
// GUILTY AS SOCK! — Scripter Edition
// Общий сервер игры: раздаёт статику + WebSocket «зал онлайн» + WebRTC-сигналинг.
// HTTPS по умолчанию (нужен для микрофона на телефонах/Wi-Fi).
// Отключить: GAS_HTTP=1 npm start
// ============================================================
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import selfsigned from 'selfsigned';

const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без I, L, O, 0, 1 — чтобы не путать
const ROOM_LEN = 5;
const MAX_CHAT = 140;
const MAX_NAME = 16;
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000; // 3 часа без активности — зал закрывается

// Сертификат для HTTPS: генерируем один раз, кешируем в .cache/
async function getCert(root){
  const dir = path.join(root, '.cache');
  const keyPath = path.join(dir, 'gas-key.pem');
  const certPath = path.join(dir, 'gas-cert.pem');
  try {
    const key = fs.readFileSync(keyPath, 'utf8');
    const cert = fs.readFileSync(certPath, 'utf8');
    if(key.includes('PRIVATE KEY') && cert.includes('CERTIFICATE')) return { key, cert };
  } catch(e){ /* сгенерируем ниже */ }
  const ips = ['127.0.0.1', ...lanIPs()];
  const altNames = [{ type: 2, value: 'localhost' }, ...ips.map(ip => ({ type: 7, ip }))];
  const pems = await selfsigned.generate(
    [{ name: 'commonName', value: 'GUILTY-AS-SOCK-LAN' }],
    { days: 825, algorithm: 'sha256', keySize: 2048, altNames }
  );
  try {
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(keyPath, pems.private, 'utf8');
    fs.writeFileSync(certPath, pems.cert, 'utf8');
  } catch(e){ /* кеш — best effort */ }
  return { key: pems.private, cert: pems.cert };
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.mjs':  'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.map':  'application/json; charset=utf-8',
};

export function lanIPs(){
  const out = [];
  try{
    for(const list of Object.values(os.networkInterfaces())){
      for(const ni of list || []){
        if(ni && ni.family === 'IPv4' && !ni.internal) out.push(ni.address);
      }
    }
  }catch(e){ /* ignore */ }
  return out;
}

const cleanName = (s, fallback='Носок') => {
  const n = String(s ?? '').replace(/[\r\n\t]/g,' ').trim().slice(0, MAX_NAME);
  return n || fallback;
};
const cleanText = (s) => String(s ?? '').replace(/[\r\n\t]/g,' ').trim().slice(0, MAX_CHAT);

function send(ws, obj){
  if(ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch(e){ /* ignore */ }
  }
}

export function createGameServer({ root, port = 8080, host = '0.0.0.0', secure } = {}){
  const gameRoot = root || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

  // ---------- rooms ----------
  const rooms = new Map(); // code -> { code, created, clients: Map(id -> {ws,name,host}), state, votes: Map(id->bool), chat: [], seq }
  let clientSeq = 1;

  function makeCode(){
    for(let tries=0; tries<50; tries++){
      let c = '';
      for(let i=0;i<ROOM_LEN;i++) c += ROOM_ALPHABET[Math.floor(Math.random()*ROOM_ALPHABET.length)];
      if(!rooms.has(c)) return c;
    }
    return null;
  }

  function playerList(room){
    return [...room.clients.values()].map(c => ({ id: c.id, name: c.name, host: !!c.host }));
  }
  function broadcast(room, obj, exceptId = null){
    const payload = JSON.stringify(obj);
    for(const c of room.clients.values()){
      if(c.id === exceptId) continue;
      if(c.ws.readyState === 1) { try { c.ws.send(payload); } catch(e){ /* ignore */ } }
    }
  }
  function votesTally(room){
    const list = [];
    for(const [id, guilty] of room.votes){
      const c = room.clients.get(id);
      list.push({ id, name: c ? c.name : 'Носок', guilty: !!guilty });
    }
    const guilty = list.filter(v=>v.guilty).length;
    return { guilty, innocent: list.length - guilty, voters: list, total: list.length };
  }
  function pushPlayers(room){
    broadcast(room, { t:'players', players: playerList(room) });
  }
  function roomByWs(ws){
    const roomCode = ws._roomCode;
    return roomCode ? rooms.get(roomCode) : null;
  }

  // ---------- static + api ----------
  let server = null;
  let mirrorServer = null;
  let wss = null;
  let scheme = 'http';
  const getPort = () => (server && server.address() ? server.address().port : port);
  const getHttpPort = () => (mirrorServer && mirrorServer.address() ? mirrorServer.address().port : (scheme === 'http' ? getPort() : null));

  const handler = (req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

    if(urlPath === '/api/info'){
      res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
      res.end(JSON.stringify({ name:'GUILTY AS SOCK!', port: getPort(), ips: lanIPs(), secure: scheme === 'https' }));
      return;
    }

    let file = path.join(gameRoot, urlPath === '/' ? 'index.html' : urlPath);
    if(!file.startsWith(gameRoot)) { res.writeHead(403); return res.end('forbidden'); }
    if(fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    if(!fs.existsSync(file)) { res.writeHead(404); return res.end('not found'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(file).pipe(res);
  };

  // ---------- websocket ----------
  const chatLimiter = new Map(); // ws -> [timestamps]
  const ballLimiter = new Map();
  const signalLimiter = new Map();

  function allow(map, ws, count, windowMs){
    const now = Date.now();
    const arr = (map.get(ws) || []).filter(t => now - t < windowMs);
    if(arr.length >= count) { map.set(ws, arr); return false; }
    arr.push(now); map.set(ws, arr); return true;
  }

  const onConnection = (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg = null;
      try { msg = JSON.parse(String(raw).slice(0, 16384)); } catch(e){ return; }
      if(!msg || typeof msg !== 'object') return;
      const name = cleanName(msg.name);

      switch(msg.t){
        case 'create': {
          if(ws._roomCode) break;
          const code = makeCode();
          if(!code) { send(ws, { t:'error', msg:'Залы закончились — попробуй ещё раз' }); break; }
          const room = {
            code, created: Date.now(), state: null, chat: [],
            clients: new Map(), votes: new Map(),
          };
          const id = 'c' + (clientSeq++);
          room.clients.set(id, { id, ws, name, host: true });
          rooms.set(code, room);
          ws._roomCode = code; ws._clientId = id;
          send(ws, { t:'created', room: code, id });
          pushPlayers(room);
          break;
        }
        case 'join': {
          if(ws._roomCode) break;
          const code = String(msg.room || '').toUpperCase().trim();
          const room = rooms.get(code);
          if(!room) { send(ws, { t:'error', msg:'Зал «'+code+'» не найден. Проверь код.' }); break; }
          const id = 'c' + (clientSeq++);
          room.clients.set(id, { id, ws, name, host: false });
          ws._roomCode = code; ws._clientId = id;
          send(ws, { t:'joined', room: code, id, state: room.state, chat: room.chat.slice(-30), votes: votesTally(room) });
          pushPlayers(room);
          broadcast(room, { t:'chat', from:'🧦', text:`${name} вошёл в зал!`, sys:true, ts:Date.now() }, id);
          break;
        }
        case 'state': { // хост шлёт снимок состояния суда
          const room = roomByWs(ws); if(!room) break;
          const me = room.clients.get(ws._clientId); if(!me || !me.host) break;
          room.state = msg.state || null;
          room.lastActivity = Date.now();
          broadcast(room, { t:'state', state: room.state }, ws._clientId);
          break;
        }
        case 'vote': { // голос онлайн-присяжного
          const room = roomByWs(ws); if(!room) break;
          room.votes.set(ws._clientId, !!msg.guilty);
          room.lastActivity = Date.now();
          broadcast(room, { t:'votes', ...votesTally(room) });
          break;
        }
        case 'chat': {
          const room = roomByWs(ws); if(!room) break;
          if(!allow(chatLimiter, ws, 5, 3000)) { send(ws, { t:'error', msg:'Полегче с чатом!' }); break; }
          const text = cleanText(msg.text); if(!text) break;
          const me = room.clients.get(ws._clientId);
          const entry = { from: me ? me.name : 'Носок', text, ts: Date.now() };
          room.chat.push(entry);
          if(room.chat.length > 50) room.chat.splice(0, room.chat.length - 50);
          room.lastActivity = Date.now();
          broadcast(room, { t:'chat', ...entry });
          break;
        }
        case 'ball': { // бросок бумажного комка онлайн-присяжным
          const room = roomByWs(ws); if(!room) break;
          if(!allow(ballLimiter, ws, 1, 4000)) { send(ws, { t:'error', msg:'Комки летят не чаще раза в 4 сек!' }); break; }
          const me = room.clients.get(ws._clientId);
          room.lastActivity = Date.now();
          broadcast(room, { t:'ball', from: me ? me.name : 'Носок' }, ws._clientId);
          break;
        }
        case 'signal': { // WebRTC signalling для голосового чата (data непрозрачна для сервера)
          const room = roomByWs(ws); if(!room) break;
          if(!allow(signalLimiter, ws, 60, 3000)) break;
          const target = msg.to ? String(msg.to) : null;
          const entry = { t:'signal', from: ws._clientId, data: msg.data ?? null };
          if(target){
            const c = room.clients.get(target);
            if(c) send(c.ws, entry);
          } else {
            broadcast(room, entry, ws._clientId);
          }
          break;
        }
        case 'leave': {
          const room = roomByWs(ws); if(!room) break;
          handleDisconnect(ws, room);
          break;
        }
        default: break;
      }
    });

    ws.on('close', () => {
      const room = roomByWs(ws);
      if(room) handleDisconnect(ws, room);
      chatLimiter.delete(ws); ballLimiter.delete(ws); signalLimiter.delete(ws);
    });
  };

  function handleDisconnect(ws, room){
    const id = ws._clientId;
    const me = room.clients.get(id);
    room.clients.delete(id);
    room.votes.delete(id);
    if(me && me.host){
      // Хост ушёл — зал закрывается
      broadcast(room, { t:'closed', msg:'Хост покинул зал. Суд отменяется!' });
      for(const c of room.clients.values()){
        try { c.ws.close(); } catch(e){ /* ignore */ }
      }
      rooms.delete(room.code);
      return;
    }
    broadcast(room, { t:'players', players: playerList(room) });
    broadcast(room, { t:'votes', ...votesTally(room) });
    if(me) broadcast(room, { t:'chat', from:'🧦', text:`${me.name} покинул зал`, sys:true, ts:Date.now() });
    ws._roomCode = null;
  }

  // heartbeat + чистка протухших залов
  let beat = null;
  function startBeat(){
    beat = setInterval(() => {
      if(!wss) return;
      for(const ws of wss.clients){
        if(ws.isAlive === false) { try { ws.terminate(); } catch(e){ /* ignore */ } continue; }
        ws.isAlive = false;
        try { ws.ping(); } catch(e){ /* ignore */ }
      }
      const now = Date.now();
      for(const [code, room] of rooms){
        const last = room.lastActivity || room.created;
        if(now - last > ROOM_IDLE_MS){
          broadcast(room, { t:'closed', msg:'Зал закрыт по таймауту' });
          for(const c of room.clients.values()) { try { c.ws.close(); } catch(e){ /* ignore */ } }
          rooms.delete(code);
        }
      }
    }, 25000);
    beat.unref?.();
  }

  async function start(){
    const wantSecure = secure !== undefined ? !!secure : process.env.GAS_HTTP !== '1';
    if(wantSecure){
      try {
        const { key, cert } = await getCert(gameRoot);
        server = https.createServer({ key, cert }, handler);
        scheme = 'https';
        // HTTP-зеркало только для локали: localhost — и так secure context,
        // а у локального окна EXE/браузера нечему падать на сертификатах.
        // Друзья по LAN продолжают ходить на HTTPS (самоподписанный, одно принятие).
        mirrorServer = http.createServer(handler);
      } catch(err){
        console.warn('[server] HTTPS недоступен (' + err.message + ') — запускаю HTTP (микрофон полноценно работает только на localhost)');
        server = http.createServer(handler);
        scheme = 'http';
      }
    } else {
      server = http.createServer(handler);
      scheme = 'http';
    }
    wss = new WebSocketServer({ noServer: true });
    wss.on('connection', onConnection);
    const upgrade = (req, socket, head) => {
      let pathname = '/';
      try { pathname = new URL(req.url || '/', 'http://127.0.0.1').pathname; }
      catch(e){ try { socket.destroy(); } catch(_){} return; }
      if(pathname !== '/ws'){ try { socket.destroy(); } catch(_){} return; }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    };
    server.on('upgrade', upgrade);
    if(mirrorServer) mirrorServer.on('upgrade', upgrade);
    startBeat();
    const listen = (srv, p, h) => new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      srv.once('error', onError);
      srv.listen(p, h, () => { srv.removeListener('error', onError); resolve(); });
    });
    await listen(server, port, host);
    if(mirrorServer) await listen(mirrorServer, 0, '127.0.0.1'); // случайный свободный, только localhost
    return server;
  }

  async function close(){
    if(beat) clearInterval(beat);
    if(wss) for(const ws of wss.clients) { try { ws.terminate(); } catch(e){ /* ignore */ } }
    if(wss) await new Promise(r => wss.close(() => r()));
    if(server) await new Promise(r => server.close(() => r()));
    if(mirrorServer) await new Promise(r => mirrorServer.close(() => r()));
  }

  return {
    start, close, rooms, port,
    get scheme(){ return scheme; },
    get server(){ return server; },
    get wss(){ return wss; },
    get mirrorServer(){ return mirrorServer; },
    get httpPort(){ return getHttpPort(); },
  };
}
