// ============================================================
// GUILTY AS SOCK! — Scripter Edition
// Общий сервер игры: раздаёт статику + WebSocket «зал онлайн».
// Один процесс обслуживает и игру (порт 8080), и комнату друга:
// друзья с телефонов заходят на /juror.html, вводят код зала
// и голосуют, кидают бумажные комки и пишут в чат прямо из суда.
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const ROOM_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // без I, L, O, 0, 1 — чтобы не путать
const ROOM_LEN = 5;
const MAX_CHAT = 140;
const MAX_NAME = 16;
const ROOM_IDLE_MS = 3 * 60 * 60 * 1000; // 3 часа без активности — зал закрывается

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

export function createGameServer({ root, port = 8080, host = '0.0.0.0' } = {}){
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
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);

    if(urlPath === '/api/info'){
      res.writeHead(200, { 'Content-Type':'application/json; charset=utf-8', 'Cache-Control':'no-store' });
      res.end(JSON.stringify({ name:'GUILTY AS SOCK!', port: server.address()?.port ?? port, ips: lanIPs() }));
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
  });

  // ---------- websocket ----------
  const wss = new WebSocketServer({ server, path: '/ws' });

  const chatLimiter = new Map(); // ws -> [timestamps]
  const ballLimiter = new Map();

  function allow(map, ws, count, windowMs){
    const now = Date.now();
    const arr = (map.get(ws) || []).filter(t => now - t < windowMs);
    if(arr.length >= count) { map.set(ws, arr); return false; }
    arr.push(now); map.set(ws, arr); return true;
  }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', (raw) => {
      let msg = null;
      try { msg = JSON.parse(String(raw).slice(0, 4096)); } catch(e){ return; }
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
      chatLimiter.delete(ws); ballLimiter.delete(ws);
    });
  });

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

  // heartbeat
  const beat = setInterval(() => {
    for(const ws of wss.clients){
      if(ws.isAlive === false) { try { ws.terminate(); } catch(e){ /* ignore */ } continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch(e){ /* ignore */ }
    }
    // чистим протухшие залы
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

  function start(){
    return new Promise((resolve, reject) => {
      const onError = (err) => reject(err);
      server.once('error', onError);
      server.listen(port, host, () => {
        server.removeListener('error', onError);
        resolve(server);
      });
    });
  }

  async function close(){
    clearInterval(beat);
    for(const ws of wss.clients) { try { ws.terminate(); } catch(e){ /* ignore */ } }
    await new Promise(r => wss.close(() => r()));
    await new Promise(r => server.close(() => r()));
  }

  return { server, wss, rooms, start, close, port };
}
