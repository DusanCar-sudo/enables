'use strict';
/* VOLT RUSH — main. Arcade-sim bike physics (throttle/brake, lean steering,
   countersteer feel, wheelies, jumps off ramp surfaces, wall bounce),
   first-person + chase cam, battery economy, volt orbs, garage progression.
   Desktop keyboard+mouse; mobile touch UI with reduced quality preset. */

const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
const Q = window.Q, IS_MOBILE = window.IS_MOBILE;

/* ================= renderer ================= */
const renderer = new THREE.WebGLRenderer({ antialias: Q.aa, powerPreference: 'high-performance' });
renderer.setSize(innerWidth, innerHeight);
renderer.setPixelRatio(Math.min(devicePixelRatio, Q.pxr));
renderer.shadowMap.enabled = Q.shadows;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;
document.body.appendChild(renderer.domElement);
const canvas = renderer.domElement;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x9fc3e0);
scene.fog = new THREE.FogExp2(0xa8c4d8, Q.fog);

const camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, Q.far);
camera.rotation.order = 'YXZ';
scene.add(camera);

scene.add(new THREE.HemisphereLight(0xcfe4f5, 0x6f7d64, 0.75));
const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
sun.position.set(80, 120, 40);
if (Q.shadows) {
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
  sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
  sun.shadow.camera.near = 20; sun.shadow.camera.far = 300;
  sun.shadow.bias = -0.0006;
}
scene.add(sun);
scene.add(sun.target);

City.build(scene);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

/* ================= DOM ================= */
const $ = id => document.getElementById(id);
const D = {
  hud: $('hud'), garage: $('garage'), winscr: $('winscr'), touchUI: $('touchUI'),
  speedN: $('speedN'), wheelieTag: $('wheelieTag'),
  battBar: $('battBar'), battFill: $('battBar').firstElementChild, battPct: $('battPct'),
  pts: $('pts'), gPts: $('gPts'), bikeName: $('bikeName'),
  objective: $('objective'), objFill: $('objBar').firstElementChild,
  toasts: $('toasts'), crashFade: $('crashFade'), fps: $('fps'),
  bikeCards: $('bikeCards'), rideBtn: $('rideBtn'), winBtn: $('winBtn'),
  rotateTip: $('rotateTip'),
};

/* ================= save / progression ================= */
const save = { pts: 0, owned: ['lightbee'], current: 'lightbee', won: false, tune: {} };
try { Object.assign(save, JSON.parse(localStorage.getItem('voltrush') || '{}')); } catch (e) { }
function persist() { localStorage.setItem('voltrush', JSON.stringify(save)); }

/* ================= bike state ================= */
let spec = Bikes.catalog.find(b => b.id === save.current) || Bikes.catalog[0];
let bikeVis = null;

/* workshop tuning: per-bike percentage multipliers applied over the spec.
   More power costs battery; higher top speed softens acceleration curve. */
function tuneOf(id) {
  if (!save.tune) save.tune = {};
  if (!save.tune[id]) save.tune[id] = { power: 100, top: 100, agility: 100, jump: 100 };
  return save.tune[id];
}
const eff = { vmax: 1, accel: 1, agility: 1, jump: 1, drainW: 1 };
function applyTune() {
  const t = tuneOf(spec.id);
  eff.vmax = spec.vmax * t.top / 100;
  eff.accel = spec.accel * t.power / 100;
  eff.agility = spec.agility * t.agility / 100;
  eff.jump = spec.jump * t.jump / 100;
  eff.drainW = spec.drainW * (0.55 + 0.45 * t.power / 100 + 0.25 * (t.top - 100) / 100);
}

const B = {
  pos: new THREE.Vector3(City.spawn.x, 0, City.spawn.z),
  heading: City.spawn.heading, // yaw, 0 = +z
  v: 0,                        // forward speed m/s
  vy: 0, y: 0, grounded: true,
  lean: 0, steer: 0,
  wheelie: 0, wheelieV: 0,
  battery: 1,
  wheelSpin: 0,
  crashT: 0, airT: 0,
  pitchVis: 0,
};

