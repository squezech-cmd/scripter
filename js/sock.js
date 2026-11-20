// ============================================================
// Procedural 3D sock puppets — built from Three.js primitives.
// No external models needed. Canvas textures for patterns.
// ============================================================
import * as THREE from 'three';

const PATTERN_COLORS = {
  plain:   null,
  stripes: ['#ffffff','#e63946'],
  dots:    ['#ffffff'],
  checker: ['#ffffff','#222222'],
  flame:   ['#ff6b00','#ffd60a'],
};

export function makePatternTexture(pattern, baseColor){
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = baseColor; g.fillRect(0,0,256,256);
  if(pattern === 'stripes'){
    g.fillStyle = '#ffffff';
    for(let y=0;y<256;y+=42) g.fillRect(0,y,256,18);
    g.fillStyle = 'rgba(0,0,0,.15)';
    for(let y=18;y<256;y+=42) g.fillRect(0,y,256,4);
  } else if(pattern === 'dots'){
    g.fillStyle = 'rgba(255,255,255,.85)';
    for(let y=16;y<256;y+=36) for(let x=16;x<256;x+=36){
      g.beginPath(); g.arc(x + ((y/36)%2?9:0), y, 7, 0, Math.PI*2); g.fill();
    }
  } else if(pattern === 'checker'){
    const s=32;
    for(let y=0;y<8;y++) for(let x=0;x<8;x++){
      if((x+y)%2===0){ g.fillStyle='rgba(255,255,255,.55)'; g.fillRect(x*s,y*s,s,s); }
    }
  } else if(pattern === 'flame'){
    g.fillStyle='rgba(255,107,0,.9)';
    for(let i=0;i<14;i++){
      const x=Math.random()*256, y=140+Math.random()*116, r=14+Math.random()*26;
      g.beginPath(); g.ellipse(x,y,r*0.6,r,0,0,Math.PI*2); g.fill();
    }
    g.fillStyle='rgba(255,214,10,.95)';
    for(let i=0;i<10;i++){
      const x=Math.random()*256, y=180+Math.random()*76, r=8+Math.random()*14;
      g.beginPath(); g.ellipse(x,y,r*0.6,r,0,0,Math.PI*2); g.fill();
    }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function sockProfile(){
  // Lathe profile: from toe (bottom) to top opening
  const pts = [];
  const prof = [
    [0.00, 0.00],[0.30, 0.00],[0.42, 0.06],[0.46, 0.16],[0.44, 0.30],
    [0.40, 0.55],[0.38, 0.85],[0.40, 1.10],[0.44, 1.30],[0.46, 1.50],
    [0.44, 1.70],[0.40, 1.85],[0.36, 1.95],[0.34, 2.05],[0.36, 2.12],
  ];
  for(const [x,y] of prof) pts.push(new THREE.Vector2(x,y));
  return pts;
}

export function createSock(config = {}){
  const {
    color = '#e63946', pattern = 'plain', accessory = 'none', costume = 'casual',
    role = 'juror', name = 'Носок', scale = 1,
  } = config;

  const group = new THREE.Group();
  const tex = makePatternTexture(pattern, color);
  const bodyMat = new THREE.MeshStandardMaterial({ map: tex, roughness:0.85, metalness:0.0 });
  const darkMat = new THREE.MeshStandardMaterial({ color:0x222222, roughness:0.6 });

  // Body (sock tube + foot)
  const bodyGeo = new THREE.LatheGeometry(sockProfile(), 20);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.castShadow = true; body.receiveShadow = true;
  group.add(body);

  // Heel bump
  const heel = new THREE.Mesh(new THREE.SphereGeometry(0.30, 14, 12), bodyMat);
  heel.position.set(0, 0.28, -0.22); heel.scale.set(1,0.8,0.8); heel.castShadow = true;
  group.add(heel);

  // Toe cap (front)
  const toe = new THREE.Mesh(new THREE.SphereGeometry(0.30, 14, 12), bodyMat);
  toe.position.set(0, 0.10, 0.30); toe.scale.set(1,0.7,1.1); toe.castShadow = true;
  group.add(toe);

  // Cuff (top band)
  const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.40, 0.22, 20, 1, true),
    new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.9, side:THREE.DoubleSide }));
  cuff.position.y = 2.08; group.add(cuff);
  const cuffStripe = new THREE.Mesh(new THREE.CylinderGeometry(0.395, 0.395, 0.07, 20, 1, true),
    new THREE.MeshStandardMaterial({ color:0xf5c542, roughness:0.9, side:THREE.DoubleSide }));
  cuffStripe.position.y = 2.02; group.add(cuffStripe);

  // Eyes — googly
  const eyeWhite = new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.3 });
  const pupilMat = new THREE.MeshStandardMaterial({ color:0x111111, roughness:0.2 });
  const eyes = [];
  for(const side of [-1,1]){
    const eg = new THREE.Group();
    const w = new THREE.Mesh(new THREE.SphereGeometry(0.13, 14, 12), eyeWhite);
    const p = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), pupilMat);
    p.position.set(0, 0.02, 0.10);
    eg.add(w, p);
    eg.position.set(side*0.16, 1.78, 0.30);
    group.add(eg); eyes.push(eg);
  }

  // Mouth — openable
  const mouthGroup = new THREE.Group();
  const mouth = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.035, 8, 16, Math.PI), darkMat);
  mouth.rotation.x = Math.PI; mouth.rotation.z = Math.PI;
  mouthGroup.add(mouth);
  const mouthInner = new THREE.Mesh(new THREE.SphereGeometry(0.11, 10, 8),
    new THREE.MeshStandardMaterial({ color:0x7a1f2b, roughness:0.9 }));
  mouthInner.position.z = -0.02; mouthInner.scale.set(1,0.6,0.5);
  mouthGroup.add(mouthInner);
  mouthGroup.position.set(0, 1.52, 0.36);
  group.add(mouthGroup);

  // Arms
  const arms = [];
  for(const side of [-1,1]){
    const arm = new THREE.Group();
    const upper = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.08, 0.55, 10), bodyMat);
    upper.position.y = -0.27; upper.castShadow = true;
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.13, 10, 8),
      new THREE.MeshStandardMaterial({ color:0xffd9b3, roughness:0.8 }));
    hand.position.y = -0.58; hand.castShadow = true;
    arm.add(upper, hand);
    arm.position.set(side*0.48, 1.45, 0);
    arm.rotation.z = side * 0.5;
    group.add(arm); arms.push(arm);
  }

  // Legs / feet
  for(const side of [-1,1]){
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.12, 0.35, 10), bodyMat);
    leg.position.set(side*0.16, -0.12, 0); leg.castShadow = true;
    const foot = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), bodyMat);
    foot.position.set(side*0.16, -0.30, 0.08); foot.scale.set(1,0.6,1.4);
    group.add(leg, foot);
  }

  // Accessories
  addAccessory(group, accessory, bodyMat);
  // Costume overlays
  addCostume(group, costume, bodyMat);

  // Role badge (floating label handled separately, but add colored scarf)
  const roleColors = { judge:0x222222, prosecutor:0x4361ee, defense:0x2ec4b6, witness:0xf5c542, juror:0x9a95c2, journalist:0xe63946, bailiff:0x7209b7 };
  const scarf = new THREE.Mesh(new THREE.TorusGeometry(0.30, 0.07, 8, 18),
    new THREE.MeshStandardMaterial({ color: roleColors[role] ?? 0xffffff, roughness:0.8 }));
  scarf.position.y = 1.92; scarf.rotation.x = Math.PI/2;
  group.add(scarf);

  group.scale.setScalar(scale);
  group.userData = { eyes, mouth: mouthGroup, arms, body, heel, toe, name, role, talking:false, talkTime:0, gestureTime:0, walkPhase:0, baseY:0 };

  return group;
}

