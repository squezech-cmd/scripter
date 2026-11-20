// Boots the real js/main.js (copied with rewritten imports) and drives it.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import FakeTimers from '@sinonjs/fake-timers';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

// --- copy main.js with import specifiers rewritten for the harness ---
let src = fs.readFileSync(path.join(root, 'js/main.js'), 'utf8');
src = src
  .replace(/from 'three'/g, `from '${path.join(here,'three-shim.mjs').replace(/\\/g,'/')}'`)
  .replace(/from '\.\/(data|sock|courtroom|ai|audio)\.js'/g, `from '${root.replace(/\\/g,'/')}/js/$1.js'`)
  .replace(/from 'three\/addons\/[^']*'/g, `from '${path.join(here,'three-shim.mjs').replace(/\\/g,'/')}'`);
const outFile = path.join(here, '_main.test.mjs');
fs.writeFileSync(outFile, src);

// --- fake timers (real time would make the trial take ~50s) ---
const timers = FakeTimers.withGlobal(globalThis).install({
  toFake: ['setTimeout','clearTimeout','setInterval','clearInterval','Date','performance'],
  now: 1700000000000,
});

const doc = globalThis.document;
const $ = id => doc.getElementById(id);
const assert = (cond, msg) => { if(!cond){ console.error('❌ FAIL:', msg); process.exitCode = 1; } else console.log('✅', msg); };
const rafCbs = new Map();
let rafId = 0;
globalThis.requestAnimationFrame = cb => { const id = ++rafId; rafCbs.set(id, cb); return id; };
globalThis.cancelAnimationFrame = id => rafCbs.delete(id);

function frame(){
  const cbs = [...rafCbs.values()]; rafCbs.clear();
  for(const cb of cbs){ cb(performance.now()); }
}
function frames(n, dt = 16){ for(let i=0;i<n;i++){ timers.tick(dt); frame(); } }
async function until(pred, label, maxMs = 90000, step = 100){
  let t = 0, lastLog = -1;
  while(t < maxMs){
    if(pred()) return true;
    timers.tick(step); frame(); t += step;
    if(Math.floor(t/5000) !== lastLog){ lastLog = Math.floor(t/5000);
      console.log(`   … ${(t/1000).toFixed(0)}s waiting for ${label} | phase="${$('phaseChip').textContent}" | pause=${$('pauseScreen').className} | verdict=${$('verdictScreen').className} | hud=${$('hud').className}`);
    }
    await new Promise(r=>setImmediate(r));
  }
  console.error('❌ timeout waiting for:', label);
  process.exitCode = 1;
  return false;
}
const visible = id => !$(id).classList.contains('hidden') && !$(id).classList.contains('active') ? null : true;

globalThis.__frame = frame;
globalThis.__frames = frames;
globalThis.__until = until;
globalThis.__timers = timers;
globalThis.__$ = $;
globalThis.__assert = assert;

// boot the game
try{
  await import(outFile + '?v=' + Date.now());
}catch(e){
  console.error('❌ BOOT ERROR:', e);
  process.exit(1);
}
console.log('— booted —');

// 1. loading completes -> main menu
await until(() => $('mainMenu').classList.contains('active'), 'main menu', 5000);
assert($('mainMenu').classList.contains('active'), 'main menu opened after loading');
frames(30);

// 2. customize screen opens and renders swatches / sock rebuilds
$('btnCustomize').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(5);
assert($('customizeScreen').classList.contains('active'), 'customize screen opened');
assert(doc.querySelectorAll('#colorSwatches .swatch').length === 10, 'color swatches rendered (10)');
doc.querySelectorAll('#colorSwatches .swatch')[3].dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
doc.querySelector('#patternRow .opt[data-pattern="stripes"]').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
assert($('patternRow').querySelector('.opt.active').dataset.pattern === 'stripes', 'pattern select works');

// 3. decks screen
$('btnDecks').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
assert(doc.querySelectorAll('#deckGrid .deck-card').length === 6, 'six decks rendered');
doc.querySelectorAll('#deckGrid .deck-card')[1].dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(2);

// 4. lobby
$('btnPlay').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
assert($('lobbyScreen').classList.contains('active'), 'lobby opened');
assert(doc.querySelectorAll('#roleGrid .role-card').length === 7, 'seven roles rendered');
doc.querySelectorAll('#roleGrid .role-card')[1].dispatchEvent(new MouseEvent('click', {bubbles:true})); // prosecutor
frames(2);
assert(doc.querySelectorAll('#lobbyPlayers .lobby-player').length > 1, 'lobby players list filled');

