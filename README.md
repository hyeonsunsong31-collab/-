# Ascendant Ki

An open-world action RPG for the browser (PC and mobile). It pairs the power fantasy of DBZ/DBS (aura charging,
transformations, thick electric ki blasts) with Zenless Zone Zero-style combat (perfect dodges, parries, Daze/Stun,
Chain Attacks), in a sunlit medieval Europe of meadows, forests and villages.

Everything is generated in code: terrain, buildings, trees and grass; skinned characters, faces and hair; every
animation pose; VFX and shaders; UI art; and all sound effects and music. The repo has no image, model or audio files.

## Running it

Requires Node.js 22.18 or newer, which provides the built-in `node:sqlite` and TypeScript type stripping.

```bash
npm install
npm run dev          # game server on :8080 + Vite on :5173 (proxying /api)
```

Open http://localhost:5173. Without the server running, the client falls back to an **offline save** in
`localStorage`. It uses the same `shared/` rules, so a static build of the client is fully playable on its own.

```bash
npm run build        # client → client/dist
npm start            # Fastify serves the API and client/dist on :8080
```

Other commands:

- `npm run typecheck`: checks shared, server and client.
- `npm test`: runs the Vitest unit and API tests (shared math, combat resolution, mobs, save/sync against a live in-memory server).
- `node client/tests/e2e/<scenario>.mjs <url> <outDir>`: Playwright walkthroughs that save screenshots. Scenarios are
  `controller`, `combat`, `mobs`, `progress`, `arena`, `hud` and `audio`.

URL flags:

| Flag | Effect |
| --- | --- |
| `?q=low\|medium\|high\|ultra` | Quality preset |
| `?offline` | Never contact the server |
| `?touch` | Force touch controls |
| `?title` / `?notitle` | Show or skip the title screen |
| `?gallery=clipA,clipB&phases=6&view=side` | Animation contact sheets |

## Controls

| PC | Action |
| --- | --- |
| WASD | Move (camera-relative) |
| Left Shift | Ninja sprint |
| Space | One-leg ninja jump |
| Space ×2 | Superman flight; Space / Ctrl to rise / sink |
| Q (+WASD) | Dash. W+Q forward, A+Q left, D+Q right; Q or S+Q back |
| LMB | Light combo (5 hits); hold on the 5th to rush |
| E | Special; EX Special with 60 Energy; hold E for the charged Dragon Fist |
| RMB | Guard. Parry on a **gold** flash; **red** flashes can only be dodged |
| R | Ki bolt; hold for a beam; hold at 2000 Surge for the Ultimate |
| T | Hold to power up and transform; T×2 to revert |
| Mouse drag | Camera |
| Right Shift | Shift-lock camera |
| Tab | Cycle target |
| C | Status (stats) |
| M | World map |
| F | Talk |
| Esc | Pause |

On mobile:

- Movement uses a dynamic joystick that appears under the left thumb. It also aims dashes.
- Drag on the right side of the screen to turn the camera.
- The button arc around ATK holds DASH, KI, SPECIAL, GUARD, JUMP (tap twice to fly) and POWER.
- RUN toggles sprint, TARGET cycles foes, and MENU and MAP open their screens.

## Systems

- **Combat (ZZZ rules).**
  - *Moves:* 5-hit chains, air chains, dash attacks, Meteor Crash EX and the Dragon Fist.
  - *Defence:* perfect dodges trigger grey slow motion and a dodge counter; timed guards give perfect parries.
  - *Stun and finishers:* Daze builds to Stun (×1.5 damage). A heavy hit on a stunned foe starts a Chain Attack
    (choose Rush, Meteor or Thunder, up to 3).
  - *Gauges:* Energy pays for EX moves. Surge (the decibel meter) feeds transformations and the Ultimate.
- **Forms:** Golden Ascension I (Lv 10), Golden Storm II (25), Golden Mane III (45), Crimson Divinity (70), Azure
  Divinity (100) and Silver Instinct (150). Each has its own hair, eyes, aura, stat multipliers and a DB-style PL
  multiplier.
- **Stats:** STR, KI, VIT, AGI, IMP and FOC.
  - Each level gives +5 points.
  - Stackable buffs: Momentum, Instinct, Zenkai, Mastery, Overcharge, Guard Crack and Static.
  - **Power Level** = total stats^1.5 × a balance factor (geometric/arithmetic mean). It is shown over every fighter.
- **World:**
  - About 2 km² of terrain with Ashford, Brookhollow, Highmere Castle, a ruined watchtower, Lake Mirren and a river.
  - Nine enemy camps whose level bands rise with distance from Ashford.
  - Five mob archetypes, with an attack-token director that limits how many swing at once.
- **Training Grounds:**
  - Talk to a herald to fight the Rogue Ascendant at one of four difficulties.
  - The round ends by K.O., ring-out or the clock. A valid win gives **+5 levels**.
  - The server validates the match ticket and its duration.
- **Server:** Fastify + SQLite.
  - Guest accounts with hashed tokens.
  - Validated stat allocation and respec.
  - Rate-limited kill-XP reports, single-use match tickets and a leaderboard.

## Layout

```
shared/   game math shared by client and server (stats, PL, damage, buffs, forms, progression, rival generation)
server/   Fastify API + node:sqlite persistence
client/
  src/world      terrain, grass, trees, villages, colosseum, water, colliders
  src/character  rig, procedural skinned bodies, faces, hair, toon materials, outlines, dissolve
  src/animation  pose space, animator (blend space, layers, events, root motion), every clip
  src/combat     combat system, attacks, chain attacks
  src/gameplay   fighter, hero moveset, player, mobs, spawner, arena, NPCs
  src/ai         rival AI, mob AI, attack director
  src/fx         particles, lightning, trails, afterimages, shockwaves, debris, ki, aura, screen effects
  src/audio      Web Audio engine, synthesized SFX, generative music, sound director
  src/ui         HUD, maps, status, arena screens, title/pause/settings, touch controls
  src/net        REST client and the online/offline save service
```
