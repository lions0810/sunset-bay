[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/lions0810/sunset-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/lions0810/sunset-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
An entry for make.fun's [Make GTA 6 bounty](https://make.fun/bounty/gta6-01).

# Sunset Bay

An original top-down 2D open-world crime game in plain canvas JavaScript — no build
step, no libraries, no network, no assets: everything on screen is drawn by the code.
Sunset Bay is a coastal city of road grids and city blocks, a beach and a pier along
its south edge, palms, parked cars, wandering pedestrians and ambient traffic. You are
a nobody with a fixer: five jobs stand between you and $9,500, and the bay's police
would like a word.

## How to play

- **Walk**: WASD or arrow keys. **Enter / exit a car**: walk up to one and press **E**.
  The teal car by your home is yours; every other car you take is a crime, once per car.
- **Drive**: W/S or ↑/↓ for throttle, brake and reverse; A/D or ←/→ to steer (it bites
  harder the faster you go); **Space** is the handbrake — it loosens the rear tyres
  into a drift and leaves skid marks.
- Follow the gold marker and the dashed route line. The HUD shows your cash, the day
  and clock, your wanted stars, the current objective with its distance, and a minimap
  with the objective and the police on it.
- **Wanted**: stealing a car, running a pedestrian down and the fixer's dirtier work
  all raise stars. Police spawn, pursue, and brake to match your speed as they close
  in rather than ramming forever; if they corner you slow and close, the bust meter
  fills — get moving or get away. Break sight and range for a while and the stars cool
  off. Get busted and the day ends: a fine, a new morning, your job half-done.

## The five jobs

1. **The package** — meet the fixer, collect at the warehouse, deliver to the pier. $400.
2. **The rush order** — a pickup at Café Lumen, delivered across town against a
   150-second clock. $900.
3. **The tail** — follow the orange mark around the east side, holding the distance
   band: close enough not to lose him, far enough not to spook him, for 40 seconds.
   $1,800 — and a patrol clocks you doing it.
4. **Three packages** — collect three drops around the city; every one raises your
   wanted level. Bring them back to the fixer. $2,400.
5. **The getaway** — reach the hideout garage at three stars, then lose the police
   entirely. $4,000.

Finish the chain and the day closes with a **Day complete — $9,500** summary; the bay
stays open for free-roam afterwards.

## Running it

- Play locally: `node serve.ts` (Node 22), then open http://localhost:8080.
- Hand it in: `node main.ts` copies `game/` and `screenshots/` to `/output` (or
  `$MAKEFUN_OUTPUT_DIR`) and writes `dossier.json` with the vendored make.fun library,
  after checking the three promised renders exist; it also writes `manifest.json`, a
  sha256 manifest of everything handed in.
- A `?seed=N` query fixes all of the game's randomness — the same seed always builds
  the same city. `game/shots.json`'s scenes (`?shot=title|drive|mission`) stage the
  deterministic screenshots and raise `window.__shotReady` when painted.

## Tech notes

- `game/src/` is six small ES modules: `rng.js` (a seeded mulberry32 and geometry
  helpers), `world.js` (the seeded city, collision, and the one-time ground render),
  `actors.js` (car physics with a grip/slide split, pedestrians, and the police
  driver), `missions.js` (the five-job state machine), `input.js`, and `main.js`
  (fixed-timestep loop, camera, HUD, minimap, overlays, screenshot staging).
- The simulation runs on a fixed 1/60 step, so a seed plus an input script replays
  exactly — which is how the entry is playtested headlessly: a driver script plays
  the whole chain on real keyboard events and asserts the cash lands on $9,500.
- Police pursuit is deliberately fair: inside 110px a police car targets the player's
  speed plus a small closing allowance, inside 55px the player's speed itself, and
  alongside a stopped player it stops. No teleporting, no endless ramming.