function mountBike(s) {
  spec = s;
  applyTune();
  if (bikeVis) scene.remove(bikeVis.root);
  bikeVis = Bikes.build(s);
  scene.add(bikeVis.root);
  D.bikeName.textContent = s.name;
}
mountBike(spec);

function resetBike(full) {
  B.pos.set(City.spawn.x, 0, City.spawn.z);
  B.heading = City.spawn.heading;
  B.v = 0; B.vy = 0; B.y = 0; B.grounded = true;
  B.lean = 0; B.steer = 0; B.wheelie = 0; B.wheelieV = 0;
  B.crashT = 0;
  if (full) B.battery = 1;
}

/* ================= orbs visuals ================= */
const orbMeshes = [];
{
  const gGeo = new THREE.SphereGeometry(0.34, 10 + Q.orbSeg * 4, 8 + Q.orbSeg * 4);
  const silver = new THREE.MeshBasicMaterial({ color: 0x9fdcff });
  const gold = new THREE.MeshBasicMaterial({ color: 0xffd45c });
  for (const o of City.orbs) {
    const m = new THREE.Mesh(gGeo, o.gold ? gold : silver);
    m.position.set(o.x, o.y, o.z);
    scene.add(m);
    orbMeshes.push({ o, m, taken: false, respawn: 0 });
  }
}

/* trophy bikes on plinths (show locked lineup at spawn) */
const plinthBikes = [];
Bikes.catalog.forEach((s, i) => {
  const pv = Bikes.build(s);
  const pl = City.plinths[i];
  pv.root.position.set(pl.x, 0.4, pl.z);
  pv.root.rotation.y = Math.PI;
  scene.add(pv.root);
  plinthBikes.push({ pv, spec: s });
});

/* ================= input ================= */
const keys = {};
addEventListener('keydown', e => {
  keys[e.code] = true;
  if (e.code === 'KeyC' && playing) camMode = (camMode + 1) % 2;
  if (e.code === 'KeyR' && playing) { resetBike(false); AudioSys.bump(); }
  // bunny hop — stronger with speed and JUMP tuning
  if (e.code === 'Space' && playing && !e.repeat && B.grounded && B.crashT <= 0) {
    B.grounded = false;
    B.vy = (2.9 + Math.min(1.5, Math.abs(B.v) * 0.05)) * eff.jump;
    B.airT = 0;
    AudioSys.bump();
  }
});
addEventListener('keyup', e => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; });

let mouseYaw = 0, mousePitch = 0;
let orbitHold = false, orbitYaw = 0, orbitPitch = 0.32;
document.addEventListener('mousemove', e => {
  if (document.pointerLockElement !== canvas) return;
  if (orbitHold) {
    // RMB held: free orbit around the bike
    orbitYaw -= e.movementX * 0.004;
    orbitPitch = clamp(orbitPitch + e.movementY * 0.003, 0.04, 1.25);
    return;
  }
  mouseYaw = clamp(mouseYaw - e.movementX * 0.0016, -2.4, 2.4);
  mousePitch = clamp(mousePitch - e.movementY * 0.0014, -0.7, 0.55);
});
document.addEventListener('mousedown', e => {
  if (e.button !== 2 || !playing || document.pointerLockElement !== canvas) return;
  orbitHold = true;
  orbitYaw = B.heading;      // start directly behind the bike
  orbitPitch = 0.32;
});
document.addEventListener('mouseup', e => { if (e.button === 2) orbitHold = false; });
document.addEventListener('contextmenu', e => e.preventDefault());

