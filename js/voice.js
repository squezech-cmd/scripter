// ============================================================
// GUILTY AS SOCK! — Голосовой чат зала (WebRTC mesh, без серверов).
// Звук идёт напрямую между игроками; сигналинг — через сервер зала.
// ============================================================
import { netSupported, getMyId, getPlayers, getMode, onPlayers, onSignal, onRoomClosed, sendSignal } from './net.js';

let localStream = null;
let micOn = false;
let desiredPeers = new Set();
const peers = new Map(); // id -> { pc, audio, makingOffer, ignoreOffer, sentLocalTracks }

const STUN = [{ urls: 'stun:stun.l.google.com:19302' }];

export function voiceSupported(){
  return netSupported()
    && typeof navigator !== 'undefined' && !!navigator.mediaDevices && !!navigator.mediaDevices.getUserMedia
    && typeof RTCPeerConnection !== 'undefined';
}
export function isMicOn(){ return micOn; }
export function voicePeerCount(){ return peers.size; }

// Perfect negotiation (MDN): вежливая сторона откатывает свой оффер при коллизии
const polite = (otherId) => String(getMyId() || '') > String(otherId || '');

function sendLocalTracks(state){
  if(!localStream || state.sentLocalTracks) return;
  try {
    for(const track of localStream.getAudioTracks()) state.pc.addTrack(track, localStream);
    state.sentLocalTracks = true;
  } catch(err){ console.warn('[voice] addTrack:', err); }
}

function ensurePeer(id){
  if(peers.has(id)) return peers.get(id);
  const pc = new RTCPeerConnection({ iceServers: STUN });
  const audio = document.createElement('audio');
  audio.autoplay = true; audio.playsInline = true; audio.setAttribute('playsinline','');
  audio.style.display = 'none';
  document.body.appendChild(audio);
  const state = { pc, audio, makingOffer: false, ignoreOffer: false, sentLocalTracks: false };
  peers.set(id, state);
  sendLocalTracks(state);

  pc.onicecandidate = (e) => { if(e.candidate) sendSignal(id, { candidate: e.candidate }); };
  pc.ontrack = (e) => { audio.srcObject = e.streams[0]; audio.play?.().catch(()=>{}); };
  pc.onnegotiationneeded = async () => {
    try {
      state.makingOffer = true;
      await pc.setLocalDescription();
      sendSignal(id, { description: pc.localDescription });
    } catch(err){ console.warn('[voice] negotiation:', err); }
    finally { state.makingOffer = false; }
  };
  pc.onconnectionstatechange = () => {
    const st = pc.connectionState;
    if(st === 'failed' || st === 'closed'){ closePeer(id); }
    else if(st === 'disconnected'){
      setTimeout(() => { const s = peers.get(id); if(s && s.pc.connectionState === 'disconnected' && !desiredPeers.has(id)) closePeer(id); }, 8000);
    }
  };
  return state;
}
function closePeer(id){
  const s = peers.get(id);
  if(!s) return;
  try { s.pc.onicecandidate = null; s.pc.ontrack = null; s.pc.onnegotiationneeded = null; } catch(e){ /* ignore */ }
  try { s.pc.close(); } catch(e){ /* ignore */ }
  try { s.audio.srcObject = null; s.audio.remove(); } catch(e){ /* ignore */ }
  peers.delete(id);
}
function syncPeers(){
  // Соединения создаём для всех участников зала (даже без микрофона — слушаем)
  for(const id of desiredPeers) if(id && id !== getMyId()) ensurePeer(id);
  for(const id of [...peers.keys()]) if(!desiredPeers.has(id)) closePeer(id);
}

export async function enableMic(){
  if(micOn) return true;
  if(!voiceSupported()) throw new Error('Голосовой чат недоступен: нужен HTTPS (или localhost) и WebRTC.');
  if(getMode() === 'off') throw new Error('Сначала создай или войди в зал.');
  if(!localStream){
    localStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
  }
  for(const track of localStream.getAudioTracks()) track.enabled = true;
  micOn = true;
  desiredPeers = new Set(getPlayers().map(p => p.id));
  syncPeers();
  for(const state of peers.values()) sendLocalTracks(state);
  return true;
}
// Полная выгрузка (уход из зала / отключение звука)
export function disableMic(){
  micOn = false;
  if(localStream){ for(const t of localStream.getTracks()) t.stop(); localStream = null; }
  for(const id of [...peers.keys()]) closePeer(id);
}
// Мут: просто глушим треки — mesh остаётся, renegotiation не нужна
export function muteMic(){
  if(localStream) for(const track of localStream.getAudioTracks()) track.enabled = false;
  micOn = false;
}
export async function toggleMic(){
  if(micOn){ muteMic(); return false; }
  await enableMic();
  return true;
}

export async function handleSignal(from, data){
  if(!from || !data) return;
  if(desiredPeers.size && !desiredPeers.has(from)){
    // Новый участник — регистрируем и отвечаем
    desiredPeers.add(from);
  }
  const state = ensurePeer(from);
  const pc = state.pc;
  try {
    if(data.description){
      const desc = data.description;
      const offerCollision = desc.type === 'offer' && (state.makingOffer || pc.signalingState !== 'stable');
      state.ignoreOffer = !polite(from) && offerCollision;
      if(state.ignoreOffer) return;
      if(desc.type === 'offer' && offerCollision){
        // polite сторона: откатываем свой оффер
        try { await pc.setLocalDescription({ type: 'rollback' }); } catch(e){ /* старые браузеры проглотят */ }
      }
      await pc.setRemoteDescription(desc);
      if(desc.type === 'offer'){
        await pc.setLocalDescription();
        sendSignal(from, { description: pc.localDescription });
      }
    } else if(data.candidate){
      try { await pc.addIceCandidate(data.candidate); }
      catch(err){ if(!state.ignoreOffer) console.warn('[voice] ice:', err); }
    }
  } catch(err){ console.warn('[voice] signal:', err); }
}

let initialized = false;
export function initVoice(){
  if(initialized) return;
  initialized = true;
  onPlayers((list) => {
    desiredPeers = new Set(list.map(p => p.id));
    syncPeers();
  });
  onSignal((from, data) => { handleSignal(from, data); });
  onRoomClosed(() => disableMic());
}
