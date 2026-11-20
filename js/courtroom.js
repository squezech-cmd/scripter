// ============================================================
// 3D Courtroom builder — procedural, themed, no external assets.
// ============================================================
import * as THREE from 'three';
import { THEMES } from './data.js';

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
  const m = new THREE.Mesh(new THREE.BoxGeometry(w,h,d),
    new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.85, metalness: opts.metal ?? 0 }));
  m.position.set(x,y,z);
  m.castShadow = opts.shadow ?? true; m.receiveShadow = true;
  if(opts.ry) m.rotation.y = opts.ry;
  return m;
}
function cyl(rt,rb,h,color,x,y,z,opts={}){
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,opts.seg||16),
    new THREE.MeshStandardMaterial({ color, roughness: opts.rough ?? 0.8, metalness: opts.metal ?? 0 }));
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

  const wallMat = new THREE.MeshStandardMaterial({ color: theme.wall, roughness:0.9 });
  const floorTex = woodTexture('#'+theme.floor.toString(16).padStart(6,'0'), '#000000');
  floorTex.repeat.set(4,4);
  const floorMat = new THREE.MeshStandardMaterial({ map: floorTex, roughness:0.7 });

  // Floor 30x24
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(30,24), floorMat);
  floor.rotation.x = -Math.PI/2; floor.receiveShadow = true;
  group.add(floor);

  // Carpet center
  const carpet = new THREE.Mesh(new THREE.PlaneGeometry(10,16),
    new THREE.MeshStandardMaterial({ color: theme.accent, roughness:1 }));
  carpet.rotation.x = -Math.PI/2; carpet.position.set(0,0.02,0); carpet.receiveShadow = true;
  group.add(carpet);
  const carpet2 = new THREE.Mesh(new THREE.PlaneGeometry(8,14),
    new THREE.MeshStandardMaterial({ color:0x8b0000, roughness:1 }));
  carpet2.rotation.x = -Math.PI/2; carpet2.position.set(0,0.03,0); carpet2.receiveShadow = true;
  group.add(carpet2);

  // Walls
  const mkWall = (w,h,x,y,z,ry)=>{
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w,h), wallMat);
    m.position.set(x,y,z); m.rotation.y = ry; m.receiveShadow = true; group.add(m); return m;
  };
  mkWall(30,8, 0,4,-12, 0);
  mkWall(24,8, -15,4,0, Math.PI/2);
  mkWall(24,8, 15,4,0, -Math.PI/2);
  mkWall(30,8, 0,4,12, Math.PI);

  // Ceiling
  const ceil = new THREE.Mesh(new THREE.PlaneGeometry(30,24),
    new THREE.MeshStandardMaterial({ color:0x2a2350, roughness:1 }));
  ceil.rotation.x = Math.PI/2; ceil.position.y = 8; group.add(ceil);

  // Judge bench (back center, high)
  group.add(box(8,2.2,1.6, 0x3a2410, 0,1.1,-9.5));
  group.add(box(8.6,0.3,2.0, 0x5a3a1a, 0,2.35,-9.5));
  group.add(box(8,0.5,1.6, theme.accent, 0,2.0,-9.5));
  // Judge chair
  group.add(box(1.6,2.4,0.4, 0x8b0000, 0,3.2,-10.2));
  group.add(box(1.6,0.4,0.5, 0x8b0000, 0,2.2,-10.0));
  // Scales of justice on bench
  const scaleGroup = new THREE.Group();
  const goldMat = new THREE.MeshStandardMaterial({ color:0xf5c542, metalness:0.8, roughness:0.25 });
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
  const gHead = new THREE.Mesh(new THREE.CylinderGeometry(0.14,0.14,0.45,12), new THREE.MeshStandardMaterial({color:0x8b5a2b,roughness:0.6}));
  gHead.rotation.z = Math.PI/2; gavel.add(gHead);
  const gHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.04,0.04,0.6,8), new THREE.MeshStandardMaterial({color:0x5a3a1a}));
  gHandle.position.x = 0.45; gavel.add(gHandle);
  gavel.position.set(2.5,2.55,-9.5); gavel.rotation.y = 0.4; group.add(gavel);

  // JUSTICE sign
  const signCanvas = document.createElement('canvas'); signCanvas.width=1024; signCanvas.height=128;
  const sg = signCanvas.getContext('2d');
  sg.fillStyle='#1a1428'; sg.fillRect(0,0,1024,128);
  sg.fillStyle='#f5c542'; sg.font='900 72px Georgia, serif'; sg.textAlign='center';
  sg.fillText('⚖  JUSTICE  ⚖',512,88);
  const signTex = new THREE.CanvasTexture(signCanvas); signTex.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(new THREE.PlaneGeometry(9,1.1), new THREE.MeshBasicMaterial({ map: signTex }));
  sign.position.set(0,6.2,-11.9); group.add(sign);

  // Prosecutor & Defense tables
  const table = (x,z,ry,color)=>{
    const t = new THREE.Group();
    t.add(box(4,1.1,1.4, 0x5a3a1a, 0,0.55,0));
    t.add(box(4.3,0.15,1.7, 0x3a2410, 0,1.15,0));
    t.add(box(4,0.08,1.4, color, 0,1.24,0));
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
    const m=new THREE.Mesh(new THREE.PlaneGeometry(2.4,0.45), new THREE.MeshBasicMaterial({map:t}));
    m.position.set(x,1.55,z); group.add(m);
  };
  plate('ПРОКУРОР',-4.5,-3.2,0x4361ee);
  plate('АДВОКАТ',4.5,-3.2,0x2ec4b6);
  plate('СУДЬЯ',0,-8.6,0xf5c542);

  // Witness stand (right side)
  group.add(box(2.2,1.4,2.2, 0x5a3a1a, 9,0.7,-2));
  group.add(box(2.4,0.15,2.4, 0x3a2410, 9,1.45,-2));
  group.add(box(0.15,1.2,2.2, 0x5a3a1a, 7.9,2.0,-2));
  group.add(box(0.15,1.2,2.2, 0x5a3a1a, 10.1,2.0,-2));
  plate('СВИДЕТЕЛЬ',9,-0.8,0xf5c542);

  // Jury box (left side, 6 seats)
  group.add(box(2.0,1.2,7, 0x5a3a1a, -9.5,0.6,-1));
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
      group.add(box(1.0,0.6,8, 0x6b4423, sx*11,0.3,2+r*0));
      group.add(box(0.25,1.0,8, 0x6b4423, sx*11.5,0.9,2));
    }
  }

  // Pillars
  for(const [x,z] of [[-7,-7],[7,-7],[-7,6],[7,6],[-13,-7],[13,-7]]){
    group.add(cyl(0.5,0.6,8, 0xd9c9a3, x,4,z,{seg:12}));
    group.add(box(1.4,0.4,1.4, 0xb8a888, x,7.8,z));
    group.add(box(1.4,0.4,1.4, 0xb8a888, x,0.2,z));
  }

  // Flags
  const flag = (x,z,color)=>{
    const f = new THREE.Group();
    f.add(cyl(0.04,0.04,4.5, 0x888888, 0,2.25,0,{seg:8}));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.6,1.0,8,4),
      new THREE.MeshStandardMaterial({ color, side:THREE.DoubleSide, roughness:0.9 }));
    cloth.position.set(0.85,3.9,0); f.add(cloth);
    f.position.set(x,0,z); f.rotation.y = Math.random()*0.6-0.3;
    f.userData.cloth = cloth;
    return f;
  };
  const flags = [flag(-6,-11,0xe63946), flag(6,-11,0x4361ee), flag(-13,4,0xf5c542), flag(13,4,0x2ec4b6)];
  flags.forEach(f=>group.add(f));

  // Chandelier
  const chand = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.4,0.08,8,24), new THREE.MeshStandardMaterial({color:0xf5c542,metalness:0.7,roughness:0.3}));
  ring.rotation.x = Math.PI/2; chand.add(ring);
  for(let i=0;i<8;i++){
    const a=(i/8)*Math.PI*2;
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.12,8,8), new THREE.MeshBasicMaterial({color:0xffe9b0}));
    bulb.position.set(Math.cos(a)*1.4,0.15,Math.sin(a)*1.4); chand.add(bulb);
  }
  const chain = new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,2,6), new THREE.MeshStandardMaterial({color:0x888888}));
  chain.position.y = 1.2; chand.add(chain);
  chand.position.set(0,6.5,0); group.add(chand);

  // Windows with light (back wall)
  for(let i=-2;i<=2;i++){
    if(i===0) continue;
    const win = new THREE.Mesh(new THREE.PlaneGeometry(2.2,3.2),
      new THREE.MeshBasicMaterial({ color: theme.light, transparent:true, opacity:0.85 }));
    win.position.set(i*4.5,4.5,-11.95); group.add(win);
    group.add(box(2.4,0.15,0.1, 0x3a2410, i*4.5,6.15,-11.9));
    group.add(box(2.4,0.15,0.1, 0x3a2410, i*4.5,2.85,-11.9));
  }

  // Podium for journalist / bailiff
  group.add(box(1.6,1.2,1.0, 0x3a2410, -6,0.6,2));
  group.add(box(1.8,0.15,1.2, 0x5a3a1a, -6,1.25,2));
  plate('ПРЕССА',-6,2.6,0xe63946);
  group.add(box(1.6,1.2,1.0, 0x3a2410, 6,0.6,2));
  group.add(box(1.8,0.15,1.2, 0x5a3a1a, 6,1.25,2));
  plate('ПРИСТАВ',6,2.6,0x7209b7);

  // Lights
  scene.add(group);
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  ambient.name = 'courtAmbient';
  scene.add(ambient);
  const dir = new THREE.DirectionalLight(theme.light, 1.2);
  dir.position.set(8,14,6); dir.castShadow = true;
  dir.shadow.mapSize.set(2048,2048);
  dir.shadow.camera.left=-16; dir.shadow.camera.right=16; dir.shadow.camera.top=16; dir.shadow.camera.bottom=-16;
  dir.name = 'courtDir';
  scene.add(dir);
  const point = new THREE.PointLight(theme.accent, 30, 30, 1.5);
  point.position.set(0,6,0); point.name='courtPoint';
  scene.add(point);

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
  for(const name of ['courtroom','courtAmbient','courtDir','courtPoint']){
    const o = scene.getObjectByName(name);
    if(o) scene.remove(o);
  }
}
