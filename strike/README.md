# DUSTLINE

Browser tactical FPS in the spirit of Counter-Strike. Zero game assets — all
textures painted on canvas, all audio synthesized live in WebAudio.

## Run (offline vs bots)

Open `index.html` directly in Chrome/Firefox, or serve it:

```bash
cd strike
python3 -m http.server 8377
# open http://localhost:8377
```

## Run (online PvP — 3 concurrent games)

```bash
cd strike
npm install ws        # once
node server.js        # serves the game AND hosts rooms on :8377
# open http://localhost:8377 on each machine (use the host's LAN IP)
```

In the menu pick **ONLINE PVP**, set a callsign, choose **GAME 1 / 2 / 3**
(occupancy shown live), hit DEPLOY. Up to 6 players per room, three rooms
run simultaneously and independently. The first player to join an empty
room decides its map. Online rooms are pure PvP deathmatch — bots are
offline mode only. Side choice (TERRORIST/POLICE) sets your player model.

## Match setup

- **MAP** — DUST2, MIRAGE, ANUBIS (schematic homages) or original DUSTBOWL
- **SIDE** — TERRORIST or POLICE; offline, the 5 bots play the other side
- **BOT SKILL** — EASY / MEDIUM / HARD (reaction time, aim error, vision
  range, burst length, hearing radius, movement speed; MEDIUM = original
  tuning)

## Features

- Source-style movement: ground friction, air control, crouch, silent walk,
  jump, step-up on stairs/crates, landing dips, fall damage
- AK-47 (auto, CS-style rising recoil pattern), USP-S (semi), knife
- ADS, moving/jumping spread penalties, crouch accuracy bonus
- Hitscan with head/body/leg zones, damage falloff, tracers, decals,
  shell casings, muzzle flashes, blood/dust particles
- 5 bot hostiles: waypoint patrol, line-of-sight detection with vision cone,
  reaction time, burst fire, strafing combat, hunting last-known-position,
  they hear your shots and loud footsteps; 3 skill levels
- 4 maps with per-map waypoint graphs, palettes and fog: DUST2 (3 lanes,
  mid doors, long doors, tunnels), MIRAGE (connector cross-corridor,
  palace), ANUBIS (canal + bridges, obelisks), DUSTBOWL (original)
- Online PvP: node server with 3 independent rooms, join/leave anytime,
  position sync + interpolation, shot tracers/sounds relayed, kill feed
  and scoreboard across clients, 10-min rolling matches
- Synthesized audio: layered gunshots with distance filtering and reverb,
  footsteps, reloads, whizzes on near misses, breathing that scales with
  exertion/damage, heartbeat when low HP, ambient wind
- Deathmatch: 10 min, kill feed, Tab scoreboard, damage direction indicator

## Controls

| Key | Action |
|---|---|
| WASD | move |
| Shift | walk (silent) |
| Ctrl / C | crouch |
| Space | jump |
| Mouse 1 | fire |
| Mouse 2 | aim |
| R | reload |
| 1 / 2 / 3 | AK-47 / USP-S / knife |
| Tab | scoreboard |
| Esc | menu |

## Files

- `index.html` — HUD, menus, styles
- `game.js` — player controller, weapons, bots, effects, loop
- `world.js` — map registry (4 maps), canvas textures, waypoint graphs
- `net.js` — WebSocket client, remote player avatars, hit relay
- `server.js` — static file server + 3-room PvP relay (needs `ws`)
- `audio.js` — WebAudio synth engine
- `lib/three.min.js` — Three.js r128
