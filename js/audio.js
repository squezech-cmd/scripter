// ============================================================
// Synthesized SFX via WebAudio — no external files needed.
// ============================================================
export class SoundFX {
  constructor(){
    this.ctx = null;
    this.volume = 0.8;
    this.enabled = true;
  }
  ensure(){
    if(!this.ctx){
      try{ this.ctx = new (window.AudioContext || window.webkitAudioContext)(); }catch(e){ this.ctx = null; }
    }
    if(this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  setVolume(v){ this.volume = v; }
  tone(freq, dur, type='sine', vol=0.3, when=0, slideTo=null){
    if(!this.enabled) return;
    const ctx = this.ensure(); if(!ctx) return;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if(slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(20,slideTo), t+dur);
    g.gain.setValueAtTime(vol * this.volume, t);
    g.gain.exponentialRampToValueAtTime(0.001, t+dur);
    o.connect(g).connect(ctx.destination);
    o.start(t); o.stop(t+dur+0.02);
  }
  noise(dur, vol=0.2, when=0, freq=1000){
    if(!this.enabled) return;
    const ctx = this.ensure(); if(!ctx) return;
    const t = ctx.currentTime + when;
    const len = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for(let i=0;i<len;i++) d[i] = (Math.random()*2-1) * (1 - i/len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const f = ctx.createBiquadFilter(); f.type='bandpass'; f.frequency.value=freq; f.Q.value=0.8;
    const g = ctx.createGain(); g.gain.value = vol * this.volume;
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
  }
  gavel(){ this.noise(0.08,0.5,0,800); this.tone(180,0.12,'square',0.35,0,90); this.noise(0.08,0.5,0.14,800); this.tone(180,0.12,'square',0.35,0.14,90); }
  gavelOnce(){ this.noise(0.08,0.5,0,800); this.tone(180,0.12,'square',0.35,0,90); }
  paper(){ this.noise(0.18,0.25,0,2500); }
  paperHit(){ this.noise(0.1,0.4,0,1200); this.tone(300,0.1,'sine',0.2,0,150); }
  buzzer(){ this.tone(140,0.5,'sawtooth',0.25,0,120); this.tone(138,0.5,'sawtooth',0.25,0,120); }
  pop(){ this.tone(600,0.08,'sine',0.3,0,900); }
  objection(){ this.tone(880,0.15,'square',0.3,0,660); this.tone(660,0.2,'square',0.3,0.12,440); }
  crowdOoh(){ this.tone(300,0.6,'sine',0.15,0,220); this.tone(320,0.6,'sine',0.12,0.05,240); this.noise(0.5,0.08,0,600); }
  crowdCheer(){ [523,659,784,1046].forEach((f,i)=>this.tone(f,0.25,'triangle',0.25,i*0.09)); this.noise(0.6,0.1,0,900); }
  fanfare(){ [392,523,659,784,1046,784,1046].forEach((f,i)=>this.tone(f,0.3,'triangle',0.3,i*0.12)); }
  sad(){ [440,415,392,330].forEach((f,i)=>this.tone(f,0.35,'sine',0.25,i*0.18)); }
  click(){ this.tone(800,0.05,'sine',0.2,0,1000); }
  present(){ this.tone(523,0.12,'triangle',0.3,0); this.tone(784,0.2,'triangle',0.3,0.1); }
  jump(){ this.tone(300,0.15,'sine',0.2,0,600); }
  talk(){ this.tone(200+Math.random()*200,0.07,'square',0.08,0,150); }
}
export const sfx = new SoundFX();
