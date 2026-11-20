// Re-export real three, but stub the GPU renderer so the game can boot in jsdom.
export * from 'three';
import * as T from 'three';

export class WebGLRenderer {
  constructor(opts = {}){
    this.domElement = opts.canvas || { addEventListener(){}, style:{}, getBoundingClientRect(){ return {left:0,top:0,width:1280,height:720}; } };
    this.shadowMap = { enabled:false, type: 0 };
    this.outputColorSpace = '';
    this.toneMapping = 0;
    this.toneMappingExposure = 1;
    this.info = { render:{ calls:0, triangles:0 } };
    this.renders = 0;
  }
  setPixelRatio(){ }
  setSize(){ }
  render(){ this.renders++; }
  dispose(){ }
  getContext(){ return {}; }
}
export const __realThree = T;
