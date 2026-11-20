// ============================================================
// GUILTY AS SOCK! — Scripter Edition
// Клиент сетевого режима «Зал онлайн» (только хост-режим).
// Безопасный импорт: ничего не падает, если нет WebSocket (jsdom, file://).
// ============================================================

let ws = null;
let roomCode = null;
let myId = null;
let players = [];
let votes = { guilty: 0, innocent: 0, voters: [], total: 0 };
let connectError = null;
const ballQueue = [];
const chatListeners = [];
const playersListeners = [];
const votesListeners = [];
const closedListeners = [];
const ballListeners = [];

export function netSupported(){
  return typeof WebSocket !== 'undefined';
}
export function isHosting(){
  return !!ws && ws.readyState === 1 && !!roomCode;
}
export function currentRoom(){ return roomCode; }
export function currentPlayers(){ return players.slice(); }
export function currentVotes(){ return votes; }
export function lastConnectError(){ return connectError; }

function emit(list, ...args){
  for(const cb of list.slice()) { try { cb(...args); } catch(e){ /* ignore */ } }
}

export function onPlayers(cb){ playersListeners.push(cb); }
export function onChat(cb){ chatListeners.push(cb); }
export function onVotes(cb){ votesListeners.push(cb); }
export function onBall(cb){ ballListeners.push(cb); }
export function onRoomClosed(cb){ closedListeners.push(cb); }

export function consumeBalls(){
  return ballQueue.splice(0, ballQueue.length);
}

export function leaveRoom(){
  if(ws){
    try { ws.send(JSON.stringify({ t:'leave' })); } catch(e){ /* ignore */ }
    try { ws.close(); } catch(e){ /* ignore */ }
  }
  ws = null; roomCode = null; myId = null; players = [];
  votes = { guilty: 0, innocent: 0, voters: [], total: 0 };
}

function handleMessage(raw){
  let msg = null;
  try { msg = JSON.parse(String(raw)); } catch(e){ return; }
  if(!msg || typeof msg !== 'object') return;
  switch(msg.t){
    case 'created':
      roomCode = msg.room; myId = msg.id;
      break;
    case 'players':
      players = Array.isArray(msg.players) ? msg.players : [];
      emit(playersListeners, players.slice());
      break;
    case 'votes':
      votes = {
        guilty: +msg.guilty||0, innocent: +msg.innocent||0,
        voters: Array.isArray(msg.voters) ? msg.voters : [], total: +msg.total||0,
      };
      emit(votesListeners, votes);
      break;
    case 'chat':
      emit(chatListeners, { from: String(msg.from||'Носок'), text: String(msg.text||''), sys: !!msg.sys, ts: msg.ts||Date.now() });
      break;
    case 'ball': {
      const from = String(msg.from || 'Носок');
      ballQueue.push({ from });
      emit(ballListeners, { from });
      break;
    }
    case 'closed':
      emit(closedListeners, String(msg.msg || 'Зал закрыт'));
      break;
    case 'error':
      connectError = String(msg.msg || 'Ошибка связи');
      emit(closedListeners, connectError);
      break;
    default: break;
  }
}

function wsUrl(){
  try{
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }catch(e){
    return null;
  }
}

// Создать зал (хост = ведущий компьютер, на нём идёт суд).
export function createRoom(name, timeoutMs = 6000){
  return new Promise((resolve) => {
    if(!netSupported() || typeof location === 'undefined' || !location.host){
      resolve({ ok:false, error:'Онлайн доступен только при запуске через «npm start» или EXE-версию (не просто из файла).' });
      return;
    }
    const url = wsUrl();
    if(!url){ resolve({ ok:false, error:'Не удалось определить адрес сервера.' }); return; }
    leaveRoom();
    connectError = null;
    let done = false;
    try { ws = new WebSocket(url); }
    catch(e){ resolve({ ok:false, error:'Нет связи с сервером зала.' }); return; }

    const to = setTimeout(() => {
      if(done) return; done = true;
      const err = connectError || 'Сервер не ответил. Запусти игру через npm start / EXE.';
      leaveRoom();
      resolve({ ok:false, error: err });
    }, timeoutMs);

    ws.onopen = () => {
      try { ws.send(JSON.stringify({ t:'create', name: String(name||'Хост').slice(0,16) })); } catch(e){ /* ignore */ }
    };
    ws.onmessage = (ev) => {
      handleMessage(ev.data);
      if(roomCode && !done){
        done = true; clearTimeout(to);
        resolve({ ok:true, room: roomCode, id: myId });
      }
    };
    ws.onerror = () => {
      if(done) return; done = true; clearTimeout(to);
      const err = 'Не удалось подключиться к серверу зала.';
      connectError = err; leaveRoom(); resolve({ ok:false, error: err });
    };
    ws.onclose = () => {
      const hadRoom = !!roomCode;
      roomCode = null; ws = null; players = [];
      if(hadRoom) emit(closedListeners, 'Связь с залом потеряна.');
    };
  });
}

// Хост рассылает снимок состояния суда всем онлайн-присяжным.
export function sendState(state){
  if(!isHosting()) return;
  try { ws.send(JSON.stringify({ t:'state', state })); } catch(e){ /* ignore */ }
}

export function netDebugInfo(){
  return { room: roomCode, players: players.length, votes: votes.total, hosting: isHosting() };
}
