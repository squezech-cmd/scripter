// ============================================================
// GUILTY AS SOCK! — Scripter Edition
// Онлайн-клиент зала суда. Ролевой: и хост (игра), и присяжный (juror.html).
// Безопасен в jsdom/file://: ничего не падает, если нет WebSocket.
// ============================================================

let ws = null;
let mode = 'off'; // 'off' | 'host' | 'juror'
let roomCode = null;
let myId = null;
let myName = '';
let players = [];
let votes = { guilty: 0, innocent: 0, voters: [], total: 0 };
let lastState = null;
let connectError = null;
const ballQueue = [];
const listeners = {
  players: [], chat: [], votes: [], closed: [], ball: [], state: [], signal: [], joined: [],
};

export function netSupported(){
  return typeof WebSocket !== 'undefined';
}
export function getMode(){ return mode; }
export function getMyId(){ return myId; }
export function getMyName(){ return myName; }
export function getRoom(){ return roomCode; }
export function getPlayers(){ return players.slice(); }
export function getVotes(){ return votes; }
export function getLastState(){ return lastState; }
export function lastConnectError(){ return connectError; }
export function isHosting(){ return mode === 'host' && !!ws && ws.readyState === 1 && !!roomCode; }
export function isJoined(){ return mode === 'juror' && !!ws && ws.readyState === 1 && !!roomCode; }

// Совместимость с прошлым API (используется в main.js)
export const currentRoom = getRoom;
export const currentPlayers = getPlayers;
export const currentVotes = getVotes;

export function consumeBalls(){
  return ballQueue.splice(0, ballQueue.length);
}

export function onPlayers(cb){ listeners.players.push(cb); }
export function onChat(cb){ listeners.chat.push(cb); }
export function onVotes(cb){ listeners.votes.push(cb); }
export function onBall(cb){ listeners.ball.push(cb); }
export function onRoomClosed(cb){ listeners.closed.push(cb); }
export function onState(cb){ listeners.state.push(cb); }
export function onJoined(cb){ listeners.joined.push(cb); }
export function onSignal(cb){ listeners.signal.push(cb); }

function emit(list, ...args){
  for(const cb of list.slice()) { try { cb(...args); } catch(e){ /* ignore */ } }
}

let intentionalClose = false;
export function leaveRoom(){
  if(ws){
    intentionalClose = true;
    try { ws.send(JSON.stringify({ t:'leave' })); } catch(e){ /* ignore */ }
    try { ws.close(); } catch(e){ /* ignore */ }
  }
  ws = null; mode = 'off'; roomCode = null; myId = null;
  players = []; lastState = null;
  votes = { guilty: 0, innocent: 0, voters: [], total: 0 };
}

function handleMessage(raw){
  let msg = null;
  try { msg = JSON.parse(String(raw)); } catch(e){ return; }
  if(!msg || typeof msg !== 'object') return;
  switch(msg.t){
    case 'created':
      mode = 'host'; roomCode = msg.room; myId = msg.id;
      break;
    case 'joined':
      mode = 'juror'; roomCode = msg.room; myId = msg.id;
      lastState = msg.state || null;
      if(msg.votes) votes = normalizeVotes(msg.votes);
      emit(listeners.joined, { room: roomCode, id: myId, state: lastState, chat: msg.chat || [], votes });
      if(lastState) emit(listeners.state, lastState);
      if(votes.total) emit(listeners.votes, votes);
      break;
    case 'players':
      players = Array.isArray(msg.players) ? msg.players : [];
      emit(listeners.players, players.slice());
      break;
    case 'state':
      lastState = msg.state || null;
      emit(listeners.state, lastState);
      break;
    case 'votes':
      votes = normalizeVotes(msg);
      emit(listeners.votes, votes);
      break;
    case 'chat':
      emit(listeners.chat, { from: String(msg.from||'Носок'), text: String(msg.text||''), sys: !!msg.sys, ts: msg.ts||Date.now() });
      break;
    case 'ball': {
      const from = String(msg.from || 'Носок');
      if(mode !== 'juror') ballQueue.push({ from }); // хосту — в 3D-зал
      emit(listeners.ball, { from });
      break;
    }
    case 'signal': // WebRTC signalling для голосового чата
      emit(listeners.signal, String(msg.from||''), msg.data);
      break;
    case 'closed':
      intentionalClose = true; // сервер уже сообщил о закрытии — не дублируем в onclose
      emit(listeners.closed, String(msg.msg || 'Зал закрыт'));
      break;
    case 'error':
      connectError = String(msg.msg || 'Ошибка связи');
      emit(listeners.closed, connectError);
      break;
    default: break;
  }
}
function normalizeVotes(msg){
  return {
    guilty: +msg.guilty||0, innocent: +msg.innocent||0,
    voters: Array.isArray(msg.voters) ? msg.voters : [],
    total: +msg.total||0,
  };
}

