// ============================================================
// GUILTY AS SOCK! — Scripter Edition
// Main game: 3D courtroom, first-person socks, AI trial, paper physics.
// Browser game — no app install needed. Runs from index.html.
// ============================================================
import * as THREE from 'three';
import { ROLES, DECKS, CASES, EVIDENCE, STYLES, LINES, ACHIEVEMENTS, SOCK_NAMES, pick, fill, shuffle } from './data.js';
import { createSock, animateSock, sockSay, sockGesture } from './sock.js';
import { buildCourtroom, clearCourtroom } from './courtroom.js';
import { drawHand, aiChooseCard, aiChooseStyle, persuasionScore, generatePresentLine, aiVote, generateHeadline, streamerVote } from './ai.js';
import { sfx } from './audio.js';

// ---------- utils ----------
const $ = id => document.getElementById(id);
class TrialEnd extends Error {}
// Pause-aware, abort-aware timer used by the trial director.
async function sleep(ms){
  const token = gameState.trialToken;
  let left = ms;
  while(left > 0){
    await new Promise(r=>setTimeout(r,100));
    if(token !== gameState.trialToken) throw new TrialEnd('trial ended');
    if(!gameState.paused) left -= 100;
  }
  if(token !== gameState.trialToken) throw new TrialEnd('trial ended');
}
const clamp = (v,a,b)=>Math.max(a,Math.min(b,v));
const rand = (a,b)=>a+Math.random()*(b-a);
const randInt = (a,b)=>Math.floor(rand(a,b+1));

function loadSave(){
  try{ return JSON.parse(localStorage.getItem('gas_scripter_save')||'{}'); }catch(e){ return {}; }
}
function storeSave(){
  try{ localStorage.setItem('gas_scripter_save', JSON.stringify(save)); }catch(e){}
}
const save = Object.assign({
  wins:0, cases:0, score:0, achievements:{},
  sock:{ color:'#e63946', pattern:'plain', accessory:'none', costume:'casual', name:'Сэр Носок', charisma:5 },
  settings:{ volume:80, sens:5, quality:'medium', subtitles:true },
  deck:'classic', theme:'classic', role:'defense', aiCount:5, streamer:false,
}, loadSave());
if(!save.sock) save.sock = { color:'#e63946', pattern:'plain', accessory:'none', costume:'casual', name:'Сэр Носок', charisma:5 };
if(!save.settings) save.settings = { volume:80, sens:5, quality:'medium', subtitles:true };

// ---------- DOM ----------
const canvas = $('gameCanvas');
const screens = ['loadingScreen','mainMenu','customizeScreen','decksScreen','lobbyScreen','howScreen','settingsScreen','pauseScreen','verdictScreen','matchEndScreen'];
function showScreen(id){
  screens.forEach(s=>$(s).classList.toggle('active', s===id));
  if(!id) screens.forEach(s=>$(s).classList.remove('active'));
}
function toast(msg, ms=2600){
  const t = $('centerToast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(t._h); t._h = setTimeout(()=>t.classList.add('hidden'), ms);
}
function logCourt(text){
  const log = $('courtLog');
  const div = document.createElement('div'); div.className='log-line'; div.textContent = text;
  log.appendChild(div);
  while(log.children.length>6) log.removeChild(log.firstChild);
}
function unlockAchievement(id){
  if(save.achievements[id]) return;
  save.achievements[id]=true; storeSave();
  const a = ACHIEVEMENTS.find(x=>x.id===id); if(!a) return;
  $('achTitle').textContent = a.title; $('achDesc').textContent = a.desc;
  $('achievementToast').classList.remove('hidden');
  sfx.fanfare();
  setTimeout(()=>$('achievementToast').classList.add('hidden'), 3500);
}

// ---------- Three setup ----------
let renderer, scene, camera, clock;
let court = null;
let playerSock = null;
let aiSocks = []; // {mesh, role, name, hand, prosScore, defScore, isPlayer}
let paperBalls = [];
let confetti = [];
let gameState = {
  phase:'menu', caseData:null, caseNum:1, matchWins:0, matchLosses:0,
  prosScore:0, defScore:0, chaos:0, paperLeft:5, round:0,
  selectedCard:null, selectedStyle:null, trialStart:0, trialToken:0,
  playerRole:'defense', deck:'classic', streamer:false, headlinesLeft:3,
  votes:[], paused:false, freeRoam:false, speaking:null, paperHits:0, objections:0, presented:0,
};
let shakeAmt = 0;
function addShake(v){ shakeAmt = Math.min(0.55, shakeAmt + v); }
const player = {
  pos: new THREE.Vector3(0,1.7,8), vel: new THREE.Vector3(), yaw:0, pitch:0,
  onGround:true, keys:{}, locked:false,
};
const colliders = [
  {minX:-4.3,maxX:4.3,minZ:-10.4,maxZ:-8.6}, // bench
  {minX:-6.6,maxX:-2.4,minZ:-4.8,maxZ:-3.2}, // pros table
  {minX:2.4,maxX:6.6,minZ:-4.8,maxZ:-3.2},   // def table
  {minX:7.8,maxX:10.2,minZ:-3.2,maxZ:-0.8},  // witness
  {minX:-10.6,maxX:-8.4,minZ:-4.6,maxZ:2.6}, // jury
  {minX:-6.9,maxX:-5.1,minZ:1.4,maxZ:2.6},   // press
  {minX:5.1,maxX:6.9,minZ:1.4,maxZ:2.6},     // bailiff
];

function initThree(){
  renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;

  scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0a0914);
  scene.fog = new THREE.Fog(0x0a0914, 18, 42);

  camera = new THREE.PerspectiveCamera(72, innerWidth/innerHeight, 0.1, 100);
  camera.position.copy(player.pos);

  clock = new THREE.Clock();
  window.addEventListener('resize', onResize);
  buildCourt();
  buildPlayerSock();
  buildPaperPool();
  animate();
}

function requestLock(){ /* free mouse-look: no pointer lock needed */ player.locked = true; }
function onResize(){
  camera.aspect = innerWidth/innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
}

function buildCourt(){
  clearCourtroom(scene);
  court = buildCourtroom(scene, save.theme || 'classic');
  scene.fog.color.setHex(court.theme.fog);
  applyQuality();
}

function applyQuality(){
  const q = save.settings.quality || 'medium';
  if(q==='low'){ renderer.setPixelRatio(1); renderer.shadowMap.enabled=false; }
  else if(q==='medium'){ renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)); renderer.shadowMap.enabled=true; }
  else { renderer.setPixelRatio(Math.min(devicePixelRatio,2)); renderer.shadowMap.enabled=true; }
  scene.traverse(o=>{ if(o.material) o.material.needsUpdate=true; });
}

function buildPlayerSock(){
  if(playerSock) scene.remove(playerSock);
  playerSock = createSock({ ...save.sock, role: gameState.playerRole });
  playerSock.userData.name = save.sock.name;
  scene.add(playerSock);
}

function buildPaperPool(){
  const geo = new THREE.IcosahedronGeometry(0.14, 0);
  const mat = new THREE.MeshStandardMaterial({ color:0xfff8e7, roughness:0.95, flatShading:true });
  for(let i=0;i<24;i++){
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.visible = false;
    m.userData = { active:false, vel:new THREE.Vector3(), spin:new THREE.Vector3(), fromPlayer:false, life:0 };
    scene.add(m); paperBalls.push(m);
  }
}

function throwPaper(fromPlayer=true){
  if(gameState.paperLeft<=0 && fromPlayer){ toast('📄 Комки закончились!'); return; }
  const ball = paperBalls.find(b=>!b.userData.active);
  if(!ball) return;
  if(fromPlayer) gameState.paperLeft--;
  $('paperVal').textContent = gameState.paperLeft;
  ball.visible = true; ball.userData.active = true; ball.userData.fromPlayer = fromPlayer; ball.userData.life = 6;
  const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
  ball.position.copy(camera.position).add(dir.clone().multiplyScalar(0.6));
  ball.userData.vel.copy(dir.multiplyScalar(14)).add(new THREE.Vector3(rand(-0.5,0.5), 2.2, rand(-0.5,0.5)));
  ball.userData.spin.set(rand(-8,8),rand(-8,8),rand(-8,8));
  sfx.paper();
  if(playerSock) sockGesture(playerSock);
}

