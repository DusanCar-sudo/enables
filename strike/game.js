'use strict';
/* DUSTLINE — core game. Player controller (source-style friction/accel,
   crouch, step-up), hitscan weapons with recoil patterns, bot AI
   (patrol/combat/hunt over waypoint graph), effects pools, HUD. */

/* ================= helpers ================= */
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const lerp = (a, b, t) => a + (b - a) * t;
const srand = () => (Math.random() + Math.random() + Math.random()) * 2 / 3 - 1; // ~gaussian -1..1
const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();

/* ================= renderer / scene ================= */
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9ec1dd);
scene.fog = new THREE.FogExp2(0xc9b892, 0.0042);

const camera = new THREE.PerspectiveCamera(75, innerWidth / innerHeight, 0.04, 400);
camera.rotation.order = 'YXZ';
scene.add(camera);

const hemi = new THREE.HemisphereLight(0xbfd6e8, 0x8a7a5c, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff2dd, 1.15);
sun.position.set(60, 90, 30);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -70; sun.shadow.camera.right = 70;
sun.shadow.camera.top = 70; sun.shadow.camera.bottom = -70;
sun.shadow.camera.near = 10; sun.shadow.camera.far = 250;
sun.shadow.bias = -0.0005;
scene.add(sun);
scene.add(sun.target);

/* map is loaded after settings are read (below) */
function applyMapAmbience() {
  const m = World.current;
  scene.background = new THREE.Color(m.sky);
  scene.fog = new THREE.FogExp2(m.fogColor, m.fogDensity);
}

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ================= DOM refs ================= */
const $ = id => document.getElementById(id);
const D = {
  hud: $('hud'), menu: $('menu'), death: $('death'), endscr: $('endscr'),
  ch: $('ch'), hitm: $('hitm'), vig: $('vig'), lowhp: $('lowhp'), dmgdir: $('dmgdir'),
  timer: $('timer'), scoreL: $('scoreL'), scoreR: $('scoreR'), feed: $('feed'),
  hpnum: $('hpnum'), hpbar: $('hpbar'), hpbarFill: $('hpbar').firstElementChild,
  wname: $('wname'), mag: $('mag'), reserve: $('reserve'), reloadTip: $('reloadTip'),
  fps: $('fps'), scoreboard: $('scoreboard'), sbBody: $('sbBody'), sbTitle: $('sbTitle'),
  playBtn: $('playBtn'), restartBtn: $('restartBtn'),
  mapSeg: $('mapSeg'), sideSeg: $('sideSeg'), diffSeg: $('diffSeg'), modeSeg: $('modeSeg'),
  roomSeg: $('roomSeg'), onlineRows: $('onlineRows'), nameInp: $('nameInp'),
  netStatus: $('netStatus'), menuSub: $('menuSub'),
  deathTxt: $('deathTxt'), deathSub: $('deathSub'), endTitle: $('endTitle'), endTxt: $('endTxt'),
  sens: $('sens'), vol: $('vol'), fovr: $('fovr'),
  sensV: $('sensV'), volV: $('volV'), fovV: $('fovV'),
};

/* ================= settings ================= */
const settings = {
  sens: 1, vol: 0.8, fov: 75,
  map: 'dust2', side: 'T', diff: 'medium', mode: 'offline', room: '1', name: 'PLAYER',
};
try { Object.assign(settings, JSON.parse(localStorage.getItem('dustline') || '{}')); } catch (e) { }
if (!World.MAPS[settings.map]) settings.map = 'dust2';
function applySettings() {
  D.sens.value = settings.sens; D.sensV.textContent = (+settings.sens).toFixed(2);
  D.vol.value = settings.vol; D.volV.textContent = Math.round(settings.vol * 100) + '%';
  D.fovr.value = settings.fov; D.fovV.textContent = settings.fov;
  AudioSys.setVolume(+settings.vol);
}
applySettings();
D.sens.addEventListener('input', () => { settings.sens = +D.sens.value; save(); });
D.vol.addEventListener('input', () => { settings.vol = +D.vol.value; save(); });
D.fovr.addEventListener('input', () => { settings.fov = +D.fovr.value; save(); });
function save() { applySettings(); localStorage.setItem('dustline', JSON.stringify(settings)); }

/* ================= teams / difficulty ================= */
const TEAMS = {
  T: {
    label: 'TERRORISTS', names: ['VIPER', 'ROOK', 'HAVOC', 'DAGGER', 'KOBRA'],
    cloth: 0x8a7a5c, vest: 0x3f4238, skin: 0xc99f78, helmet: 0x23241f,
  },
  CT: {
    label: 'POLICE', names: ['NOVA', 'ATLAS', 'JUDGE', 'BASTION', 'WARDEN'],
    cloth: 0x3d4c63, vest: 0x1c2735, skin: 0xd8b090, helmet: 0x111a26,
  },
};
const enemySide = () => settings.side === 'CT' ? 'T' : 'CT';

/* bot killer instinct — medium is the original tuning */
const DIFFS = {
  easy:   { react: [0.50, 0.45], skill: [0.55, 0.20], err: 1.9, vision: 42, burst: [2, 2], hear: 0.6, moveMul: 0.85 },
  medium: { react: [0.22, 0.30], skill: [0.85, 0.35], err: 1.0, vision: 65, burst: [3, 4], hear: 1.0, moveMul: 1.0 },
  hard:   { react: [0.07, 0.10], skill: [1.35, 0.35], err: 0.55, vision: 85, burst: [5, 4], hear: 1.6, moveMul: 1.12 },
};
const diff = () => DIFFS[settings.diff] || DIFFS.medium;

/* ================= menu wiring ================= */
let cfgDirty = true; // config changed since last (re)deploy

function segInit(el, key, cb) {
  const btns = el.querySelectorAll('button');
  btns.forEach(b => {
    b.classList.toggle('on', b.dataset.v === String(settings[key]));
    b.addEventListener('click', () => {
      if (String(settings[key]) === b.dataset.v) return;
      settings[key] = b.dataset.v;
      btns.forEach(x => x.classList.toggle('on', x === b));
      save();
      if (cb) cb();
    });
  });
}

function updateSub() {
  const mapLabel = World.MAPS[settings.map].label;
  const side = settings.side === 'CT' ? 'POLICE' : 'TERRORIST';
  D.menuSub.textContent = settings.mode === 'online'
    ? `${mapLabel} // ${side} // ONLINE GAME ${settings.room}`
    : `${mapLabel} // ${side} // 5 HOSTILES [${settings.diff.toUpperCase()}]`;
  D.playBtn.textContent = (state.started && !cfgDirty) ? 'RESUME' : 'DEPLOY';
}

segInit(D.mapSeg, 'map', () => {
  cfgDirty = true;
  if (!state.started) { World.load(settings.map, scene); applyMapAmbience(); }
  updateSub();
});
segInit(D.sideSeg, 'side', () => { cfgDirty = true; updateSub(); });
segInit(D.diffSeg, 'diff', () => { cfgDirty = true; updateSub(); });
segInit(D.roomSeg, 'room', () => { cfgDirty = true; updateSub(); });
segInit(D.modeSeg, 'mode', () => {
  cfgDirty = true;
  D.onlineRows.style.display = settings.mode === 'online' ? 'block' : 'none';
  updateSub();
});
D.onlineRows.style.display = settings.mode === 'online' ? 'block' : 'none';
D.nameInp.value = settings.name;
D.nameInp.addEventListener('input', () => {
  settings.name = D.nameInp.value.toUpperCase().slice(0, 12);
  save();
});

/* room occupancy polling while menu open in online mode */
setInterval(() => {
  if (D.menu.style.display === 'none' || settings.mode !== 'online') return;
  Net.fetchRooms().then(rooms => {
    for (const r of rooms) {
      const b = D.roomSeg.querySelector(`button[data-v="${r.n}"]`);
      if (b) b.textContent = `GAME ${r.n} — ${r.count}/${r.max}` + (r.map ? ` ${World.MAPS[r.map].label.replace('DE_', '')}` : '');
    }
    if (!D.netStatus.dataset.err) D.netStatus.textContent = '';
  }).catch(() => {
    if (!D.netStatus.dataset.err) D.netStatus.textContent = 'SERVER OFFLINE — run: node server.js';
  });
}, 2500);

/* initial map for menu backdrop */
World.load(settings.map, scene);
applyMapAmbience();
World.setPlayerTeam(settings.side);

/* ================= state ================= */
const state = {
  started: false, paused: true, over: false,
  time: 600, kills: 0, deaths: 0, tNow: 0,
};

const p = {
  pos: new THREE.Vector3(-40, 0, 0), vel: new THREE.Vector3(),
  yaw: -Math.PI / 2, pitch: 0, roll: 0,
  onGround: true, crouchF: 0, hp: 100, dead: false, respawnT: 0, spawnProt: 0,
  bobPhase: 0, bobAmp: 0, stepAcc: 0, landOff: 0, exert: 0,
  vigT: 0, dirT: 0, dirAng: 0, hitT: 0, hitHead: false,
};

