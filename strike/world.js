'use strict';
/* DUSTLINE world — multi-map registry. All textures painted on canvas at boot.
   Maps: dust2 / mirage / anubis (schematic homages) + original dustbowl.
   Exposes: solids (AABBs), load(name, scene), setPlayerTeam(side),
   waypoints/adjacency, playerSpawns/botSpawns, groundY, MAPS. */
const World = (() => {
  const solids = [];   // { min:{x,y,z}, max:{x,y,z} }
  const boxes = [];    // { cx,cy,cz, sx,sy,sz, mat }
  let group = null;    // THREE.Group of current map meshes
  let waypoints = [];
  let adj = [];
  let current = null;
  let TEX = null;

  /* ---------- procedural textures ---------- */

  function makeCanvas(w, h, fn) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    fn(c.getContext('2d'), w, h);
    return c;
  }

  function speckle(g, w, h, n, dark, light) {
    for (let i = 0; i < n; i++) {
      const v = Math.random();
      g.fillStyle = v > 0.5
        ? `rgba(255,250,235,${light * Math.random()})`
        : `rgba(30,22,10,${dark * Math.random()})`;
      g.fillRect(Math.random() * w, Math.random() * h, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
  }

  function texWall(base, stain) {
    return makeCanvas(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 900, 0.10, 0.07);
      for (let i = 0; i < 7; i++) {
        g.fillStyle = `rgba(${stain},${0.05 + Math.random() * 0.07})`;
        const x = Math.random() * w;
        g.fillRect(x, Math.random() * h * 0.4, 8 + Math.random() * 26, 60 + Math.random() * 120);
      }
      const gr = g.createLinearGradient(0, h * 0.6, 0, h);
      gr.addColorStop(0, `rgba(${stain},0)`);
      gr.addColorStop(1, `rgba(${stain},0.4)`);
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.strokeStyle = `rgba(${stain},0.35)`; g.lineWidth = 1;
      for (let i = 0; i < 5; i++) {
        g.beginPath();
        let x = Math.random() * w, y = Math.random() * h * 0.5;
        g.moveTo(x, y);
        for (let s = 0; s < 5; s++) { x += (Math.random() - 0.5) * 24; y += 12 + Math.random() * 18; g.lineTo(x, y); }
        g.stroke();
      }
    });
  }

  function texFloor(base, drift) {
    return makeCanvas(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 1400, 0.12, 0.08);
      for (let i = 0; i < 10; i++) {
        g.fillStyle = `rgba(${drift},${0.05 + Math.random() * 0.06})`;
        g.beginPath();
        g.ellipse(Math.random() * w, Math.random() * h, 20 + Math.random() * 40, 6 + Math.random() * 12, Math.random() * 3, 0, 7);
        g.fill();
      }
      g.fillStyle = 'rgba(80,62,35,0.3)';
      for (let i = 0; i < 40; i++) g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
    });
  }

  function texCrate() {
    return makeCanvas(128, 128, (g, w, h) => {
      g.fillStyle = '#96713f'; g.fillRect(0, 0, w, h);
      for (let r = 0; r < 4; r++) {
        const y = r * 32;
        g.fillStyle = r % 2 ? '#8c6837' : '#9e7845';
        g.fillRect(0, y, w, 32);
        g.fillStyle = 'rgba(40,25,8,0.55)';
        g.fillRect(0, y + 30, w, 2);
        g.strokeStyle = 'rgba(60,40,15,0.25)';
        for (let i = 0; i < 4; i++) {
          g.beginPath();
          g.moveTo(0, y + 4 + Math.random() * 24);
          g.bezierCurveTo(w * 0.3, y + Math.random() * 32, w * 0.7, y + Math.random() * 32, w, y + 4 + Math.random() * 24);
          g.stroke();
        }
      }
      g.fillStyle = '#7a5a2e';
      g.fillRect(0, 0, w, 7); g.fillRect(0, h - 7, w, 7);
      g.fillRect(0, 0, 7, h); g.fillRect(w - 7, 0, 7, h);
      g.strokeStyle = 'rgba(35,22,6,0.6)'; g.lineWidth = 2;
      g.strokeRect(1, 1, w - 2, h - 2);
      speckle(g, w, h, 250, 0.12, 0.05);
    });
  }

  function texMetal() {
    return makeCanvas(128, 128, (g, w, h) => {
      g.fillStyle = '#5f6e60'; g.fillRect(0, 0, w, h);
      for (let x = 0; x < w; x += 2) {
        g.fillStyle = `rgba(210,225,210,${Math.random() * 0.05})`;
        g.fillRect(x, 0, 1, h);
      }
      g.strokeStyle = 'rgba(20,28,20,0.5)'; g.lineWidth = 2;
      g.strokeRect(6, 6, w - 12, h - 12);
      g.fillStyle = 'rgba(25,32,25,0.7)';
      for (const px of [12, w - 12]) for (let y = 12; y < h; y += 26) {
        g.beginPath(); g.arc(px, y, 2.4, 0, 7); g.fill();
      }
      for (let i = 0; i < 5; i++) {
        g.fillStyle = `rgba(120,70,30,${0.06 + Math.random() * 0.1})`;
        g.fillRect(10 + Math.random() * (w - 20), 20 + Math.random() * 40, 3 + Math.random() * 5, 30 + Math.random() * 60);
      }
      speckle(g, w, h, 220, 0.14, 0.04);
    });
  }

  function texConcrete(base) {
    return makeCanvas(256, 256, (g, w, h) => {
      g.fillStyle = base; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 1100, 0.13, 0.07);
      g.strokeStyle = 'rgba(50,45,35,0.3)'; g.lineWidth = 1.5;
      g.strokeRect(0, 0, w, h);
      for (let i = 0; i < 4; i++) {
        g.strokeStyle = `rgba(55,48,38,${0.15 + Math.random() * 0.15})`;
        g.beginPath();
        g.moveTo(Math.random() * w, 0);
        g.lineTo(Math.random() * w, h);
        g.stroke();
      }
    });
  }

  function texStone() {
    return makeCanvas(256, 256, (g, w, h) => {
      g.fillStyle = '#a9a08c'; g.fillRect(0, 0, w, h);
      speckle(g, w, h, 1000, 0.14, 0.06);
      // large hewn blocks
      g.strokeStyle = 'rgba(45,40,30,0.45)'; g.lineWidth = 3;
      for (let y = 0; y < h; y += 64) {
        g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke();
        const off = (y / 64) % 2 ? 64 : 0;
        for (let x = off; x < w; x += 128) {
          g.beginPath(); g.moveTo(x, y); g.lineTo(x, y + 64); g.stroke();
        }
      }
      // hieroglyph-ish scratches
      g.strokeStyle = 'rgba(60,50,35,0.3)'; g.lineWidth = 1.5;
      for (let i = 0; i < 14; i++) {
        const x = 12 + Math.random() * (w - 24), y = 8 + Math.random() * (h - 30);
        g.strokeRect(x, y, 4 + Math.random() * 8, 8 + Math.random() * 14);
      }
    });
  }

  function texWater() {
    return makeCanvas(128, 128, (g, w, h) => {
      g.fillStyle = '#2d6b74'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 26; i++) {
        g.strokeStyle = `rgba(180,230,235,${0.06 + Math.random() * 0.12})`;
        g.lineWidth = 1 + Math.random();
        g.beginPath();
        let x = Math.random() * w; const y = Math.random() * h;
        g.moveTo(x, y);
        for (let s = 0; s < 4; s++) { x += 8 + Math.random() * 10; g.quadraticCurveTo(x - 5, y + (Math.random() - 0.5) * 6, x, y); }
        g.stroke();
      }
    });
  }

  function buildTextures() {
    TEX = {
      wall: new THREE.CanvasTexture(texWall('#c9b28a', '70,55,30')),
      plaster: new THREE.CanvasTexture(texWall('#dccba4', '95,80,55')),
      stone: new THREE.CanvasTexture(texStone()),
      floor: new THREE.CanvasTexture(texFloor('#c3ab7f', '230,215,175')),
      floorStone: new THREE.CanvasTexture(texFloor('#b0a58d', '215,210,185')),
      crate: new THREE.CanvasTexture(texCrate()),
      metal: new THREE.CanvasTexture(texMetal()),
      concrete: new THREE.CanvasTexture(texConcrete('#a29a87')),
      water: new THREE.CanvasTexture(texWater()),
    };
    for (const k in TEX) {
      TEX[k].wrapS = TEX[k].wrapT = THREE.RepeatWrapping;
      TEX[k].anisotropy = 4;
    }
  }

  /* ---------- geometry helpers ---------- */
  // box(cx, cz, sx, sz, sy, mat, cy?) — cy defaults so box sits on ground
  function box(cx, cz, sx, sz, sy, mat, cy) {
    if (cy === undefined) cy = sy / 2;
    boxes.push({ cx, cy, cz, sx, sy, sz, mat });
    solids.push({
      min: { x: cx - sx / 2, y: cy - sy / 2, z: cz - sz / 2 },
      max: { x: cx + sx / 2, y: cy + sy / 2, z: cz + sz / 2 }
    });
  }

  /* staircase from ground up to a platform of height topH.
     (x0,z0) = platform edge midpoint, (dx,dz) = unit direction steps descend. */
  function steps(x0, z0, dx, dz, topH, w) {
    for (let k = 1; k <= 8; k++) {
      const hh = topH - 0.3 * k;
      if (hh < 0.15) break;
      const cx = x0 + dx * (k - 0.5) * 0.6;
      const cz = z0 + dz * (k - 0.5) * 0.6;
      box(cx, cz, dx !== 0 ? 0.6 : w, dz !== 0 ? 0.6 : w, hh, 'concrete');
    }
  }

  function outerWalls() {
    box(0, -35.5, 92, 1, 6, 'wall');
    box(0, 35.5, 92, 1, 6, 'wall');
    box(-45.5, 0, 1, 72, 6, 'wall');
    box(45.5, 0, 1, 72, 6, 'wall');
  }

  /* ==================== MAP DEFINITIONS ==================== */

  const MAPS = {

    /* ------------ DE_DUST2 (schematic) ------------
       Three lanes: B tunnels (west), mid with doors, long A (east).
       T spawn south strip, CT spawn north strip. A site NE plat, B site NW. */
    dust2: {
      label: 'DE_DUST2',
      sky: 0x9ec1dd, fogColor: 0xc9b892, fogDensity: 0.0042,
      floorTex: 'floor',
      define() {
        outerWalls();
        // lane-divider buildings
        box(-21, 0, 18, 34, 5, 'wall');   // west block x[-30,-12] z[-17,17]
        box(21, 0, 18, 34, 5, 'wall');    // east block x[12,30]  z[-17,17]
        // B tunnels choke (west lane, z=5): gap x[-41,-36]
        box(-33, 5, 6, 2, 5, 'wall');
        box(-43.5, 5, 5, 2, 5, 'wall');
        // mid doors (z=-10): gap x[-3,3]
        box(-7.5, -10, 9, 1, 4, 'metal');
        box(7.5, -10, 9, 1, 4, 'metal');
        // long doors (east lane, z=8): gap x[35,41]
        box(32.5, 8, 5, 1, 4, 'metal');
        box(43.5, 8, 5, 1, 4, 'metal');
        // A site platform NE + steps on south face
        box(38, -30, 10, 8, 1.5, 'concrete');
        steps(38, -26, 0, 1, 1.5, 6);
        // B site platform NW + steps
        box(-38, -28, 8, 6, 1, 'concrete');
        steps(-38, -25, 0, 1, 1, 5);
        // crates — T strip
        box(-14, 26, 1.8, 1.8, 1.8, 'crate');
        box(16, 30, 1.2, 1.2, 1.2, 'crate');
        // crates — mid
        box(-6, 4, 1.2, 1.2, 1.2, 'crate');
        box(6, -20, 1.8, 1.8, 1.8, 'crate');
        // crates — long / A
        box(34, -2, 1.8, 1.8, 1.8, 'crate');
        box(33, -20, 1.8, 1.8, 1.8, 'crate');
        box(33, -20, 1.2, 1.2, 1.2, 'crate', 1.8 + 0.6);
        box(43, -14, 1.2, 1.2, 1.2, 'crate');
        // crates — tunnels / B
        box(-34, 12, 1.2, 1.2, 1.2, 'crate');
        box(-33, -18, 1.8, 1.8, 1.8, 'crate');
        box(-43, -20, 1.2, 1.2, 1.2, 'crate');
        // crates — CT
        box(-8, -30, 1.8, 1.8, 1.8, 'crate');
        box(8, -30, 1.2, 1.2, 1.2, 'crate');
        // barrels
        box(-4.5, -8, 1, 1, 1.25, 'barrel');
        box(34, 10, 1, 1, 1.25, 'barrel');
      },
      waypoints: [
        { x: -38, z: 30 },   // 0 T west / tunnels S
        { x: 0, z: 28 },     // 1 T mid
        { x: 38, z: 30 },    // 2 T east / long S
        { x: 0, z: 12 },     // 3 mid S
        { x: 0, z: -16 },    // 4 mid N (past doors)
        { x: 0, z: -28 },    // 5 CT mid
        { x: 38, z: 8 },     // 6 long doors
        { x: 38, z: -10 },   // 7 long N
        { x: 38, z: -22 },   // 8 A site
        { x: 38, z: -30 },   // 9 A platform (elevated)
        { x: -38.5, z: 5 },  // 10 tunnel choke
        { x: -38, z: -10 },  // 11 tunnels N
        { x: -38, z: -21 },  // 12 B site
        { x: -22, z: -28 },  // 13 CT west
        { x: 22, z: -28 },   // 14 CT east
        { x: -38, z: -28 },  // 15 B platform (elevated)
      ],
      edges: [
        [0, 1], [1, 2], [1, 3], [3, 4], [4, 5],
        [2, 6], [6, 7], [7, 8], [8, 9], [7, 14],
        [0, 10], [10, 11], [11, 12], [12, 15], [12, 13],
        [13, 5], [14, 5], [14, 8], [4, 13], [4, 14],
      ],
      spawns: {
        T: [{ x: -38, z: 31 }, { x: -19, z: 31 }, { x: 0, z: 31 }, { x: 19, z: 31 }, { x: 38, z: 31 }],
        CT: [{ x: -22, z: -31 }, { x: -10, z: -31 }, { x: 0, z: -31 }, { x: 10, z: -31 }, { x: 22, z: -31 }],
      },
    },

    /* ------------ DE_MIRAGE (schematic) ------------
       Three lanes + full horizontal connector corridor at z~0 ("window"),
       palace platform east of T spawn overlooking A approach. */
    mirage: {
      label: 'DE_MIRAGE',
      sky: 0xaed4ea, fogColor: 0xd9cba1, fogDensity: 0.0038,
      floorTex: 'floor',
      define() {
        outerWalls();
        // lane blocks split by connector corridor z[-2,3]
        box(-21, -9.5, 18, 15, 5, 'plaster'); // west N  z[-17,-2]
        box(-21, 10, 18, 14, 5, 'plaster');   // west S  z[3,17]
        box(21, -9.5, 18, 15, 5, 'plaster');  // east N
        box(21, 10, 18, 14, 5, 'plaster');    // east S
        // mid window choke (z=-6): gap x[-4,4]
        box(-8, -6, 8, 1, 4, 'plaster');
        box(8, -6, 8, 1, 4, 'plaster');
        // apartment chokes on outer lanes (z=-8): gaps x[-41,-36] / x[36,41]
        box(-33, -8, 6, 2, 5, 'plaster');
        box(-43.5, -8, 5, 2, 5, 'plaster');
        box(33, -8, 6, 2, 5, 'plaster');
        box(43.5, -8, 5, 2, 5, 'plaster');
        // palace platform (SE) + steps descending west
        box(36, 22, 10, 8, 2, 'concrete');
        steps(31, 22, -1, 0, 2, 6);
        // A site NE, B site NW — crate clusters
        box(34, -20, 1.8, 1.8, 1.8, 'crate');
        box(34, -20, 1.2, 1.2, 1.2, 'crate', 1.8 + 0.6);
        box(42, -24, 1.2, 1.2, 1.2, 'crate');
        box(38, -30, 1.8, 1.8, 1.8, 'crate');
        box(-36, -20, 1.8, 1.8, 1.8, 'crate');
        box(-42, -26, 1.2, 1.2, 1.2, 'crate');
        box(-34, -29, 1.8, 1.8, 1.8, 'crate');
        box(-34, -29, 1.2, 1.2, 1.2, 'crate', 1.8 + 0.6);
        // connector cover
        box(-21, 0.5, 1.2, 1.2, 1.2, 'crate');
        box(21, 0.5, 1.2, 1.2, 1.2, 'crate');
        // mid + T strip cover
        box(-6, 10, 1.8, 1.8, 1.8, 'crate');
        box(-16, 28, 1.8, 1.8, 1.8, 'crate');
        box(6, -24, 1.2, 1.2, 1.2, 'crate');
        // barrels
        box(4.5, -4, 1, 1, 1.25, 'barrel');
        box(-38, 12, 1, 1, 1.25, 'barrel');
      },
      waypoints: [
        { x: -38, z: 30 },    // 0 T west
        { x: 0, z: 28 },      // 1 T mid
        { x: 38, z: 30 },     // 2 T east (palace alley)
        { x: 0, z: 10 },      // 3 mid S
        { x: 0, z: 0.5 },     // 4 connector center
        { x: 0, z: -12 },     // 5 mid N (past window)
        { x: 0, z: -28 },     // 6 CT mid
        { x: -21, z: 0.5 },   // 7 connector W
        { x: 21, z: 0.5 },    // 8 connector E
        { x: -38, z: 0.5 },   // 9 west lane @ connector
        { x: 38, z: 0.5 },    // 10 east lane @ connector
        { x: -38.5, z: -8 },  // 11 apts choke W
        { x: -38, z: -23 },   // 12 B site
        { x: 38.5, z: -8 },   // 13 ramp choke E
        { x: 38, z: -22 },    // 14 A site
        { x: -22, z: -28 },   // 15 CT west
        { x: 22, z: -28 },    // 16 CT east
        { x: 43.5, z: 22 },   // 17 palace alley E
        { x: 36, z: 22 },     // 18 palace top (elevated)
        { x: 27, z: 22 },     // 19 palace steps W
      ],
      edges: [
        [0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6],
        [4, 7], [4, 8], [7, 9], [8, 10],
        [9, 0], [9, 11], [11, 12], [12, 15], [15, 6],
        [10, 13], [13, 14], [14, 16], [16, 6],
        [2, 17], [17, 10], [2, 19], [19, 18], [1, 19],
      ],
      spawns: {
        T: [{ x: -38, z: 31 }, { x: -19, z: 31 }, { x: 0, z: 31 }, { x: 14, z: 31 }, { x: 27, z: 28 }],
        CT: [{ x: -22, z: -31 }, { x: -10, z: -31 }, { x: 0, z: -31 }, { x: 10, z: -31 }, { x: 22, z: -31 }],
      },
    },

    /* ------------ DE_ANUBIS (schematic) ------------
       Canal running through mid with two bridges, sandstone temples,
       obelisk landmarks. A east, B west. */
    anubis: {
      label: 'DE_ANUBIS',
      sky: 0x86b5c4, fogColor: 0xb3a98a, fogDensity: 0.0046,
      floorTex: 'floorStone', water: true,
      define() {
        outerWalls();
        // temple blocks
        box(-21, 0, 18, 34, 5, 'stone');  // west x[-30,-12] z[-17,17]
        box(21, 0, 18, 34, 5, 'stone');   // east x[12,30]  z[-17,17]
        // mid gates north/south: gap over canal x[-4,4]
        box(-8, -17, 8, 1.2, 5, 'stone');
        box(8, -17, 8, 1.2, 5, 'stone');
        box(-8, 17, 8, 1.2, 5, 'stone');
        box(8, 17, 8, 1.2, 5, 'stone');
        // bridges over canal
        box(0, -10, 12, 3.4, 0.55, 'concrete');
        box(0, 12, 12, 3.4, 0.55, 'concrete');
        // obelisks pinching outer lanes
        box(-38, 0, 1.8, 1.8, 9, 'stone');
        box(38, 0, 1.8, 1.8, 9, 'stone');
        box(0, 30, 1.6, 1.6, 8, 'stone');
        // A site platform NE + steps
        box(38, -30, 10, 8, 1.5, 'concrete');
        steps(38, -26, 0, 1, 1.5, 6);
        // site crates
        box(33, -21, 1.8, 1.8, 1.8, 'crate');
        box(43, -18, 1.2, 1.2, 1.2, 'crate');
        box(-36, -22, 1.8, 1.8, 1.8, 'crate');
        box(-36, -22, 1.2, 1.2, 1.2, 'crate', 1.8 + 0.6);
        box(-42, -28, 1.2, 1.2, 1.2, 'crate');
        box(-33, -30, 1.8, 1.8, 1.8, 'crate');
        // lane cover
        box(-36, 14, 1.8, 1.8, 1.8, 'crate');
        box(36, 12, 1.2, 1.2, 1.2, 'crate');
        box(-6, 24, 1.2, 1.2, 1.2, 'crate');
        box(6, -24, 1.8, 1.8, 1.8, 'crate');
        // barrels
        box(-4.5, 20, 1, 1, 1.25, 'barrel');
        box(4.5, -20, 1, 1, 1.25, 'barrel');
      },
      waypoints: [
        { x: -38, z: 30 },   // 0 T west
        { x: 0, z: 26 },     // 1 T mid
        { x: 38, z: 30 },    // 2 T east
        { x: 0, z: 12 },     // 3 bridge S (elevated)
        { x: 0, z: 0 },      // 4 canal mid
        { x: 0, z: -10 },    // 5 bridge N (elevated)
        { x: 0, z: -22 },    // 6 mid exit N
        { x: 0, z: -29 },    // 7 CT mid
        { x: 38, z: 10 },    // 8 east lane S
        { x: 38, z: -10 },   // 9 east lane N
        { x: 38, z: -21 },   // 10 A site
        { x: 38, z: -30 },   // 11 A platform (elevated)
        { x: -38, z: 10 },   // 12 west lane S
        { x: -38, z: -10 },  // 13 west lane N
        { x: -38, z: -20 },  // 14 B site
        { x: -22, z: -28 },  // 15 CT west
        { x: 22, z: -28 },   // 16 CT east
      ],
      edges: [
        [0, 1], [1, 2], [1, 3], [3, 4], [4, 5], [5, 6], [6, 7],
        [2, 8], [8, 9], [9, 10], [10, 11], [9, 16], [10, 16],
        [0, 12], [12, 13], [13, 14], [14, 15], [13, 15],
        [15, 7], [16, 7],
      ],
      spawns: {
        T: [{ x: -38, z: 31 }, { x: -19, z: 31 }, { x: -8, z: 28 }, { x: 19, z: 31 }, { x: 38, z: 31 }],
        CT: [{ x: -22, z: -31 }, { x: -10, z: -31 }, { x: 0, z: -32 }, { x: 10, z: -31 }, { x: 22, z: -31 }],
      },
    },

    /* ------------ DE_DUSTBOWL (original map) ------------ */
    dustbowl: {
      label: 'DE_DUSTBOWL',
      sky: 0x9ec1dd, fogColor: 0xc9b892, fogDensity: 0.0042,
      floorTex: 'floor',
      define() {
        outerWalls();
        // north building row (between long & mid)
        box(-22, -18, 28, 12, 5, 'wall');
        box(2, -18, 12, 12, 5, 'wall');
        box(20, -18, 16, 12, 5, 'wall');
        // south building row (between mid & tunnels)
        box(-20, 18, 32, 12, 5, 'wall');
        box(20, 18, 24, 12, 5, 'wall');
        box(2, 18, 5, 6, 5, 'concrete');
        // mid double-door choke
        box(0, -7, 1, 10, 4, 'metal');
        box(0, 7.5, 1, 9, 4, 'metal');
        // A platform + steps
        box(37, -31, 10, 8, 1.5, 'concrete');
        steps(37, -27, 0, 1, 1.5, 6);
        // crates
        box(-12, -32.5, 1.8, 1.8, 1.8, 'crate');
        box(18, -32, 1.2, 1.2, 1.2, 'crate');
        box(-13, 3, 1.2, 1.2, 1.2, 'crate');
        box(-24, 6, 1.8, 1.8, 1.8, 'crate');
        box(-24, 6, 1.2, 1.2, 1.2, 'crate', 1.8 + 0.6);
        box(20, 2, 1.8, 1.8, 1.8, 'crate');
        box(20, 2, 1.2, 1.2, 1.2, 'crate', 1.8 + 0.6);
        box(12, -7, 1.2, 1.2, 1.2, 'crate');
        box(-4, -4, 1.2, 1.2, 1.2, 'crate');
        box(31, -16, 1.8, 1.8, 1.8, 'crate');
        box(43, -18, 1.2, 1.2, 1.2, 'crate');
        box(-10, 29, 1.8, 1.8, 1.8, 'crate');
        box(14, 26, 1.2, 1.2, 1.2, 'crate');
        box(38, 18, 1.8, 1.8, 1.8, 'crate');
        box(36, 29, 1.2, 1.2, 1.2, 'crate');
        box(36, 29, 1.2, 1.2, 1.2, 'crate', 1.2 + 0.6);
        box(42, 31, 1.8, 1.8, 1.8, 'crate');
        box(-3, -8, 1, 1, 1.25, 'barrel');
        box(3, 6, 1, 1, 1.25, 'barrel');
      },
      waypoints: [
        { x: -40, z: -29 }, { x: -18, z: -29 }, { x: 0, z: -29 }, { x: 20, z: -29 },
        { x: 37, z: -20 }, { x: 37, z: -31 }, { x: 42, z: -8 }, { x: 42, z: 10 },
        { x: 39, z: 22 }, { x: 36, z: 32 }, { x: 14, z: 29 }, { x: -10, z: 32 },
        { x: -30, z: 29 }, { x: -40, z: 27 }, { x: -40, z: 0 }, { x: -26, z: 0 },
        { x: -6, z: 0 }, { x: 6, z: 0 }, { x: 22, z: -4 }, { x: -6, z: -27 },
        { x: -6, z: -18 }, { x: -6, z: -10 }, { x: 10, z: -27 }, { x: 10, z: -18 },
        { x: 10, z: -10 }, { x: 3, z: 9 }, { x: -3, z: 18 }, { x: 7, z: 18 },
        { x: 2, z: 27 },
      ],
      edges: [
        [0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [4, 18],
        [6, 7], [7, 8], [8, 9], [9, 10], [10, 11], [11, 12], [12, 13],
        [13, 14], [14, 0], [14, 15], [15, 16], [16, 17], [17, 18], [18, 6],
        [2, 19], [19, 20], [20, 21], [21, 16],
        [3, 22], [22, 23], [23, 24], [24, 17], [24, 18],
        [17, 25], [25, 26], [26, 28], [25, 27], [27, 28], [28, 10], [28, 11],
      ],
      spawns: {
        T: [{ x: -40, z: -29 }, { x: -40, z: -15 }, { x: -40, z: 0 }, { x: -40, z: 14 }, { x: -40, z: 27 }],
        CT: [{ x: 42, z: -8 }, { x: 42, z: 10 }, { x: 39, z: 22 }, { x: 37, z: -31 }, { x: 36, z: 32 }],
      },
    },
  };

  /* ---------- scene build ---------- */

  function buildMeshes(scene) {
    group = new THREE.Group();

    // ground
    const gTex = TEX[current.floorTex].clone(); gTex.needsUpdate = true;
    gTex.repeat.set(26, 20);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(92, 72),
      new THREE.MeshStandardMaterial({ map: gTex, roughness: 0.96, metalness: 0.02 })
    );
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    group.add(ground);

    // canal water (anubis)
    if (current.water) {
      const wTex = TEX.water.clone(); wTex.needsUpdate = true;
      wTex.repeat.set(2, 16);
      const water = new THREE.Mesh(
        new THREE.PlaneGeometry(8, 71),
        new THREE.MeshStandardMaterial({ map: wTex, roughness: 0.25, metalness: 0.45, transparent: true, opacity: 0.92 })
      );
      water.rotation.x = -Math.PI / 2;
      water.position.y = 0.03;
      group.add(water);
    }

    for (const b of boxes) {
      let mesh;
      if (b.mat === 'barrel') {
        mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(0.5, 0.5, b.sy, 14),
          new THREE.MeshStandardMaterial({ color: 0x5b6b4f, roughness: 0.55, metalness: 0.5 })
        );
      } else {
        const base = TEX[b.mat] || TEX.wall;
        const tt = base.clone(); tt.needsUpdate = true;
        const horiz = Math.max(b.sx, b.sz);
        tt.repeat.set(Math.max(1, Math.round(horiz / 3)), Math.max(1, Math.round(b.sy / 2.6)));
        mesh = new THREE.Mesh(
          new THREE.BoxGeometry(b.sx, b.sy, b.sz),
          new THREE.MeshStandardMaterial({
            map: tt,
            roughness: b.mat === 'metal' ? 0.5 : 0.95,
            metalness: b.mat === 'metal' ? 0.4 : 0.02
          })
        );
      }
      mesh.position.set(b.cx, b.cy, b.cz);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    scene.add(group);
  }

  function load(name, scene) {
    if (!TEX) buildTextures();
    if (!MAPS[name]) name = 'dust2';
    if (group) {
      scene.remove(group);
      group.traverse(o => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) { if (o.material.map) o.material.map.dispose(); o.material.dispose(); }
      });
      group = null;
    }
    solids.length = 0;
    boxes.length = 0;
    current = MAPS[name];
    current.name = name;
    current.define();
    buildMeshes(scene);
    waypoints = current.waypoints;
    adj = waypoints.map(() => []);
    for (const [a, b] of current.edges) { adj[a].push(b); adj[b].push(a); }
    return current;
  }

  /* player picks a side; enemy bots spawn on the other side */
  function setPlayerTeam(side) {
    if (!current) return;
    api.playerSpawns = current.spawns[side === 'CT' ? 'CT' : 'T'];
    api.botSpawns = current.spawns[side === 'CT' ? 'T' : 'CT'];
  }

  /* ---------- navigation ---------- */

  function findPath(from, to) {
    if (from === to) return [to];
    const prev = new Array(waypoints.length).fill(-1);
    const q = [from]; prev[from] = from;
    while (q.length) {
      const n = q.shift();
      if (n === to) break;
      for (const m of adj[n]) if (prev[m] === -1) { prev[m] = n; q.push(m); }
    }
    if (prev[to] === -1) return [to];
    const path = [];
    for (let n = to; n !== from; n = prev[n]) path.push(n);
    path.reverse();
    return path;
  }

  function nearestNode(x, z) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < waypoints.length; i++) {
      const dx = waypoints[i].x - x, dz = waypoints[i].z - z;
      const d = dx * dx + dz * dz;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  /* top of highest solid under (x,z) reachable from height fromY */
  function groundY(x, z, fromY) {
    let g = 0;
    for (const b of solids) {
      if (x > b.min.x && x < b.max.x && z > b.min.z && z < b.max.z) {
        if (b.max.y <= fromY + 0.65 && b.max.y > g) g = b.max.y;
      }
    }
    return g;
  }

  const api = {
    solids, load, setPlayerTeam, findPath, nearestNode, groundY, MAPS,
    playerSpawns: [], botSpawns: [],
    get waypoints() { return waypoints; },
    get adj() { return adj; },
    get current() { return current; },
  };
  return api;
})();