function wsUrl(){
  try{
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }catch(e){
    return null;
  }
}

function connect(timeoutMs, buildHello){
  connectError = null;
  return new Promise((resolve) => {
    if(!canConnectOnline()){ resolve({ ok:false, error: onlineBlockedReason() }); return; }
    let done = false;
    let socket = null;
    try { socket = new WebSocket(wsUrl()); }
    catch(e){ resolve({ ok:false, error:'Нет связи с сервером зала.' }); return; }
    ws = socket;
    intentionalClose = false;
    const finish = (res) => {
      if(done) return; done = true; clearTimeout(timer); resolve(res);
    };
    const cleanupAll = () => {
      try { socket.close(); } catch(e){ /* ignore */ }
      if(ws === socket){ ws = null; mode = 'off'; roomCode = null; }
    };
    const timer = setTimeout(() => {
      cleanupAll();
      finish({ ok:false, error: connectError || 'Сервер не ответил. Запусти игру через npm start / EXE.' });
    }, timeoutMs);
    socket.onopen = () => {
      try { socket.send(JSON.stringify(buildHello())); } catch(e){ /* ignore */ }
    };
    socket.onmessage = (ev) => {
      handleMessage(ev.data);
      if((mode === 'host' || mode === 'juror') && roomCode) finish({ ok:true, room: roomCode, id: myId });
    };
    socket.onerror = () => {
      connectError = 'Не удалось подключиться к серверу зала.';
      cleanupAll();
      finish({ ok:false, error: connectError });
    };
    socket.onclose = () => {
      const hadRoom = !!roomCode; const m = mode;
      if(ws === socket){ ws = null; mode = 'off'; roomCode = null; players = []; }
      if(hadRoom && m !== 'off' && !intentionalClose) emit(listeners.closed, 'Связь с залом потеряна.');
      finish({ ok:false, error: connectError || 'Связь с залом прервалась.' });
    };
  });
}

// --- Хост: создать зал ---
export const createRoom = (name, timeoutMs = 6000) => {
  if(!canConnectOnline()) return Promise.resolve({ ok:false, error: onlineBlockedReason() });
  leaveRoom();
  myName = String(name || 'Хост').slice(0,16) || 'Хост';
  return connect(timeoutMs, () => ({ t:'create', name: myName }));
};

// --- Присяжный: войти по коду ---
export const joinRoom = (code, name, timeoutMs = 8000) => {
  if(!canConnectOnline()) return Promise.resolve({ ok:false, error: onlineBlockedReason() });
  const clean = String(code || '').toUpperCase().trim();
  if(!/^[A-Z2-9]{4,6}$/.test(clean)) return Promise.resolve({ ok:false, error:'Код — 5 символов от хоста, например ABCDE' });
  leaveRoom();
  myName = String(name || 'Носок').slice(0,16) || 'Носок';
  return connect(timeoutMs, () => ({ t:'join', room: clean, name: myName }));
};

function canConnectOnline(){
  return netSupported() && typeof location !== 'undefined' && !!location.host && /^https?:$/.test(location.protocol);
}
function onlineBlockedReason(){
  return 'Онлайн доступен только при запуске через «npm start» или EXE-версию (не просто из файла).';
}

// --- Хост: рассылка снимка состояния суда ---
export function sendState(state){
  if(!isHosting()) return;
  try { ws.send(JSON.stringify({ t:'state', state })); } catch(e){ /* ignore */ }
}
// --- Присяжный: голос / чат / комок ---
export function sendVote(guilty){
  if(!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify({ t:'vote', guilty: !!guilty })); } catch(e){ /* ignore */ }
}
export function sendChat(text){
  if(!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify({ t:'chat', text: String(text||'').slice(0,140) })); } catch(e){ /* ignore */ }
}
export function sendBall(){
  if(!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify({ t:'ball' })); } catch(e){ /* ignore */ }
}
// --- Голосовой чат: отправка WebRTC-сигналинга ---
export function sendSignal(to, data){
  if(!ws || ws.readyState !== 1) return;
  try { ws.send(JSON.stringify({ t:'signal', to: to || undefined, data })); } catch(e){ /* ignore */ }
}
