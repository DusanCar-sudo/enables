'use strict';
/* VOLT RUSH city — 300x300m. Streets, building blocks, NE dirt park with
   jump line, SW skatepark (funbox, kickers, quarter pipe), charge pads,
   volt orbs. Ramps exist both as meshes and as height-field surfaces so
   physics and visuals always agree. */
const City = (() => {
  const surfaces = []; // {x0,x1,z0,z1,type:'flat'|'ramp',h|h0,h1,axis}
  const walls = [];    // AABBs {min:{x,y,z},max:{x,y,z}}
  const orbs = [];     // {x,y,z,v,gold}
  const pads = [{ x: 10, z: 72 }, { x: 28, z: -30 }, { x: -30, z: 30 }];
  const spawn = { x: 0, z: 78, heading: Math.PI }; // facing -z (north, into city)
  const plinths = [{ x: -8, z: 92 }, { x: 0, z: 94 }, { x: 8, z: 92 }];

  /* ---------- textures ---------- */
  function makeCanvas(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    fn(c.getContext('2d'), w, h);
    return c;
  }
  function speckle(g, w, h, n, dark, light) {
    for (let i = 0; i < n; i++) {
      const v = Math.random();
      g.fillStyle = v > 0.5 ? `rgba(255,255,255,${light * Math.random()})`
        : `rgba(0,0,0,${dark * Math.random()})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }
  function texAsphalt() {
    return makeCanvas(128, 256, (g, w, h) => {
      g.fillStyle = '#3c3f42'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 700, 0.16, 0.05);
      // center dashed line
      g.fillStyle = '#d8d3b8';
      for (let y = 8; y < h; y += 48) g.fillRect(w / 2 - 2, y, 4, 22);
      // edge lines
      g.fillStyle = 'rgba(220,215,190,0.5)';
      g.fillRect(4, 0, 2, h); g.fillRect(w - 6, 0, 2, h);
    });
  }
  function texPavement() {
    return makeCanvas(128, 128, (g, w, h) => {
      g.fillStyle = '#8d8a80'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 500, 0.1, 0.06);
      g.strokeStyle = 'rgba(40,38,32,0.35)'; g.lineWidth = 1.5;
      for (let i = 0; i <= 4; i++) {
        g.beginPath(); g.moveTo(i * 32, 0); g.lineTo(i * 32, h); g.stroke();
        g.beginPath(); g.moveTo(0, i * 32); g.lineTo(w, i * 32); g.stroke();
      }
    });
  }
  function texGrass() {
    return makeCanvas(128, 128, (g, w, h) => {
      g.fillStyle = '#5d7c3a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = Math.random() > 0.5 ? 'rgba(120,160,70,0.35)' : 'rgba(50,75,30,0.35)';
        g.fillRect(Math.random() * w, Math.random() * h, 1, 2 + Math.random() * 2);
      }
    });
  }
  function texDirt() {
    return makeCanvas(128, 128, (g, w, h) => {
      g.fillStyle = '#8a6a42'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 700, 0.15, 0.07);
      for (let i = 0; i < 14; i++) {
        g.fillStyle = 'rgba(60,42,22,0.25)';
        g.beginPath();
        g.ellipse(Math.random() * w, Math.random() * h, 4 + Math.random() * 10, 2 + Math.random() * 4, Math.random() * 3, 0, 7);
        g.fill();
      }
    });
  }
  function texConcrete() {
    return makeCanvas(128, 128, (g, w, h) => {
      g.fillStyle = '#a5a29a'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 550, 0.12, 0.06);
    });
  }
  function texFacade() {
    return makeCanvas(128, 256, (g, w, h) => {
      const base = ['#9a8f80', '#8f9aa5', '#a5988a', '#8a95a0'][Math.floor(Math.random() * 4)];
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 300, 0.08, 0.05);
      // windows grid
      for (let ry = 10; ry < h - 18; ry += 30) {
        for (let rx = 10; rx < w - 16; rx += 26) {
          const lit = Math.random() < 0.12;
          g.fillStyle = lit ? '#ffe9a8' : (Math.random() < 0.5 ? '#2c3844' : '#3d4c5a');
          g.fillRect(rx, ry, 16, 20);
          g.strokeStyle = 'rgba(30,26,20,0.5)'; g.lineWidth = 1.5;
          g.strokeRect(rx, ry, 16, 20);
        }
      }
      // ground floor band
      g.fillStyle = 'rgba(40,36,30,0.45)'; g.fillRect(0, h - 14, w, 14);
    });
  }

  /* ---------- geometry helpers ---------- */
  let sceneRef = null;
  const mats = {};

  function flat(x0, x1, z0, z1, h) { surfaces.push({ type: 'flat', x0, x1, z0, z1, h }); }

  // ramp surface: height varies linearly along `axis` from h0 (at axis-min) to h1
  function rampSurf(x0, x1, z0, z1, h0, h1, axis) {
    surfaces.push({ type: 'ramp', x0, x1, z0, z1, h0, h1, axis });
  }

  // prism mesh matching a ramp/flat footprint (corner heights)
  function prismMesh(x0, x1, z0, z1, h00, h10, h01, h11, mat) {
    // hAB = height at (xA edge, zB edge); A,B in {0,1}
    const v = [];
    const p = [
      [x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1],           // 0-3 bottom
      [x0, h00, z0], [x1, h10, z0], [x1, h11, z1], [x0, h01, z1],   // 4-7 top
    ];
    const quad = (a, b, c, d) => { v.push(...p[a], ...p[b], ...p[c], ...p[a], ...p[c], ...p[d]); };
    quad(4, 5, 6, 7); // top
    quad(0, 1, 5, 4); // north side (z0)
    quad(2, 3, 7, 6); // south side (z1)
    quad(1, 2, 6, 5); // east side (x1)
    quad(3, 0, 4, 7); // west side (x0)
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(v), 3));
    // box-projected UVs — textured materials need them or the mesh won't draw
    const uv = new Float32Array(v.length / 3 * 2);
    for (let i = 0; i < v.length / 3; i++) {
      uv[i * 2] = (v[i * 3] + v[i * 3 + 2]) * 0.22;
      uv[i * 2 + 1] = (v[i * 3 + 1] + v[i * 3 + 2]) * 0.22;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, mat);
    m.castShadow = true; m.receiveShadow = true;
    sceneRef.add(m);
    return m;
  }

  function ramp(x0, x1, z0, z1, h0, h1, axis, mat) {
    rampSurf(x0, x1, z0, z1, h0, h1, axis);
    if (axis === 'x') prismMesh(x0, x1, z0, z1, h0, h1, h0, h1, mat);
    else prismMesh(x0, x1, z0, z1, h0, h0, h1, h1, mat);
  }

  function block(x0, x1, z0, z1, h, mat) {
    flat(x0, x1, z0, z1, h);
    prismMesh(x0, x1, z0, z1, h, h, h, h, mat);
  }

  // quarter pipe approximated by curved ramp segments (physics == visuals)
  function quarterPipe(x0, x1, z0, z1, R, axis, mat) {
    const N = 6;
    for (let i = 0; i < N; i++) {
      const t0 = i / N, t1 = (i + 1) / N;
      const hA = R - Math.sqrt(Math.max(0, R * R - (t0 * 0.94 * R) ** 2));
      const hB = R - Math.sqrt(Math.max(0, R * R - (t1 * 0.94 * R) ** 2));
      if (axis === 'x') {
        const xa = x0 + (x1 - x0) * t0, xb = x0 + (x1 - x0) * t1;
        ramp(Math.min(xa, xb), Math.max(xa, xb), z0, z1,
          xb > xa ? hA : hB, xb > xa ? hB : hA, 'x', mat);
      } else {
        const za = z0 + (z1 - z0) * t0, zb = z0 + (z1 - z0) * t1;
        ramp(x0, x1, Math.min(za, zb), Math.max(za, zb),
          zb > za ? hA : hB, zb > za ? hB : hA, 'z', mat);
      }
    }
  }

  function wall(cx, cz, sx, sz, h, mesh) {
    walls.push({
      min: { x: cx - sx / 2, y: 0, z: cz - sz / 2 },
      max: { x: cx + sx / 2, y: h, z: cz + sz / 2 }
    });
    if (mesh) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(sx, h, sz), mesh);
      m.position.set(cx, h / 2, cz);
      m.castShadow = true; m.receiveShadow = true;
      sceneRef.add(m);
    }
  }

  function building(cx, cz, sx, sz, h) {
    const tex = new THREE.CanvasTexture(texFacade());
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(Math.max(1, Math.round(Math.max(sx, sz) / 8)), Math.max(1, Math.round(h / 12)));
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    wall(cx, cz, sx, sz, h, mat);
    // roof lip
    const lip = new THREE.Mesh(new THREE.BoxGeometry(sx + 0.6, 0.5, sz + 0.6), mats.concrete);
    lip.position.set(cx, h + 0.25, cz);
    sceneRef.add(lip);
  }

  function tree(x, z) {
    const g = new THREE.Group();
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.2, 1.6, 6),
      new THREE.MeshLambertMaterial({ color: 0x5e4527 }));
    trunk.position.y = 0.8; g.add(trunk);
    const leaf = new THREE.MeshLambertMaterial({ color: 0x4a7030 });
    const c1 = new THREE.Mesh(new THREE.ConeGeometry(1.3, 2.4, 7), leaf);
    c1.position.y = 2.5; g.add(c1);
    const c2 = new THREE.Mesh(new THREE.ConeGeometry(0.95, 1.8, 7), leaf);
    c2.position.y = 3.6; g.add(c2);
    c1.castShadow = c2.castShadow = true;
    g.position.set(x, 0, z);
    sceneRef.add(g);
    walls.push({ min: { x: x - 0.25, y: 0, z: z - 0.25 }, max: { x: x + 0.25, y: 2, z: z + 0.25 } });
  }

  function orb(x, y, z, gold) { orbs.push({ x, y, z, v: gold ? 50 : 25, gold: !!gold }); }

  /* ---------- build ---------- */
  function build(scene) {
    sceneRef = scene;
    const T = {
      asphalt: new THREE.CanvasTexture(texAsphalt()),
      pavement: new THREE.CanvasTexture(texPavement()),
      grass: new THREE.CanvasTexture(texGrass()),
      dirt: new THREE.CanvasTexture(texDirt()),
      concrete: new THREE.CanvasTexture(texConcrete()),
    };
    for (const k in T) { T[k].wrapS = T[k].wrapT = THREE.RepeatWrapping; T[k].anisotropy = 4; }
    mats.concrete = new THREE.MeshLambertMaterial({ map: T.concrete });
    mats.dirt = new THREE.MeshLambertMaterial({ map: T.dirt });

    function groundPlane(w, d, x, z, y, tex, rx, rz) {
      const t = tex.clone(); t.needsUpdate = true; t.repeat.set(rx, rz);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshLambertMaterial({ map: t }));
      m.rotation.x = -Math.PI / 2;
      m.position.set(x, y, z);
      m.receiveShadow = true;
      sceneRef.add(m);
    }
    // base
    groundPlane(300, 300, 0, 0, 0, T.pavement, 60, 60);
    // park grass (NE) & plaza concrete (SW)
    groundPlane(105, 105, 72, -72, 0.012, T.grass, 26, 26);
    groundPlane(105, 105, -72, 72, 0.014, T.concrete, 22, 22);
    // dirt strip under jump line
    groundPlane(78, 14, 72, -70, 0.02, T.dirt, 12, 2);
    // streets (N-S at x=-60,0,60 / E-W at z=-60,0,60)
    for (const sx of [-60, 0, 60]) groundPlane(14, 300, sx, 0, 0.025, T.asphalt, 1, 26);
    for (const sz of [-60, 0, 60]) {
      const t = T.asphalt.clone(); t.needsUpdate = true; t.repeat.set(1, 26); t.rotation = Math.PI / 2; t.center.set(0.5, 0.5);
      const m = new THREE.Mesh(new THREE.PlaneGeometry(300, 14), new THREE.MeshLambertMaterial({ map: t }));
      m.rotation.x = -Math.PI / 2; m.position.set(0, 0.028, sz);
      m.receiveShadow = true;
      sceneRef.add(m);
    }

    // perimeter fence
    const fence = new THREE.MeshLambertMaterial({ color: 0x55606a });
    wall(0, -150.5, 302, 1, 2.5, fence);
    wall(0, 150.5, 302, 1, 2.5, fence);
    wall(-150.5, 0, 1, 302, 2.5, fence);
    wall(150.5, 0, 1, 302, 2.5, fence);

    // buildings — NW quadrant
    building(-100, -100, 24, 22, 20);
    building(-100, -30, 22, 20, 14);
    building(-30, -100, 20, 24, 24);
    building(-32, -32, 18, 18, 11);
    building(-100, -68, 20, 14, 9);
    building(-68, -100, 14, 20, 16);
    // buildings — SE quadrant (leave spawn area z 60..100, x -20..20 clear)
    building(100, 100, 24, 24, 18);
    building(100, 34, 20, 18, 12);
    building(38, 104, 18, 16, 10);
    building(96, 68, 16, 14, 8);
    // spawn canopy posts (visual only)
    const post = new THREE.MeshLambertMaterial({ color: 0x3a4650 });
    for (const [px, pz] of [[-10, 70], [10, 70], [-10, 96], [10, 96]]) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 4, 8), post);
      m.position.set(px, 2, pz);
      sceneRef.add(m);
    }
    const roof = new THREE.Mesh(new THREE.BoxGeometry(24, 0.3, 30),
      new THREE.MeshLambertMaterial({ color: 0x2f6b8f }));
    roof.position.set(0, 4.1, 83);
    roof.castShadow = true;
    sceneRef.add(roof);

    /* ---- SW skatepark ---- */
    // quarter pipe against west wall (ride toward -x)
    quarterPipe(-104, -119.7, 40, 100, 3.4, 'x', mats.concrete);
    wall(-121, 70, 2, 62, 4.2, mats.concrete); // backing wall
    // funbox (ride along x)
    ramp(-56, -50, 52, 62, 0, 1.3, 'x', mats.concrete);   // up (from east... h0 at x0=-56)
    block(-66, -56, 52, 62, 1.3, mats.concrete);          // top
    ramp(-72, -66, 52, 62, 1.3, 0, 'x', mats.concrete);   // down
    // kickers (launch ramps)
    ramp(-40, -35, 28, 33, 0, 1.7, 'x', mats.concrete);   // launch riding +x? h peak at x1=-35
    ramp(-95, -90, 88, 93, 1.7, 0, 'x', mats.concrete);   // launch riding -x

    /* ---- NE dirt park jump line (ride +x along z=-70) ---- */
    for (let i = 0; i < 3; i++) {
      const s = 38 + i * 24;
      ramp(s, s + 4.2, -74, -66, 0, 1.9, 'x', mats.dirt);       // takeoff
      ramp(s + 9.5, s + 16, -74, -66, 1.7, 0, 'x', mats.dirt);  // lander
      orb(s + 6.2, 2.6, -70, true);
      orb(s + 7.4, 2.9, -70, true);
      orb(s + 8.6, 2.6, -70, true);
    }

    // trees
    const treeSpots = [];
    for (let i = 0; i < 40; i++) {
      treeSpots.push([30 + Math.random() * 88, -115 + Math.random() * 55]); // park
    }
    treeSpots.push([-20, 20], [20, -20], [-20, -20], [20, 20], [74, 40], [-74, -50]);
    for (let i = 0; i < Math.min(window.Q.trees, treeSpots.length); i++) {
      const [tx, tz] = treeSpots[i];
      if (Math.abs(tx) < 12 || Math.abs(tz) < 12) continue; // keep off main streets
      tree(tx, tz);
    }

    /* ---- charge pads ---- */
    for (const pd of pads) {
      const base = new THREE.Mesh(new THREE.CylinderGeometry(2.2, 2.4, 0.12, 20),
        new THREE.MeshLambertMaterial({ color: 0x1d3d2c }));
      base.position.set(pd.x, 0.06, pd.z);
      sceneRef.add(base);
      const glow = new THREE.Mesh(new THREE.CylinderGeometry(1.9, 1.9, 0.05, 20),
        new THREE.MeshBasicMaterial({ color: 0x3dff8a, transparent: true, opacity: 0.55 }));
      glow.position.set(pd.x, 0.14, pd.z);
      sceneRef.add(glow);
      pd.glow = glow;
      const bolt = new THREE.Mesh(new THREE.ConeGeometry(0.35, 1.4, 4),
        new THREE.MeshBasicMaterial({ color: 0x7dffb0 }));
      bolt.position.set(pd.x, 2.6, pd.z);
      sceneRef.add(bolt);
      pd.bolt = bolt;
    }

    /* ---- orbs ---- */
    for (let z = -130; z <= 130; z += 20) {
      if (Math.abs(z - 78) < 12) continue;
      orb(0, 1.1, z, false);
    }
    for (let x = -130; x <= 130; x += 20) {
      if (Math.abs(x) < 8) continue;
      orb(x, 1.1, 0, false);
    }
    for (let x = -110; x <= -20; x += 22) orb(x, 1.1, 60, false);
    for (let z = -110; z <= -20; z += 22) orb(60, 1.1, z, false);
    // park ring
    for (let a = 0; a < 8; a++) {
      orb(78 + Math.cos(a / 8 * Math.PI * 2) * 16, 1.2, -88 + Math.sin(a / 8 * Math.PI * 2) * 16, false);
    }
    // skatepark bonuses
    orb(-61, 2.5, 57, true); orb(-63, 2.5, 57, true);         // funbox top
    orb(-116, 4.6, 55, true); orb(-116, 4.6, 85, true);       // quarter lip
    orb(-37, 3.0, 30.5, true);                                 // over kicker 1
    orb(-93, 3.0, 90.5, true);                                 // over kicker 2
    for (let i = 0; i < 6; i++) orb(-95 + i * 13, 1.1, 70, false); // plaza line

    /* ---- plinths ---- */
    for (const pl of plinths) {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.7, 0.4, 18), mats.concrete);
      m.position.set(pl.x, 0.2, pl.z);
      m.castShadow = true; m.receiveShadow = true;
      sceneRef.add(m);
    }
  }

  /* ---------- queries ---------- */
  function groundAt(x, z) {
    let h = 0;
    for (const s of surfaces) {
      if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) continue;
      let sh;
      if (s.type === 'flat') sh = s.h;
      else {
        const t = s.axis === 'x' ? (x - s.x0) / (s.x1 - s.x0) : (z - s.z0) / (s.z1 - s.z0);
        sh = s.h0 + (s.h1 - s.h0) * t;
      }
      if (sh > h) h = sh;
    }
    return h;
  }

  return { surfaces, walls, orbs, pads, spawn, plinths, build, groundAt };
})();