function addAccessory(group, acc, bodyMat){
  if(acc === 'glasses'){
    const mat = new THREE.MeshStandardMaterial({ color:0x111111, roughness:0.3, metalness:0.4 });
    for(const side of [-1,1]){
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.02, 8, 16), mat);
      lens.position.set(side*0.16, 1.78, 0.44); group.add(lens);
    }
    const bridge = new THREE.Mesh(new THREE.CylinderGeometry(0.015,0.015,0.14,6), mat);
    bridge.rotation.z = Math.PI/2; bridge.position.set(0,1.78,0.44); group.add(bridge);
  } else if(acc === 'wig'){
    const wig = new THREE.Mesh(new THREE.SphereGeometry(0.42, 16, 12, 0, Math.PI*2, 0, Math.PI*0.55),
      new THREE.MeshStandardMaterial({ color:0xf5f5f5, roughness:1 }));
    wig.position.y = 1.95; group.add(wig);
    const back = new THREE.Mesh(new THREE.CylinderGeometry(0.42,0.46,0.35,16,1,true),
      new THREE.MeshStandardMaterial({ color:0xf5f5f5, roughness:1, side:THREE.DoubleSide }));
    back.position.y = 1.78; group.add(back);
  } else if(acc === 'hat'){
    const hatMat = new THREE.MeshStandardMaterial({ color:0x111111, roughness:0.4 });
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.26,0.26,0.42,16), hatMat);
    top.position.y = 2.42; group.add(top);
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.44,0.44,0.05,16), hatMat);
    brim.position.y = 2.22; group.add(brim);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.27,0.27,0.10,16), new THREE.MeshStandardMaterial({ color:0xe63946 }));
    band.position.y = 2.28; group.add(band);
  } else if(acc === 'bowtie'){
    const m = new THREE.MeshStandardMaterial({ color:0xe63946, roughness:0.6 });
    for(const side of [-1,1]){
      const wing = new THREE.Mesh(new THREE.ConeGeometry(0.12,0.22,4), m);
      wing.rotation.z = side * Math.PI/2; wing.position.set(side*0.13, 1.62, 0.38); group.add(wing);
    }
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.06,8,8), m);
    knot.position.set(0,1.62,0.38); group.add(knot);
  } else if(acc === 'mustache'){
    const m = new THREE.MeshStandardMaterial({ color:0x3a2a1a, roughness:1 });
    for(const side of [-1,1]){
      const w = new THREE.Mesh(new THREE.SphereGeometry(0.12,10,8), m);
      w.scale.set(1.6,0.5,0.6); w.position.set(side*0.10, 1.44, 0.40); w.rotation.z = side*0.3; group.add(w);
    }
  } else if(acc === 'crown'){
    const gold = new THREE.MeshStandardMaterial({ color:0xf5c542, roughness:0.25, metalness:0.8 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.34,0.36,0.18,12,1,true), gold);
    band.position.y = 2.28; group.add(band);
    for(let i=0;i<6;i++){
      const spike = new THREE.Mesh(new THREE.ConeGeometry(0.06,0.18,4), gold);
      const a = (i/6)*Math.PI*2;
      spike.position.set(Math.cos(a)*0.34, 2.44, Math.sin(a)*0.34); group.add(spike);
    }
  } else if(acc === 'horns'){
    const m = new THREE.MeshStandardMaterial({ color:0xe63946, roughness:0.5 });
    for(const side of [-1,1]){
      const horn = new THREE.Mesh(new THREE.ConeGeometry(0.09,0.35,8), m);
      horn.position.set(side*0.28, 2.22, 0); horn.rotation.z = side * -0.5; group.add(horn);
    }
  }
}

