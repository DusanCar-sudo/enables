'use strict';
/* DUSTLINE server — serves the game files AND hosts 3 concurrent PvP rooms.
   Run:  npm install ws   (once)
         node server.js   [PORT]     default 8377
   Then open http://localhost:8377 — pick ONLINE PVP, choose GAME 1/2/3. */

const http = require('http');
const fs = require('fs');
const path = require('path');

let WebSocketServer;
try { ({ WebSocketServer } = require('ws')); }
catch (e) {
  console.error('Missing dependency. Run:  npm install ws');
  process.exit(1);
}

const PORT = +(process.argv[2] || process.env.PORT || 8377);
const ROOT = __dirname;
const MATCH_SECONDS = 600;
const MAX_PLAYERS = 6;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

/* ---------- rooms ---------- */

const rooms = {};
for (const n of [1, 2, 3]) {
  rooms[n] = { n, players: new Map(), map: null, startT: Date.now() };
}
let nextId = 1;

function remain(room) {
  return Math.max(0, MATCH_SECONDS - (Date.now() - room.startT) / 1000);
}

function roomInfo() {
  return Object.values(rooms).map(r => ({
    n: r.n,
    count: r.players.size,
    max: MAX_PLAYERS,
    map: r.players.size ? r.map : null,
  }));
}

function broadcast(room, msg, exceptId) {
  const data = JSON.stringify(msg);
  for (const [id, pl] of room.players) {
    if (id === exceptId) continue;
    if (pl.ws.readyState === 1) pl.ws.send(data);
  }
}

function sendTo(room, id, msg) {
  const pl = room.players.get(id);
  if (pl && pl.ws.readyState === 1) pl.ws.send(JSON.stringify(msg));
}

// match rollover: reset timer + scores, tell everyone
setInterval(() => {
  for (const room of Object.values(rooms)) {
    if (room.players.size && remain(room) <= 0) {
      room.startT = Date.now();
      for (const pl of room.players.values()) { pl.kills = 0; pl.deaths = 0; }
      broadcast(room, { t: 'newmatch', remain: MATCH_SECONDS });
    }
  }
}, 3000);

/* ---------- http ---------- */

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];
  if (url === '/rooms') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(roomInfo()));
    return;
  }
  let file = url === '/' ? '/index.html' : url;
  file = path.normalize(file).replace(/^(\.\.[/\\])+/, '');
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
  fs.readFile(full, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  });
});

/* ---------- websocket ---------- */

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', ws => {
  let room = null;
  let id = 0;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (e) { return; }

    if (msg.t === 'join' && !room) {
      const r = rooms[msg.room];
      if (!r) return;
      if (r.players.size >= MAX_PLAYERS) {
        ws.send(JSON.stringify({ t: 'full' }));
        return;
      }
      if (r.players.size === 0) {
        // first joiner sets the room's map and restarts the clock
        r.map = ['dust2', 'mirage', 'anubis', 'dustbowl'].includes(msg.map) ? msg.map : 'dust2';
        r.startT = Date.now();
      }
      room = r;
      id = nextId++;
      const name = String(msg.name || 'PLAYER').slice(0, 12).toUpperCase() || 'PLAYER';
      const team = msg.team === 'CT' ? 'CT' : 'T';
      const others = [...room.players.values()].map(pl => ({
        id: pl.id, name: pl.name, team: pl.team, kills: pl.kills, deaths: pl.deaths,
      }));
      room.players.set(id, { id, ws, name, team, kills: 0, deaths: 0 });
      ws.send(JSON.stringify({ t: 'welcome', id, map: room.map, remain: remain(room), players: others }));
      broadcast(room, { t: 'pjoin', id, name, team }, id);
      console.log(`[room ${room.n}] ${name} joined (${room.players.size}/${MAX_PLAYERS}) map=${room.map}`);
      return;
    }
    if (!room) return;

    switch (msg.t) {
      case 's':
        broadcast(room, {
          t: 's', id,
          x: msg.x, y: msg.y, z: msg.z, yaw: msg.yaw,
          c: msg.c, d: msg.d, hp: msg.hp,
        }, id);
        break;
      case 'shot':
        broadcast(room, { t: 'shot', id, o: msg.o, e: msg.e }, id);
        break;
      case 'hit': {
        const dmg = Math.min(150, Math.max(0, +msg.dmg || 0));
        sendTo(room, msg.to, { t: 'hit', by: id, dmg, zone: msg.zone });
        break;
      }
      case 'die': {
        const me = room.players.get(id);
        if (me) me.deaths++;
        const killer = room.players.get(msg.by);
        if (killer && msg.by !== id) killer.kills++;
        broadcast(room, { t: 'die', id, by: msg.by || null });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!room) return;
    const pl = room.players.get(id);
    room.players.delete(id);
    broadcast(room, { t: 'pleave', id });
    if (pl) console.log(`[room ${room.n}] ${pl.name} left (${room.players.size}/${MAX_PLAYERS})`);
    room = null;
  });
});

server.listen(PORT, () => {
  console.log(`DUSTLINE server: http://localhost:${PORT}  (3 rooms, ${MAX_PLAYERS} players each)`);
});
