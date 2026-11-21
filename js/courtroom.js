// ============================================================
// 3D Courtroom builder — procedural, themed, no external assets.
// v2.1: процедурные текстуры (паркет, обои, мрамор, ковёр с эмблемой),
// лучи света из окон, дополнительные театральные источники света.
// ============================================================
import * as THREE from 'three';
import { THEMES } from './data.js';

// ---------- procedural textures (canvas) ----------
function parquetTexture(base, dark){
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0,0,512,512);
  const rows = 8, ph = 512/rows;
  for(let r=0;r<rows;r++){
    const off = (r%2)*128;
    for(let x=-128; x<512+128; x+=256){
      const shade = 0.28+Math.random()*0.3;
      g.fillStyle = 'rgba(0,0,0,'+shade.toFixed(2)+')';
      g.fillRect(x+off, r*ph, 252, ph-2);
      g.strokeStyle = dark; g.globalAlpha = 0.35; g.lineWidth = 1.4;
      g.beginPath();
      for(let i=0;i<3;i++){
        const gy = r*ph + 10 + Math.random()*(ph-20);
        g.moveTo(x+off+8, gy);
        g.lineTo(x+off+244, gy + (Math.random()*8-4));
      }
      g.stroke(); g.globalAlpha = 1;
      g.fillStyle = 'rgba(255,235,180,.07)'; g.fillRect(x+off, r*ph, 252, 3);
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(4,4);
  return tex;
}
function wallpaperTexture(accent){
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#2b2440'; g.fillRect(0,0,512,512);
  for(let x=0;x<512;x+=64){
    g.fillStyle = 'rgba(255,255,255,.045)'; g.fillRect(x,0,26,512);
    g.fillStyle = 'rgba(0,0,0,.22)'; g.fillRect(x+26,0,4,512);
  }
  // «Дамаск» — ромбики золотым
  g.fillStyle = accent; g.globalAlpha = 0.22;
  for(let y=32;y<512;y+=86){
    const off = ((y/86)%2)*43;
    for(let x=32+off;x<512;x+=86){
      g.beginPath();
      g.moveTo(x, y-11); g.lineTo(x+8, y); g.lineTo(x, y+11); g.lineTo(x-8, y); g.lineTo(x, y-11);
      g.fill();
    }
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(5,1.6);
  return tex;
}
function panelTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#3a2410'; g.fillRect(0,0,512,512);
  for(let x=0;x<512;x+=64){
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x,0,4,512);
    g.fillStyle = 'rgba(255,255,255,.05)'; g.fillRect(x+4,0,3,512);
    g.strokeStyle = 'rgba(245,197,66,.14)'; g.lineWidth = 3;
    g.strokeRect(x+10, 40, 44, 180);
    g.strokeRect(x+10, 292, 44, 140);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.repeat.set(6,1);
  return tex;
}
function marbleTexture(){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#d9c9a3'; g.fillRect(0,0,256,256);
  g.strokeStyle = 'rgba(90,80,60,.45)'; g.lineWidth = 1.6;
  for(let v=0;v<7;v++){
    let x = Math.random()*256, y = 0;
    g.globalAlpha = 0.5 + Math.random()*0.3;
    g.beginPath(); g.moveTo(x,y);
    while(y < 256){ y += 14+Math.random()*22; x += (Math.random()-0.5)*54; g.lineTo(x,y); }
    g.stroke();
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function carpetTexture(accent){
  const c = document.createElement('canvas'); c.width = 512; c.height = 768;
  const g = c.getContext('2d');
  // глубокий рубин + золотая кайма + эмблема
  g.fillStyle = '#6e0f14'; g.fillRect(0,0,512,768);
  g.fillStyle = 'rgba(255,255,255,.03)';
  for(let y=0;y<768;y+=6) g.fillRect(0,y,512,2);
  g.strokeStyle = accent; g.lineWidth = 14; g.globalAlpha = .9; g.strokeRect(18,18,476,732);
  g.lineWidth = 3; g.globalAlpha = .8; g.strokeRect(44,44,424,680);
  g.globalAlpha = 1;
  // эмблема-весы
  g.strokeStyle = accent; g.fillStyle = accent; g.globalAlpha = .92;
  g.beginPath(); g.arc(256,330,120,0,Math.PI*2); g.lineWidth = 10; g.stroke();
  g.beginPath(); g.arc(256,330,96,0,Math.PI*2); g.lineWidth = 3; g.stroke();
  g.font = '900 150px Georgia, serif'; g.textAlign = 'center';
  g.fillText('⚖', 256, 384);
  g.font = '900 34px Georgia, serif';
  g.fillText('Justitia', 256, 516);
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function woodTexture(base, dark){
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = base; g.fillRect(0,0,512,512);
  for(let y=0;y<512;y+=64){
    g.fillStyle = dark; g.globalAlpha = 0.25 + Math.random()*0.2;
    g.fillRect(0,y,512,3);
    g.globalAlpha = 0.12;
    for(let i=0;i<8;i++) g.fillRect(Math.random()*512, y+4, 40+Math.random()*80, 2);
  }
  g.globalAlpha = 1;
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function box(w,h,d,color,x,y,z,opts={}){
  const mat = opts.map
    ? new THREE.MeshStandardMaterial({ map: opts.map, roughness: opts.rough ?? 0.75, metalness: opts.metal ?? 0 })
    : new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0 });
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d), mat);
  m.position.set(x,y,z);
  m.castShadow = opts.shadow ?? true; m.receiveShadow = true;
  if(opts.ry) m.rotation.y = opts.ry;
  return m;
}
function cyl(rt,rb,h,color,x,y,z,opts={}){
  const mat = opts.map
    ? new THREE.MeshStandardMaterial({ map: opts.map, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0 })
    : new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0 });
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,opts.seg||16), mat);
  m.position.set(x,y,z); m.castShadow = true; m.receiveShadow = true;
  return m;
}

