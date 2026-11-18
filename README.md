[![make.fun · gta6-01](https://make.fun/badge/gta6-01.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![rank](https://make.fun/badge/gta6-01/lions0810/sunset-bay/rank.svg)](https://make.fun/bounty/gta6-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
[![reward](https://make.fun/badge/gta6-01/lions0810/sunset-bay/reward.svg)](https://make.fun/bounty/gta6-01?utm_source=github&utm_medium=readme&utm_campaign=gta6-01)
An entry for make.fun's [Make GTA 6 bounty](https://make.fun/bounty/gta6-01).

# Sunset Bay

An original top-down 2D open-world crime game in the browser — no build step, no
libraries, no assets: one HTML page, a handful of ES modules and a canvas. You are a
nobody in a seaside city of four avenues and three cross-streets, a beach and the sea.
A fixer by the west avenue has work. Five jobs, one long day: run them all and the
bay is yours.

## The game

- **A living little city** — a 2400×1600 world: a road grid with parked cars and
  wandering pedestrians, buildings you collide with (kerb included), palms, a sandy
  beach and water you cannot cross. Smooth follow camera, minimap, day clock.
- **On foot and behind the wheel** — walk anywhere; press E by any parked car to
  take it. Cars accelerate, brake and reverse, steer harder the faster they go, and
  drift on the handbrake, laying skid marks. Cars bounce off each other and off
  buildings — nothing glues, nothing tunnels.
- **Police and wanted stars** — steal a car in front of a witness, run someone down,
  or take the wrong job and the stars rise. Police chase, and brake to match your
  speed as they close in. Stay close-and-slow too long and you are busted: a fine,
  and the day goes on. Break away — every patrol car beyond 400 px for a few
  seconds — and the stars clear.
- **Five jobs from the fixer** ($9,500 in all): a pickup and delivery ($400), a
  timed delivery ($900), tailing a mark without being made ($1,800), collecting
  three packages while the heat rises ($2,400), and the big one — reach the hideout
  at three stars and lose the police ($4,000). Finish all five for the Day Complete
  summary, then free-roam.

## Controls

| Keys | Action |
| --- | --- |
| W A S D / arrows | Walk, drive, steer |
| E | Enter or exit a car |
| Space (in a car) | Handbrake — drift |
| P or Esc | Pause |

Follow the amber marker and the dashed route line; the number beside the objective
is the distance left. The minimap shows roads, your arrow, the objective and
police blips.

## Run it

```sh
node serve.ts            # serves game/ on http://localhost:8080
# or: node main.ts       # hands the entry in to /output (dossier.json + manifest.json)
```

Open the page, press Enter, and go meet the fixer. `?seed=N` fixes the city and the
day (the same seed always builds the same Sunset Bay); `?shot=title|drive|mission`
stages a deterministic scene and sets `window.__shotReady` for screenshot capture,
as listed in `shots.json`.

## Tech notes

- `game/` is plain static files: `index.html` plus ES modules under `game/src/`
  (`config`, `random`, `input`, `world`, `render`, `shots`, `main`). Canvas 2D only.
- The world steps at a fixed 1/60 s; car physics split velocity into forward and
  lateral parts so grip, drift and speed-scaled steering fall out of one small
  integrator. Car-to-car contact is an impulse along the contact normal.
- `main.ts` (Node 22, standard library only) copies `game/` and `screenshots/` to
  the output directory, writes the judge's `dossier.json` with the vendored
  `vendor/makefun-game.ts`, and adds its own `manifest.json`: every handed-in file
  with its byte size and sha256, failing loudly if a cover screenshot is missing.