/* ================= collision ================= */
function boxCollides(pos, hx, h) {
  for (const s of World.solids) {
    if (pos.x + hx > s.min.x && pos.x - hx < s.max.x &&
        pos.z + hx > s.min.z && pos.z - hx < s.max.z &&
        pos.y + h > s.min.y && pos.y < s.max.y) return s;
  }
  return null;
}

/* returns true if movement was blocked (after clamping) */
function moveAxis(pos, axis, d, hx, h, canStep) {
  if (d === 0) return false;
  pos[axis] += d;
  if (!boxCollides(pos, hx, h)) return false;
  if (canStep && axis !== 'y') {
    const oy = pos.y;
    pos.y = oy + 0.55;
    if (!boxCollides(pos, hx, h)) return false; // stepped up, gravity settles
    pos.y = oy;
  }
  for (let i = 0; i < 4; i++) {
    const s = boxCollides(pos, hx, h);
    if (!s) break;
    if (axis === 'y') pos.y = d > 0 ? s.min.y - h - 0.001 : s.max.y + 0.001;
    else pos[axis] = d > 0 ? s.min[axis] - hx - 0.001 : s.max[axis] + hx + 0.001;
  }
  return true;
}

/* ================= raycasts ================= */
function rayAABB(ro, rd, b, tMax) {
  let tmin = 0, tmax = tMax, axis = null, sign = 1;
  for (const a of ['x', 'y', 'z']) {
    const o = ro[a], d = rd[a];
    if (Math.abs(d) < 1e-9) {
      if (o < b.min[a] || o > b.max[a]) return null;
      continue;
    }
    const inv = 1 / d;
    let t1 = (b.min[a] - o) * inv, t2 = (b.max[a] - o) * inv, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tmin) { tmin = t1; axis = a; sign = s; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return null;
  }
  if (axis === null) return null;
  return { t: tmin, axis, sign };
}

function raySphere(ro, rd, cx, cy, cz, r, tMax) {
  const ox = ro.x - cx, oy = ro.y - cy, oz = ro.z - cz;
  const b = ox * rd.x + oy * rd.y + oz * rd.z;
  const c = ox * ox + oy * oy + oz * oz - r * r;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return (t > 0 && t < tMax) ? t : null;
}

function rayWorld(ro, rd, maxT) {
  let best = null, bt = maxT;
  if (rd.y < -1e-6) {
    const t = -ro.y / rd.y;
    if (t > 0 && t < bt) { bt = t; best = { t, nx: 0, ny: 1, nz: 0 }; }
  }
  for (const b of World.solids) {
    const h = rayAABB(ro, rd, b, bt);
    if (h) {
      bt = h.t;
      best = {
        t: h.t,
        nx: h.axis === 'x' ? h.sign : 0,
        ny: h.axis === 'y' ? h.sign : 0,
        nz: h.axis === 'z' ? h.sign : 0
      };
    }
  }
  if (best) best.point = new THREE.Vector3(ro.x + rd.x * best.t, ro.y + rd.y * best.t, ro.z + rd.z * best.t);
  return best;
}

function losBlocked(ax, ay, az, bx, by, bz) {
  _v1.set(ax, ay, az);
  _v2.set(bx - ax, by - ay, bz - az);
  const len = _v2.length();
  if (len < 0.01) return false;
  _v2.multiplyScalar(1 / len);
  return !!rayWorld(_v1, _v2, len - 0.25);
}

function panDistTo(pos) {
  _v3.copy(pos).sub(camera.position);
  const dist = _v3.length();
  if (dist < 0.01) return { pan: 0, dist: 0 };
  _v3.normalize();
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  return { pan: (_v3.x * rx + _v3.z * rz) * 0.85, dist };
}

/* ================= effects pools ================= */
function radialTex(draw) {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  draw(c.getContext('2d'));
  return new THREE.CanvasTexture(c);
}
const flashTex = radialTex(g => {
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,250,220,1)');
  gr.addColorStop(0.25, 'rgba(255,205,110,0.9)');
  gr.addColorStop(0.6, 'rgba(255,140,40,0.35)');
  gr.addColorStop(1, 'rgba(255,120,20,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(255,240,190,0.8)'; g.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    g.beginPath(); g.moveTo(32, 32);
    const a = i * Math.PI / 2 + 0.4;
    g.lineTo(32 + Math.cos(a) * 30, 32 + Math.sin(a) * 30); g.stroke();
  }
});
const decalTex = radialTex(g => {
  const gr = g.createRadialGradient(32, 32, 2, 32, 32, 26);
  gr.addColorStop(0, 'rgba(12,10,8,0.95)');
  gr.addColorStop(0.45, 'rgba(25,20,14,0.7)');
  gr.addColorStop(1, 'rgba(30,24,16,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
});

// tracers
const tracers = [];
{
  const geo = new THREE.BoxGeometry(1, 1, 1);
  for (let i = 0; i < 24; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color: 0xffd489, transparent: true, opacity: 0.85,
      blending: THREE.AdditiveBlending, depthWrite: false
    }));
    m.visible = false; scene.add(m);
    tracers.push({ m, life: 0 });
  }
}
function spawnTracer(a, b) {
  let tr = tracers.find(t => t.life <= 0) || tracers[0];
  tr.life = 0.06;
  tr.m.visible = true;
  tr.m.position.copy(a).add(b).multiplyScalar(0.5);
  const len = a.distanceTo(b);
  tr.m.scale.set(0.02, 0.02, Math.max(0.1, len));
  tr.m.lookAt(b);
}

// decals
const decals = [];
let decalI = 0;
{
  const geo = new THREE.PlaneGeometry(0.16, 0.16);
  for (let i = 0; i < 100; i++) {
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      map: decalTex, transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2
    }));
    m.visible = false; m.renderOrder = 1; scene.add(m);
    decals.push(m);
  }
}
function spawnDecal(point, nx, ny, nz) {
  const m = decals[decalI++ % decals.length];
  m.visible = true;
  m.position.set(point.x + nx * 0.01, point.y + ny * 0.01, point.z + nz * 0.01);
  _v1.set(point.x + nx, point.y + ny, point.z + nz);
  m.lookAt(_v1);
  m.rotateZ(Math.random() * Math.PI * 2);
  const s = 0.8 + Math.random() * 0.5;
  m.scale.set(s, s, s);
}

// particles
const PART_N = 400;
const partPos = new Float32Array(PART_N * 3);
const partCol = new Float32Array(PART_N * 3);
const partVel = new Float32Array(PART_N * 3);
const partLife = new Float32Array(PART_N);
const partGrav = new Float32Array(PART_N);
let partI = 0;
const partGeo = new THREE.BufferGeometry();
partGeo.setAttribute('position', new THREE.BufferAttribute(partPos, 3));
partGeo.setAttribute('color', new THREE.BufferAttribute(partCol, 3));
const partPts = new THREE.Points(partGeo, new THREE.PointsMaterial({
  size: 0.06, vertexColors: true, transparent: true, opacity: 0.95, depthWrite: false
}));
partPts.frustumCulled = false;
scene.add(partPts);
for (let i = 0; i < PART_N; i++) partPos[i * 3 + 1] = -999;

function spawnParticles(x, y, z, n, color, speed, grav, life, up) {
  const r = (color >> 16 & 255) / 255, g = (color >> 8 & 255) / 255, b = (color & 255) / 255;
  for (let k = 0; k < n; k++) {
    const i = partI++ % PART_N;
    partPos[i * 3] = x; partPos[i * 3 + 1] = y; partPos[i * 3 + 2] = z;
    partVel[i * 3] = srand() * speed;
    partVel[i * 3 + 1] = Math.abs(srand()) * speed * (up || 0.8);
    partVel[i * 3 + 2] = srand() * speed;
    partCol[i * 3] = r * (0.7 + Math.random() * 0.3);
    partCol[i * 3 + 1] = g * (0.7 + Math.random() * 0.3);
    partCol[i * 3 + 2] = b * (0.7 + Math.random() * 0.3);
    partLife[i] = life * (0.6 + Math.random() * 0.7);
    partGrav[i] = grav;
  }
}
function updateParticles(dt) {
  for (let i = 0; i < PART_N; i++) {
    if (partLife[i] <= 0) continue;
    partLife[i] -= dt;
    if (partLife[i] <= 0) { partPos[i * 3 + 1] = -999; continue; }
    partVel[i * 3 + 1] -= partGrav[i] * dt;
    partPos[i * 3] += partVel[i * 3] * dt;
    partPos[i * 3 + 1] += partVel[i * 3 + 1] * dt;
    partPos[i * 3 + 2] += partVel[i * 3 + 2] * dt;
  }
  partGeo.attributes.position.needsUpdate = true;
  partGeo.attributes.color.needsUpdate = true;
}