function updatePaper(dt){
  for(const b of paperBalls){
    if(!b.userData.active) continue;
    b.userData.life -= dt;
    b.userData.vel.y -= 18*dt;
    b.position.addScaledVector(b.userData.vel, dt);
    b.rotation.x += b.userData.spin.x*dt; b.rotation.y += b.userData.spin.y*dt;
    if(b.position.y < 0.14){ b.position.y=0.14; b.userData.vel.y*=-0.35; b.userData.vel.x*=0.7; b.userData.vel.z*=0.7; b.userData.spin.multiplyScalar(0.5); }
    if(Math.abs(b.position.x)>14.5 || Math.abs(b.position.z)>11.5 || b.userData.life<=0){
      b.userData.active=false; b.visible=false; continue;
    }
    // Hit socks?
    const all = [playerSock, ...aiSocks.map(s=>s.mesh)].filter(Boolean);
    for(const s of all){
      if(s===playerSock && !b.userData.fromPlayer) continue;
      const d = b.position.distanceTo(s.position.clone().add(new THREE.Vector3(0,1.2,0)));
      if(d < 0.75){
        b.userData.active=false; b.visible=false;
        sfx.paperHit();
        addChaos(5);
        if(!b.userData.fromPlayer) addShake(0.12);
        if(b.userData.fromPlayer){
          gameState.paperHits++;
          if(gameState.paperHits>=10) unlockAchievement('paper_master');
          save.score += 10; storeSave(); updateHudScore();
        }
        const who = s.userData.name || 'Носок';
        logCourt(`📄 Комок попал в: ${who}!`);
        sockSay(s, 1.6);
        // Show hit line occasionally
        if(Math.random()<0.5) showSpeech(who, pick(LINES.paperHit), 1600);
        // Distract speaker: reduce their side score slightly
        if(gameState.speaking){
          if(gameState.speaking.role==='prosecutor') gameState.prosScore = Math.max(0, gameState.prosScore-1);
          if(gameState.speaking.role==='defense') gameState.defScore = Math.max(0, gameState.defScore-1);
        }
        break;
      }
    }
  }
}

function addChaos(n){
  gameState.chaos = clamp(gameState.chaos + n, 0, 100);
  $('chaosFill').style.width = gameState.chaos + '%';
  $('chaosVal').textContent = Math.round(gameState.chaos) + '%';
  if(gameState.chaos>=100) unlockAchievement('chaos_king');
}

function updateHudScore(){
  $('hudScore').textContent = save.score;
  $('hudWins').textContent = gameState.matchWins;
  $('hudLosses').textContent = gameState.matchLosses;
  $('statWins').textContent = save.wins;
  $('statCases').textContent = save.cases;
  $('statScore').textContent = save.score;
  $('profileChip').textContent = `🧦 ${save.sock.name} • ${save.wins} побед • ${save.score} очков`;
}

// ---------- Speech ----------
let speechTimer = null;
function showSpeech(name, text, ms=3200, styleText=''){
  if(!save.settings.subtitles && name!==save.sock.name) { /* still show player */ }
  $('speechName').textContent = name;
  $('speechText').textContent = text;
  $('speechStyle').textContent = styleText;
  $('speechBox').classList.remove('hidden');
  clearTimeout(speechTimer);
  speechTimer = setTimeout(()=>$('speechBox').classList.add('hidden'), ms);
  sfx.talk();
}
function speakBy(sockObj, text, ms=3200, styleText=''){
  if(!sockObj) return;
  sockSay(sockObj.mesh, ms/1000);
  gameState.speaking = sockObj;
  showSpeech(sockObj.name, text, ms, styleText);
  logCourt(`💬 ${sockObj.name}: ${text.slice(0,80)}${text.length>80?'…':''}`);
}

// ---------- AI socks ----------
const SOCK_COLORS = ['#e63946','#4361ee','#2ec4b6','#f5c542','#7209b7','#ff5fa2','#00f5ff','#ff8c42','#7bf1a8','#ff6b6b'];
function randomSockConfig(role){
  return {
    color: pick(SOCK_COLORS),
    pattern: pick(['plain','stripes','dots','checker','flame']),
    accessory: pick(['none','glasses','wig','hat','bowtie','mustache','crown','horns']),
    costume: pick(['casual','judge','lawyer','punk','royal']),
    role,
  };
}
function clearAiSocks(){
  for(const s of aiSocks) scene.remove(s.mesh);
  aiSocks = [];
}
function spawnAiSocks(){
  clearAiSocks();
  const rolesNeeded = ROLES.map(r=>r.id).filter(r=>r!==gameState.playerRole);
  const count = clamp(save.aiCount||5, 3, 8);
  // Always include judge, prosecutor, defense if player isn't them
  const priority = ['judge','prosecutor','defense','witness','juror','journalist','bailiff'];
  const chosen = [];
  for(const r of priority){ if(rolesNeeded.includes(r) && chosen.length<count) chosen.push(r); }
  // Fill extra jurors, and guarantee a jury of at least 3 AI jurors
  while(chosen.length<count) chosen.push('juror');
  while(chosen.filter(r=>r==='juror').length < 3) chosen.push('juror');
  const names = shuffle(SOCK_NAMES.filter(n=>n!==save.sock.name));
  chosen.forEach((role,i)=>{
    const cfg = randomSockConfig(role);
    const mesh = createSock({ ...cfg, role, name: names[i%names.length] });
    mesh.userData.name = names[i%names.length];
    const spawn = court.spawns[role] || court.spawns.gallery;
    mesh.position.copy(spawn.pos);
    mesh.userData.baseY = spawn.pos.y;
    mesh.lookAt(spawn.look.x, mesh.position.y+1.5, spawn.look.z);
    // Slight offsets for duplicate jurors
    if(role==='juror'){
      mesh.position.z += (i%3)*0.9 - 0.9;
      mesh.position.x += rand(-0.2,0.2);
    }
    scene.add(mesh);
    aiSocks.push({ mesh, role, name: names[i%names.length], hand: drawHand(gameState.deck,5), charisma: randInt(3,8), wanderTarget:null, wanderTimer:0 });
  });
  // Player entry
  const playerEntry = { mesh: playerSock, role: gameState.playerRole, name: save.sock.name, hand: drawHand(gameState.deck,5), charisma: save.sock.charisma, isPlayer:true };
  aiSocks.push(playerEntry);
  buildPlayerSock();
  playerEntry.mesh = playerSock;
  // Place player at role spawn (but camera is FP there).
  // Witness/juror stand just in front of their stands so colliders don't shove the player out.
  const PLAYER_SPAWN = {
    witness: { pos:new THREE.Vector3(9, 0, -0.1),  look:new THREE.Vector3(0, 1.5, -4) },
    juror:   { pos:new THREE.Vector3(-8.0, 0, -1.2), look:new THREE.Vector3(0, 1.5, -3) },
  };
  const ps = PLAYER_SPAWN[gameState.playerRole] || court.spawns[gameState.playerRole] || court.spawns.gallery;
  player.pos.copy(ps.pos).add(new THREE.Vector3(0,1.7,0));
  playerSock.position.copy(ps.pos);
  playerSock.lookAt(ps.look.x, 1.5, ps.look.z);
  camera.position.copy(player.pos);
  // Face look direction
  const lookTarget = ps.look.clone(); lookTarget.y = player.pos.y;
  camera.lookAt(lookTarget);
  player.yaw = Math.atan2(-(lookTarget.x-player.pos.x), -(lookTarget.z-player.pos.z));
  player.pitch = 0;
  syncCamera();
  playerSock.visible = false; // first-person: you ARE the sock
}

function findSock(role){
  return aiSocks.find(s=>s.role===role);
}
function allSocks(){ return aiSocks; }