// touch state
const touch = { gas: 0, brake: 0, steer: 0, wheelie: false };
function bindTouch(id, on, off) {
  const el = $(id);
  const start = e => { e.preventDefault(); el.classList.add('on'); on(); };
  const end = e => { e.preventDefault(); el.classList.remove('on'); off && off(); };
  el.addEventListener('touchstart', start, { passive: false });
  el.addEventListener('touchend', end, { passive: false });
  el.addEventListener('touchcancel', end, { passive: false });
}
if (IS_MOBILE) {
  bindTouch('tGas', () => touch.gas = 1, () => touch.gas = 0);
  bindTouch('tBrake', () => touch.brake = 1, () => touch.brake = 0);
  bindTouch('tLeft', () => touch.steer = -1, () => { if (touch.steer < 0) touch.steer = 0; });
  bindTouch('tRight', () => touch.steer = 1, () => { if (touch.steer > 0) touch.steer = 0; });
  bindTouch('tWheelie', () => touch.wheelie = true, () => touch.wheelie = false);
  bindTouch('tCam', () => { camMode = (camMode + 1) % 2; });
  bindTouch('tMenu', () => { openGarage(); });
}

function readInput() {
  const gas = (keys['KeyW'] || keys['ArrowUp']) ? 1 : touch.gas;
  const brake = (keys['KeyS'] || keys['ArrowDown']) ? 1 : touch.brake;
  const steer = ((keys['KeyD'] || keys['ArrowRight']) ? 1 : 0)
    - ((keys['KeyA'] || keys['ArrowLeft']) ? 1 : 0) || touch.steer;
  const wheelie = keys['ShiftLeft'] || keys['ShiftRight'] || touch.wheelie;
  return { gas, brake, steer, wheelie };
}

/* ================= physics ================= */
function wallCollide() {
  for (const w of City.walls) {
    const r = 0.42;
    if (B.pos.x + r < w.min.x || B.pos.x - r > w.max.x ||
        B.pos.z + r < w.min.z || B.pos.z - r > w.max.z ||
        B.y > w.max.y) continue;
    // push out along smallest penetration
    const px = Math.min(B.pos.x + r - w.min.x, w.max.x - (B.pos.x - r));
    const pz = Math.min(B.pos.z + r - w.min.z, w.max.z - (B.pos.z - r));
    if (px < pz) B.pos.x += (B.pos.x < (w.min.x + w.max.x) / 2) ? -px : px;
    else B.pos.z += (B.pos.z < (w.min.z + w.max.z) / 2) ? -pz : pz;
    const sp = Math.abs(B.v);
    if (sp > 11) { crash(); return; }
    if (sp > 2) AudioSys.bump();
    B.v *= -0.35;
  }
}

function crash() {
  B.crashT = 1.3;
  B.v *= 0.1;
  B.wheelie = 0;
  B.wheelieV = 0;
  B.steer = 0;
  AudioSys.crash();
  D.crashFade.style.opacity = 0.85;
  setTimeout(() => { D.crashFade.style.opacity = 0; }, 350);
  toast('CRASH!', false);
}