export function buildCourtroom(scene, themeId='classic'){
  const theme = THEMES[themeId] || THEMES.classic;
  const group = new THREE.Group();
  group.name = 'courtroom';

  // Clear old
  const old = scene.getObjectByName('courtroom');
  if(old){ scene.remove(old); }

  const accentCss = '#'+theme.accent.toString(16).padStart(6,'0');
  const floorTex = parquetTexture('#'+theme.floor.toString(16).padStart(6,'0'), '#000000');
  const wallTex = wallpaperTexture(accentCss);
  const panelTex = panelTexture();
  const marbleTex = marbleTexture();
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness:0.92 });
  const panelMat = new THREE.MeshStandardMaterial({ map: panelTex, roughness:0.7 });

  // Floor 30x24 (паркет)
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30,24),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness:0.65 }));
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true;
  group.add(floor);

  // Центральный ковёр с весами правосудия
  const carpetTex = carpetTexture(accentCss);
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(9,13.2),
    new THREE.MeshStandardMaterial({ map: carpetTex, roughness:0.98 }));
  carpet.rotation.x = -Math.PI/2; carpet.position.set(0,0.02,0.5); carpet.receiveShadow = true;
  group.add(carpet);

  // Walls (обои) + деревянные панели (нижняя треть)
  const mkWall = (w,h,x,y,z,ry)=>{
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), wallMat);
    m.position.set(x,y,z); m.rotation.y = ry; m.receiveShadow = true; group.add(m);
    const wains = new THREE.Mesh(new THREE.PlaneGeometry(w,1.35), panelMat);
    wains.position.set(x, 0.68, z); wains.rotation.y = ry;
    wains.translateZ(0.02); wains.receiveShadow = true; group.add(wains);
    return m;
  };
  mkWall(30,8, 0,4,-12, 0);
  mkWall(24,8, -15,4,0, Math.PI/2);
  mkWall(24,8, 15,4,0, -Math.PI/2);
  mkWall(30,8, 0,4,12, Math.PI);

  // Ceiling (кессоны)
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(30,24),
    new THREE.MeshStandardMaterial({ color:0x241f38, roughness:1 }));
  ceil.rotation.x = Math.PI/2; ceil.position.y = 8; group.add(ceil);
  for(let cx=-12;cx<=12;cx+=6){
    for(let cz=-9;cz<=9;cz+=6){
      group.add(box(5.2,0.18,5.2, 0x2e2846, cx,7.92,cz, { shadow:false }));
    }
  }

  // Judge bench (back center, high) — марморированные панели
  group.add(box(8,2.2,1.6, 0x3a2410, 0,1.1,-9.5, { map: panelTex }));
  group.add(box(8.6,0.3,2.0, 0x5a3a1a, 0,2.35,-9.5));
  group.add(box(8,0.5,1.6, theme.accent, 0,2.0,-9.5, { rough:0.5, metal:0.25 }));
  // Judge chair
  group.add(box(1.6,2.4,0.4, 0x8b0000, 0,3.2,-10.2));
  group.add(box(1.6,0.4,0.5, 0x8b0000, 0,2.2,-10.0));
  // Scales of justice on bench
  const scaleGroup = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({ color:0xf5c542, metalness:0.85, roughness:0.22, emissive:0x442200, emissiveIntensity:0.35 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.08,1.2,10), goldMat);
  pole.position.y = 0.6; scaleGroup.add(pole);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(1.1,0.06,0.06), goldMat);
  beam.position.y = 1.15; scaleGroup.add(beam);
  for(const s of [-1,1]){
    const pan = new THREE.Mesh(new THREE.CylinderGeometry(0.22,0.16,0.08,12), goldMat);
    pan.position.set(s*0.5,0.85,0); scaleGroup.add(pan);
    const str = new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.015,0.3,6), goldMat);
    str.position.set(s*0.5,1.0,0); scaleGroup.add(str);
  }
  scaleGroup.position.set(-2.5,2.5,-9.5); group.add(scaleGroup);
  // Gavel on bench (visual)
  const gavel = new THREE.Group();
  const gHead = new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.14,0.45,12), new THREE.MeshStandardMaterial({color:0x8b5a2b,roughness:0.55}));
  gHead.rotation.z = Math.PI/2; gavel.add(gHead);
  const gHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.6,8), new THREE.MeshStandardMaterial({color:0x5a3a1a}));
  gHandle.position.x = 0.45; gavel.add(gHandle);
  gavel.position.set(2.5,2.55,-9.5); gavel.rotation.y = 0.4; group.add(gavel);

  // JUSTICE sign (неоновая табличка)
  const signCanvas = document.createElement('canvas'); signCanvas.width=1024; signCanvas.height=128;
  const sg = signCanvas.getContext('2d');
  sg.fillStyle='#140f22'; sg.fillRect(0,0,1024,128);
  sg.strokeStyle='#f5c542'; sg.lineWidth=6; sg.strokeRect(8,8,1008,112);
  sg.fillStyle='#ffd966'; sg.font='900 74px Georgia, serif'; sg.textAlign='center';
  sg.globalAlpha=0.35; sg.fillText('⚖  J U S T I C E  ⚖',512,90);
  sg.globalAlpha=1; sg.fillText('⚖  J U S T I C E  ⚖',512,88);
  const signTex = new THREE.CanvasTexture(signCanvas); signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9,1.1), new THREE.MeshBasicMaterial({ map: signTex }));
  sign.position.set(0,6.2,-11.9); group.add(sign);

  // Prosecutor & Defense tables
  const table = (x,z,ry,color)=>{
    const t = new THREE.Group();
    t.add(box(4,1.1,1.4, 0x5a3a1a, 0,0.55,0, { map: panelTex }));
    t.add(box(4.3,0.15,1.7, 0x3a2410, 0,1.15,0));
    t.add(box(4,0.08,1.4, color, 0,1.24,0, { rough:0.4, metal:0.3 }));
    t.position.set(x,0,z); t.rotation.y = ry;
    return t;
  };
  group.add(table(-4.5,-4,0, 0x4361ee));   // prosecutor left
  group.add(table( 4.5,-4,0, 0x2ec4b6));   // defense right
  // Name plates
  const plate = (text,x,z,color)=>{
    const c=document.createElement('canvas'); c.width=512; c.height=96;
    const g=c.getContext('2d'); g.fillStyle='#fff8e7'; g.fillRect(0,0,512,96);
    g.fillStyle='#231a00'; g.font='900 44px Arial'; g.textAlign='center'; g.fillText(text,256,62);
    const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace;
    const m=new THREE.Mesh(new THREE.PlaneGeometry(2.4,0.45), new THREE.MeshBasicMaterial({map:t, transparent:true}));
    m.position.set(x,1.55,z); group.add(m);
  };
  plate('ПРОКУРОР',-4.5,-3.2,0x4361ee);
  plate('АДВОКАТ',4.5,-3.2,0x2ec4b6);
  plate('СУДЬЯ',0,-8.6,0xf5c542);

  // Witness stand (right side)
  group.add(box(2.2,1.4,2.2, 0x5a3a1a, 9,0.7,-2, { map: panelTex }));
  group.add(box(2.4,0.15,2.4, 0x3a2410, 9,1.45,-2));
  group.add(box(0.15,1.2,2.2, 0x5a3a1a, 7.9,2.0,-2));
  group.add(box(0.15,1.2,2.2, 0x5a3a1a, 10.1,2.0,-2));
  plate('СВИДЕТЕЛЬ',9,-0.8,0xf5c542);

  // Jury box (left side, 6 seats)
  group.add(box(2.0,1.2,7, 0x5a3a1a, -9.5,0.6,-1, { map: panelTex }));
  group.add(box(2.2,0.15,7.2, 0x3a2410, -9.5,1.25,-1));
  for(let i=0;i<6;i++){
    group.add(box(1.6,0.9,0.9, 0x8b0000, -9.5,1.7,-3.6+i*1.05));
  }
  plate('ПРИСЯЖНЫЕ',-8.4,-1,0x9a95c2);

  // Gallery pews (back rows)
  for(let r=0;r<3;r++){
    const z = 3 + r*2.6;
    group.add(box(12,0.6,1.0, 0x6b4423, 0,0.3,z));
    group.add(box(12,1.0,0.25, 0x6b4423, 0,0.9,z+0.6));
    group.add(box(12,0.15,1.2, 0x8b5a2b, 0,0.65,z));
  }
  // Side pews
  for(const sx of [-1,1]){
    for(let r=0;r<2;r++){
      group.add(box(1.0,0.6,8, 0x6b4423, sx*11,0.3,2));
      group.add(box(0.25,1.0,8, 0x6b4423, sx*11.5,0.9,2));
    }
  }

  // Pillars (мрамор)
  for(const [x,z] of [[-7,-7],[7,-7],[-7,6],[7,6],[-13,-7],[13,-7]]){
    group.add(cyl(0.5,0.6,8, 0xd9c9a3, x,4,z,{seg:12, map: marbleTex, rough:0.35}));
    group.add(box(1.4,0.4,1.4, 0xb8a888, x,7.8,z));
    group.add(box(1.4,0.4,1.4, 0xb8a888, x,0.2,z));
  }

  // Flags
  const flag = (x,z,color)=>{
    const f = new THREE.Group();
    f.add(cyl(0.04,0.04,4.5, 0x888888, 0,2.25,0,{seg:8}));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.0,8,4),
      new THREE.MeshStandardMaterial({ color, side:THREE.DoubleSide, roughness:0.9, emissive:color, emissiveIntensity:0.12 }));
    cloth.position.set(0.85,3.9,0); f.add(cloth);
    f.position.set(x,0,z); f.rotation.y = Math.random()*0.6-0.3;
    f.userData.cloth = cloth;
    return f;
  };
  const flags = [flag(-6,-11,0xe63946), flag(6,-11,0x4361ee), flag(-13,4,0xf5c542), flag(13,4,0x2ec4b6)];
  flags.forEach(f=>group.add(f));

  // Chandelier (сияющие лампочки + точка золотого света)
  const chand = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4,0.09,10,28), new THREE.MeshStandardMaterial({color:0xf5c542,metalness:0.75,roughness:0.25, emissive:0xcc8800, emissiveIntensity:0.4}));
  ring.rotation.x = Math.PI/2; chand.add(ring);
  for(let i=0;i<10;i++){
    const a=(i/10)*Math.PI*2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.13,8,8), new THREE.MeshBasicMaterial({color:0xffe9b0}));
    bulb.position.set(Math.cos(a)*1.4,0.18,Math.sin(a)*1.4); chand.add(bulb);
    const candle = new THREE.Mesh(new THREE.CylinderGeometry(0.05,0.06,0.3,6), new THREE.MeshStandardMaterial({color:0xf8f0d8, emissive:0xffd88a, emissiveIntensity:0.5}));
    candle.position.set(Math.cos(a)*1.4,0.02,Math.sin(a)*1.4); chand.add(candle);
  }
  const crown = new THREE.Mesh(new THREE.ConeGeometry(0.34,0.5,10), goldMat || new THREE.MeshStandardMaterial({color:0xf5c542, metalness:0.8, roughness:0.3}));
  crown.position.y = -0.32; chand.add(crown);
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,2,6), new THREE.MeshStandardMaterial({color:0x888888}));
  chain.position.y = 1.2; chand.add(chain);
  chand.position.set(0,6.5,0); group.add(chand);

  // Windows with light (back wall) + световые лучи из окон
  for(let i=-2;i<=2;i++){
    if(i===0) continue;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2,3.2),
      new THREE.MeshBasicMaterial({ color: theme.light, transparent:true, opacity:0.9 }));
    win.position.set(i*4.5,4.5,-11.95); group.add(win);
    // рама
    group.add(box(2.4,0.16,0.12, 0x2a1f10, i*4.5,6.15,-11.9));
    group.add(box(2.4,0.16,0.12, 0x2a1f10, i*4.5,2.85,-11.9));
    group.add(box(0.16,3.4,0.12, 0x2a1f10, i*4.5-1.18,4.5,-11.9));
    group.add(box(0.16,3.4,0.12, 0x2a1f10, i*4.5+1.18,4.5,-11.9));
    group.add(box(0.08,3.2,0.08, 0x2a1f10, i*4.5,4.5,-11.92, { shadow:false }));
    group.add(box(2.2,0.08,0.08, 0x2a1f10, i*4.5,4.5,-11.92, { shadow:false }));
    // луч света (аддитивный конус)
    const ray = new THREE.Mesh(
      new THREE.ConeGeometry(1.6, 7.5, 12, 1, true),
      new THREE.MeshBasicMaterial({ color: theme.light, transparent:true, opacity:0.055, blending:THREE.AdditiveBlending, depthWrite:false, side:THREE.DoubleSide })
    );
    ray.position.set(i*4.5, 3.6, -9.2);
    ray.rotation.x = 0.42;
    group.add(ray);
  }

  // Podium for journalist / bailiff
  group.add(box(1.6,1.2,1.0, 0x3a2410, -6,0.6,2, { map: panelTex }));
  group.add(box(1.8,0.15,1.2, 0x5a3a1a, -6,1.25,2));
  plate('ПРЕССА',-6,2.6,0xe63946);
  group.add(box(1.6,1.2,1.0, 0x3a2410, 6,0.6,2, { map: panelTex }));
  group.add(box(1.8,0.15,1.2, 0x5a3a1a, 6,1.25,2));
  plate('ПРИСТАВ',6,2.6,0x7209b7);

  // Lights
  scene.add(group);
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  ambient.name = 'courtAmbient';
  scene.add(ambient);
  const hemi = new THREE.HemisphereLight(0xfff3d6, 0x1a1430, 0.55);
  hemi.name = 'courtHemi';
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(theme.light, 1.15);
  dir.position.set(8,14,6); dir.castShadow = true;
  dir.shadow.mapSize.set(2048,2048);
  dir.shadow.camera.left=-16; dir.shadow.camera.right=16; dir.shadow.camera.top=16; dir.shadow.camera.bottom=-16;
  dir.shadow.bias = -0.0004;
  dir.name = 'courtDir';
  scene.add(dir);
  const point = new THREE.PointLight(theme.accent, 26, 26, 1.6);
  point.position.set(0,6,0); point.name='courtPoint';
  scene.add(point);
  // театральные контурные света: синий (обвинение) / бирюзовый (защита)
  const prosSpot = new THREE.PointLight(0x4361ee, 14, 14, 1.8);
  prosSpot.position.set(-7,4.5,-4); prosSpot.name = 'courtPros'; scene.add(prosSpot);
  const defSpot = new THREE.PointLight(0x2ec4b6, 14, 14, 1.8);
  defSpot.position.set(7,4.5,-4); defSpot.name = 'courtDef'; scene.add(defSpot);

  // Spawn points (role -> position + lookAt)
  const spawns = {
    judge:      { pos:new THREE.Vector3(0,0,-8.2),    look:new THREE.Vector3(0,1.5,4) },
    prosecutor: { pos:new THREE.Vector3(-4.5,0,-2.6), look:new THREE.Vector3(0,1.5,-6) },
    defense:    { pos:new THREE.Vector3(4.5,0,-2.6),  look:new THREE.Vector3(0,1.5,-6) },
    witness:    { pos:new THREE.Vector3(9,1.5,-2),    look:new THREE.Vector3(0,1.5,-4) },
    juror:      { pos:new THREE.Vector3(-9.5,1.3,-1), look:new THREE.Vector3(0,1.5,-2) },
    journalist: { pos:new THREE.Vector3(-6,0,3.2),    look:new THREE.Vector3(0,1.5,-4) },
    bailiff:    { pos:new THREE.Vector3(6,0,3.2),     look:new THREE.Vector3(0,1.5,-4) },
    gallery:    { pos:new THREE.Vector3(0,0,8),       look:new THREE.Vector3(0,1.5,-6) },
  };

  return { group, spawns, flags, chandelier: chand, theme };
}

export function clearCourtroom(scene){
  for(const name of ['courtroom','courtAmbient','courtHemi','courtDir','courtPoint','courtPros','courtDef']){
    const o = scene.getObjectByName(name);
    if(o) scene.remove(o);
  }
}