// shell casings
const shells = [];
{
  const geo = new THREE.BoxGeometry(0.012, 0.012, 0.045);
  const mat = new THREE.MeshStandardMaterial({ color: 0xc8a23c, roughness: 0.35, metalness: 0.85 });
  for (let i = 0; i < 20; i++) {
    const m = new THREE.Mesh(geo, mat);
    m.visible = false; scene.add(m);
    shells.push({ m, life: 0, vel: new THREE.Vector3(), rot: new THREE.Vector3() });
  }
}
let shellI = 0;
function spawnShell() {
  const s = shells[shellI++ % shells.length];
  s.life = 0.9;
  s.m.visible = true;
  camera.getWorldDirection(_v1);
  _v2.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw)); // right
  s.m.position.copy(camera.position).addScaledVector(_v1, 0.3).addScaledVector(_v2, 0.22);
  s.m.position.y -= 0.12;
  s.vel.copy(_v2).multiplyScalar(1.6 + Math.random()).setY(1.8 + Math.random());
  s.rot.set(srand() * 14, srand() * 14, srand() * 14);
}
function updateShells(dt) {
  for (const s of shells) {
    if (s.life <= 0) continue;
    s.life -= dt;
    if (s.life <= 0) { s.m.visible = false; continue; }
    s.vel.y -= 10 * dt;
    s.m.position.addScaledVector(s.vel, dt);
    s.m.rotation.x += s.rot.x * dt; s.m.rotation.y += s.rot.y * dt; s.m.rotation.z += s.rot.z * dt;
    if (s.m.position.y < 0.02) { s.m.position.y = 0.02; s.vel.y = Math.abs(s.vel.y) * 0.3; s.vel.x *= 0.6; s.vel.z *= 0.6; }
  }
}

// bot muzzle flash sprites + shared lights
const botFlashes = [];
for (let i = 0; i < 6; i++) {
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true
  }));
  sp.scale.set(0.6, 0.6, 1); sp.visible = false;
  scene.add(sp);
  botFlashes.push({ sp, life: 0 });
}
let botFlashI = 0;
function spawnBotFlash(pos) {
  const f = botFlashes[botFlashI++ % botFlashes.length];
  f.life = 0.05; f.sp.visible = true; f.sp.position.copy(pos);
  botFlashLight.position.copy(pos);
  botFlashLight.intensity = 2.0;
}
const botFlashLight = new THREE.PointLight(0xffc66a, 0, 9);
scene.add(botFlashLight);
const vmFlashLight = new THREE.PointLight(0xffc66a, 0, 7);
vmFlashLight.position.set(0.2, -0.15, -0.8);
camera.add(vmFlashLight);

/* ================= view models ================= */
const VM = {};
let vmKick = 0, vmSwayX = 0, vmSwayY = 0, mouseVX = 0, mouseVY = 0;
let knifeT = 0;

function vmPart(parent, mat, sx, sy, sz, x, y, z, rx) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
  m.position.set(x, y, z);
  if (rx) m.rotation.x = rx;
  parent.add(m);
  return m;
}
const M_metal = new THREE.MeshStandardMaterial({ color: 0x33322e, roughness: 0.42, metalness: 0.75 });
const M_dark = new THREE.MeshStandardMaterial({ color: 0x1f1e1c, roughness: 0.5, metalness: 0.6 });
const M_wood = new THREE.MeshStandardMaterial({ color: 0x6e4b28, roughness: 0.75, metalness: 0.05 });
const M_blade = new THREE.MeshStandardMaterial({ color: 0xb9c2c6, roughness: 0.25, metalness: 0.95 });

function makeFlashPlane(g, z) {
  const f = new THREE.Mesh(
    new THREE.PlaneGeometry(0.24, 0.24),
    new THREE.MeshBasicMaterial({ map: flashTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })
  );
  f.position.set(0, 0.008, z);
  f.visible = false;
  g.add(f);
  return f;
}

function buildRifleVM() {
  const g = new THREE.Group();
  vmPart(g, M_metal, 0.055, 0.075, 0.46, 0, 0, -0.02);          // receiver
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.3, 10), M_dark);
  bar.rotation.x = Math.PI / 2; bar.position.set(0, 0.008, -0.46); g.add(bar);
  vmPart(g, M_dark, 0.03, 0.03, 0.06, 0, 0.008, -0.62);          // brake
  vmPart(g, M_wood, 0.05, 0.055, 0.2, 0, -0.002, -0.32);         // handguard
  const mag = vmPart(g, M_dark, 0.033, 0.17, 0.075, 0, -0.11, -0.05, 0.32);
  vmPart(g, M_wood, 0.03, 0.085, 0.045, 0, -0.085, 0.09);        // grip
  vmPart(g, M_wood, 0.042, 0.075, 0.24, 0, -0.018, 0.27);        // stock
  vmPart(g, M_dark, 0.008, 0.045, 0.008, 0, 0.048, -0.58);       // front sight
  vmPart(g, M_dark, 0.032, 0.018, 0.02, 0, 0.05, -0.06);         // rear sight
  return { g, mag, flash: makeFlashPlane(g, -0.67), hip: new THREE.Vector3(0.26, -0.26, -0.5), ads: new THREE.Vector3(0, -0.053, -0.34) };
}
function buildPistolVM() {
  const g = new THREE.Group();
  vmPart(g, M_metal, 0.042, 0.05, 0.2, 0, 0.014, -0.1);          // slide
  vmPart(g, M_dark, 0.038, 0.05, 0.13, 0, -0.022, -0.08);        // frame
  const mag = vmPart(g, M_dark, 0.034, 0.115, 0.05, 0, -0.075, 0, -0.14);
  vmPart(g, M_dark, 0.007, 0.02, 0.007, 0, 0.048, -0.19);        // front sight
  vmPart(g, M_dark, 0.03, 0.015, 0.015, 0, 0.047, -0.01);        // rear sight
  return { g, mag, flash: makeFlashPlane(g, -0.24), hip: new THREE.Vector3(0.22, -0.24, -0.42), ads: new THREE.Vector3(0, -0.05, -0.3) };
}
function buildKnifeVM() {
  const g = new THREE.Group();
  vmPart(g, M_blade, 0.012, 0.045, 0.24, 0, 0.01, -0.16);
  vmPart(g, M_dark, 0.026, 0.05, 0.11, 0, 0, 0.02);
  return { g, mag: null, flash: null, hip: new THREE.Vector3(0.26, -0.27, -0.42), ads: new THREE.Vector3(0.26, -0.27, -0.42) };
}

VM.rifle = buildRifleVM();
VM.pistol = buildPistolVM();
VM.knife = buildKnifeVM();
for (const k in VM) { VM[k].g.visible = false; camera.add(VM[k].g); }

/* ================= weapons ================= */
const WEAPONS = {
  rifle: {
    name: 'AK-47', kind: 'rifle', magSize: 30, dmg: 34, interval: 0.1, reloadTime: 2.45,
    auto: true, spread: 0.0021, bloomAdd: 0.0016, bloomMax: 0.013, adsZoom: 0.79, adsSpread: 0.42,
    recoil(i) {
      const v = i < 2 ? 0.013 : i < 10 ? 0.019 : 0.010;
      const h = i < 6 ? (Math.random() - 0.5) * 0.005
        : Math.sin(i * 0.55) * 0.010 + (Math.random() - 0.5) * 0.003;
      return [v, h];
    }
  },
  pistol: {
    name: 'USP-S', kind: 'pistol', magSize: 12, dmg: 29, interval: 0.16, reloadTime: 2.2,
    auto: false, spread: 0.0026, bloomAdd: 0.003, bloomMax: 0.014, adsZoom: 0.88, adsSpread: 0.5,
    recoil() { return [0.011, (Math.random() - 0.5) * 0.004]; }
  },
  knife: {
    name: 'KNIFE', kind: 'knife', magSize: Infinity, dmg: 48, interval: 0.5,
    auto: true, spread: 0, bloomAdd: 0, bloomMax: 0, adsZoom: 1, adsSpread: 1,
    recoil() { return [0, 0]; }
  }
};
const loadout = { rifle: { mag: 30, reserve: 90 }, pistol: { mag: 12, reserve: 48 } };
let cur = 'rifle';
let firing = false, fireJust = false, adsHeld = false, adsF = 0;
let bloom = 0, recoilP = 0, recoilY = 0, shotIdx = 0, lastFireT = -9;
let reloading = false, reloadT = 0, reloadStage = 0;
let switching = null;

function currentSpread() {
  const w = WEAPONS[cur];
  if (w.kind === 'knife') return 0;
  const hsp = Math.hypot(p.vel.x, p.vel.z);
  let m = 1 + (hsp / 5.2) * 1.9;
  if (!p.onGround) m *= 3.4;
  m *= 1 - 0.3 * p.crouchF;
  m *= 1 - (1 - w.adsSpread) * adsF;
  return w.spread * m + bloom;
}

function switchTo(name) {
  if (cur === name || switching || p.dead) return;
  reloading = false;
  switching = { t: 0, to: name, swapped: false };
}

function startReload() {
  const w = WEAPONS[cur];
  if (w.kind === 'knife' || reloading || switching || p.dead) return;
  const L = loadout[cur];
  if (L.mag >= w.magSize || L.reserve <= 0) return;
  reloading = true; reloadT = 0; reloadStage = 0;
}

function shotDir(spread) {
  const d = new THREE.Vector3(srand() * spread, srand() * spread, -1).normalize();
  return d.applyQuaternion(camera.quaternion);
}

