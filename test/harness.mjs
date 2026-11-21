// Test harness: runs the real game modules inside jsdom with a stubbed WebGL renderer.
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const dom = new JSDOM(html, { pretendToBeVisual: true, url: 'http://localhost/' });
const { window } = dom;

// ---- fake 2D canvas context so CanvasTexture code paths work ----
const fake2d = () => new Proxy({
  canvas: null, fillStyle: '#000', strokeStyle: '#000', font: '', textAlign: '', lineWidth: 1, globalAlpha: 1,
  fillRect(){}, strokeRect(){}, clearRect(){}, fillText(){}, beginPath(){}, arc(){}, ellipse(){},
  moveTo(){}, lineTo(){}, stroke(){}, fill(){}, save(){}, restore(){}, translate(){}, rotate(){},
  createLinearGradient(){ return { addColorStop(){} }; },
  createRadialGradient(){ return { addColorStop(){} }; },
  drawImage(){}, measureText(){ return { width: 10 }; },
}, { get(t, k){ return k in t ? t[k] : () => {}; }, set(t, k, v){ t[k] = v; return true; } });
window.HTMLCanvasElement.prototype.getContext = function(type){
  if(type === '2d'){ const c = fake2d(); c.canvas = this; return c; }
  return null;
};

// ---- globals the game expects ----
const g = globalThis;
g.window = window; g.document = window.document;
g.HTMLElement = window.HTMLElement; g.HTMLCanvasElement = window.HTMLCanvasElement;
g.Element = window.Element; g.Node = window.Node; g.Event = window.Event;
g.MouseEvent = window.MouseEvent; g.KeyboardEvent = window.KeyboardEvent;
g.TouchEvent = window.TouchEvent || window.Event;
try{ Object.defineProperty(g,'navigator',{value:window.navigator,configurable:true}); }catch(e){}
g.devicePixelRatio = 1;
g.innerWidth = 1280; g.innerHeight = 720;
try{ Object.defineProperty(g,'performance',{value:window.performance ?? g.performance,configurable:true,writable:true}); }catch(e){}
g.localStorage = { _d:{}, getItem(k){ return this._d[k] ?? null; }, setItem(k,v){ this._d[k]=String(v); }, removeItem(k){ delete this._d[k]; } };
g.confirm = () => true;
g.alert = () => {};
let rafId = 0; const rafCbs = new Map();
g.requestAnimationFrame = cb => { const id = ++rafId; rafCbs.set(id, cb); return id; };
g.cancelAnimationFrame = id => rafCbs.delete(id);
g.__pumpRaf = (frames = 1, dtMs = 16) => {
  for(let f = 0; f < frames; f++){
    const cbs = [...rafCbs.entries()];
    rafCbs.clear();
    for(const [, cb] of cbs) { try { cb(performance.now()); } catch(e){ console.error('RAF ERROR:', e); process.exitCode = 1; } }
  }
};
window.requestAnimationFrame = g.requestAnimationFrame;
window.cancelAnimationFrame = g.cancelAnimationFrame;

// report page-level errors
const errors = [];
window.addEventListener('error', e => errors.push('window:error ' + (e.message || e)));
process.on('unhandledRejection', r => { errors.push('unhandledRejection: ' + (r && r.stack || r)); });

// expose for tests
g.__errors = errors;
g.__dom = dom;

await import('./boot.mjs');