function updateBike(dt) {
  // crash stun: no control, brake only while still rolling forward (never reverse)
  const inp = B.crashT > 0 ? { gas: 0, brake: B.v > 0.4 ? 1 : 0, steer: 0, wheelie: false } : readInput();
  B.crashT = Math.max(0, B.crashT - dt);

  const dead = B.battery <= 0;
  const throttle = dead ? 0 : inp.gas;

  // longitudinal
  const drag = 0.012 * B.v * Math.abs(B.v) + 0.25;
  let acc = 0;
  if (throttle > 0 && B.grounded) {
    const powerCurve = 1 - Math.pow(Math.abs(B.v) / eff.vmax, 3);
    acc += eff.accel * Math.max(0, powerCurve) * throttle;
  }
  if (inp.brake) acc -= (B.v > 0 ? 11 : 4);
  acc -= drag * Math.sign(B.v);
  B.v += acc * dt;
  if (Math.abs(B.v) < 0.06 && throttle === 0) B.v = 0;
  B.v = clamp(B.v, -3.5, eff.vmax * 1.08); // slight overspeed downhill headroom

  // battery: drain by throttle load, regen on brake
  if (throttle > 0 && B.grounded) {
    const load = 0.35 + 0.65 * (Math.abs(B.v) / eff.vmax);
    // scaled so a Light Bee at full throttle lasts ~6-7 min of riding
    B.battery -= (eff.drainW * load * dt) / (spec.battWh * 380);
  }
  if (inp.brake && B.v > 3) B.battery += 0.004 * dt; // light regen
  B.battery = clamp(B.battery, 0, 1);

  // steering: speed-sensitive, lean follows
  const spF = clamp(Math.abs(B.v) / 8, 0, 1);
  const steerRate = eff.agility * (2.6 - 1.55 * clamp(Math.abs(B.v) / eff.vmax, 0, 1));
  B.steer += (inp.steer - B.steer) * Math.min(1, 8 * dt);
  if (Math.abs(B.v) > 0.4 && B.grounded) {
    B.heading -= B.steer * steerRate * dt * Math.sign(B.v) * spF;
  } else if (!B.grounded) {
    B.heading -= B.steer * steerRate * 0.35 * dt; // small air control
  }
  const targetLean = -B.steer * clamp(Math.abs(B.v) / eff.vmax, 0, 1) * 0.62;
  B.lean += (targetLean - B.lean) * Math.min(1, 6.5 * dt);

  // wheelie: shift+gas at speed pitches up; balance minigame-lite
  if (inp.wheelie && throttle > 0 && B.grounded && B.v > 4) {
    B.wheelieV += 2.6 * dt;
  } else {
    B.wheelieV -= 4.5 * dt;
  }
  // balance pushback near the tipping point — wheelie is holdable,
  // loop-out only when pinned hard past the balance zone
  if (B.wheelie > 0.45) B.wheelieV -= (B.wheelie - 0.45) * 6 * dt;
  B.wheelieV = clamp(B.wheelieV, -2, 1.2);
  B.wheelie = clamp(B.wheelie + B.wheelieV * dt, 0, 0.62);
  if (B.wheelie <= 0) B.wheelieV = Math.max(0, B.wheelieV);
  if (B.wheelie >= 0.6 && B.wheelieV > 0.25) { crash(); } // looped out

  // integrate horizontal
  const dx = Math.sin(B.heading) * B.v * dt;
  const dz = Math.cos(B.heading) * B.v * dt;
  B.pos.x = clamp(B.pos.x + dx, -148, 148);
  B.pos.z = clamp(B.pos.z + dz, -148, 148);

  // vertical vs ground surface (ramps launch naturally: ground falls away
  // or rises; when rising faster than vy we convert slope into launch)
  const g = City.groundAt(B.pos.x, B.pos.z);
  const gPrev = City.groundAt(B.pos.x - dx, B.pos.z - dz);
  const slopeVy = (g - gPrev) / Math.max(dt, 1e-4);

  if (B.grounded) {
    if (g < B.y - 0.08) {
      // ground dropped away — airborne
      B.grounded = false;
      B.vy = slopeVy > 0 ? slopeVy : 0;
      B.airT = 0;
    } else {
      B.y = g;
      // launch off upslope lips
      if (slopeVy > 2.2 && Math.abs(B.v) > 6) {
        B.grounded = false;
        B.vy = slopeVy * 0.92 * eff.jump;
        B.airT = 0;
      }
    }
  }
  if (!B.grounded) {
    B.vy -= 15.5 * dt;
    B.y += B.vy * dt;
    B.airT += dt;
    if (B.y <= g) {
      B.y = g;
      const impact = -B.vy;
      B.grounded = true;
      if (impact > 13) crash();
      else if (impact > 3) AudioSys.land(impact > 8);
      if (B.airT > 0.55 && B.crashT === 0) {
        const pts = Math.round(B.airT * 22);
        addPts(pts, `AIR +${pts}`);
      }
      B.vy = 0;
    }
  }

  wallCollide();

  // wheel spin visual
  B.wheelSpin += (B.v / 0.3) * dt;

  // engine audio
  AudioSys.engine(Math.abs(B.v), eff.vmax, throttle, !!inp.brake, B.grounded, B.battery < 0.15 && B.battery > 0);
  if (B.wheelie > 0.1 && Math.random() < dt * 6) AudioSys.wheelieTick();

  // charge pads
  for (const pd of City.pads) {
    const d = Math.hypot(B.pos.x - pd.x, B.pos.z - pd.z);
    if (d < 2.3 && B.y < 0.5) {
      if (B.battery < 1) {
        B.battery = Math.min(1, B.battery + 0.14 * dt);
        if (Math.random() < dt * 2.5) AudioSys.charge();
      }
    }
  }

  // orbs
  for (const om of orbMeshes) {
    if (om.taken) {
      om.respawn -= dt;
      if (om.respawn <= 0) { om.taken = false; om.m.visible = true; }
      continue;
    }
    const d2 = (B.pos.x - om.o.x) ** 2 + (B.pos.z - om.o.z) ** 2;
    const dy = Math.abs((B.y + 0.8) - om.o.y);
    if (d2 < 1.5 && dy < 1.5) {
      om.taken = true; om.m.visible = false; om.respawn = 45;
      addPts(om.o.v, `+${om.o.v} ⚡`);
      AudioSys.pickup(om.o.gold);
    }
  }
}

