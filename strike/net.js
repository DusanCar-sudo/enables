'use strict';
/* DUSTLINE net — WebSocket client for online PvP rooms.
   Server: server.js (node). Protocol: JSON text frames.
   game.js exposes window.GameAPI (avatars, feed, damage, state) at boot;
   everything here runs after that, at join/frame time. */
const Net = (() => {
  let ws = null;
  let myId = null;
  let room = 0;
  let online = false;
  let sendAcc = 0;
  const players = new Map();   // id -> remote player

  function addPlayer(info) {
    if (players.has(info.id)) return players.get(info.id);
    const av = GameAPI.makeAvatar(info.team, info.name);
    const pl = {
      netId: info.id, id: info.id, name: info.name, team: info.team,
      kills: info.kills || 0, deaths: info.deaths || 0,
      pos: new THREE.Vector3(0, -50, 0),
      tgt: { x: 0, y: -50, z: 0, yaw: 0, crouch: 0 },
      yaw: 0, dead: true, hp: 100, walkPhase: 0, hasState: false,
      mesh: av.mesh, parts: av.parts,
    };
    players.set(info.id, pl);
    return pl;
  }

  function removePlayer(id) {
    const pl = players.get(id);
    if (!pl) return;
    GameAPI.removeAvatar(pl.mesh);
    players.delete(id);
  }

  function clearPlayers() {
    for (const id of [...players.keys()]) removePlayer(id);
  }

  function handle(msg) {
    switch (msg.t) {
      case 's': {
        const pl = players.get(msg.id);
        if (!pl) break;
        pl.tgt.x = msg.x; pl.tgt.y = msg.y; pl.tgt.z = msg.z;
        pl.tgt.yaw = msg.yaw; pl.tgt.crouch = msg.c || 0;
        pl.hp = msg.hp;
        const wasDead = pl.dead;
        pl.dead = !!msg.d;
        pl.mesh.visible = !pl.dead;
        if (!pl.hasState || (wasDead && !pl.dead)) {
          // snap on first state / respawn
          pl.pos.set(msg.x, msg.y, msg.z); pl.yaw = msg.yaw;
          pl.hasState = true;
        }
        break;
      }
      case 'shot': {
        const pl = players.get(msg.id);
        GameAPI.remoteShot(msg.o, msg.e, pl);
        break;
      }
      case 'hit':
        GameAPI.remoteHit(msg.by, msg.dmg, msg.zone);
        break;
      case 'die': {
        const victim = msg.id === myId ? null : players.get(msg.id);
        const killer = msg.by === myId ? null : players.get(msg.by);
        if (victim) victim.deaths++;
        if (killer) killer.kills++;
        if (msg.by === myId && msg.id !== myId) GameAPI.creditKill(msg.id);
        if (msg.id !== myId) {
          const kn = msg.by === myId ? 'YOU' : (killer ? killer.name : '?');
          const vn = victim ? victim.name : '?';
          GameAPI.addFeed(`<b>${kn}</b> ✖ ${vn}`, msg.by === myId ? 'me' : 'them');
        }
        break;
      }
      case 'pjoin':
        addPlayer(msg);
        GameAPI.addFeed(`${msg.name} CONNECTED`, 'them');
        break;
      case 'pleave': {
        const pl = players.get(msg.id);
        if (pl) GameAPI.addFeed(`${pl.name} DISCONNECTED`, 'them');
        removePlayer(msg.id);
        break;
      }
      case 'newmatch':
        GameAPI.newMatch(msg.remain);
        for (const pl of players.values()) { pl.kills = 0; pl.deaths = 0; }
        break;
    }
  }

  function wsUrl() {
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}/ws`;
  }

  function join(roomN, name, team, mapPref) {
    return new Promise((resolve, reject) => {
      leave();
      let settled = false;
      try { ws = new WebSocket(wsUrl()); }
      catch (e) { reject(new Error('SERVER UNREACHABLE')); return; }
      const timer = setTimeout(() => {
        if (!settled) { settled = true; leave(); reject(new Error('SERVER TIMEOUT')); }
      }, 5000);
      ws.onopen = () => {
        ws.send(JSON.stringify({ t: 'join', room: roomN, name, team, map: mapPref }));
      };
      ws.onmessage = ev => {
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!settled) {
          if (msg.t === 'welcome') {
            settled = true;
            clearTimeout(timer);
            myId = msg.id; room = roomN; online = true;
            for (const info of msg.players) addPlayer(info);
            resolve({ map: msg.map, remain: msg.remain });
          } else if (msg.t === 'full') {
            settled = true;
            clearTimeout(timer);
            leave();
            reject(new Error('GAME ' + roomN + ' FULL'));
          }
          return;
        }
        handle(msg);
      };
      ws.onerror = () => {
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error('SERVER UNREACHABLE — run: node server.js')); }
      };
      ws.onclose = () => {
        if (settled && online) { online = false; clearPlayers(); GameAPI.netDown(); }
      };
    });
  }

  function leave() {
    if (ws) {
      ws.onclose = null; ws.onerror = null;
      try { ws.close(); } catch (e) { }
      ws = null;
    }
    online = false;
    myId = null;
    room = 0;
    clearPlayers();
  }

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  /* called every frame from game loop */
  function update(dt) {
    if (!online) return;
    // interpolate remotes
    const k = Math.min(1, 12 * dt);
    for (const pl of players.values()) {
      if (!pl.hasState || pl.dead) continue;
      const dx = pl.tgt.x - pl.pos.x, dz = pl.tgt.z - pl.pos.z;
      const moving = Math.hypot(dx, dz) > 0.02;
      pl.pos.x += dx * k;
      pl.pos.y += (pl.tgt.y - pl.pos.y) * k;
      pl.pos.z += dz * k;
      let dy = pl.tgt.yaw - pl.yaw;
      while (dy > Math.PI) dy -= 2 * Math.PI;
      while (dy < -Math.PI) dy += 2 * Math.PI;
      pl.yaw += dy * k;
      pl.mesh.position.copy(pl.pos);
      pl.mesh.rotation.y = pl.yaw + Math.PI; // avatar model faces +z like bots
      const crouchScale = 1 - 0.22 * pl.tgt.crouch;
      pl.mesh.scale.y = crouchScale;
      if (moving) pl.walkPhase += dt * 9;
      const swing = moving ? Math.sin(pl.walkPhase) * 0.55 : 0;
      pl.parts.legL.rotation.x = swing;
      pl.parts.legR.rotation.x = -swing;
    }
    // send own state ~15Hz
    sendAcc += dt;
    if (sendAcc >= 1 / 15) {
      sendAcc = 0;
      send(Object.assign({ t: 's' }, GameAPI.getState()));
    }
  }

  /* hitscan versus remote players; mirrors rayBots. */
  function rayRemotes(ro, rd, maxT) {
    let best = null, bt = maxT;
    for (const pl of players.values()) {
      if (pl.dead || !pl.hasState) continue;
      const t = raySphere(ro, rd, pl.pos.x, pl.pos.y + 1.52, pl.pos.z, 0.2, bt);
      if (t !== null) { bt = t; best = { t, player: pl, zone: 'head' }; }
      const bb = {
        min: { x: pl.pos.x - 0.38, y: pl.pos.y, z: pl.pos.z - 0.38 },
        max: { x: pl.pos.x + 0.38, y: pl.pos.y + 1.42, z: pl.pos.z + 0.38 }
      };
      const h = rayAABB(ro, rd, bb, bt);
      if (h) {
        bt = h.t;
        const hy = ro.y + rd.y * h.t - pl.pos.y;
        best = { t: h.t, player: pl, zone: hy < 0.65 ? 'legs' : 'body' };
      }
    }
    return best;
  }

  const round2 = v => Math.round(v * 100) / 100;
  function sendShot(o, e) {
    send({
      t: 'shot',
      o: [round2(o.x), round2(o.y), round2(o.z)],
      e: [round2(e.x), round2(e.y), round2(e.z)],
    });
  }
  function sendHit(targetId, dmg, zone) { send({ t: 'hit', to: targetId, dmg: Math.round(dmg), zone }); }
  function sendDie(byId) { send({ t: 'die', by: byId || null }); }

  function fetchRooms() {
    return fetch('/rooms', { cache: 'no-store' }).then(r => r.json());
  }

  function topEnemyKills() {
    let m = 0;
    for (const pl of players.values()) m = Math.max(m, pl.kills);
    return m;
  }

  return {
    join, leave, update, rayRemotes, sendShot, sendHit, sendDie, fetchRooms,
    players, topEnemyKills,
    get online() { return online; },
    get room() { return room; },
    get id() { return myId; },
  };
})();