// ---------- Player movement ----------
function syncCamera(){
  camera.position.copy(player.pos);
  camera.rotation.order = 'YXZ';
  camera.rotation.y = player.yaw;
  camera.rotation.x = player.pitch;
}
function updatePlayer(dt){
  if(gameState.phase==='menu' || gameState.phase==='verdict' || gameState.paused) return;
  const speed = player.keys['shift'] ? 7.5 : 4.2;
  const fwd = new THREE.Vector3(-Math.sin(player.yaw),0,-Math.cos(player.yaw));
  const right = new THREE.Vector3(Math.cos(player.yaw),0,-Math.sin(player.yaw));
  const move = new THREE.Vector3();
  if(player.keys['w']||player.keys['arrowup']) move.add(fwd);
  if(player.keys['s']||player.keys['arrowdown']) move.sub(fwd);
  if(player.keys['d']||player.keys['arrowright']) move.add(right);
  if(player.keys['a']||player.keys['arrowleft']) move.sub(right);
  // Touch joystick
  if(touch.move.lengthSq()>0.01){
    move.add(fwd.clone().multiplyScalar(-touch.move.y));
    move.add(right.clone().multiplyScalar(touch.move.x));
  }
  if(move.lengthSq()>0){
    move.normalize().multiplyScalar(speed*dt);
    player.pos.add(move);
    playerSock.position.x = player.pos.x; playerSock.position.z = player.pos.z;
    playerSock.position.y = Math.abs(Math.sin(performance.now()*0.008))*0.06;
    playerSock.rotation.y = player.yaw + Math.PI;
  } else {
    playerSock.position.x = player.pos.x; playerSock.position.z = player.pos.z;
    playerSock.position.y = Math.sin(performance.now()*0.002)*0.03;
    playerSock.rotation.y = player.yaw + Math.PI;
  }
  // Gravity / jump
  player.vel.y -= 18*dt;
  player.pos.y += player.vel.y*dt;
  if(player.pos.y <= 1.7){ player.pos.y=1.7; player.vel.y=0; player.onGround=true; }
  // Bounds + colliders
  player.pos.x = clamp(player.pos.x, -13.5, 13.5);
  player.pos.z = clamp(player.pos.z, -11, 11);
  for(const c of colliders){
    if(player.pos.x>c.minX && player.pos.x<c.maxX && player.pos.z>c.minZ && player.pos.z<c.maxZ){
      // push out along smallest penetration
      const dxl = player.pos.x-c.minX, dxr = c.maxX-player.pos.x;
      const dzl = player.pos.z-c.minZ, dzr = c.maxZ-player.pos.z;
      const m = Math.min(dxl,dxr,dzl,dzr);
      if(m===dxl) player.pos.x=c.minX; else if(m===dxr) player.pos.x=c.maxX;
      else if(m===dzl) player.pos.z=c.minZ; else player.pos.z=c.maxZ;
    }
  }
  syncCamera();
  // Interact hint: near a sock?
  let near = null;
  for(const s of aiSocks){
    if(s.isPlayer) continue;
    if(player.pos.distanceTo(s.mesh.position.clone().add(new THREE.Vector3(0,1.7,0))) < 3.2){ near=s; break; }
  }
  const hint = $('interactHint');
  if(near){ hint.textContent = `E — поговорить с ${near.name} (${roleName(near.role)})`; hint.classList.remove('hidden'); hint._near=near; }
  else hint.classList.add('hidden');
}
function roleName(id){ return (ROLES.find(r=>r.id===id)||{}).name || id; }

// Touch
const touch = { move:new THREE.Vector2(), lookId:null, lastLook:{x:0,y:0} };
function initTouch(){
  const isTouch = 'ontouchstart' in window;
  if(isTouch) $('touchControls').classList.remove('hidden');
  const joy = $('joystick'), knob = $('joystickKnob');
  let joyId = null;
  const joyMove = e=>{
    const r = joy.getBoundingClientRect();
    const cx = r.left+r.width/2, cy = r.top+r.height/2;
    let dx = (e.clientX-cx)/45, dy = (e.clientY-cy)/45;
    const len = Math.hypot(dx,dy); if(len>1){ dx/=len; dy/=len; }
    touch.move.set(dx,dy);
    knob.style.transform = `translate(calc(-50% + ${dx*32}px), calc(-50% + ${dy*32}px))`;
  };
  joy.addEventListener('touchstart', e=>{ joyId=e.changedTouches[0].identifier; joyMove(e.changedTouches[0]); e.preventDefault(); },{passive:false});
  joy.addEventListener('touchmove', e=>{ for(const t of e.changedTouches) if(t.identifier===joyId) joyMove(t); e.preventDefault(); },{passive:false});
  const joyEnd = e=>{ for(const t of e.changedTouches) if(t.identifier===joyId){ joyId=null; touch.move.set(0,0); knob.style.transform='translate(-50%,-50%)'; } };
  joy.addEventListener('touchend', joyEnd); joy.addEventListener('touchcancel', joyEnd);
  // Look drag on canvas
  canvas.addEventListener('touchstart', e=>{
    const t = e.changedTouches[0]; touch.lookId=t.identifier; touch.lastLook={x:t.clientX,y:t.clientY};
  },{passive:true});
  canvas.addEventListener('touchmove', e=>{
    for(const t of e.changedTouches){
      if(t.identifier===touch.lookId){
        const dx = t.clientX-touch.lastLook.x, dy = t.clientY-touch.lastLook.y;
        player.yaw -= dx*0.005; player.pitch = clamp(player.pitch - dy*0.005, -1.4, 1.4);
        touch.lastLook={x:t.clientX,y:t.clientY};
      }
    }
  },{passive:true});
  $('tInteract').addEventListener('click', ()=>doInteract());
  $('tThrow').addEventListener('click', ()=>{ if(gameState.phase!=='menu') throwPaper(true); });
  $('tJump').addEventListener('click', ()=>{ if(player.onGround){ player.vel.y=7; player.onGround=false; sfx.jump(); } });
  $('tObjection').addEventListener('click', ()=>doObjection());
}

function doInteract(){
  const hintEl = $('interactHint');
  if(hintEl.classList.contains('hidden')) return;
  const near = hintEl._near;
  if(near){
    const lines = [
      `Привет! Я ${near.name}, ${roleName(near.role)}. Дело «${gameState.caseData?.crime||''}» — это жесть.`,
      `Слушай, я думаю, ${gameState.caseData?.accused||'обвиняемый'} что-то скрывает…`,
      `Кидай комки в прокурора — зал обожает хаос!`,
      `Мои карты-доказательства — топ. Присяжные будут в шоке!`,
    ];
    speakBy(near, pick(lines), 2800);
    save.score += 5; storeSave(); updateHudScore();
  }
}
function doObjection(){
  if(!['opening','present','witness','free','closing'].includes(gameState.phase)) return;
  gameState.objections++;
  if(gameState.objections>=5) unlockAchievement('objection');
  $('objectionFlash').classList.remove('hidden');
  setTimeout(()=>$('objectionFlash').classList.add('hidden'), 900);
  sfx.objection(); addChaos(3);
  addShake(0.14);
  const flash = $('damageFlash');
  flash.style.opacity = '0.55';
  setTimeout(()=>{ flash.style.opacity = '0'; }, 180);
  const me = aiSocks.find(s=>s.isPlayer);
  if(me) speakBy(me, pick(LINES.objection), 1800, '✋ Возражение!');
  save.score += 15; storeSave(); updateHudScore();
}
function doGavel(){
  if(gameState.playerRole!=='judge') return;
  sfx.gavel(); addChaos(-12); addShake(0.18);
  toast('🔨 Молоток! Порядок восстановлен.');
  logCourt('🔨 Судья стучит молотком!');
  if(gameState.chaos<20) save.score+=10, storeSave(), updateHudScore();
}

