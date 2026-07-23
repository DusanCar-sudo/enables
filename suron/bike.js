'use strict';
/* VOLT RUSH bikes — Sur-Ron-inspired lineup with real-world spec sheet.
   Procedural 3D model: twin-spar alloy frame silhouette, USD-style forks,
   rear mono-shock, knobby tires, mid-drive motor block, belt/chain guard.
   One builder, per-bike tint + proportions. */
const Bikes = (() => {
  /* Real Sur-Ron figures (spec sheet values, converted):
     Light Bee X: 6 kW peak, ~75-80 km/h, 60V 32Ah, 50 kg
     Ultra Bee:  12.5 kW peak, ~90 km/h, 74V 55Ah, 85 kg
     Storm Bee:  22.5 kW peak, ~110 km/h, 96V 55Ah, 118 kg */
  const catalog = [
    {
      id: 'lightbee', name: 'SUR-RON LIGHT BEE X', tier: 'STREET LEGEND', tierCls: 't1',
      cost: 0,
      specs: ['<b>6 kW</b> peak PMSM', '<b>75 km/h</b> top speed', '60V 32Ah — <b>1.9 kWh</b>', '<b>50 kg</b> — flickable'],
      vmax: 75 / 3.6, accel: 7.5, mass: 50, agility: 1.25,
      battWh: 1900, drainW: 2600, jump: 1.0,
      color: 0x2f3338, rim: 0x14171a, accent: 0xd8dde2,
    },
    {
      id: 'ultrabee', name: 'SUR-RON ULTRA BEE', tier: 'TRAIL WEAPON', tierCls: 't2',
      cost: 600,
      specs: ['<b>12.5 kW</b> peak', '<b>90 km/h</b> top speed', '74V 55Ah — <b>4.1 kWh</b>', '<b>85 kg</b> — planted'],
      vmax: 90 / 3.6, accel: 9.5, mass: 85, agility: 1.05,
      battWh: 4100, drainW: 3400, jump: 1.12,
      color: 0x8a8f96, rim: 0x1a1d20, accent: 0xffb84d,
    },
    {
      id: 'stormbee', name: 'SUR-RON STORM BEE', tier: 'THE GRAIL', tierCls: 't3',
      cost: 1500,
      specs: ['<b>22.5 kW</b> peak', '<b>110 km/h</b> top speed', '96V 55Ah — <b>5.3 kWh</b>', '<b>118 kg</b> — full send'],
      vmax: 110 / 3.6, accel: 12.0, mass: 118, agility: 0.92,
      battWh: 5300, drainW: 4200, jump: 1.22,
      color: 0x1d5fa8, rim: 0x101316, accent: 0x63c8ff,
    },
  ];

  function knobbyTire(r, w, rimColor) {
    const g = new THREE.Group();
    const tire = new THREE.Mesh(
      new THREE.TorusGeometry(r, w, 8, 20),
      new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.95 })
    );
    tire.rotation.y = Math.PI / 2; // ring into YZ plane, spin axis = x
    g.add(tire);
    // knobs
    const knobGeo = new THREE.BoxGeometry(w * 1.7, 0.025, 0.03);
    const knobMat = new THREE.MeshStandardMaterial({ color: 0x232326, roughness: 1 });
    for (let i = 0; i < 14; i++) {
      const a = i / 14 * Math.PI * 2;
      const k = new THREE.Mesh(knobGeo, knobMat);
      k.position.set(0, Math.cos(a) * (r + w * 0.75), Math.sin(a) * (r + w * 0.75));
      k.rotation.x = -a;
      g.add(k);
    }
    const rim = new THREE.Mesh(
      new THREE.CylinderGeometry(r * 0.62, r * 0.62, w * 0.7, 18),
      new THREE.MeshStandardMaterial({ color: rimColor, roughness: 0.4, metalness: 0.7 })
    );
    rim.rotation.z = Math.PI / 2;
    g.add(rim);
    // spokes
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x8f969c, roughness: 0.35, metalness: 0.8 });
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(0.012, r * 1.15, 0.012), spokeMat);
      s.rotation.x = i / 6 * Math.PI;
      g.add(s);
    }
    const hub = new THREE.Mesh(
      new THREE.CylinderGeometry(0.05, 0.05, w * 1.4, 10),
      spokeMat
    );
    hub.rotation.z = Math.PI / 2;
    g.add(hub);
    g.traverse(m => { if (m.isMesh) m.castShadow = true; });
    return g;
  }

  /* Build full bike. Returns:
     root — position/yaw/pitch(roll applied to lean group)
     lean — child, z-roll for lean
     chassis — child of lean, x-pitch for wheelie
     wheelF/wheelR — spin around x
     forkG — steer around y */
  function build(spec) {
    const P = { // proportions
      wb: 1.26,           // wheelbase
      rw: 0.30, rt: 0.085, // wheel radius / tire thickness
      seatH: 0.83,
    };
    const paint = new THREE.MeshStandardMaterial({ color: spec.color, roughness: 0.35, metalness: 0.55 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x212428, roughness: 0.6, metalness: 0.4 });
    const alloy = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.3, metalness: 0.85 });
    const accent = new THREE.MeshStandardMaterial({ color: spec.accent, roughness: 0.4, metalness: 0.3 });
    const rubber = new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.9 });

    const root = new THREE.Group();
    const lean = new THREE.Group(); root.add(lean);
    const chassis = new THREE.Group(); lean.add(chassis);

    function box(mat, sx, sy, sz, x, y, z, rz, parent) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, sy, sz), mat);
      m.position.set(x, y, z);
      if (rz) m.rotation.x = rz;
      m.castShadow = true;
      (parent || chassis).add(m);
      return m;
    }
    function tube(mat, r, len, x, y, z, rx, parent) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
      m.position.set(x, y, z);
      m.rotation.x = rx === undefined ? 0 : rx;
      m.castShadow = true;
      (parent || chassis).add(m);
      return m;
    }

    // +z forward. Rear axle z=-wb/2, front axle z=+wb/2.
    const zR = -P.wb / 2, zF = P.wb / 2, axleY = P.rw + P.rt; // axle at tire outer radius so tread sits on the ground

    // twin-spar frame: two side spars from steerer down to swingarm pivot
    for (const sx of [-0.045, 0.045]) {
      const spar = box(paint, 0.03, 0.06, 0.78, sx, 0.72, 0.12);
      spar.rotation.x = -0.28;
      const lower = box(paint, 0.03, 0.05, 0.5, sx, 0.45, -0.1);
      lower.rotation.x = 0.35;
    }
    // battery box (the Sur-Ron signature center mass)
    box(dark, 0.13, 0.34, 0.4, 0, 0.5, 0.1);
    box(accent, 0.135, 0.08, 0.28, 0, 0.56, 0.1); // battery stripe
    // motor block + small sprocket
    box(dark, 0.16, 0.17, 0.2, 0, 0.32, -0.12);
    tube(alloy, 0.05, 0.05, 0.06, 0.3, -0.16, Math.PI / 2);
    // seat / tail
    const seat = box(dark, 0.11, 0.05, 0.46, 0, P.seatH, -0.16);
    seat.rotation.x = 0.06;
    box(paint, 0.1, 0.04, 0.2, 0, P.seatH - 0.05, -0.38); // tail
    // swingarm
    for (const sx of [-0.05, 0.05]) {
      const arm = box(alloy, 0.025, 0.045, 0.62, sx, (axleY + 0.38) / 2, (zR - 0.05) / 2 + 0.02);
      arm.lookAt(new THREE.Vector3(sx, axleY, zR).add(root.position));
      arm.rotation.x += Math.PI / 2;
    }
    // mono-shock
    const shock = tube(accent, 0.025, 0.3, 0, 0.55, -0.22, 0.5);
    shock.rotation.x = 0.55;
    // fork group (steering)
    const forkG = new THREE.Group();
    forkG.position.set(0, 0.86, 0.36);
    forkG.rotation.x = -0.42; // rake
    chassis.add(forkG);
    for (const sx of [-0.055, 0.055]) {
      tube(alloy, 0.022, 0.5, sx, -0.28, 0, 0, forkG);   // upper (gold on real bike)
      tube(dark, 0.028, 0.34, sx, -0.52, 0, 0, forkG);   // lower
    }
    // handlebar
    const bar = tube(dark, 0.016, 0.56, 0, 0.06, 0, 0, forkG);
    bar.rotation.z = Math.PI / 2;
    for (const sx of [-0.26, 0.26]) {
      tube(rubber, 0.021, 0.11, sx, 0.06, 0, 0, forkG).rotation.z = Math.PI / 2; // grips
    }
    box(dark, 0.09, 0.05, 0.02, 0, 0.1, 0.04, 0, forkG); // bar display
    // front fender
    const fender = box(paint, 0.1, 0.02, 0.4, 0, -0.62, 0.08, 0, forkG);
    fender.rotation.x = -0.15;
    // headlight
    const hl = box(accent, 0.08, 0.1, 0.03, 0, -0.08, 0.09, 0, forkG);
    // number plate on front
    box(paint, 0.14, 0.16, 0.015, 0, 0.0, 0.07, 0, forkG);

    // wheels — parented to chassis (position), spin via rotation.x
    const wheelR = knobbyTire(P.rw, P.rt, spec.rim);
    wheelR.position.set(0, axleY, zR);
    chassis.add(wheelR);
    const wheelF = knobbyTire(P.rw, P.rt, spec.rim);
    wheelF.position.set(0, -0.68, 0.02);
    forkG.add(wheelF); // front wheel steers with fork

    // pedal pegs
    for (const sx of [-0.12, 0.12]) box(alloy, 0.09, 0.02, 0.05, sx, 0.3, 0.06);

    root.traverse(m => { if (m.isMesh) { m.castShadow = true; } });
    return { root, lean, chassis, forkG, wheelF, wheelR, headlight: hl };
  }

  return { catalog, build };
})();