/* ================= points / progression ================= */
function addPts(n, label) {
  save.pts += n;
  persist();
  if (label) toast(label, true);
  checkObjective();
}

function toast(txt, small) {
  const d = document.createElement('div');
  d.className = 'toast';
  if (small) d.style.fontSize = '17px';
  d.textContent = txt;
  D.toasts.appendChild(d);
  setTimeout(() => d.remove(), 1400);
  while (D.toasts.children.length > 3) D.toasts.firstChild.remove();
}

function nextGoal() {
  for (const s of Bikes.catalog) if (!save.owned.includes(s.id)) return s;
  return null;
}
function checkObjective() {
  const goal = nextGoal();
  if (!goal) {
    D.objective.textContent = 'FULL GARAGE — KING OF THE CITY';
    D.objFill.style.width = '100%';
    return;
  }
  D.objective.textContent = `NEXT: ${goal.name.replace('SUR-RON ', '')} — ${save.pts}/${goal.cost} ⚡`;
  D.objFill.style.width = Math.min(100, save.pts / goal.cost * 100) + '%';
}

/* ================= cameras ================= */
let camMode = 0; // 0 first-person, 1 chase
const camPos = new THREE.Vector3();
function updateCamera(dt) {
  const sinH = Math.sin(B.heading), cosH = Math.cos(B.heading);
  if (orbitHold) {
    // external orbit view while RMB held
    const dist = 5.2, cp = Math.cos(orbitPitch);
    camPos.set(
      B.pos.x - Math.sin(orbitYaw) * dist * cp,
      B.y + 0.9 + Math.sin(orbitPitch) * dist,
      B.pos.z - Math.cos(orbitYaw) * dist * cp
    );
    camera.position.lerp(camPos, Math.min(1, 16 * dt));
    camera.lookAt(B.pos.x, B.y + 0.9, B.pos.z);
  } else if (camMode === 0) {
    // rider eyes: above seat, slight forward; look direction = heading + mouse
    const ex = B.pos.x - sinH * 0.1, ez = B.pos.z - cosH * 0.1;
    const ey = B.y + 1.42 + B.wheelie * 0.25;
    camPos.set(ex, ey, ez);
    camera.position.lerp(camPos, Math.min(1, 25 * dt));
    camera.rotation.y = B.heading + Math.PI + mouseYaw;
    camera.rotation.x = clamp(mousePitch - B.wheelie * 0.5 + (B.grounded ? 0 : clamp(-B.vy * 0.012, -0.08, 0.1)), -1.2, 1.2);
    camera.rotation.z = B.lean * 0.45;
  } else {
    // chase — behind the bike, looking ahead
    const back = 4.6, up = 1.9;
    camPos.set(B.pos.x - sinH * back, B.y + up, B.pos.z - cosH * back);
    camera.position.lerp(camPos, Math.min(1, 7 * dt));
    camera.lookAt(B.pos.x + sinH * 1.5, B.y + 0.9, B.pos.z + cosH * 1.5);
    camera.rotation.z += B.lean * 0.18;
  }
  // speed FOV kick
  const fovT = 72 + clamp(Math.abs(B.v) / eff.vmax, 0, 1) * 12;
  if (Math.abs(camera.fov - fovT) > 0.1) { camera.fov += (fovT - camera.fov) * Math.min(1, 4 * dt); camera.updateProjectionMatrix(); }
}