// ---------- Evidence hand UI ----------
function renderHand(){
  const me = aiSocks.find(s=>s.isPlayer);
  const hand = $('hand'); hand.innerHTML='';
  if(!me || !me.hand || me.hand.length===0){
    hand.innerHTML = '<div style="color:#cfc9f5;font-size:13px;padding:10px">Карты закончились — жди следующего раунда</div>';
    return;
  }
  me.hand.forEach((card,i)=>{
    const div = document.createElement('div');
    div.className = 'ev-card' + (gameState.selectedCard===card?' selected':'');
    div.innerHTML = `<div class="ev-emoji">${card.emoji}</div><b>${card.name}</b><p>${card.desc}</p><div class="ev-stats"><span>💪 ${card.persuasion}</span><span>🎪 ${card.chaos}</span></div>`;
    div.addEventListener('click', ()=>{
      gameState.selectedCard = card; sfx.click(); renderHand();
      $('handHint').textContent = `Выбрано: ${card.name} — теперь стиль`;
    });
    hand.appendChild(div);
  });
}
function renderStyleRow(){
  document.querySelectorAll('.style-btn[data-style]').forEach(b=>{
    b.classList.toggle('active', gameState.selectedStyle===b.dataset.style);
  });
}
function playerPresent(){
  const me = aiSocks.find(s=>s.isPlayer);
  if(!gameState.selectedCard || !gameState.selectedStyle){
    toast('Выбери карту и стиль!'); return;
  }
  if(!['opening','present','witness','free','closing'].includes(gameState.phase)){
    toast('Сейчас нельзя предъявлять — дождись начала заседания!'); return;
  }
  const card = gameState.selectedCard;
  const style = gameState.selectedStyle;
  const score = persuasionScore(card, style, gameState.deck, save.sock.charisma);
  const vars = { crime: gameState.caseData.crime, accused: gameState.caseData.accused };
  const line = generatePresentLine(card, style, vars);
  speakBy(me, line, 3400, `${STYLES[style].emoji} ${STYLES[style].name} • +${score} убедительности`);
  sfx.present(); addChaos(STYLES[style].chaos*2);
  if(gameState.playerRole==='prosecutor') gameState.prosScore += score;
  else if(gameState.playerRole==='defense') gameState.defScore += score;
  else {
    // Witness/juror/etc presenting helps defense slightly (or prosecutor if card chaos high?)
    gameState.defScore += score*0.5;
  }
  me.hand = me.hand.filter(c=>c!==card);
  gameState.selectedCard=null; gameState.selectedStyle=null;
  gameState.presented++;
  if(gameState.presented>=15) unlockAchievement('evidence');
  save.score += Math.round(score*5); storeSave(); updateHudScore();
  renderHand(); renderStyleRow();
  logCourt(`🃏 ${me.name} предъявил: ${card.name} (+${score})`);
  // AI reacts
  setTimeout(()=>{
    const judge = findSock('judge');
    if(judge && !judge.isPlayer && Math.random()<0.6) speakBy(judge, pick(['Принято. Записал в протокол.','Интересно… присяжные, слушайте внимательно.','Хм. Продолжайте.']), 2000);
  }, 3600);
}

// ---------- Trial flow ----------
function setPhase(p, label){
  gameState.phase = p;
  $('phaseChip').textContent = label;
}
async function runTrial(token){
  const cd = gameState.caseData;
  const vars = { crime: cd.crime, accused: cd.accused };
  const judge = findSock('judge');
  const pros = findSock('prosecutor');
  const def = findSock('defense');
  const wit = findSock('witness');
  const alive = ()=> token===gameState.trialToken;

  // OPENING
  setPhase('opening','🎤 Открытие');
  if(judge && !judge.isPlayer) speakBy(judge, fill(pick(LINES.judgeOpen), vars), 3600);
  else if(judge && judge.isPlayer) showSpeech(save.sock.name, 'Заседание открыто! Прокурор, ваше слово!', 3000);
  await sleep(3800); if(!alive()) return;
  if(pros && !pros.isPlayer) speakBy(pros, fill(pick(LINES.prosecutorOpen), vars), 3800);
  else if(pros && pros.isPlayer) showSpeech(save.sock.name, 'Я прокурор! Слушайте моё обвинение!', 3000);
  await sleep(4000); if(!alive()) return;
  if(def && !def.isPlayer) speakBy(def, fill(pick(LINES.defenseOpen), vars), 3800);
  else if(def && def.isPlayer) showSpeech(save.sock.name, 'Я адвокат! Мой клиент невиновен!', 3000);
  await sleep(4000); if(!alive()) return;

  // PRESENT rounds (3 rounds)
  setPhase('present','🃏 Доказательства');
  toast('🃏 Предъявляй доказательства! Выбери карту + стиль.');
  for(let round=0; round<3; round++){
    if(!alive()) return;
    gameState.round = round+1;
    // Prosecutor AI
    if(pros && !pros.isPlayer && pros.hand.length){
      const card = aiChooseCard(pros.hand,'prosecutor',gameState.deck);
      const style = aiChooseStyle(card);
      const score = persuasionScore(card, style, gameState.deck, pros.charisma);
      speakBy(pros, generatePresentLine(card, style, vars), 3600, `${STYLES[style].emoji} ${STYLES[style].name} • +${score}`);
      sfx.present(); addChaos(STYLES[style].chaos);
      gameState.prosScore += score;
      pros.hand = pros.hand.filter(c=>c!==card);
      logCourt(`🃏 Прокурор: ${card.name} (+${score})`);
      await sleep(3200); if(!alive()) return;
      // Defense objection chance
      if(def && !def.isPlayer && Math.random()<0.35){
        speakBy(def, pick(LINES.objection), 1800, '✋ Возражение!');
        sfx.objection(); addChaos(2);
        gameState.prosScore = Math.max(0, gameState.prosScore-1.5);
        await sleep(1800); if(!alive()) return;
      }
    }
    // Defense AI
    if(def && !def.isPlayer && def.hand.length){
      const card = aiChooseCard(def.hand,'defense',gameState.deck);
      const style = aiChooseStyle(card);
      const score = persuasionScore(card, style, gameState.deck, def.charisma);
      speakBy(def, generatePresentLine(card, style, vars), 3600, `${STYLES[style].emoji} ${STYLES[style].name} • +${score}`);
      sfx.present(); addChaos(STYLES[style].chaos);
      gameState.defScore += score;
      def.hand = def.hand.filter(c=>c!==card);
      logCourt(`🃏 Адвокат: ${card.name} (+${score})`);
      await sleep(3200); if(!alive()) return;
      if(pros && !pros.isPlayer && Math.random()<0.3){
        speakBy(pros, pick(LINES.objection), 1800, '✋ Возражение!');
        sfx.objection(); addChaos(2);
        gameState.defScore = Math.max(0, gameState.defScore-1.5);
        await sleep(1800); if(!alive()) return;
      }
    }
    // Player hint (no extra wait — you can present at any moment)
    if(aiSocks.find(s=>s.isPlayer)?.hand?.length){
      toast(`Раунд ${round+1}/3: твоя очередь! Выбери карту и стиль, жми «Предъявить».`);
    }
  }

  // WITNESS
  setPhase('witness','👁️ Свидетель');
  if(wit && !wit.isPlayer){
    speakBy(wit, fill(pick(LINES.witness), vars), 4000);
    sfx.crowdOoh();
    // Witness sways scores a bit
    if(Math.random()<0.5) gameState.defScore += rand(2,5); else gameState.prosScore += rand(2,5);
    await sleep(4600); if(!alive()) return;
  } else if(wit && wit.isPlayer){
    toast('👁️ Ты свидетель! Выбери показание в панели справа.');
    renderWitnessOptions();
    await sleep(6000); if(!alive()) return;
  }

  // FREE CHAOS
  setPhase('free','🎪 Свободный хаос');
  toast('🎪 Свободный хаос! Ходи, кидай комки, говори (E). Через 15 сек — финал!');
  gameState.freeRoam = true;
  const freeEnd = Date.now()+15000;
  while(Date.now()<freeEnd){
    if(!alive()){ gameState.freeRoam=false; return; }
    if(gameState.chaos>=85 && judge && !judge.isPlayer){
      speakBy(judge, pick(LINES.chaosHigh), 2600);
      sfx.gavel(); addChaos(-25);
      await sleep(2800);
    }
    await sleep(500);
  }
  gameState.freeRoam=false;
  if(!alive()) return;

  // CLOSING
  setPhase('closing','🏁 Заключительные речи');
  if(pros && !pros.isPlayer) speakBy(pros, `Присяжные! ${cd.accused} виновен в «${cd.crime}». Голосуйте сердцем — и картами!`, 3600);
  await sleep(4000); if(!alive()) return;
  if(def && !def.isPlayer) speakBy(def, `Присяжные! ${cd.accused} невиновен. Верьте доказательствам, а не шуму!`, 3600);
  await sleep(4000); if(!alive()) return;

  // VOTING
  await runVoting(token);
}