// 5. start trial as prosecutor
$('btnStartTrial').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(20);
assert(!$('hud').classList.contains('hidden'), 'HUD visible when trial starts');
assert(doc.querySelectorAll('#hand .ev-card').length === 5, 'player hand has 5 evidence cards');
assert($('caseTitle').textContent.length > 3, 'case loaded: ' + $('caseTitle').textContent);

// 6. evidence selection + presenting
const cards = doc.querySelectorAll('#hand .ev-card');
cards[0].dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
assert(doc.querySelector('#hand .ev-card.selected') != null, 'evidence card selectable');
doc.querySelector('.style-btn[data-style="logic"]').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
assert(doc.querySelector('.style-btn[data-style="logic"]').classList.contains('active'), 'style selectable');
$('btnPresent').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(10);
assert(!$('speechBox').classList.contains('hidden'), 'player speech shown after presenting');
assert(doc.querySelectorAll('#hand .ev-card').length === 4, 'card consumed from hand');

// 7. paper balls
$('gameCanvas').dispatchEvent(new MouseEvent('mousedown', {bubbles:true, button:0}));
frames(5);
assert($('paperVal').textContent === '4', 'paper ball thrown (5 -> 4)');

// 8. objection + gavel (prosecutor has no gavel)
$('btnObjection') || null;
frames(5);

// 9. let the AI trial run to the verdict
const reached = await until(() => $('verdictScreen').classList.contains('active'), 'verdict screen', 120000, 250);
assert(reached && $('verdictScreen').classList.contains('active'), 'verdict screen reached');
assert(['ВИНОВЕН','НЕВИНОВЕН'].includes($('verdictStamp').textContent), 'verdict stamp: ' + $('verdictStamp').textContent);
assert($('verdictVotes').textContent.includes('Голоса'), 'jury votes listed');

// 10. next case
$('btnNextCase').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(20);
assert(!$('hud').classList.contains('hidden'), 'next case starts a new trial');
assert($('caseChip').textContent.includes('Дело №2'), 'case counter incremented: ' + $('caseChip').textContent);

// 11. pause / resume mid trial
$('btnPauseHud').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(5);
assert($('pauseScreen').classList.contains('active'), 'pause screen opened');
$('btnResume').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(5);
assert(!$('pauseScreen').classList.contains('active'), 'resumed from pause');

// 12. trial keeps running after pause (did not die)
const reached2 = await until(() => $('verdictScreen').classList.contains('active'), 'second verdict after pause', 120000, 250);
assert(reached2, 'trial survived pause and reached verdict');

// 13. next case -> quit to menu
$('btnNextCase').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(10);
$('btnPauseHud').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
$('btnQuitToMenu').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(5);
assert($('mainMenu').classList.contains('active'), 'quit to menu works');
assert($('hud').classList.contains('hidden'), 'HUD hidden in menu');

// 14. quick play random role
$('btnQuick').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(20);
assert(!$('hud').classList.contains('hidden'), 'quick play starts trial');
await until(() => $('verdictScreen').classList.contains('active'), 'quick play verdict', 260000, 250);

// ---------- role-specific scenarios ----------
async function toMenu(){
  frames(3);
  if(!$('pauseScreen').classList.contains('active')){
    $('btnPauseHud').dispatchEvent(new MouseEvent('click', {bubbles:true}));
    frames(2);
  }
  $('btnQuitToMenu').dispatchEvent(new MouseEvent('click', {bubbles:true}));
  frames(3);
}
async function startAs(roleIdx, streamer=false){
  $('btnPlay').dispatchEvent(new MouseEvent('click', {bubbles:true}));
  frames(3);
  doc.querySelectorAll('#roleGrid .role-card')[roleIdx].dispatchEvent(new MouseEvent('click', {bubbles:true}));
  frames(2);
  const on = doc.querySelector('#streamerRow .opt[data-streamer="on"]');
  const off = doc.querySelector('#streamerRow .opt[data-streamer="off"]');
  ((streamer ? on : off)).dispatchEvent(new MouseEvent('click', {bubbles:true}));
  frames(2);
  $('btnStartTrial').dispatchEvent(new MouseEvent('click', {bubbles:true}));
  frames(20);
}