function addCostume(group, costume, bodyMat){
  if(costume === 'judge'){
    const robe = new THREE.Mesh(new THREE.CylinderGeometry(0.52,0.62,1.1,16,1,true),
      new THREE.MeshStandardMaterial({ color:0x111111, roughness:0.9, side:THREE.DoubleSide }));
    robe.position.y = 0.85; group.add(robe);
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.30,0.06,8,16),
      new THREE.MeshStandardMaterial({ color:0xffffff, roughness:0.8 }));
    collar.position.y = 1.92; collar.rotation.x = Math.PI/2; group.add(collar);
  } else if(costume === 'lawyer'){
    const suit = new THREE.Mesh(new THREE.CylinderGeometry(0.50,0.58,1.0,16,1,true),
      new THREE.MeshStandardMaterial({ color:0x1a1a3a, roughness:0.9, side:THREE.DoubleSide }));
    suit.position.y = 0.85; group.add(suit);
    const tie = new THREE.Mesh(new THREE.BoxGeometry(0.10,0.45,0.03),
      new THREE.MeshStandardMaterial({ color:0xe63946 }));
    tie.position.set(0,1.45,0.44); group.add(tie);
  } else if(costume === 'punk'){
    const spikes = new THREE.Mesh(new THREE.CylinderGeometry(0.40,0.42,0.12,12,1,true),
      new THREE.MeshStandardMaterial({ color:0xff5fa2, roughness:0.7, side:THREE.DoubleSide }));
    spikes.position.y = 2.20; group.add(spikes);
    for(let i=0;i<5;i++){
      const s = new THREE.Mesh(new THREE.ConeGeometry(0.05,0.16,6),
        new THREE.MeshStandardMaterial({ color:0x00f5ff, metalness:0.6, roughness:0.3 }));
      const a=(i/5)*Math.PI*2; s.position.set(Math.cos(a)*0.38,2.32,Math.sin(a)*0.38); group.add(s);
    }
  } else if(costume === 'royal'){
    const cape = new THREE.Mesh(new THREE.CylinderGeometry(0.55,0.70,1.2,16,1,true),
      new THREE.MeshStandardMaterial({ color:0x7209b7, roughness:0.8, side:THREE.DoubleSide }));
    cape.position.y = 0.80; group.add(cape);
    const trim = new THREE.Mesh(new THREE.TorusGeometry(0.55,0.04,8,20),
      new THREE.MeshStandardMaterial({ color:0xf5c542, metalness:0.7, roughness:0.3 }));
    trim.position.y = 1.42; trim.rotation.x = Math.PI/2; group.add(trim);
  }
}