async function runVoting(token){
  setPhase('voting','🗳️ Голосование');
  const alive = ()=> token===gameState.trialToken;
  // Streamer bias
  let streamerBias = 0;
  if(gameState.streamer){
    const sv = streamerVote(gameState.prosScore, gameState.defScore);
    $('chatGuilty').textContent = sv.guilty+'%'; $('chatInnocent').textContent = sv.innocent+'%';
    streamerBias = (sv.guilty-50)/25;
    logCourt(`🔴 Чат: ${sv.guilty}% за «виновен»`);
  }
  // Jurors vote
  const jurors = aiSocks.filter(s=>s.role==='juror');
  gameState.votes = [];
  for(const j of jurors){
    if(j.isPlayer){
      toast('🗳️ Голосуй: ВИНОВЕН или НЕВИНОВЕН (панель справа)!');
      $('jurorPanel').classList.remove('hidden');
      // Wait up to 12s for player vote
      const start = Date.now();
      while(!$('jurorPanel').classList.contains('hidden') && Date.now()-start<12000){
        if(!alive()) return;
        await sleep(300);
      }
      if($('jurorPanel').classList.contains('hidden')===false){
        $('jurorPanel').classList.add('hidden');
        const v = aiVote(gameState.prosScore, gameState.defScore, save.sock.charisma, gameState.chaos, streamerBias);
        gameState.votes.push({ name:j.name, guilty:v, player:true });
      }
    } else {
      const v = aiVote(gameState.prosScore, gameState.defScore, j.charisma, gameState.chaos, streamerBias);
      gameState.votes.push({ name:j.name, guilty:v });
      await sleep(400);
    }
  }
  if(gameState.votes.length===0){
    // No jurors in lobby: simulate 5
    for(let i=0;i<5;i++) gameState.votes.push({ name:`Присяжный ${i+1}`, guilty: aiVote(gameState.prosScore, gameState.defScore, 5, gameState.chaos, streamerBias) });
  }
  if(!alive()) return;
  const guiltyVotes = gameState.votes.filter(v=>v.guilty).length;
  const guilty = guiltyVotes > gameState.votes.length/2;
  // If player is judge, they decide (override if they click verdict earlier? simplified: judge AI announces, player judge gets bonus)
  await showVerdict(guilty, token);
}

async function showVerdict(guilty, token){
  setPhase('verdict','⚖️ Вердикт');
  const cd = gameState.caseData;
  const judge = findSock('judge');
  const text = fill(pick(guilty?LINES.verdictGuilty:LINES.verdictInnocent), { crime:cd.crime, accused:cd.accused });
  if(judge && !judge.isPlayer) speakBy(judge, text, 4200);
  sfx.gavel();
  if(guilty) sfx.crowdOoh(); else sfx.crowdCheer();
  await sleep(4400);
  if(token!==gameState.trialToken) return;

  // Determine player win
  let playerWon = false;
  const pr = gameState.playerRole;
  if(pr==='prosecutor') playerWon = guilty;
  else if(pr==='defense') playerWon = !guilty;
  else if(pr==='judge') playerWon = true; // judge always "wins" if verdict delivered (bonus)
  else if(pr==='juror'){
    const myVote = gameState.votes.find(v=>v.player);
    playerWon = myVote ? (myVote.guilty===guilty) : (Math.random()<0.5);
  }
  else playerWon = Math.random()<0.5; // witness/journalist/bailiff: fun participation

  if(playerWon){ gameState.matchWins++; save.wins++; save.score+=100; sfx.fanfare(); spawnConfetti(); }
  else { gameState.matchLosses++; save.score+=20; sfx.sad(); }
  save.cases++; storeSave(); updateHudScore();
  if(save.wins>=1) unlockAchievement('first_win');
  if(save.wins>=3) unlockAchievement('three_wins');
  if(pr==='judge' && playerWon) unlockAchievement('judge');

  // UI
  const stamp = $('verdictStamp');
  stamp.textContent = guilty ? 'ВИНОВЕН' : 'НЕВИНОВЕН';
  stamp.className = 'verdict-stamp' + (guilty?'':' innocent');
  $('verdictTitle').textContent = guilty ? `${cd.accused} — виновен!` : `${cd.accused} — свободен!`;
  $('verdictText').textContent = text + (playerWon ? ' 🎉 Ты выиграл это дело!' : ' 😢 В следующий раз повезёт.');
  $('verdictStats').innerHTML = `
    <div><b>${Math.round(gameState.prosScore)}</b>Очки прокурора</div>
    <div><b>${Math.round(gameState.defScore)}</b>Очки адвоката</div>
    <div><b>${Math.round(gameState.chaos)}%</b>Хаос в зале</div>
    <div><b>${gameState.paperHits}</b>Попаданий комком</div>`;
  $('verdictVotes').innerHTML = '<b>🗳️ Голоса присяжных:</b><br>' + gameState.votes.map(v=>`${v.guilty?'🔴':'🟢'} ${v.name}: ${v.guilty?'ВИНОВЕН':'НЕВИНОВЕН'}`).join('<br>');
  $('hud').classList.add('hidden');
  document.exitPointerLock?.();
  showScreen('verdictScreen');
  gameState.phase='verdict';

  // Match end?
  if(gameState.matchWins>=3 || gameState.matchLosses>=3){
    $('btnNextCase').textContent = '🏁 ФИНАЛ МАТЧА';
  } else {
    $('btnNextCase').textContent = '➡️ СЛЕДУЮЩЕЕ ДЕЛО';
  }
}

function spawnConfetti(){
  const geo = new THREE.BoxGeometry(0.12,0.02,0.12);
  const colors = [0xf5c542,0xe63946,0x2ec4b6,0x4361ee,0xff5fa2];
  for(let i=0;i<60;i++){
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: pick(colors) }));
    m.position.set(rand(-6,6), rand(4,7), rand(-4,4));
    m.userData = { vel:new THREE.Vector3(rand(-1,1), rand(-2,-0.5), rand(-1,1)), rot:rand(-4,4) };
    scene.add(m); confetti.push(m);
  }
}
function updateConfetti(dt){
  for(let i=confetti.length-1;i>=0;i--){
    const c = confetti[i];
    c.position.addScaledVector(c.userData.vel, dt);
    c.rotation.x += c.userData.rot*dt; c.rotation.y += c.userData.rot*dt;
    if(c.position.y<0.1){ scene.remove(c); confetti.splice(i,1); }
  }
}