function tryFire() {
  const w = WEAPONS[cur];
  if (state.tNow - lastFireT < w.interval) return;
  if (w.kind === 'knife') { lastFireT = state.tNow; knifeAttack(); return; }
  const L = loadout[cur];
  if (L.mag <= 0) {
    if (fireJust) { AudioSys.empty(); if (L.reserve > 0) startReload(); }
    return;
  }
  lastFireT = state.tNow;
  L.mag--;
  // ray
  const spread = currentSpread();
  const rd = shotDir(spread);
  const ro = camera.position.clone();
  const wall = rayWorld(ro, rd, 300);
  const maxT = wall ? wall.t : 300;
  const hitBot = rayBots(ro, rd, maxT);
  const hitRem = Net.online ? Net.rayRemotes(ro, rd, hitBot ? hitBot.t : maxT) : null;
  // muzzle world position for tracer
  camera.getWorldDirection(_v1);
  _v2.set(Math.cos(p.yaw), 0, -Math.sin(p.yaw));
  const muzzle = camera.position.clone().addScaledVector(_v1, 0.55).addScaledVector(_v2, 0.13);
  muzzle.y -= 0.1 * (1 - adsF);
  let end;
  if (hitRem) {
    end = ro.clone().addScaledVector(rd, hitRem.t);
    const fall = clamp(1 - (hitRem.t - 16) * 0.007, 0.55, 1);
    const mult = hitRem.zone === 'head' ? 4 : hitRem.zone === 'legs' ? 0.75 : 1;
    Net.sendHit(hitRem.player.netId, w.dmg * fall * mult, hitRem.zone);
    p.hitT = 0.18; p.hitHead = hitRem.zone === 'head';
    AudioSys.hit(hitRem.zone === 'head');
    spawnParticles(end.x, end.y, end.z, 10, 0x8a1206, 2.6, 8, 0.45, 0.7);
  } else if (hitBot) {
    end = ro.clone().addScaledVector(rd, hitBot.t);
    const dist = hitBot.t;
    const fall = clamp(1 - (dist - 16) * 0.007, 0.55, 1);
    const zone = hitBot.zone;
    const mult = zone === 'head' ? 4 : zone === 'legs' ? 0.75 : 1;
    damageBot(hitBot.bot, w.dmg * fall * mult, zone);
    spawnParticles(end.x, end.y, end.z, 10, 0x8a1206, 2.6, 8, 0.45, 0.7);
  } else if (wall) {
    end = wall.point;
    spawnDecal(wall.point, wall.nx, wall.ny, wall.nz);
    spawnParticles(end.x, end.y, end.z, 7, 0xb59f72, 2, 3.5, 0.5, 1);
    spawnParticles(end.x, end.y, end.z, 3, 0xffd080, 5, 9, 0.22, 1);
    const pd = panDistTo(end);
    if (pd.dist > 6) AudioSys.impact(pd.dist, pd.pan);
  } else {
    end = ro.clone().addScaledVector(rd, 300);
  }
  spawnTracer(muzzle, end);
  if (Net.online) Net.sendShot(muzzle, end);
  // recoil / bloom / effects
  const [rp, ry] = w.recoil(shotIdx++);
  recoilP += rp; recoilY += ry;
  bloom = Math.min(w.bloomMax, bloom + w.bloomAdd);
  vmKick = 1;
  const vm = VM[cur];
  if (vm.flash) {
    vm.flash.visible = true;
    vm.flash.rotation.z = Math.random() * Math.PI * 2;
    const fs = 0.8 + Math.random() * 0.5;
    vm.flash.scale.set(fs, fs, fs);
    setTimeout(() => { vm.flash.visible = false; }, 45);
  }
  vmFlashLight.intensity = 2.4;
  spawnShell();
  AudioSys.shot(w.kind, 0, 0);
  alertBots(p.pos, 48 * diff().hear);
  if (L.mag === 0 && L.reserve > 0) startReload();
}

function knifeAttack() {
  knifeT = 0.25;
  AudioSys.shot('knife', 0, 0);
  const rd = shotDir(0);
  const ro = camera.position.clone();
  const wall = rayWorld(ro, rd, 2.2);
  const reach = wall ? Math.min(wall.t, 2.2) : 2.2;
  const hitBot = rayBots(ro, rd, reach);
  const hitRem = Net.online ? Net.rayRemotes(ro, rd, hitBot ? hitBot.t : reach) : null;
  if (hitRem) {
    const mult = hitRem.zone === 'head' ? 1.6 : 1;
    Net.sendHit(hitRem.player.netId, WEAPONS.knife.dmg * mult, hitRem.zone);
    p.hitT = 0.18; p.hitHead = hitRem.zone === 'head';
    AudioSys.hit(hitRem.zone === 'head');
    const end = ro.addScaledVector(rd, hitRem.t);
    spawnParticles(end.x, end.y, end.z, 10, 0x8a1206, 2.6, 8, 0.45, 0.7);
  } else if (hitBot) {
    const mult = hitBot.zone === 'head' ? 1.6 : 1;
    damageBot(hitBot.bot, WEAPONS.knife.dmg * mult, hitBot.zone);
    const end = ro.addScaledVector(rd, hitBot.t);
    spawnParticles(end.x, end.y, end.z, 10, 0x8a1206, 2.6, 8, 0.45, 0.7);
  } else if (wall && wall.t < 2.2) {
    spawnDecal(wall.point, wall.nx, wall.ny, wall.nz);
    AudioSys.impact(1, 0);
  }
}

function updateWeapon(dt) {
  // switch animation
  if (switching) {
    switching.t += dt;
    if (!switching.swapped && switching.t > 0.16) {
      VM[cur].g.visible = false;
      cur = switching.to;
      VM[cur].g.visible = true;
      switching.swapped = true;
      shotIdx = 0; bloom = 0;
      AudioSys.draw();
    }
    if (switching.t > 0.38) switching = null;
  }
  // reload
  if (reloading) {
    const w = WEAPONS[cur];
    reloadT += dt;
    const rt = reloadT / w.reloadTime;
    if (reloadStage === 0 && rt > 0.22) { reloadStage = 1; AudioSys.reload(0); }
    if (reloadStage === 1 && rt > 0.58) { reloadStage = 2; AudioSys.reload(1); }
    if (reloadStage === 2 && rt > 0.84) { reloadStage = 3; AudioSys.reload(2); }
    if (reloadT >= w.reloadTime) {
      reloading = false;
      const L = loadout[cur];
      const need = w.magSize - L.mag;
      const take = Math.min(need, L.reserve);
      L.mag += take; L.reserve -= take;
      shotIdx = 0;
    }
  }
  // firing
  const w = WEAPONS[cur];
  if (firing && !p.dead && !switching && !reloading && document.pointerLockElement === canvas) {
    if (w.auto || fireJust) tryFire();
  }
  if (state.tNow - lastFireT > 0.35) shotIdx = 0;
  fireJust = false;
  // decay
  bloom = Math.max(0, bloom - w.bloomMax * 3.0 * dt);
  const rec = Math.min(1, 9 * dt);
  recoilP -= recoilP * rec; recoilY -= recoilY * rec;
  vmKick = Math.max(0, vmKick - 11 * dt);
  vmFlashLight.intensity = Math.max(0, vmFlashLight.intensity - 55 * dt);
  botFlashLight.intensity = Math.max(0, botFlashLight.intensity - 45 * dt);
  // ADS
  const wantAds = adsHeld && w.kind !== 'knife' && !reloading && !p.dead;
  adsF += ((wantAds ? 1 : 0) - adsF) * Math.min(1, 13 * dt);
  const targetFov = settings.fov * (1 - (1 - w.adsZoom) * adsF);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov = targetFov;
    camera.updateProjectionMatrix();
  }
  // knife swing timer
  knifeT = Math.max(0, knifeT - dt);
  // view model transform
  const vm = VM[cur];
  const hsp = Math.hypot(p.vel.x, p.vel.z);
  const bobA = p.bobAmp * (1 - adsF * 0.85);
  const bobX = Math.sin(p.bobPhase) * 0.017 * bobA;
  const bobY = -Math.abs(Math.cos(p.bobPhase)) * 0.013 * bobA;
  vmSwayX += (clamp(-mouseVX * 0.00045, -0.03, 0.03) - vmSwayX) * Math.min(1, 9 * dt);
  vmSwayY += (clamp(mouseVY * 0.00035, -0.025, 0.025) - vmSwayY) * Math.min(1, 9 * dt);
  mouseVX *= Math.max(0, 1 - 14 * dt); mouseVY *= Math.max(0, 1 - 14 * dt);
  const g = vm.g;
  g.position.lerpVectors(vm.hip, vm.ads, adsF);
  g.position.x += bobX + vmSwayX;
  g.position.y += bobY + vmSwayY + vmKick * 0.015;
  g.position.z += vmKick * 0.085;
  g.rotation.set(-vmKick * 0.13, 0, vmSwayX * 1.6);
  // reload dip + mag animation
  if (reloading) {
    const rt = reloadT / WEAPONS[cur].reloadTime;
    g.rotation.x -= Math.sin(Math.min(1, rt * 1.15) * Math.PI) * 0.55;
    g.rotation.z += Math.sin(Math.min(1, rt * 1.15) * Math.PI) * 0.25;
    if (vm.mag) {
      const mo = -0.15 * Math.sin(clamp((rt - 0.2) / 0.5, 0, 1) * Math.PI);
      vm.mag.position.y = vm.magBaseY + mo;
    }
    if (rt > 0.84 && rt < 0.93) g.position.z += 0.025; // bolt rack jerk
  } else if (vm.mag) {
    vm.mag.position.y = vm.magBaseY;
  }
  // knife swing
  if (cur === 'knife' && knifeT > 0) {
    const kt = 1 - knifeT / 0.25;
    g.rotation.z -= Math.sin(kt * Math.PI) * 1.15;
    g.rotation.x -= Math.sin(kt * Math.PI) * 0.5;
    g.position.z -= Math.sin(kt * Math.PI) * 0.14;
  }
  // switch raise/lower
  if (switching) {
    const st = switching.t;
    const drop = st < 0.16 ? st / 0.16 : Math.max(0, 1 - (st - 0.16) / 0.22);
    g.position.y -= drop * 0.28;
    g.rotation.x -= drop * 0.5;
  }
  // bot flash sprites decay
  for (const f of botFlashes) {
    if (f.life > 0) { f.life -= dt; if (f.life <= 0) f.sp.visible = false; }
  }
}
VM.rifle.magBaseY = VM.rifle.mag.position.y;
VM.pistol.magBaseY = VM.pistol.mag.position.y;
for (const k in VM) { if (VM[k].mag) VM[k].magBaseY = VM[k].mag.position.y; }
VM[cur].g.visible = true;