/* ================= bike visual sync ================= */
function syncBikeVis(dt) {
  const r = bikeVis;
  r.root.position.set(B.pos.x, B.y, B.pos.z);
  r.root.rotation.y = B.heading; // model front is +z; heading 0 moves +z
  r.lean.rotation.z = B.lean;
  // pitch: wheelie + air attitude
  let pitch = -B.wheelie * 1.15;
  if (!B.grounded) pitch += clamp(-B.vy * 0.03, -0.25, 0.3);
  B.pitchVis += (pitch - B.pitchVis) * Math.min(1, 10 * dt);
  // pitch pivots around the rear tire contact patch (z=-0.63) so the rear
  // wheel stays planted during wheelies instead of sinking into the ground
  const zPivot = -0.63;
  r.chassis.rotation.x = B.pitchVis;
  r.chassis.position.y = zPivot * Math.sin(B.pitchVis);
  r.chassis.position.z = zPivot * (1 - Math.cos(B.pitchVis));
  r.forkG.rotation.y = -B.steer * 0.35;
  r.wheelF.rotation.x = B.wheelSpin;
  r.wheelR.rotation.x = B.wheelSpin;
  // bike stays visible in first person: bars + front wheel in frame feels right
}

/* ================= garage UI ================= */
let playing = false;
function buildGarage() {
  D.gPts.textContent = save.pts;
  D.bikeCards.innerHTML = '';
  for (const s of Bikes.catalog) {
    const owned = save.owned.includes(s.id);
    const card = document.createElement('div');
    card.className = 'bcard' + (save.current === s.id ? ' sel' : '') + (owned ? '' : ' locked');
    card.innerHTML = `<h3>${s.name.replace('SUR-RON ', '')}</h3>
      <div class="tier ${s.tierCls}">${s.tier}</div>
      <ul>${s.specs.map(x => `<li>${x}</li>`).join('')}</ul>`;
    const btn = document.createElement('button');
    btn.className = 'bbtn' + (owned ? '' : ' buy');
    if (owned) {
      btn.textContent = save.current === s.id ? 'RIDING' : 'SELECT';
      btn.disabled = save.current === s.id;
      btn.onclick = () => { save.current = s.id; persist(); mountBike(s); resetBike(false); buildGarage(); };
    } else {
      btn.textContent = `UNLOCK — ${s.cost} ⚡`;
      btn.disabled = save.pts < s.cost;
      btn.onclick = () => {
        if (save.pts < s.cost) return;
        save.pts -= s.cost;
        save.owned.push(s.id);
        save.current = s.id;
        persist();
        mountBike(s);
        resetBike(true);
        AudioSys.unlock();
        buildGarage();
        if (s.id === 'stormbee' && !save.won) {
          save.won = true; persist();
          D.garage.style.display = 'none';
          D.winscr.style.display = 'flex';
          return;
        }
      };
    }
    card.appendChild(btn);
    D.bikeCards.appendChild(card);
  }
  refreshTuneUI();
}

/* ---- workshop tuning sliders ---- */
const TUNE_KEYS = [
  ['tPower', 'power'], ['tTop', 'top'], ['tAgi', 'agility'], ['tJump', 'jump'],
];
function refreshTuneUI() {
  const t = tuneOf(spec.id);
  $('tuneBike').textContent = spec.name.replace('SUR-RON ', '');
  for (const [el, key] of TUNE_KEYS) {
    $(el).value = t[key];
    $(el + 'V').textContent = t[key] + '%';
  }
}
for (const [el, key] of TUNE_KEYS) {
  $(el).addEventListener('input', () => {
    const t = tuneOf(spec.id);
    t[key] = +$(el).value;
    $(el + 'V').textContent = t[key] + '%';
    applyTune();
    persist();
  });
}