// ---------- Case / match ----------
function dailyCase(){
  const d = new Date();
  const seed = d.getFullYear()*10000 + (d.getMonth()+1)*100 + d.getDate();
  return CASES[seed % CASES.length];
}
function startMatch(quick=false){
  gameState.matchWins=0; gameState.matchLosses=0; gameState.caseNum=0;
  gameState.deck = save.deck || 'classic';
  gameState.streamer = !!save.streamer;
  if(quick){
    gameState.playerRole = pick(ROLES).id;
    save.theme = pick(Object.keys({classic:1,neon:1,medieval:1,candy:1}));
  }
  buildCourt();
  nextCase(quick);
}
function nextCase(quick=false){
  gameState.trialToken++;
  const token = gameState.trialToken;
  gameState.caseNum++;
  // Daily case every 3rd case as addon
  const cd = (gameState.caseNum%3===0) ? dailyCase() : pick(CASES);
  gameState.caseData = cd;
  gameState.prosScore=0; gameState.defScore=0; gameState.chaos=0;
  gameState.paperLeft=5; gameState.paperHits=0; gameState.objections=0; gameState.presented=0;
  gameState.trialStart = Date.now();
  $('timerChip').textContent = '⏱️ 0:00';
  $('speechBox').classList.add('hidden');
  gameState.headlinesLeft=3; gameState.selectedCard=null; gameState.selectedStyle=null;
  $('paperVal').textContent='5';
  addChaos(0);
  $('caseChip').textContent = `⚖️ Дело №${gameState.caseNum} • ${cd.title}`;
  $('caseTitle').textContent = cd.title;
  $('caseDesc').textContent = cd.desc;
  $('caseMeta').textContent = `👤 ${cd.accused} • 📍 ${cd.location} • Сложность ${'★'.repeat(cd.severity)}`;
  $('courtLog').innerHTML='';
  $('chatLines').innerHTML='';
  spawnAiSocks();
  renderHand(); renderStyleRow();
  updateRolePanels();
  $('hud').classList.remove('hidden');
  showScreen(null);
  updateHudScore();
  logCourt(`📁 Новое дело: ${cd.title}`);
  if(gameState.streamer){
    $('streamerChat').classList.remove('hidden');
    if(save.achievements && !save.achievements.streamer) unlockAchievement('streamer');
    startChatSim();
  } else $('streamerChat').classList.add('hidden');
  // Lock pointer on user gesture chain (button click) — request lock
  setTimeout(()=>{ requestLock(); }, 200);
  runTrial(token).catch(e=>{ if(!(e instanceof TrialEnd)) console.error(e); });
}
function updateRolePanels(){
  const pr = gameState.playerRole;
  $('judgePanel').classList.toggle('hidden', pr!=='judge');
  $('jurorPanel').classList.add('hidden'); // shown during voting
  $('journalistPanel').classList.toggle('hidden', pr!=='journalist');
  $('witnessPanel').classList.toggle('hidden', pr!=='witness');
  $('bailiffPanel').classList.toggle('hidden', pr!=='bailiff');
  if(pr==='journalist') renderHeadlines();
  if(pr==='witness') renderWitnessOptions();
}
function renderHeadlines(){
  const box = $('headlineOptions'); box.innerHTML='';
  if(gameState.headlinesLeft<=0){ box.innerHTML='<div style="font-size:12px;color:#aaa">Публикаций не осталось</div>'; return; }
  const vars = { crime: gameState.caseData.crime, accused: gameState.caseData.accused };
  shuffle(LINES.headlines).slice(0,3).forEach(h=>{
    const b = document.createElement('button'); b.className='headline-opt'; b.textContent = '📰 ' + fill(h, vars);
    b.addEventListener('click', ()=>{
      gameState.headlinesLeft--; sfx.present();
      const bonus = rand(2,5);
      if(Math.random()<0.5) gameState.prosScore+=bonus; else gameState.defScore+=bonus;
      logCourt(`📰 Заголовок: ${fill(h,vars)} (+${bonus})`);
      showSpeech(save.sock.name, fill(h,vars), 2600, '📰 Публикация!');
      save.score+=25; storeSave(); updateHudScore();
      renderHeadlines();
    });
    box.appendChild(b);
  });
}
function renderWitnessOptions(){
  const box = $('witnessOptions'); box.innerHTML='';
  const vars = { crime: gameState.caseData.crime, accused: gameState.caseData.accused };
  shuffle(LINES.witness).slice(0,3).forEach(line=>{
    const b = document.createElement('button'); b.className='witness-opt'; b.textContent = '👁️ ' + fill(line, vars);
    b.addEventListener('click', ()=>{
      const me = aiSocks.find(s=>s.isPlayer);
      speakBy(me, fill(line,vars), 3400, '👁️ Показания свидетеля');
      sfx.crowdOoh();
      if(Math.random()<0.5) gameState.defScore+=rand(3,6); else gameState.prosScore+=rand(3,6);
      save.score+=30; storeSave(); updateHudScore();
      box.innerHTML='<div style="font-size:12px;color:#aaa">Показания даны ✓</div>';
    });
    box.appendChild(b);
  });
}
let chatInterval = null;
function startChatSim(){
  clearInterval(chatInterval);
  const lines = $('chatLines');
  chatInterval = setInterval(()=>{
    if($('streamerChat').classList.contains('hidden')) return;
    const div = document.createElement('div');
    div.textContent = `💬 ${pick(LINES.chat)}`;
    lines.appendChild(div);
    while(lines.children.length>7) lines.removeChild(lines.firstChild);
  }, 2800);
}

// ---------- Pause ----------
function pauseGame(auto=false){
  if(gameState.phase==='menu'||gameState.phase==='verdict') return;
  gameState.paused = true;
  showScreen('pauseScreen');
  document.exitPointerLock?.();
}
function resumeGame(){
  gameState.paused = false;
  showScreen(null);
  requestLock();
}

// ---------- AI wander ----------
function updateAiWander(dt){
  for(const s of aiSocks){
    if(s.isPlayer) continue;
    if(gameState.freeRoam){
      s.wanderTimer -= dt;
      if(s.wanderTimer<=0 || !s.wanderTarget){
        s.wanderTarget = new THREE.Vector3(rand(-10,10), 0, rand(-6,8));
        s.wanderTimer = rand(3,7);
      }
      const target = s.wanderTarget.clone(); target.y = s.mesh.position.y;
      const dir = target.sub(s.mesh.position);
      if(dir.length()>0.4){
        dir.normalize();
        s.mesh.position.addScaledVector(dir, dt*1.6);
        s.mesh.lookAt(s.mesh.position.clone().add(dir).setY(s.mesh.position.y+1.5));
        animateSock(s.mesh, dt, performance.now()*0.001, { walking:true, speed:1.6 });
      } else animateSock(s.mesh, dt, performance.now()*0.001, {});
    } else {
      animateSock(s.mesh, dt, performance.now()*0.001, {});
      // Face speaker
      if(gameState.speaking && gameState.speaking.mesh!==s.mesh){
        s.mesh.lookAt(gameState.speaking.mesh.position.x, s.mesh.position.y+1.5, gameState.speaking.mesh.position.z);
      }
    }
  }
  if(playerSock) animateSock(playerSock, dt, performance.now()*0.001, {});
}

// ---------- Main loop ----------
function animate(){
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.05);
  const t = clock.elapsedTime;

  // Timer
  if(['opening','present','witness','free','closing','voting'].includes(gameState.phase) && !gameState.paused){
    if(!gameState.trialStart) gameState.trialStart = Date.now();
    const s = Math.floor((Date.now()-gameState.trialStart)/1000);
    $('timerChip').textContent = `⏱️ ${Math.floor(s/60)}:${String(s%60).padStart(2,'0')}`;
    // Chaos slowly decays
    if(Math.random()<0.002) addChaos(-1);
  }

  // Flags wave
  if(court?.flags){
    for(const f of court.flags){
      const cloth = f.userData.cloth;
      if(cloth){
        const pos = cloth.geometry.attributes.position;
        for(let i=0;i<pos.count;i++){
          const x = pos.getX(i);
          pos.setZ(i, Math.sin(t*3 + x*2)*0.08*(x+0.8));
        }
        pos.needsUpdate = true;
      }
    }
    if(court.chandelier) court.chandelier.rotation.y = t*0.15;
  }

  // Customize preview: orbit camera around your sock
  if($('customizeScreen').classList.contains('active')){
    playerSock.visible = true;
    playerSock.position.set(0,0,6);
    playerSock.rotation.y = Math.PI + Math.sin(t*0.5)*0.15;
    const a = t*0.55;
    camera.position.set(Math.sin(a)*3.6, 1.6 + Math.sin(t*0.4)*0.25, 6 + Math.cos(a)*3.6);
    camera.lookAt(0, 1.1, 6);
  } else if($('mainMenu').classList.contains('active') || $('loadingScreen').classList.contains('active')){
    // hero shot: your sock alone on the courtroom carpet
    playerSock.visible = true;
    playerSock.position.set(0,0,0);
    playerSock.rotation.y = Math.PI + Math.sin(t*0.4)*0.35;
    camera.position.set(Math.sin(t*0.14)*7.5, 3.1 + Math.sin(t*0.3)*0.25, Math.cos(t*0.14)*7.5);
    camera.lookAt(0,1.15,0);
  } else if(['verdict','menu'].includes(gameState.phase)){
    playerSock.visible = true;
    camera.position.set(Math.sin(t*0.15)*9, 4.0, Math.cos(t*0.15)*9);
    camera.lookAt(0,1.5,-3);
  } else {
    playerSock.visible = false;
    updatePlayer(dt);
    if(shakeAmt > 0.002){
      camera.position.x += rand(-1,1)*shakeAmt;
      camera.position.y += rand(-1,1)*shakeAmt*0.7;
      camera.rotation.z = rand(-1,1)*shakeAmt*0.12;
      shakeAmt *= Math.pow(0.015, dt);
    }
  }

  updatePaper(dt);
  updateConfetti(dt);
  updateAiWander(dt);
  renderer.render(scene, camera);
}