/* ================= bots ================= */
const bots = [];

function buildBotMesh(team) {
  const tm = TEAMS[team] || TEAMS.T;
  const g = new THREE.Group();
  const cloth = new THREE.MeshStandardMaterial({ color: tm.cloth, roughness: 0.9 });
  const vest = new THREE.MeshStandardMaterial({ color: tm.vest, roughness: 0.85 });
  const skin = new THREE.MeshStandardMaterial({ color: tm.skin, roughness: 0.7 });
  const dark = new THREE.MeshStandardMaterial({ color: tm.helmet, roughness: 0.5, metalness: 0.4 });
  function part(mat, sx, sy, sz, x, y, z, parent) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    (parent || g).add(m);
    return m;
  }
  const legL = new THREE.Group(); legL.position.set(-0.11, 0.82, 0); g.add(legL);
  part(cloth, 0.17, 0.82, 0.19, 0, -0.41, 0, legL);
  const legR = new THREE.Group(); legR.position.set(0.11, 0.82, 0); g.add(legR);
  part(cloth, 0.17, 0.82, 0.19, 0, -0.41, 0, legR);
  part(vest, 0.48, 0.6, 0.28, 0, 1.12, 0);
  part(skin, 0.22, 0.24, 0.24, 0, 1.52, 0);
  part(dark, 0.25, 0.09, 0.27, 0, 1.63, 0); // helmet
  const armL = new THREE.Group(); armL.position.set(-0.29, 1.32, 0); g.add(armL);
  part(cloth, 0.11, 0.5, 0.13, 0, -0.16, 0.17, armL); armL.rotation.x = -1.1;
  const armR = new THREE.Group(); armR.position.set(0.29, 1.32, 0); g.add(armR);
  part(cloth, 0.11, 0.5, 0.13, 0, -0.16, 0.17, armR); armR.rotation.x = -1.1;
  part(dark, 0.06, 0.09, 0.75, 0, 1.28, 0.42); // rifle
  return { g, legL, legR, armL, armR };
}

function spawnBotAt(b, sp) {
  b.pos.set(sp.x, World.groundY(sp.x, sp.z, 3), sp.z);
  b.hp = 100; b.dead = false; b.deadT = 0;
  b.state = 'patrol'; b.path = null; b.pathI = 0;
  b.lastVis = false; b.losT = Math.random() * 0.12;
  b.aimT = 0; b.reactT = 0.5; b.burstLeft = 0; b.pauseT = 0.3; b.nextShot = 0;
  b.lostT = 0; b.strafeT = 0; b.strafeDir = 1;
  b.mesh.visible = true;
  b.mesh.rotation.set(0, 0, 0);
  b.mesh.position.copy(b.pos);
}

function rebuildBots() {
  for (const b of bots) {
    scene.remove(b.mesh);
    b.mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  }
  bots.length = 0;
  if (Net.online) return; // online rooms are pure PvP
  const team = enemySide();
  const d = diff();
  for (let i = 0; i < 5; i++) {
    const parts = buildBotMesh(team);
    scene.add(parts.g);
    const b = {
      name: TEAMS[team].names[i], mesh: parts.g, parts,
      pos: new THREE.Vector3(), yaw: 0, hp: 100, dead: false, deadT: 0,
      state: 'patrol', path: null, pathI: 0, lastVis: false, losT: 0,
      lastSeen: new THREE.Vector3(), lostT: 0, aimT: 0, reactT: 0,
      burstLeft: 0, pauseT: 0, nextShot: 0, strafeDir: 1, strafeT: 0,
      walkPhase: 0, stepAcc: 0, kills: 0, deaths: 0,
      skill: d.skill[0] + Math.random() * d.skill[1],
    };
    spawnBotAt(b, World.botSpawns[i]);
    bots.push(b);
  }
}

function rayBots(ro, rd, maxT) {
  let best = null, bt = maxT;
  for (const b of bots) {
    if (b.dead) continue;
    const t = raySphere(ro, rd, b.pos.x, b.pos.y + 1.52, b.pos.z, 0.2, bt);
    if (t !== null) { bt = t; best = { t, bot: b, zone: 'head' }; }
    const bb = {
      min: { x: b.pos.x - 0.38, y: b.pos.y, z: b.pos.z - 0.38 },
      max: { x: b.pos.x + 0.38, y: b.pos.y + 1.42, z: b.pos.z + 0.38 }
    };
    const h = rayAABB(ro, rd, bb, bt);
    if (h) {
      bt = h.t;
      const hy = ro.y + rd.y * h.t - b.pos.y;
      best = { t: h.t, bot: b, zone: hy < 0.65 ? 'legs' : 'body' };
    }
  }
  return best;
}

function damageBot(b, d, zone) {
  if (b.dead) return;
  b.hp -= d;
  b.aimT = Math.max(0, b.aimT - 0.3); // flinch
  p.hitT = 0.18; p.hitHead = zone === 'head';
  if (b.hp <= 0) {
    b.dead = true; b.deadT = 0; b.deaths++;
    state.kills++;
    loadout.rifle.reserve += 10;
    loadout.pistol.reserve += 4;
    AudioSys.kill();
    addFeed(`YOU ✖ <b>${b.name}</b>${zone === 'head' ? ' ⌖' : ''}`, 'me');
  } else {
    AudioSys.hit(zone === 'head');
    // getting shot reveals the shooter
    b.lastSeen.copy(p.pos);
    if (b.state === 'patrol') {
      b.state = 'hunt';
      b.path = World.findPath(World.nearestNode(b.pos.x, b.pos.z), World.nearestNode(p.pos.x, p.pos.z));
      b.pathI = 0;
    }
  }
  if (b.dead) AudioSys.hit(zone === 'head');
}

function alertBots(pos, radius) {
  for (const b of bots) {
    if (b.dead || b.state === 'combat') continue;
    const d = Math.hypot(b.pos.x - pos.x, b.pos.z - pos.z);
    if (d < radius) {
      b.lastSeen.copy(pos);
      b.state = 'hunt';
      b.path = World.findPath(World.nearestNode(b.pos.x, b.pos.z), World.nearestNode(pos.x, pos.z));
      b.pathI = 0;
    }
  }
}

function checkLOS(b) {
  const px = p.pos.x, py = p.pos.y + 1.62 - 0.55 * p.crouchF, pz = p.pos.z;
  const dx = px - b.pos.x, dz = pz - b.pos.z;
  const dist = Math.hypot(dx, dz);
  if (dist > diff().vision) return false;
  if (b.state !== 'combat' && dist > 4) {
    // patrol vision cone (110 deg)
    const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
    if ((dx * fx + dz * fz) / dist < Math.cos(0.96)) return false;
  }
  return !losBlocked(b.pos.x, b.pos.y + 1.5, b.pos.z, px, py, pz);
}