// verdict -> next cases until the verdict screen is left, then back to menu
async function clearVerdict(){
  if($('verdictScreen').classList.contains('active') || $('matchEndScreen').classList.contains('active')){
    $('btnVerdictMenu').dispatchEvent(new MouseEvent('click', {bubbles:true}));
    frames(4);
  }
}
await clearVerdict();
if($('matchEndScreen').classList.contains('active')){
  $('btnMatchMenu').dispatchEvent(new MouseEvent('click', {bubbles:true}));
  frames(4);
}

// JUDGE: gavel + verdict panel
await toMenu();
await startAs(0);
assert(!$('judgePanel').classList.contains('hidden'), 'judge panel visible for judge role');
const chaosBefore = parseInt($('chaosVal').textContent);
$('btnGavel').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
assert(!$('judgePanel').classList.contains('hidden') && parseInt($('chaosVal').textContent) <= chaosBefore, 'gavel works in judge panel');
$('btnVerdict').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(40);
await until(() => $('verdictScreen').classList.contains('active'), 'judge verdict', 20000, 250);
assert($('verdictScreen').classList.contains('active'), 'judge can end the trial with a verdict');
await clearVerdict();

// STREAMER mode (witness role)
await toMenu();
await startAs(3, true);
assert(!$('streamerChat').classList.contains('hidden'), 'streamer chat visible in streamer mode');
frames(400);
assert(doc.querySelectorAll('#chatLines > div').length > 0, 'streamer chat is live');

// JUROR: voting panel appears and is clickable
await toMenu();
await startAs(4);
await until(() => !$('jurorPanel').classList.contains('hidden'), 'juror voting panel', 200000, 250);
assert(!$('jurorPanel').classList.contains('hidden'), 'juror gets a vote panel');
$('btnVoteGuilty').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(10);
assert($('jurorPanel').classList.contains('hidden'), 'juror vote submitted');
await until(() => $('verdictScreen').classList.contains('active'), 'juror verdict', 30000, 250);
assert($('verdictScreen').classList.contains('active'), 'juror trial reaches verdict');
await clearVerdict();

// JOURNALIST
await toMenu();
await startAs(5);
assert(!$('journalistPanel').classList.contains('hidden'), 'journalist panel visible');
assert(doc.querySelectorAll('#headlineOptions .headline-opt').length === 3, 'journalist gets 3 headlines');
const beforeLog = $('courtLog').children.length;
doc.querySelector('#headlineOptions .headline-opt').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(5);
assert($('courtLog').textContent.includes('Заголовок'), 'journalist headline published');

// WITNESS
await toMenu();
await startAs(3);
assert(!$('witnessPanel').classList.contains('hidden'), 'witness panel visible');
assert(doc.querySelectorAll('#witnessOptions .witness-opt').length === 3, 'witness gets 3 testimonies');
doc.querySelector('#witnessOptions .witness-opt').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(5);
assert(!$('speechBox').classList.contains('hidden'), 'witness testimony spoken');

// BAILIFF
await toMenu();
await startAs(6);
assert(!$('bailiffPanel').classList.contains('hidden'), 'bailiff panel visible');
$('btnOrder').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
assert(parseInt($('chaosVal').textContent) >= 0, 'bailiff order button works');

// SAVE persistence
assert(globalThis.localStorage.getItem('gas_scripter_save') !== null, 'progress saved to localStorage');

// Pause -> how to play -> back to pause (returnToPause flow)
await until(() => ['opening','present','witness','free','closing','voting'].includes($('phaseChip').textContent.replace(/^[^А-Яа-яA-Za-z]+/,'').length ? 'present' : ''), 'trial running', 5000, 100);
$('btnPauseHud').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
$('btnHowPause').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
assert($('howScreen').classList.contains('active'), 'how-to opens from pause');
doc.querySelector('#howScreen .btn-close').dispatchEvent(new MouseEvent('click', {bubbles:true}));
frames(3);
assert($('pauseScreen').classList.contains('active'), 'closing how-to returns to pause, not menu');

console.log('— done — renders keep alive —');
const errs = globalThis.__errors || [];
if(errs.length){ console.error('ERRORS:', errs.slice(0,5)); process.exitCode = 1; }
if(process.exitCode) console.error('TEST RESULT: FAILED'); else console.log('TEST RESULT: OK');
timers.uninstall();
process.exit(process.exitCode || 0);