// ---------- Input ----------
function initInput(){
  window.addEventListener('keydown', e=>{
    const k = e.key.toLowerCase();
    player.keys[k]=true;
    if(k===' '){ e.preventDefault(); if(player.onGround){ player.vel.y=7; player.onGround=false; sfx.jump(); } }
    if(k==='e') doInteract();
    if(k==='q') doGavel();
    if(k==='r') doObjection();
    if(k==='escape' && gameState.phase!=='menu' && gameState.phase!=='verdict'){
      if(gameState.paused) resumeGame(); else pauseGame();
    }
  });
  window.addEventListener('keyup', e=>{ player.keys[e.key.toLowerCase()]=false; });
  // Free mouse-look: cursor over the 3D canvas steers the camera, cursor over HUD stays clickable.
  window.addEventListener('mousemove', e=>{
    if(!$('hud').classList.contains('hidden') && !gameState.paused &&
       !['menu','verdict'].includes(gameState.phase) &&
       e.target && e.target.id === 'gameCanvas'){
      const sens = 0.0024 * (save.settings.sens||5)/5;
      player.yaw -= (e.movementX||0) * sens;
      player.pitch = clamp(player.pitch - (e.movementY||0)*sens, -1.35, 1.35);
    }
  });
  document.addEventListener('mousedown', e=>{
    if(e.button!==0) return;
    if(!$('hud').classList.contains('hidden') && !gameState.paused && e.target && e.target.id==='gameCanvas'){
      throwPaper(true);
    }
  });
  window.addEventListener('contextmenu', e=>{ if(e.target && e.target.id==='gameCanvas') e.preventDefault(); });

}

// ---------- UI wiring ----------
let returnToPause = false;
function initUI(){
  // Loading fake progress
  let p=0;
  const loadInt = setInterval(()=>{
    p = Math.min(100, p+rand(8,18));
    $('loadFill').style.width = p+'%';
    $('loadText').textContent = p<40?'Загружаем зал суда…':p<75?'Надуваем носков…':p<100?'Точим молоток…':'Готово!';
    if(p>=100){ clearInterval(loadInt); setTimeout(()=>{ showScreen('mainMenu'); updateHudScore(); }, 400); }
  }, 220);

  // Menu buttons
  $('btnPlay').addEventListener('click', ()=>{ sfx.click(); openLobby(); });
  $('btnQuick').addEventListener('click', ()=>{ sfx.click(); startMatch(true); });
  $('btnCustomize').addEventListener('click', ()=>{ sfx.click(); showScreen('customizeScreen'); refreshCustomizeUI(); });
  $('btnDecks').addEventListener('click', ()=>{ sfx.click(); showScreen('decksScreen'); renderDecks(); });
  $('btnHow').addEventListener('click', ()=>{ sfx.click(); showScreen('howScreen'); });
  $('btnSettings').addEventListener('click', ()=>{ sfx.click(); showScreen('settingsScreen'); refreshSettingsUI(); });
  document.querySelectorAll('.btn-close').forEach(b=>b.addEventListener('click', ()=>{
    sfx.click();
    if(returnToPause && gameState.phase!=='menu' && gameState.phase!=='verdict'){ returnToPause=false; showScreen('pauseScreen'); }
    else showScreen('mainMenu');
  }));

  // Customize
  const colors = ['#e63946','#4361ee','#2ec4b6','#f5c542','#7209b7','#ff5fa2','#00f5ff','#ff8c42','#ffffff','#222222'];
  const sw = $('colorSwatches');
  colors.forEach(c=>{
    const d = document.createElement('div'); d.className='swatch'+(save.sock.color===c?' active':'');
    d.style.background=c; d.dataset.color=c;
    d.addEventListener('click', ()=>{ save.sock.color=c; buildPlayerSock(); refreshCustomizeUI(); sfx.pop(); });
    sw.appendChild(d);
  });
  const bindOptRow = (rowId, key)=>{
    $(rowId).querySelectorAll('.opt').forEach(b=>b.addEventListener('click', ()=>{
      save.sock[key]=b.dataset.pattern||b.dataset.acc||b.dataset.costume;
      buildPlayerSock(); refreshCustomizeUI(); sfx.pop();
    }));
  };
  bindOptRow('patternRow','pattern'); bindOptRow('accessoryRow','accessory'); bindOptRow('costumeRow','costume');
  $('sockNameInput').addEventListener('input', e=>{ save.sock.name=e.target.value||'Носок'; });
  $('charismaRange').addEventListener('input', e=>{ save.sock.charisma=+e.target.value; $('charismaVal').textContent=e.target.value; });
  $('btnSaveSock').addEventListener('click', ()=>{ storeSave(); sfx.fanfare(); toast('💾 Носок сохранён!'); updateHudScore(); });
  $('btnRandomSock').addEventListener('click', ()=>{
    save.sock.color=pick(colors); save.sock.pattern=pick(['plain','stripes','dots','checker','flame']);
    save.sock.accessory=pick(['none','glasses','wig','hat','bowtie','mustache','crown','horns']);
    save.sock.costume=pick(['casual','judge','lawyer','punk','royal']);
    buildPlayerSock(); refreshCustomizeUI(); sfx.pop();
  });

  // Decks
  renderDecks();
  // Lobby
  renderLobby();
  $('btnStartTrial').addEventListener('click', ()=>{ sfx.present(); startMatch(false); });
  $('aiCountRange').addEventListener('input', e=>{ save.aiCount=+e.target.value; $('aiCountVal').textContent=e.target.value; renderLobbyPlayers(); });

  // Settings
  $('btnApplySettings').addEventListener('click', ()=>{
    save.settings.volume=+$('volRange').value; save.settings.sens=+$('sensRange').value;
    sfx.setVolume(save.settings.volume/100); applyQuality(); storeSave(); sfx.fanfare(); toast('⚙️ Настройки применены');
  });
  $('btnResetProgress').addEventListener('click', ()=>{
    if(confirm('Сбросить весь прогресс?')){ localStorage.removeItem('gas_scripter_save'); location.reload(); }
  });
  $('qualityRow').querySelectorAll('.opt').forEach(b=>b.addEventListener('click', ()=>{
    save.settings.quality=b.dataset.q; refreshSettingsUI(); applyQuality();
  }));
  $('subtitleRow').querySelectorAll('.opt').forEach(b=>b.addEventListener('click', ()=>{
    save.settings.subtitles = b.dataset.sub==='on'; refreshSettingsUI();
  }));

  // HUD
  document.querySelectorAll('.style-btn[data-style]').forEach(b=>b.addEventListener('click', ()=>{
    gameState.selectedStyle=b.dataset.style; sfx.click(); renderStyleRow();
  }));
  $('btnPresent').addEventListener('click', playerPresent);
  $('btnGavel').addEventListener('click', doGavel);
  $('btnGiveFloor').addEventListener('click', ()=>{ sfx.gavelOnce(); toast('🎤 Слово дано! Говори (E рядом с носком)'); });
  $('btnMute').addEventListener('click', ()=>{ sfx.buzzer(); toast('🔇 Игрок заглушен на 5 сек (шутка)'); addChaos(2); });
  $('btnVerdict').addEventListener('click', ()=>{
    if(gameState.playerRole!=='judge') return;
    const guilty = gameState.prosScore > gameState.defScore;
    gameState.trialToken++; // cancel current trial
    showVerdict(guilty, gameState.trialToken).catch(()=>{});
  });
  $('btnVoteGuilty').addEventListener('click', ()=>{
    gameState.votes.push({ name:save.sock.name, guilty:true, player:true });
    $('jurorPanel').classList.add('hidden'); sfx.buzzer(); toast('🗳️ Голос: ВИНОВЕН');
  });
  $('btnVoteInnocent').addEventListener('click', ()=>{
    gameState.votes.push({ name:save.sock.name, guilty:false, player:true });
    $('jurorPanel').classList.add('hidden'); sfx.pop(); toast('🗳️ Голос: НЕВИНОВЕН');
  });
  $('btnOrder').addEventListener('click', ()=>{ sfx.gavel(); addChaos(-15); toast('📢 Порядок в зале!'); });
  $('btnEscort').addEventListener('click', ()=>{ sfx.buzzer(); addChaos(-10); toast('🚪 Хаотик выгнан!'); save.score+=15; storeSave(); updateHudScore(); });
  $('btnPauseHud').addEventListener('click', pauseGame);

  // Pause / verdict / match
  $('btnResume').addEventListener('click', resumeGame);
  $('btnRestartCase').addEventListener('click', ()=>{ gameState.paused=false; nextCase(); });
  $('btnQuitToMenu').addEventListener('click', quitToMenu);
  $('btnHowPause').addEventListener('click', ()=>{ returnToPause = true; showScreen('howScreen'); });
  $('btnNextCase').addEventListener('click', ()=>{
    sfx.click();
    if(gameState.matchWins>=3 || gameState.matchLosses>=3){ showMatchEnd(); }
    else nextCase();
  });
  $('btnVerdictMenu').addEventListener('click', quitToMenu);
  $('btnPlayAgain').addEventListener('click', ()=>{ startMatch(false); });
  $('btnMatchMenu').addEventListener('click', quitToMenu);

  updateHudScore();
  refreshCustomizeUI();
  refreshSettingsUI();
  sfx.setVolume((save.settings.volume??80)/100);
}