function botShoot(b, distP) {
  const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
  const from = new THREE.Vector3(b.pos.x + fx * 0.75, b.pos.y + 1.3, b.pos.z + fz * 0.75);
  const to = _v1.set(p.pos.x, p.pos.y + 1.05 - 0.35 * p.crouchF, p.pos.z);
  const dir = new THREE.Vector3().subVectors(to, from).normalize();
  const playerSpeed = Math.hypot(p.vel.x, p.vel.z);
  const err = (0.011 + distP * 0.00055 + playerSpeed * 0.0032)
    * (1 + 2.2 * Math.exp(-b.aimT * 1.8)) / b.skill * diff().err;
  dir.x += srand() * err; dir.y += srand() * err * 0.7; dir.z += srand() * err;
  dir.normalize();
  const wall = rayWorld(from, dir, 200);
  const maxT = wall ? wall.t : 200;
  const pbox = {
    min: { x: p.pos.x - 0.38, y: p.pos.y, z: p.pos.z - 0.38 },
    max: { x: p.pos.x + 0.38, y: p.pos.y + 1.8 - 0.55 * p.crouchF, z: p.pos.z + 0.38 }
  };
  const hit = rayAABB(from, dir, pbox, maxT);
  let end;
  if (hit) {
    end = from.clone().addScaledVector(dir, hit.t);
    const fall = clamp(1 - (distP - 15) * 0.008, 0.5, 1);
    damagePlayer(22 * fall * (0.75 + Math.random() * 0.45), b);
  } else {
    end = wall ? wall.point : from.clone().addScaledVector(dir, 120);
    if (wall) spawnDecal(wall.point, wall.nx, wall.ny, wall.nz);
    // near miss whiz
    _v2.copy(camera.position).sub(from);
    const tc = _v2.dot(dir);
    if (tc > 0 && tc < maxT) {
      _v3.copy(from).addScaledVector(dir, tc);
      const miss = _v3.distanceTo(camera.position);
      if (miss < 1.7) AudioSys.whiz(panDistTo(_v3).pan);
    }
  }
  spawnTracer(from, end);
  spawnBotFlash(from);
  const pd = panDistTo(from);
  AudioSys.shot('rifle', pd.dist, pd.pan);
}

function respawnBot(b) {
  let best = World.botSpawns[0], bd = -1;
  for (const sp of World.botSpawns) {
    const d = Math.hypot(sp.x - p.pos.x, sp.z - p.pos.z);
    if (d > bd) { bd = d; best = sp; }
  }
  spawnBotAt(b, best);
}

function updateBot(b, dt) {
  if (b.dead) {
    b.deadT += dt;
    // fall over
    b.mesh.rotation.x = Math.min(1.45, b.mesh.rotation.x + dt * 6);
    if (b.deadT > 3) b.mesh.position.y -= dt * 0.9;
    if (b.deadT > 4.2) respawnBot(b);
    return;
  }
  b.losT -= dt;
  if (b.losT <= 0) { b.losT = 0.12; b.lastVis = !p.dead && checkLOS(b); }
  const visible = b.lastVis && !p.dead;
  const dx = p.pos.x - b.pos.x, dz = p.pos.z - b.pos.z;
  const distP = Math.hypot(dx, dz);

  if (visible) {
    b.lastSeen.copy(p.pos); b.lostT = 0;
    if (b.state !== 'combat') {
      b.state = 'combat';
      const d = diff();
      b.reactT = d.react[0] + Math.random() * d.react[1];
      b.aimT = 0;
    }
  } else if (b.state === 'combat') {
    b.lostT += dt;
    if (b.lostT > 2.5) {
      b.state = 'hunt';
      b.path = World.findPath(World.nearestNode(b.pos.x, b.pos.z), World.nearestNode(b.lastSeen.x, b.lastSeen.z));
      b.pathI = 0;
    }
  }

  // movement
  let mvx = 0, mvz = 0, speed = 0;
  if (b.state === 'combat') {
    b.strafeT -= dt;
    if (b.strafeT <= 0) {
      b.strafeT = 0.6 + Math.random() * 0.9;
      b.strafeDir = Math.random() < 0.5 ? -1 : 1;
    }
    const inv = 1 / (distP || 1);
    const fx = dx * inv, fz = dz * inv;
    let ax = -fz * b.strafeDir, az = fx * b.strafeDir;
    if (distP > 24) { ax += fx * 0.9; az += fz * 0.9; }
    else if (distP < 7) { ax -= fx * 0.7; az -= fz * 0.7; }
    const al = Math.hypot(ax, az) || 1;
    mvx = ax / al; mvz = az / al; speed = 3.1 * diff().moveMul;
    b.yaw = Math.atan2(fx, fz);
  } else {
    if (!b.path || b.pathI >= b.path.length) {
      if (b.state === 'hunt') b.state = 'patrol';
      const target = Math.floor(Math.random() * World.waypoints.length);
      b.path = World.findPath(World.nearestNode(b.pos.x, b.pos.z), target);
      b.pathI = 0;
    }
    const wp = World.waypoints[b.path[b.pathI]];
    const tx = wp.x - b.pos.x, tz = wp.z - b.pos.z;
    const td = Math.hypot(tx, tz);
    if (td < 1.3) b.pathI++;
    else {
      mvx = tx / td; mvz = tz / td;
      speed = (b.state === 'hunt' ? 4.5 : 3.4) * diff().moveMul;
      b.yaw = Math.atan2(mvx, mvz);
    }
  }
  if (speed > 0) {
    moveAxis(b.pos, 'x', mvx * speed * dt, 0.35, 1.7, true);
    moveAxis(b.pos, 'z', mvz * speed * dt, 0.35, 1.7, true);
    b.walkPhase += speed * dt * 1.7;
    b.stepAcc += speed * dt;
    if (b.stepAcc > 2.3) {
      b.stepAcc = 0;
      const pd = panDistTo(b.pos);
      if (pd.dist < 24) AudioSys.step(0.85, pd.pan, pd.dist, true);
    }
  }
  // vertical snap to ground (handles steps/platform)
  const gy = World.groundY(b.pos.x, b.pos.z, b.pos.y + 0.4);
  b.pos.y += clamp(gy - b.pos.y, -8 * dt, 8 * dt);

  // shooting
  if (b.state === 'combat' && visible && !p.dead && p.spawnProt <= 0) {
    if (b.reactT > 0) b.reactT -= dt;
    else {
      b.aimT += dt;
      b.nextShot -= dt;
      if (b.burstLeft <= 0) {
        b.pauseT -= dt;
        const d = diff();
        if (b.pauseT <= 0) b.burstLeft = d.burst[0] + Math.floor(Math.random() * d.burst[1]);
      } else if (b.nextShot <= 0) {
        b.nextShot = 0.115;
        b.burstLeft--;
        if (b.burstLeft <= 0) b.pauseT = 0.45 + Math.random() * 0.8;
        botShoot(b, distP);
      }
    }
  }

  // visuals
  b.mesh.position.copy(b.pos);
  b.mesh.rotation.y = b.yaw;
  const swing = speed > 0 ? Math.sin(b.walkPhase) * 0.55 : 0;
  b.parts.legL.rotation.x = swing;
  b.parts.legR.rotation.x = -swing;
}

/* ================= player ================= */
function eyeHeight() { return 1.62 - 0.55 * p.crouchF; }

function damagePlayer(d, src) {
  if (p.dead || p.spawnProt > 0) return;
  p.hp -= d;
  p.vigT = Math.min(1.2, p.vigT + 0.45 + d / 70);
  p.exert = Math.min(1, p.exert + 0.25);
  AudioSys.hurt();
  recoilP += (Math.random() - 0.3) * 0.014;
  recoilY += srand() * 0.012;
  if (src) {
    p.dirT = 1;
    const dx = src.pos.x - p.pos.x, dz = src.pos.z - p.pos.z;
    const len = Math.hypot(dx, dz) || 1;
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw);
    const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
    p.dirAng = Math.atan2((dx * rx + dz * rz) / len, (dx * fx + dz * fz) / len) * 180 / Math.PI;
  }
  if (p.hp <= 0) playerDie(src);
}

function playerDie(src) {
  p.hp = 0; p.dead = true; p.respawnT = 3;
  state.deaths++;
  if (src) {
    if (!Net.online) src.kills++; // online: server relays the kill credit
    addFeed(`<b>${src.name}</b> ✖ YOU`, 'them');
  } else addFeed(`YOU ✖ YOU`, 'them');
  if (Net.online) Net.sendDie(src && src.netId);
  VM[cur].g.visible = false;
  D.death.style.display = 'flex';
  D.deathTxt.textContent = 'ELIMINATED';
  D.deathSub.textContent = (src ? `by ${src.name} — ` : '') + 'respawn in 3';
}

function respawnPlayer() {
  // pick spawn farthest from living bots
  let best = World.playerSpawns[0], bd = -1;
  for (const sp of World.playerSpawns) {
    let mind = Infinity;
    for (const b of bots) if (!b.dead) {
      mind = Math.min(mind, Math.hypot(sp.x - b.pos.x, sp.z - b.pos.z));
    }
    if (mind > bd) { bd = mind; best = sp; }
  }
  p.pos.set(best.x, 0, best.z);
  p.vel.set(0, 0, 0);
  p.hp = 100; p.dead = false; p.spawnProt = 1.2;
  p.yaw = Math.atan2(-(0 - best.x), -(0 - best.z)); // face map center
  p.pitch = 0;
  loadout.rifle.mag = 30; loadout.rifle.reserve = Math.max(loadout.rifle.reserve, 60);
  loadout.pistol.mag = 12;
  reloading = false; switching = null; bloom = 0;
  VM[cur].g.visible = true;
  D.death.style.display = 'none';
}

function landCheck(vy) {
  const sp = -vy;
  if (sp > 4) {
    p.landOff = -Math.min(0.22, sp * 0.018);
    AudioSys.land(Math.min(1, sp / 14));
    if (sp > 12) damagePlayer((sp - 12) * 6, null);
  }
}