// Animate a sock: idle bob, walk wobble, talking mouth, gestures
export function animateSock(sock, dt, time, opts={}){
  const u = sock.userData;
  if(!u) return;
  const walking = opts.walking || false;
  const speed = opts.speed || 0;

  const baseY = u.baseY ?? 0;
  if(walking){
    u.walkPhase += dt * (6 + speed*2);
    sock.position.y = baseY + Math.abs(Math.sin(u.walkPhase)) * 0.08;
    sock.rotation.z = Math.sin(u.walkPhase) * 0.08;
    sock.rotation.y += Math.sin(u.walkPhase*0.5) * 0.002;
    u.arms[0].rotation.x = Math.sin(u.walkPhase) * 0.6;
    u.arms[1].rotation.x = -Math.sin(u.walkPhase) * 0.6;
  } else {
    sock.position.y = baseY + Math.sin(time*2 + sock.id) * 0.04;
    sock.rotation.z = Math.sin(time*1.3 + sock.id) * 0.03;
    u.arms[0].rotation.x = Math.sin(time*1.5) * 0.08;
    u.arms[1].rotation.x = Math.cos(time*1.5) * 0.08;
  }

  // Talking mouth
  if(u.talking){
    u.talkTime -= dt;
    if(u.talkTime <= 0) u.talking = false;
    const open = (Math.sin(time*22) > 0) ? 1 : 0.25;
    u.mouth.scale.set(1, open, 1);
    // gesture arms while talking
    u.arms[0].rotation.x = -0.8 + Math.sin(time*8)*0.3;
    u.arms[1].rotation.x = -0.8 + Math.cos(time*8)*0.3;
  } else {
    u.mouth.scale.set(1, 0.6, 1);
  }

  // Gesture (throw / point)
  if(u.gestureTime > 0){
    u.gestureTime -= dt;
    const k = Math.max(0, u.gestureTime);
    u.arms[1].rotation.x = -1.6 * Math.sin(k*8);
  }

  // Pupils follow player-ish (slight wander)
  u.eyes.forEach((e,i)=>{
    e.rotation.y = Math.sin(time*0.7 + i*2) * 0.25;
  });
}

export function sockSay(sock, seconds=2.2){
  sock.userData.talking = true;
  sock.userData.talkTime = seconds;
}
export function sockGesture(sock){
  sock.userData.gestureTime = 0.6;
}