function quitToMenu(){
  gameState.trialToken++; gameState.phase='menu'; gameState.paused=false;
  $('hud').classList.add('hidden');
  clearAiSocks();
  buildPlayerSock();
  playerSock.position.set(0,0,6); player.pos.set(0,1.7,8);
  showScreen('mainMenu'); updateHudScore();
  document.exitPointerLock?.();
}
function showMatchEnd(){
  const won = gameState.matchWins>=3;
  $('matchStamp').textContent = won?'ПОБЕДА!':'ПОРАЖЕНИЕ';
  $('matchStamp').className = 'verdict-stamp gold';
  $('matchTitle').textContent = won?'🏆 Ты — чемпион суда!':'😢 Матч проигран';
  $('matchText').textContent = won?'Носок-легенда! Присяжные в восторге, зал аплодирует.':'Не сдавайся! Следующий суд — твой.';
  $('matchStats').innerHTML = `
    <div><b>${gameState.matchWins}–${gameState.matchLosses}</b>Счёт матча</div>
    <div><b>${save.score}</b>Всего очков</div>
    <div><b>${save.wins}</b>Побед</div>
    <div><b>${save.cases}</b>Дел сыграно</div>`;
  showScreen('matchEndScreen');
  if(won){ sfx.fanfare(); spawnConfetti(); }
}

function refreshCustomizeUI(){
  $('sockNameInput').value = save.sock.name;
  $('charismaRange').value = save.sock.charisma; $('charismaVal').textContent = save.sock.charisma;
  document.querySelectorAll('#colorSwatches .swatch').forEach(s=>s.classList.toggle('active', s.dataset.color===save.sock.color));
  const mark = (rowId, val, attr)=>$(rowId).querySelectorAll('.opt').forEach(b=>b.classList.toggle('active', b.dataset[attr]===val));
  mark('patternRow', save.sock.pattern, 'pattern');
  mark('accessoryRow', save.sock.accessory, 'acc');
  mark('costumeRow', save.sock.costume, 'costume');
}
function refreshSettingsUI(){
  $('volRange').value = save.settings.volume; $('sensRange').value = save.settings.sens;
  $('qualityRow').querySelectorAll('.opt').forEach(b=>b.classList.toggle('active', b.dataset.q===save.settings.quality));
  $('subtitleRow').querySelectorAll('.opt').forEach(b=>b.classList.toggle('active', (b.dataset.sub==='on')===!!save.settings.subtitles));
}
function renderDecks(){
  const grid = $('deckGrid'); grid.innerHTML='';
  DECKS.forEach(d=>{
    const div = document.createElement('div');
    div.className = 'deck-card' + (save.deck===d.id?' active':'');
    div.innerHTML = `<h3>${d.emoji} ${d.name}</h3><p>${d.desc}</p><div class="deck-bonus">Бонус: ${d.bonusText}</div>`;
    div.addEventListener('click', ()=>{ save.deck=d.id; storeSave(); renderDecks(); renderLobbyDeckRow(); sfx.pop(); });
    grid.appendChild(div);
  });
}
function renderLobbyDeckRow(){
  const row = $('lobbyDeckRow'); row.innerHTML='';
  DECKS.forEach(d=>{
    const b = document.createElement('button'); b.className='opt'+(save.deck===d.id?' active':''); b.textContent = `${d.emoji} ${d.name}`;
    b.addEventListener('click', ()=>{ save.deck=d.id; storeSave(); renderLobbyDeckRow(); sfx.click(); });
    row.appendChild(b);
  });
}
function renderLobby(){
  const grid = $('roleGrid'); grid.innerHTML='';
  ROLES.forEach(r=>{
    const div = document.createElement('div');
    div.className = 'role-card' + (save.role===r.id?' active':'');
    div.innerHTML = `<div class="r-emoji">${r.emoji}</div><b>${r.name}</b><small>${r.desc}</small>`;
    div.addEventListener('click', ()=>{
      save.role = r.id; gameState.playerRole = r.id;
      storeSave(); renderLobby(); renderLobbyPlayers(); sfx.pop();
    });
    grid.appendChild(div);
  });
  $('themeRow').querySelectorAll('.opt').forEach(b=>b.addEventListener('click', ()=>{
    save.theme=b.dataset.theme; storeSave(); buildCourt(); refreshThemeRow(); sfx.pop();
  }));
  refreshThemeRow();
  renderLobbyDeckRow();
  $('aiCountRange').value = save.aiCount||5; $('aiCountVal').textContent = save.aiCount||5;
  $('streamerRow').querySelectorAll('.opt').forEach(b=>b.addEventListener('click', ()=>{
    save.streamer = b.dataset.streamer==='on'; storeSave(); refreshStreamerRow(); sfx.click();
  }));
  refreshStreamerRow();
  renderLobbyPlayers();
}
function refreshThemeRow(){
  $('themeRow').querySelectorAll('.opt').forEach(b=>b.classList.toggle('active', b.dataset.theme===save.theme));
}
function refreshStreamerRow(){
  $('streamerRow').querySelectorAll('.opt').forEach(b=>b.classList.toggle('active', (b.dataset.streamer==='on')===!!save.streamer));
}
function renderLobbyPlayers(){
  const box = $('lobbyPlayers'); box.innerHTML='';
  const me = document.createElement('div'); me.className='lobby-player';
  me.innerHTML = `<div class="lp-sock" style="background:${save.sock.color}">🧦</div><div><b>${save.sock.name} (ты)</b><br><small>${roleName(save.role)}</small></div>`;
  box.appendChild(me);
  const others = ROLES.filter(r=>r.id!==save.role);
  const count = clamp(save.aiCount||5,3,8);
  for(let i=0;i<count;i++){
    const r = others[i%others.length];
    const div = document.createElement('div'); div.className='lobby-player';
    div.innerHTML = `<div class="lp-sock" style="background:${pick(SOCK_COLORS)}">🧦</div><div><b>${SOCK_NAMES[i%SOCK_NAMES.length]}</b><br><small>${r.emoji} ${r.name} • ИИ</small></div>`;
    box.appendChild(div);
  }
}
function openLobby(){
  gameState.playerRole = save.role || 'defense';
  showScreen('lobbyScreen');
  renderLobby();
}

// ---------- Boot ----------
try{
  initThree();
  initInput();
  initTouch();
  initUI();
}catch(err){
  console.error(err);
  $('loadText').textContent = 'Ошибка загрузки: ' + err.message + ' — проверь интернет (нужен CDN Three.js)';
}