function updatePlayer(dt) {
  if (p.dead) {
    p.respawnT -= dt;
    D.deathSub.textContent = D.deathSub.textContent.replace(/respawn in .*/,
      `respawn in ${Math.max(0, p.respawnT).toFixed(1)}`);
    if (p.respawnT <= 0) respawnPlayer();
    return;
  }
  p.spawnProt = Math.max(0, p.spawnProt - dt);

  const ix = (keys['KeyD'] ? 1 : 0) - (keys['KeyA'] ? 1 : 0);
  const iz = (keys['KeyS'] ? 1 : 0) - (keys['KeyW'] ? 1 : 0);
  const wantCrouch = keys['ControlLeft'] || keys['ControlRight'] || keys['KeyC'];
  const walk = keys['ShiftLeft'] || keys['ShiftRight'];

  // crouch with headroom check on stand
  let crouchTarget = wantCrouch ? 1 : 0;
  if (!wantCrouch && p.crouchF > 0.05) {
    const oy = p.pos.y;
    if (boxCollides({ x: p.pos.x, y: oy, z: p.pos.z }, 0.36, 1.8)) crouchTarget = 1;
  }
  p.crouchF += (crouchTarget - p.crouchF) * Math.min(1, 11 * dt);
  const height = 1.8 - 0.55 * p.crouchF;

  // wish direction (world space)
  const s = Math.sin(p.yaw), c = Math.cos(p.yaw);
  let wx = s * iz + c * ix;
  let wz = c * iz - s * ix;
  const wl = Math.hypot(wx, wz);
  if (wl > 0) { wx /= wl; wz /= wl; }
  const targetSpeed = (p.crouchF > 0.5 ? 2.0 : walk ? 2.6 : 5.2) * (1 - adsF * 0.12);

  // friction
  const hv = Math.hypot(p.vel.x, p.vel.z);
  if (p.onGround && hv > 0) {
    const drop = hv * 8 * dt + (wl === 0 && hv < 0.8 ? hv : 0);
    const ns = Math.max(0, hv - drop);
    const k = ns / hv;
    p.vel.x *= k; p.vel.z *= k;
  }
  // accelerate (quake style)
  if (wl > 0) {
    const curSpd = p.vel.x * wx + p.vel.z * wz;
    const add = targetSpeed - curSpd;
    if (add > 0) {
      const a = Math.min((p.onGround ? 10 : 1.6) * targetSpeed * dt, add);
      p.vel.x += wx * a; p.vel.z += wz * a;
    }
  }
  // jump
  if (keys['Space'] && p.onGround && p.crouchF < 0.6) {
    p.vel.y = 6.4;
    p.onGround = false;
    p.exert = Math.min(1, p.exert + 0.12);
    AudioSys.step(1.1, 0, 0, true);
  }
  // gravity + integrate with collision
  p.vel.y -= 18.5 * dt;
  const prevVy = p.vel.y;
  const hx = 0.36;
  const wasGround = p.onGround;
  if (moveAxis(p.pos, 'x', p.vel.x * dt, hx, height, wasGround)) p.vel.x = 0;
  if (moveAxis(p.pos, 'z', p.vel.z * dt, hx, height, wasGround)) p.vel.z = 0;
  p.onGround = false;
  if (moveAxis(p.pos, 'y', p.vel.y * dt, hx, height, false)) {
    if (p.vel.y < 0) { p.onGround = true; if (!wasGround) landCheck(prevVy); }
    p.vel.y = 0;
  }
  if (p.pos.y <= 0 && p.vel.y <= 0) {
    p.pos.y = 0;
    if (!wasGround && !p.onGround) landCheck(prevVy);
    p.onGround = true;
    p.vel.y = 0;
  }

  // head bob & footsteps
  const hsp = Math.hypot(p.vel.x, p.vel.z);
  const bobTarget = p.onGround ? Math.min(1, hsp / 5.2) : 0;
  p.bobAmp += (bobTarget - p.bobAmp) * Math.min(1, 8 * dt);
  if (p.onGround && hsp > 0.6) {
    p.bobPhase += hsp * dt * 1.55;
    p.stepAcc += hsp * dt;
    if (p.stepAcc > 2.7) {
      p.stepAcc = 0;
      const vol = p.crouchF > 0.5 ? 0.22 : walk ? 0.38 : 1;
      AudioSys.step(vol, 0, 0, !walk && p.crouchF < 0.5);
      if (vol > 0.6) alertBots(p.pos, 11 * diff().hear);
    }
  }
  p.landOff += (0 - p.landOff) * Math.min(1, 7 * dt);

  // exertion / breathing / heartbeat
  p.exert = clamp(p.exert + (hsp > 4 && p.onGround ? 0.1 * dt : -0.09 * dt), 0, 1);
  const breathLvl = clamp(0.1 + (1 - p.hp / 100) * 0.5 + p.exert * 0.45 - adsF * 0.28, 0, 1);
  AudioSys.breathSet(breathLvl);
  AudioSys.heartSet(p.hp < 35, 1 - p.hp / 35);

  // roll from strafe
  const rx = Math.cos(p.yaw), rz = -Math.sin(p.yaw);
  const latV = p.vel.x * rx + p.vel.z * rz;
  p.roll += (clamp(-latV * 0.0035, -0.02, 0.02) - p.roll) * Math.min(1, 10 * dt);
}

function updateCamera() {
  const eyeY = eyeHeight()
    + Math.sin(p.bobPhase * 2) * 0.02 * p.bobAmp
    + p.landOff;
  camera.position.set(p.pos.x, p.pos.y + eyeY, p.pos.z);
  camera.rotation.set(clamp(p.pitch + recoilP, -1.53, 1.53), p.yaw + recoilY, p.roll);
}

/* ================= HUD ================= */
function addFeed(html, cls) {
  const d = document.createElement('div');
  d.className = cls;
  d.innerHTML = html;
  D.feed.prepend(d);
  while (D.feed.children.length > 5) D.feed.lastChild.remove();
  setTimeout(() => { d.style.opacity = '0'; }, 3600);
  setTimeout(() => { d.remove(); }, 4200);
}

let fpsFrames = 0, fpsT = 0;
function updateHUD(dt) {
  // crosshair spread
  const gap = clamp(3 + (currentSpread()) * 2400, 3, 40) * (1 - adsF * 0.55);
  D.ch.style.setProperty('--gap', gap.toFixed(1) + 'px');
  D.ch.style.opacity = cur === 'knife' ? 0.5 : (1 - adsF * 0.8);
  // hp
  const hp = Math.max(0, Math.ceil(p.hp));
  D.hpnum.textContent = hp;
  D.hpbarFill.style.width = hp + '%';
  D.hpbar.classList.toggle('low', hp < 35);
  D.lowhp.classList.toggle('on', hp < 30 && !p.dead);
  if (!(hp < 30)) D.lowhp.style.opacity = 0;
  // ammo
  const w = WEAPONS[cur];
  D.wname.textContent = w.name;
  if (w.kind === 'knife') {
    D.mag.textContent = '—'; D.reserve.textContent = '';
    D.mag.className = ''; D.reloadTip.textContent = '';
  } else {
    const L = loadout[cur];
    D.mag.textContent = L.mag;
    D.reserve.textContent = '/ ' + L.reserve;
    D.mag.className = L.mag <= 4 ? 'crit' : L.mag <= 8 ? 'low' : '';
    D.reloadTip.textContent = reloading ? 'RELOADING…' : (L.mag === 0 ? 'PRESS R' : '');
  }
  // timer + score
  const t = Math.max(0, state.time);
  D.timer.textContent = Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  D.scoreL.textContent = state.kills;
  D.scoreR.textContent = Net.online ? Net.topEnemyKills() : bots.reduce((a, b) => a + b.kills, 0);
  // vignette / direction / hitmarker
  p.vigT = Math.max(0, p.vigT - dt * 1.4);
  D.vig.style.opacity = Math.min(0.85, p.vigT);
  p.dirT = Math.max(0, p.dirT - dt * 1.1);
  D.dmgdir.style.opacity = p.dirT * 0.9;
  D.dmgdir.style.transform = `rotate(${p.dirAng}deg)`;
  p.hitT = Math.max(0, p.hitT - dt);
  D.hitm.style.opacity = p.hitT > 0 ? clamp(p.hitT / 0.12, 0, 1) : 0;
  D.hitm.className = p.hitHead ? 'head' : '';
  // fps
  fpsFrames++; fpsT += dt;
  if (fpsT >= 0.5) {
    D.fps.textContent = Math.round(fpsFrames / fpsT) + ' FPS';
    fpsFrames = 0; fpsT = 0;
  }
}

function buildScoreboard() {
  const rows = [
    { name: Net.online ? `${settings.name} (YOU)` : 'YOU', k: state.kills, d: state.deaths, you: true },
    ...bots.map(b => ({ name: b.name, k: b.kills, d: b.deaths, you: false })),
    ...[...Net.players.values()].map(pl => ({ name: pl.name, k: pl.kills, d: pl.deaths, you: false })),
  ].sort((a, b) => b.k - a.k);
  D.sbBody.innerHTML = rows.map(r =>
    `<tr${r.you ? ' class="you"' : ''}><td>${r.name}</td><td>${r.k}</td><td>${r.d}</td></tr>`
  ).join('');
}