function openGarage() {
  playing = false;
  for (const k in keys) keys[k] = false;
  touch.gas = 0; touch.brake = 0; touch.steer = 0; touch.wheelie = false;
  orbitHold = false;
  buildGarage();
  refreshTuneUI();
  D.garage.style.display = 'flex';
  D.hud.style.display = 'none';
  if (IS_MOBILE) D.touchUI.style.display = 'none';
  if (document.pointerLockElement === canvas) document.exitPointerLock();
}

function startRide() {
  AudioSys.init(); AudioSys.resume();
  D.garage.style.display = 'none';
  D.winscr.style.display = 'none';
  D.hud.style.display = 'block';
  if (IS_MOBILE) D.touchUI.style.display = 'block';
  else canvas.requestPointerLock();
  playing = true;
  checkObjective();
}

D.rideBtn.addEventListener('click', startRide);
D.rideBtn.addEventListener('touchend', e => { e.preventDefault(); startRide(); }, { passive: false });
D.winBtn.addEventListener('click', startRide);
D.winBtn.addEventListener('touchend', e => { e.preventDefault(); startRide(); }, { passive: false });

document.addEventListener('pointerlockchange', () => {
  if (IS_MOBILE) return;
  if (document.pointerLockElement !== canvas && playing) openGarage();
});
addEventListener('keydown', e => {
  if (e.code === 'Escape' && playing && IS_MOBILE) openGarage();
});

/* orientation tip */
function checkOrient() {
  if (!IS_MOBILE) return;
  const portrait = innerHeight > innerWidth;
  D.rotateTip.style.display = portrait ? 'flex' : 'none';
}
addEventListener('resize', checkOrient);
checkOrient();

/* ================= HUD ================= */
let fpsFrames = 0, fpsT = 0;
function updateHUD(dt) {
  D.speedN.textContent = Math.round(Math.abs(B.v) * 3.6);
  D.wheelieTag.textContent = B.wheelie > 0.08 ? 'WHEELIE!' : (B.grounded ? '' : 'AIR');
  const pct = Math.round(B.battery * 100);
  D.battFill.style.width = pct + '%';
  D.battPct.textContent = B.battery <= 0 ? 'EMPTY — FIND GREEN PAD' : pct + '%';
  D.battBar.classList.toggle('low', pct < 20);
  D.pts.textContent = save.pts;
  fpsFrames++; fpsT += dt;
  if (fpsT >= 1) { D.fps.textContent = Math.round(fpsFrames / fpsT) + ' FPS'; fpsFrames = 0; fpsT = 0; }
}

/* ================= ambient anim ================= */
let animT = 0;
function updateAmbient(dt) {
  animT += dt;
  for (const om of orbMeshes) {
    if (om.taken) continue;
    om.m.position.y = om.o.y + Math.sin(animT * 2.2 + om.o.x) * 0.12;
    om.m.rotation.y += dt * 2;
  }
  for (const pd of City.pads) {
    if (pd.glow) pd.glow.material.opacity = 0.4 + Math.sin(animT * 3) * 0.2;
    if (pd.bolt) pd.bolt.rotation.y += dt * 1.5;
  }
  plinthBikes.forEach((pb, i) => {
    pb.pv.root.rotation.y += dt * 0.4;
    pb.pv.root.position.y = 0.4 + Math.sin(animT * 1.4 + i) * 0.05;
  });
}

/* ================= main loop ================= */
buildGarage();
checkObjective();
window.GAME = { B, save, City, Bikes };

let last = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const dt = Math.min(0.045, (now - last) / 1000);
  last = now;
  if (playing) {
    updateBike(dt);
    syncBikeVis(dt);
    updateCamera(dt);
    updateHUD(dt);
  } else {
    // garage backdrop: slow orbit around spawn plinths
    animT += 0;
    const a = now * 0.00012;
    camera.position.set(Math.cos(a) * 18, 6, 82 + Math.sin(a) * 14);
    camera.lookAt(0, 1.2, 92);
  }
  updateAmbient(dt);
  renderer.render(scene, camera);
}
requestAnimationFrame(frame);
