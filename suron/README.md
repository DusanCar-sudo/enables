# VOLT RUSH — Sur-Ron Edition

First-person e-bike game. Ride the city, hit the skatepark and dirt jumps,
collect volt orbs, manage your battery, and grind your way from the
Light Bee X up to the Storm Bee. Fan tribute — all specs from real
Sur-Ron spec sheets. Zero assets: textures painted on canvas, sounds
synthesized in WebAudio.

## Run

Open `index.html` in a browser, or serve:

```bash
cd suron
python3 -m http.server 8378
# open http://localhost:8378 — on the phone use http://<pc-ip>:8378
```

Works on mobile: touch controls appear automatically, quality auto-drops
(no shadows, lower pixel ratio, fewer trees) to keep 60 FPS on phones.

## The bikes (real spec sheet values)

| Bike | Power | Top speed | Battery | Cost |
|---|---|---|---|---|
| Light Bee X | 6 kW | 75 km/h | 60V 32Ah | free |
| Ultra Bee | 12.5 kW | 90 km/h | 74V 55Ah | 600 ⚡ |
| Storm Bee | 22.5 kW | 110 km/h | 96V 55Ah | 1500 ⚡ |

## How to earn volts

- Silver orbs on streets: 25 ⚡
- Gold orbs above jumps / on skatepark features: 50 ⚡
- Air time bonus: ~22 ⚡ per second airborne
- Battery empties with throttle — recharge on the glowing green pads
  (light regen when braking too)

## Controls

Desktop: W/S throttle-brake, A/D lean, Shift wheelie, Space rear brake,
mouse look, C camera (first-person / chase), R reset, Esc garage.
Mobile: on-screen buttons, landscape orientation.

## Files

- `index.html` — HUD, garage UI, touch controls, quality presets
- `game.js` — bike physics, cameras, pickups, progression, loop
- `bike.js` — Sur-Ron catalog + procedural 3D bike model
- `city.js` — city, skatepark, dirt jumps, textures, surfaces
- `audio.js` — motor whine, freewheel, wind, chimes (all synthesized)