/* ================= input ================= */
const keys = {};
addEventListener('keydown', e => {
  if (e.code === 'Tab') {
    e.preventDefault();
    if (state.started) { buildScoreboard(); D.scoreboard.style.display = 'block'; }
    return;
  }
  keys[e.code] = true;
  if (!state.started || state.paused || p.dead) return;
  if (e.code === 'KeyR') startReload();
  if (e.code === 'Digit1') switchTo('rifle');
  if (e.code === 'Digit2') switchTo('pistol');
  if (e.code === 'Digit3') switchTo('knife');
});
addEventListener('keyup', e => {
  if (e.code === 'Tab') { D.scoreboard.style.display = 'none'; return; }
  keys[e.code] = false;
});
addEventListener('blur', () => { for (const k in keys) keys[k] = false; firing = false; adsHeld = false; });

document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  const sens = 0.0022 * settings.sens * (1 - adsF * 0.25);
  p.yaw -= e.movementX * sens;
  p.pitch = clamp(p.pitch - e.movementY * sens, -1.51, 1.51);
  mouseVX = e.movementX; mouseVY = e.movementY;
});
document.addEventListener('mousedown', e => {
  if (document.pointerLockElement !== canvas) return;
  if (e.button === 0) { firing = true; fireJust = true; }
  if (e.button === 2) adsHeld = true;
});
document.addEventListener('mouseup', e => {
  if (e.button === 0) firing = false;
  if (e.button === 2) adsHeld = false;
});
document.addEventListener('contextmenu', e => e.preventDefault());

/* ================= flow ================= */
function lockGame() {
  AudioSys.init();
  AudioSys.resume();
  AudioSys.setVolume(+settings.vol);
  canvas.requestPointerLock();
}

function configureMatch(mapName) {
  if (!World.current || World.current.name !== mapName) {
    World.load(mapName, scene);
    applyMapAmbience();
  }
  World.setPlayerTeam(settings.side);
  rebuildBots();
  resetMatch();
  D.sbTitle.textContent = `SECTOR: ${World.current.label} — ` +
    (Net.online ? `ONLINE GAME ${Net.room}` : `DEATHMATCH [${settings.diff.toUpperCase()}]`);
}

async function deploy() {
  delete D.netStatus.dataset.err;
  D.netStatus.textContent = '';
  if (settings.mode === 'online') {
    if (Net.online && Net.room === +settings.room && state.started && !cfgDirty) { lockGame(); return; }
    D.playBtn.textContent = 'CONNECTING…';
    try {
      const info = await Net.join(+settings.room, settings.name || 'PLAYER', settings.side, settings.map);
      state.started = false;
      configureMatch(info.map);
      state.time = info.remain;
      cfgDirty = false;
      lockGame();
    } catch (e) {
      D.netStatus.dataset.err = '1';
      D.netStatus.textContent = e.message;
      updateSub();
    }
    return;
  }
  const wasOnline = Net.online;
  Net.leave();
  if (cfgDirty || wasOnline || !state.started) {
    state.started = false;
    configureMatch(settings.map);
    cfgDirty = false;
  }
  lockGame();
}
D.playBtn.addEventListener('click', deploy);
D.restartBtn.addEventListener('click', () => { resetMatch(); lockGame(); });

document.addEventListener('pointerlockchange', () => {
  const locked = document.pointerLockElement === canvas;
  if (locked) {
    if (!state.started) state.started = true;
    state.paused = false;
    D.menu.style.display = 'none';
    D.hud.style.display = 'block';
  } else {
    firing = false; adsHeld = false;
    if (state.started && !state.over) {
      state.paused = true;
      D.playBtn.textContent = 'RESUME';
      D.menu.style.display = 'flex';
    }
  }
});

function resetMatch() {
  state.time = 600; state.kills = 0; state.deaths = 0; state.over = false;
  for (let i = 0; i < bots.length; i++) {
    bots[i].kills = 0; bots[i].deaths = 0;
    spawnBotAt(bots[i], World.botSpawns[i]);
  }
  loadout.rifle.mag = 30; loadout.rifle.reserve = 90;
  loadout.pistol.mag = 12; loadout.pistol.reserve = 48;
  respawnPlayer();
  p.spawnProt = 2;
  D.endscr.style.display = 'none';
  D.feed.innerHTML = '';
}

function endMatch() {
  state.over = true;
  document.exitPointerLock();
  let enemyBest = 0, topName = '—';
  if (bots.length) {
    const top = bots.slice().sort((a, b) => b.kills - a.kills)[0];
    enemyBest = top.kills; topName = top.name;
  } else {
    for (const pl of Net.players.values()) {
      if (pl.kills >= enemyBest) { enemyBest = pl.kills; topName = pl.name; }
    }
  }
  const win = state.kills > enemyBest;
  D.endTitle.textContent = win ? 'SECTOR CLEARED' : 'MISSION FAILED';
  D.endTitle.className = win ? 'win' : 'lose';
  D.endTxt.textContent = `YOU ${state.kills} KILLS / ${state.deaths} DEATHS — TOP ${Net.online ? 'RIVAL' : 'HOSTILE'}: ${topName} (${enemyBest})`;
  D.menu.style.display = 'none';
  D.endscr.style.display = 'flex';
}

/* ================= menu backdrop orbit ================= */
let menuAngle = 0;
function menuCamera(dt) {
  menuAngle += dt * 0.06;
  camera.position.set(Math.cos(menuAngle) * 48, 26, Math.sin(menuAngle) * 38);
  camera.lookAt(0, 0, 0);
}

/* ================= net bridge ================= */
function makeNameTag(name) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 64;
  const g = c.getContext('2d');
  g.font = '700 34px ui-monospace, Consolas, monospace';
  g.textAlign = 'center';
  g.fillStyle = 'rgba(0,0,0,0.55)';
  const tw = g.measureText(name).width + 24;
  g.fillRect(128 - tw / 2, 8, tw, 46);
  g.fillStyle = '#e8f1da';
  g.fillText(name, 128, 42);
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({
    map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false,
  }));
  sp.scale.set(1.7, 0.42, 1);
  sp.position.y = 2.05;
  return sp;
}

const r2 = v => Math.round(v * 100) / 100;
window.GameAPI = {
  makeAvatar(team, name) {
    const parts = buildBotMesh(team);
    parts.g.add(makeNameTag(name));
    parts.g.visible = false;
    scene.add(parts.g);
    return { mesh: parts.g, parts };
  },
  removeAvatar(mesh) {
    scene.remove(mesh);
    mesh.traverse(o => { if (o.geometry) o.geometry.dispose(); });
  },
  remoteShot(o, e) {
    _v1.set(o[0], o[1], o[2]);
    _v2.set(e[0], e[1], e[2]);
    spawnTracer(_v1, _v2);
    spawnBotFlash(_v1);
    const pd = panDistTo(_v1);
    AudioSys.shot('rifle', pd.dist, pd.pan);
  },
  remoteHit(byId, dmg, zone) {
    damagePlayer(dmg, Net.players.get(byId) || null);
  },
  creditKill(victimId) {
    state.kills++;
    loadout.rifle.reserve += 10;
    loadout.pistol.reserve += 4;
    AudioSys.kill();
    const v = Net.players.get(victimId);
    addFeed(`YOU ✖ <b>${v ? v.name : '?'}</b>`, 'me');
  },
  addFeed,
  getState() {
    return {
      x: r2(p.pos.x), y: r2(p.pos.y), z: r2(p.pos.z),
      yaw: Math.round(p.yaw * 1000) / 1000, c: r2(p.crouchF),
      d: p.dead ? 1 : 0, hp: Math.max(0, Math.round(p.hp)),
    };
  },
  newMatch(remainT) {
    state.time = remainT || 600;
    state.kills = 0; state.deaths = 0; state.over = false;
    D.feed.innerHTML = '';
    addFeed('NEW MATCH', 'me');
    D.endscr.style.display = 'none';
  },
  netDown() {
    cfgDirty = true;
    D.netStatus.dataset.err = '1';
    D.netStatus.textContent = 'CONNECTION LOST';
    addFeed('CONNECTION LOST', 'them');
  },
};

/* ================= main loop ================= */
rebuildBots();
updateSub();
window.GAME = { p, bots, state, World, Net };

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  if (state.started && !state.paused && !state.over) {
    state.tNow += dt;
    state.time -= dt;
    if (state.time <= 0) { endMatch(); }
    updatePlayer(dt);
    updateWeapon(dt);
    for (const b of bots) updateBot(b, dt);
    updateParticles(dt);
    updateShells(dt);
    for (const tr of tracers) {
      if (tr.life > 0) {
        tr.life -= dt;
        tr.m.material.opacity = Math.max(0, tr.life / 0.06) * 0.85;
        if (tr.life <= 0) tr.m.visible = false;
      }
    }
    updateCamera();
    updateHUD(dt);
  } else if (!state.started) {
    menuCamera(dt);
  }

  Net.update(dt);
  AudioSys.update();
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
