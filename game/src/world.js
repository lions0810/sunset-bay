// Sunset Bay's world: a seeded city (road grid, buildings with their kerb strips, a beach
// and the sea), the people and cars in it, arcade car physics with impulse collisions,
// the police and the wanted system, and the fixer's five-job chain.
//
// One step is 1/60 s. Everything the HUD, the screenshot scenes and the playtest need
// lives on `state`: cash, wanted, the mission machine, the current objective, the
// nearest car, and the list of payouts as they land.

import {
  BEACH_Y, CAR, PED_SPEED, ROADS_H, ROADS_V, ROAD_HALF, TOUCH, WALK_SPEED,
  WANTED, WATER_Y, WORLD_H, WORLD_W,
} from './config.js';

export const FIXER = { x: 250, y: 430 };
const PLAYER_SPAWN = { x: 250, y: 478 };

const M1_PICKUP = { x: 1620, y: 960 };
const M1_DROPOFF = { x: 520, y: 1010 };
const M2_DROPOFF = { x: 2160, y: 470 };
const M2_TIME = 80;
const M3_LOOP = [
  { x: 920, y: 330 }, { x: 1480, y: 330 }, { x: 1480, y: 790 }, { x: 920, y: 790 },
];
const M3_TAIL_SECONDS = 40;
const M4_PACKAGES = [
  { x: 300, y: 1272 }, { x: 1252, y: 150 }, { x: 2210, y: 1272 },
];
const M5_HIDEOUT = { x: 150, y: 150 };
export const PAYOUTS = [400, 900, 1800, 2400, 4000];

const BUILDING_COLORS = ['#c96f4a', '#d9a441', '#9fb4c7', '#b5526d', '#7fae7a', '#e0d6c2', '#8d7fb8', '#d97b54'];
const ROOF_COLORS = ['#5d4037', '#4e5d6c', '#6d4c41', '#37474f', '#795548'];
const CAR_COLORS = ['#d64541', '#3f7fbf', '#e8b93e', '#59a96a', '#e6e3da', '#7a4f9d', '#d97b29', '#4fb3b0'];

const X_BANDS = [[36, 295], [425, 855], [985, 1415], [1545, 1975], [2105, 2364]];
const Y_BANDS = [[36, 265], [395, 725], [855, 1115]];

function dist(ax, ay, bx, by) {
  return Math.hypot(bx - ax, by - ay);
}

function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createWorld(rng) {
  const state = {
    time: 0,
    cash: 0,
    clockMin: 8 * 60,
    wanted: 0,
    bustMeter: 0,
    bustedCount: 0,
    evadeT: 0,
    payouts: [],
    dayComplete: false,
    summaryT: 0,
    banner: null,
    buildings: [],
    palms: [],
    cars: [],
    peds: [],
    skids: [],
    player: { x: PLAYER_SPAWN.x, y: PLAYER_SPAWN.y, angle: -Math.PI / 2, speed: 0, inCar: false, carId: null },
    mission: { next: 1, active: null, phase: null, timer: 0, tailProgress: 0, spook: 0, lost: 0, got: 0, remaining: [] },
    objective: null,
    nearestCar: null,
    fixer: FIXER,
  };

  let nextCarId = 1;
  let policeSpawnT = 0;

  function banner(text, seconds = 3.5) {
    state.banner = { text, t: seconds };
  }

  // --- City generation -------------------------------------------------------

  function genCity() {
    for (const [x0, x1] of X_BANDS) {
      for (const [y0, y1] of Y_BANDS) {
        const cols = 2;
        const rows = y1 - y0 > 300 ? 2 : 1;
        const cellW = (x1 - x0) / cols;
        const cellH = (y1 - y0) / rows;
        for (let c = 0; c < cols; c += 1) {
          for (let r = 0; r < rows; r += 1) {
            if (rng.chance(0.16)) continue; // an empty lot here and there
            const inset = rng.range(13, 20);
            state.buildings.push({
              x: x0 + c * cellW + inset,
              y: y0 + r * cellH + inset,
              w: cellW - inset * 2,
              h: cellH - inset * 2,
              color: rng.pick(BUILDING_COLORS),
              roof: rng.pick(ROOF_COLORS),
            });
          }
        }
      }
    }
    // Keep the day's important ground clear: no building may cover the fixer, the
    // spawn corner, a pickup or drop-off, a package, or the hideout — a marker the
    // player cannot physically reach would end the chain.
    const CLEAR_POINTS = [FIXER, PLAYER_SPAWN, M1_PICKUP, M1_DROPOFF, M2_DROPOFF, M5_HIDEOUT, ...M4_PACKAGES];
    state.buildings = state.buildings.filter((b) => !CLEAR_POINTS.some(
      (pt) => pt.x > b.x - 44 && pt.x < b.x + b.w + 44 && pt.y > b.y - 44 && pt.y < b.y + b.h + 44,
    ));
    // Palms along the promenade and the beach, a few in the city.
    for (let x = 70; x < WORLD_W - 40; x += rng.range(80, 120)) {
      state.palms.push({ x, y: 1272 + rng.range(-8, 8), s: rng.range(0.85, 1.2) });
    }
    for (let i = 0; i < 16; i += 1) {
      state.palms.push({ x: rng.range(50, WORLD_W - 50), y: rng.range(1330, 1420), s: rng.range(0.8, 1.25) });
    }
    for (let i = 0; i < 10; i += 1) {
      const bx = rng.pick(X_BANDS);
      const by = rng.pick(Y_BANDS);
      state.palms.push({ x: rng.range(bx[0] + 8, bx[1] - 8), y: rng.range(by[0] + 8, by[1] - 8), s: rng.range(0.7, 1) });
    }
  }

  function addCar(x, y, angle, kind) {
    const car = {
      id: nextCarId, x, y, angle, vx: 0, vy: 0, fSpeed: 0, latSpeed: 0,
      color: kind === 'police' ? '#22344e' : rng.pick(CAR_COLORS),
      kind, driver: 'none', stolen: false, braking: false, wp: 0, removed: false,
    };
    nextCarId += 1;
    state.cars.push(car);
    return car;
  }

  function genParkedCars() {
    for (const vx of ROADS_V) {
      for (let y = 120; y < 1260; y += rng.range(150, 210)) {
        if (ROADS_H.some((hy) => Math.abs(y - hy) < 120)) continue;
        const side = rng.chance(0.5) ? -1 : 1;
        addCar(vx + side * (ROAD_HALF - 24), y, side > 0 ? -Math.PI / 2 : Math.PI / 2, 'parked');
      }
    }
    for (const hy of ROADS_H) {
      for (let x = 140; x < 2320; x += rng.range(170, 240)) {
        if (ROADS_V.some((vx) => Math.abs(x - vx) < 120)) continue;
        const side = rng.chance(0.5) ? -1 : 1;
        addCar(x, hy + side * (ROAD_HALF - 24), side > 0 ? 0 : Math.PI, 'parked');
      }
    }
    // Two cars wait by the spawn corner so the day can start on wheels.
    addCar(360 - (ROAD_HALF - 24), 560, Math.PI / 2, 'parked');
    addCar(360 + (ROAD_HALF - 24), 640, -Math.PI / 2, 'parked');
  }

  function pointInBuilding(x, y, pad) {
    return state.buildings.some((b) => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad);
  }

  function genPeds() {
    for (let i = 0; i < 14; i += 1) {
      let x = 0;
      let y = 0;
      for (let tries = 0; tries < 40; tries += 1) {
        const bx = rng.pick(X_BANDS);
        const by = rng.pick(Y_BANDS);
        x = rng.range(bx[0] + 6, bx[1] - 6);
        y = rng.range(by[0] + 6, by[1] - 6);
        if (!pointInBuilding(x, y, 6)) break;
      }
      state.peds.push({
        x, y, angle: rng.range(0, Math.PI * 2), tx: x, ty: y, retarget: rng.range(0, 4),
        down: false, downT: 0, color: rng.pick(CAR_COLORS),
      });
    }
  }

  genCity();
  genParkedCars();
  genPeds();

  // --- Collision helpers -----------------------------------------------------

  /** Push a circle out of every building footprint (kerb included) and the sea; kill inward speed. */
  function collideCircle(ent, r, bounce) {
    for (const b of state.buildings) {
      const cx = clamp(ent.x, b.x, b.x + b.w);
      const cy = clamp(ent.y, b.y, b.y + b.h);
      let dx = ent.x - cx;
      let dy = ent.y - cy;
      let d = Math.hypot(dx, dy);
      if (d >= r) continue;
      if (d < 0.001) {
        // Centre inside the rect: leave by the shallowest side.
        const left = ent.x - b.x;
        const right = b.x + b.w - ent.x;
        const top = ent.y - b.y;
        const bottom = b.y + b.h - ent.y;
        const m = Math.min(left, right, top, bottom);
        if (m === left) { dx = -1; dy = 0; d = 1; ent.x = b.x - r; }
        else if (m === right) { dx = 1; dy = 0; d = 1; ent.x = b.x + b.w + r; }
        else if (m === top) { dx = 0; dy = -1; d = 1; ent.y = b.y - r; }
        else { dx = 0; dy = 1; d = 1; ent.y = b.y + b.h + r; }
      } else {
        ent.x += (dx / d) * (r - d);
        ent.y += (dy / d) * (r - d);
      }
      if (ent.vx !== undefined) {
        const nx = dx / d;
        const ny = dy / d;
        const vn = ent.vx * nx + ent.vy * ny;
        if (vn < 0) {
          ent.vx -= (1 + bounce) * vn * nx;
          ent.vy -= (1 + bounce) * vn * ny;
        }
      }
    }
    if (ent.y + r > WATER_Y) {
      ent.y = WATER_Y - r;
      if (ent.vy !== undefined && ent.vy > 0) ent.vy = -ent.vy * bounce;
    }
    ent.x = clamp(ent.x, 16, WORLD_W - 16);
    ent.y = clamp(ent.y, 16, WORLD_H - 16);
  }

  function carCircles(car) {
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    return [
      { x: car.x + fx * 11, y: car.y + fy * 11 },
      { x: car.x - fx * 11, y: car.y - fy * 11 },
    ];
  }

  function collideCars() {
    const cars = state.cars.filter((c) => !c.removed);
    for (let i = 0; i < cars.length; i += 1) {
      for (let j = i + 1; j < cars.length; j += 1) {
        const a = cars[i];
        const b = cars[j];
        if (Math.abs(a.x - b.x) > 60 || Math.abs(a.y - b.y) > 60) continue;
        const ma = a.driver === 'none' ? 3.5 : 1;
        const mb = b.driver === 'none' ? 3.5 : 1;
        for (const ca of carCircles(a)) {
          for (const cb of carCircles(b)) {
            const dx = cb.x - ca.x;
            const dy = cb.y - ca.y;
            const d = Math.hypot(dx, dy);
            const min = 24;
            if (d === 0 || d >= min) continue;
            const nx = dx / d;
            const ny = dy / d;
            const overlap = min - d;
            const total = 1 / ma + 1 / mb;
            a.x -= nx * overlap * (1 / ma / total);
            a.y -= ny * overlap * (1 / ma / total);
            b.x += nx * overlap * (1 / mb / total);
            b.y += ny * overlap * (1 / mb / total);
            // Impulse along the normal: the cars bounce apart instead of gluing.
            const rvx = b.vx - a.vx;
            const rvy = b.vy - a.vy;
            const vn = rvx * nx + rvy * ny;
            if (vn < 0) {
              const imp = (-(1 + 0.55) * vn) / total;
              a.vx -= imp * (1 / ma) * nx;
              a.vy -= imp * (1 / ma) * ny;
              b.vx += imp * (1 / mb) * nx;
              b.vy += imp * (1 / mb) * ny;
            }
          }
        }
      }
    }
  }

  // --- Car physics -------------------------------------------------------------

  function stepCar(car, ctl, dt, accel) {
    const fx = Math.cos(car.angle);
    const fy = Math.sin(car.angle);
    let f = car.vx * fx + car.vy * fy;
    let l = -car.vx * fy + car.vy * fx;
    if (ctl.up) f += accel * dt;
    if (ctl.down) {
      if (f > 30) f -= CAR.brake * dt;
      else f = Math.max(f - CAR.reverseAccel * dt, CAR.maxReverse);
    }
    f -= f * CAR.drag * dt;
    const steer = (ctl.left ? -1 : 0) + (ctl.right ? 1 : 0);
    const authority = clamp(Math.abs(f) / 140, 0, 1) * (f < 0 ? -1 : 1);
    car.angle += steer * CAR.turnRate * authority * dt * (ctl.handbrake ? 1.3 : 1);
    const grip = ctl.handbrake ? CAR.driftGrip : CAR.grip;
    l *= Math.exp(-grip * dt);
    if (ctl.handbrake) f *= Math.exp(-0.9 * dt);
    const nfx = Math.cos(car.angle);
    const nfy = Math.sin(car.angle);
    car.vx = nfx * f - nfy * l;
    car.vy = nfy * f + nfx * l;
    car.x += car.vx * dt;
    car.y += car.vy * dt;
    car.fSpeed = f;
    car.latSpeed = l;
    car.braking = !!ctl.down && f > 30;
    if ((Math.abs(l) > 55 || (ctl.handbrake && Math.abs(f) > 130)) && Math.abs(f) > 40) {
      const rx = car.x - nfx * 13;
      const ry = car.y - nfy * 13;
      const px = -nfy;
      const py = nfx;
      state.skids.push({ x: rx + px * 8, y: ry + py * 8, a: 0.55 });
      state.skids.push({ x: rx - px * 8, y: ry - py * 8, a: 0.55 });
      if (state.skids.length > 600) state.skids.splice(0, state.skids.length - 600);
    }
  }

  /** A simple chase driver shared by police and the tail target: steer at a point, manage speed. */
  function driveToward(car, tx, ty, dt, accel, cruise) {
    const diff = angDiff(Math.atan2(ty - car.y, tx - car.x), car.angle);
    const d = dist(car.x, car.y, tx, ty);
    const ctl = { up: false, down: false, left: false, right: false, handbrake: false };
    if (diff > 0.07) ctl.right = true;
    else if (diff < -0.07) ctl.left = true;
    if (Math.abs(diff) > 2.4 && d < 130) {
      ctl.down = true; // turned the wrong way and close: back up and swing round
    } else if (car.fSpeed < cruise) {
      ctl.up = true;
    } else if (car.fSpeed > cruise + 30) {
      ctl.down = true;
    }
    stepCar(car, ctl, dt, accel);
    return d;
  }

  // --- Wanted, police, busts ---------------------------------------------------

  function addStar(n) {
    state.wanted = clamp(state.wanted + n, 0, WANTED.maxStars);
    state.evadeT = 0;
  }

  function policeCars() {
    return state.cars.filter((c) => !c.removed && c.kind === 'police');
  }

  function clearPolice() {
    for (const c of state.cars) if (c.kind === 'police') c.removed = true;
  }

  function spawnPolice() {
    const p = state.player;
    let best = null;
    let bestD = -1;
    for (const vx of ROADS_V) {
      for (const hy of [...ROADS_H, 1180]) {
        const d = dist(p.x, p.y, vx, hy);
        if (d > 480 && d < 820 && d > bestD) { best = { x: vx, y: hy }; bestD = d; }
      }
    }
    if (!best) best = { x: ROADS_V[0], y: ROADS_H[0] };
    const car = addCar(best.x + rng.range(-16, 16), best.y + rng.range(-16, 16), rng.range(0, Math.PI * 2), 'police');
    car.driver = 'police';
  }

  function doBust() {
    const fine = Math.min(state.cash, 150 * state.wanted);
    state.cash -= fine;
    state.bustedCount += 1;
    state.wanted = 0;
    state.bustMeter = 0;
    state.evadeT = 0;
    state.clockMin += 30;
    clearPolice();
    banner(`BUSTED — fined $${fine.toLocaleString('en-US')}`);
    if (state.mission.active === 5) failMission('Busted during the getaway job');
  }

  // --- Missions ------------------------------------------------------------------

  function startMission(n) {
    const m = state.mission;
    m.active = n;
    m.got = 0;
    m.tailProgress = 0;
    m.spook = 0;
    m.lost = 0;
    if (n === 1) { m.phase = 'pickup'; banner('Job 1: pick up the package across town'); }
    if (n === 2) { m.phase = 'deliver'; m.timer = M2_TIME; banner('Job 2: a delivery, against the clock'); }
    if (n === 3) {
      m.phase = 'tail';
      m.seen = false;
      const t = addCar(M3_LOOP[0].x, M3_LOOP[0].y, 0, 'target');
      t.driver = 'target';
      t.wp = 1;
      t.color = '#e8e3da';
      banner('Job 3: tail the white sedan — close, but unseen');
    }
    if (n === 4) {
      m.phase = 'collect';
      m.remaining = M4_PACKAGES.map((p) => ({ ...p }));
      banner('Job 4: collect three packages — it will draw attention');
    }
    if (n === 5) {
      m.phase = 'hideout';
      addStar(3);
      banner('Job 5: the big one — reach the hideout, then lose them');
    }
  }

  function completeMission(n) {
    const pay = PAYOUTS[n - 1];
    state.cash += pay;
    state.payouts.push(pay);
    state.mission.active = null;
    state.mission.phase = null;
    state.mission.next = n + 1;
    if (n === 3) for (const c of state.cars) if (c.kind === 'target') c.removed = true;
    banner(`Job ${n} done — +$${pay.toLocaleString('en-US')}`);
    if (n === 5) {
      state.dayComplete = true;
      state.summaryT = 12;
    }
  }

  function failMission(why) {
    if (state.mission.active === 3) for (const c of state.cars) if (c.kind === 'target') c.removed = true;
    state.mission.active = null;
    state.mission.phase = null;
    banner(`${why} — see the fixer to try again`);
  }

  function missionStep(dt) {
    const m = state.mission;
    const p = state.player;
    if (!m.active) {
      if (m.next <= 5 && dist(p.x, p.y, FIXER.x, FIXER.y) < TOUCH) startMission(m.next);
      return;
    }
    if (m.active === 1) {
      const target = m.phase === 'pickup' ? M1_PICKUP : M1_DROPOFF;
      if (dist(p.x, p.y, target.x, target.y) < TOUCH) {
        if (m.phase === 'pickup') { m.phase = 'dropoff'; banner('Package on board — take it to the drop'); }
        else completeMission(1);
      }
    } else if (m.active === 2) {
      m.timer -= dt;
      if (dist(p.x, p.y, M2_DROPOFF.x, M2_DROPOFF.y) < TOUCH) completeMission(2);
      else if (m.timer <= 0) failMission('Too slow — the delivery window closed');
    } else if (m.active === 3) {
      const target = state.cars.find((c) => !c.removed && c.kind === 'target');
      if (target) {
        const d = dist(p.x, p.y, target.x, target.y);
        if (d <= 420) m.seen = true;
        if (d >= 80 && d <= 300) m.tailProgress += dt;
        if (d < 65) m.spook += dt; else m.spook = Math.max(0, m.spook - dt * 1.5);
        if (d > 420 && m.seen) m.lost += dt; else m.lost = 0;
        if (m.tailProgress >= M3_TAIL_SECONDS) completeMission(3);
        else if (m.spook > 3) failMission('Spooked — the mark made you');
        else if (m.lost > 8) failMission('Lost — the mark got away');
      }
    } else if (m.active === 4) {
      for (let i = m.remaining.length - 1; i >= 0; i -= 1) {
        const pk = m.remaining[i];
        if (dist(p.x, p.y, pk.x, pk.y) < TOUCH) {
          m.remaining.splice(i, 1);
          m.got += 1;
          addStar(1);
          banner(`Package ${m.got} of 3 — the police noticed`);
          if (m.remaining.length === 0) completeMission(4);
        }
      }
    } else if (m.active === 5) {
      if (m.phase === 'hideout' && dist(p.x, p.y, M5_HIDEOUT.x, M5_HIDEOUT.y) < TOUCH) {
        m.phase = 'evade';
        banner('At the hideout — now lose the police');
      } else if (m.phase === 'evade' && state.wanted === 0) {
        completeMission(5);
      }
    }
  }

  function updateObjective() {
    const m = state.mission;
    const p = state.player;
    let obj = null;
    if (!m.active) {
      if (m.next <= 5) obj = { x: FIXER.x, y: FIXER.y, text: `Meet the fixer — job ${m.next} of 5` };
      else obj = { x: p.x, y: p.y, text: 'Free roam — the day is yours' };
    } else if (m.active === 1) {
      const t = m.phase === 'pickup' ? M1_PICKUP : M1_DROPOFF;
      obj = { ...t, text: m.phase === 'pickup' ? 'Pick up the package' : 'Deliver the package' };
    } else if (m.active === 2) {
      obj = { ...M2_DROPOFF, text: `Timed delivery — ${Math.max(0, Math.ceil(m.timer))}s left` };
    } else if (m.active === 3) {
      const target = state.cars.find((c) => !c.removed && c.kind === 'target');
      if (target) obj = { x: target.x, y: target.y, text: `Tail the mark — ${Math.floor((m.tailProgress / M3_TAIL_SECONDS) * 100)}%` };
    } else if (m.active === 4) {
      let bestPk = null;
      let bestD = Infinity;
      for (const pk of m.remaining) {
        const d = dist(p.x, p.y, pk.x, pk.y);
        if (d < bestD) { bestD = d; bestPk = pk; }
      }
      if (bestPk) obj = { ...bestPk, text: `Collect the packages (${m.got}/3)` };
    } else if (m.active === 5) {
      if (m.phase === 'hideout') obj = { ...M5_HIDEOUT, text: 'Reach the hideout' };
      else obj = { x: p.x, y: p.y, text: 'Lose the police!' };
    }
    if (obj) obj.dist = Math.round(dist(p.x, p.y, obj.x, obj.y));
    state.objective = obj;
  }

  // --- People ----------------------------------------------------------------------

  function stepPeds(dt) {
    for (const ped of state.peds) {
      if (ped.down) {
        ped.downT -= dt;
        if (ped.downT <= 0) ped.down = false;
        continue;
      }
      let fleeX = 0;
      let fleeY = 0;
      let fleeing = false;
      for (const car of state.cars) {
        if (car.removed) continue;
        const speed = Math.hypot(car.vx, car.vy);
        if (speed > 110 && dist(ped.x, ped.y, car.x, car.y) < 100) {
          fleeX = ped.x - car.x;
          fleeY = ped.y - car.y;
          fleeing = true;
          break;
        }
      }
      let dx;
      let dy;
      let speed;
      if (fleeing) {
        const len = Math.hypot(fleeX, fleeY) || 1;
        dx = fleeX / len;
        dy = fleeY / len;
        speed = 155;
      } else {
        ped.retarget -= dt;
        if (ped.retarget <= 0 || dist(ped.x, ped.y, ped.tx, ped.ty) < 8) {
          const bx = rng.pick(X_BANDS);
          const by = rng.pick(Y_BANDS);
          ped.tx = rng.range(bx[0] + 6, bx[1] - 6);
          ped.ty = rng.range(by[0] + 6, by[1] - 6);
          ped.retarget = rng.range(4, 9);
        }
        const d = dist(ped.x, ped.y, ped.tx, ped.ty);
        if (d < 4) continue;
        dx = (ped.tx - ped.x) / d;
        dy = (ped.ty - ped.y) / d;
        speed = PED_SPEED;
      }
      ped.x += dx * speed * dt;
      ped.y += dy * speed * dt;
      ped.angle = Math.atan2(dy, dx);
      collideCircle(ped, 8, 0);
    }
  }

  // --- The step ----------------------------------------------------------------------

  function step(dt, input) {
    state.time += dt;
    state.clockMin += dt * 2;
    if (state.banner) {
      state.banner.t -= dt;
      if (state.banner.t <= 0) state.banner = null;
    }
    if (state.summaryT > 0) state.summaryT -= dt;
    for (const s of state.skids) s.a -= dt * 0.12;
    state.skids = state.skids.filter((s) => s.a > 0.02);

    const p = state.player;
    const actions = input.takeActions();

    // Player: on foot or driving.
    if (!p.inCar) {
      let dx = (input.held.has('right') ? 1 : 0) - (input.held.has('left') ? 1 : 0);
      let dy = (input.held.has('down') ? 1 : 0) - (input.held.has('up') ? 1 : 0);
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        dx /= len;
        dy /= len;
        p.x += dx * WALK_SPEED * dt;
        p.y += dy * WALK_SPEED * dt;
        p.angle = Math.atan2(dy, dx);
        p.speed = WALK_SPEED;
      } else p.speed = 0;
      const probe = { x: p.x, y: p.y };
      collideCircle(probe, 10, 0);
      p.x = probe.x;
      p.y = probe.y;
      // Cars are solid to walk into.
      for (const car of state.cars) {
        if (car.removed) continue;
        for (const cc of carCircles(car)) {
          const d = dist(p.x, p.y, cc.x, cc.y);
          if (d < 22 && d > 0) {
            p.x += ((p.x - cc.x) / d) * (22 - d);
            p.y += ((p.y - cc.y) / d) * (22 - d);
          }
        }
      }
      if (actions.has('interact') && state.nearestCar) {
        const car = state.cars.find((c) => c.id === state.nearestCar.id);
        if (car && !car.removed) {
          car.driver = 'player';
          p.inCar = true;
          p.carId = car.id;
          if (car.kind === 'parked' && !car.stolen) {
            car.stolen = true;
            const witnessed = state.peds.some((ped) => !ped.down && dist(p.x, p.y, ped.x, ped.y) < 260) || policeCars().length > 0;
            if (witnessed) {
              addStar(1);
              banner('Car stolen — someone saw that');
            }
          }
        }
      }
    } else {
      const car = state.cars.find((c) => c.id === p.carId);
      if (!car || car.removed) {
        p.inCar = false;
        p.carId = null;
      } else {
        const ctl = {
          up: input.held.has('up'),
          down: input.held.has('down'),
          left: input.held.has('left'),
          right: input.held.has('right'),
          handbrake: input.held.has('handbrake'),
        };
        stepCar(car, ctl, dt, CAR.accel);
        p.x = car.x;
        p.y = car.y;
        p.angle = car.angle;
        p.speed = Math.abs(car.fSpeed);
        if (actions.has('interact') && Math.abs(car.fSpeed) < 25) {
          car.driver = 'none';
          p.inCar = false;
          p.carId = null;
          const sideA = { x: car.x + Math.cos(car.angle + Math.PI / 2) * 27, y: car.y + Math.sin(car.angle + Math.PI / 2) * 27 };
          const sideB = { x: car.x + Math.cos(car.angle - Math.PI / 2) * 27, y: car.y + Math.sin(car.angle - Math.PI / 2) * 27 };
          const spot = pointInBuilding(sideA.x, sideA.y, 10) ? sideB : sideA;
          p.x = spot.x;
          p.y = spot.y;
        }
      }
    }

    // Nearest car, for the interact prompt and the playtest handle.
    let nearest = null;
    let nearestD = 52;
    for (const car of state.cars) {
      if (car.removed || car.driver !== 'none') continue;
      const d = dist(p.x, p.y, car.x, car.y);
      if (d < nearestD) { nearestD = d; nearest = car; }
    }
    state.nearestCar = nearest ? { id: nearest.id, x: nearest.x, y: nearest.y, dist: Math.round(nearestD) } : null;

    // Police presence follows the wanted level.
    if (state.wanted > 0) {
      policeSpawnT -= dt;
      const want = Math.min(state.wanted, 4);
      if (policeCars().length < want && policeSpawnT <= 0) {
        spawnPolice();
        policeSpawnT = 1.1;
      }
    }
    for (const car of state.cars) {
      if (car.removed) continue;
      if (car.kind === 'police' && car.driver === 'police') {
        const lead = clamp(dist(car.x, car.y, p.x, p.y) / 600, 0, 0.45);
        const tx = p.x + (p.inCar ? (state.cars.find((c) => c.id === p.carId)?.vx ?? 0) : 0) * lead;
        const ty = p.y + (p.inCar ? (state.cars.find((c) => c.id === p.carId)?.vy ?? 0) : 0) * lead;
        const d = dist(car.x, car.y, p.x, p.y);
        const cruise = d > 170 ? 999 : Math.abs(p.speed) + 24;
        driveToward(car, tx, ty, dt, CAR.policeAccel, cruise);
        if (d > 1150) car.removed = true;
      } else if (car.kind === 'target' && car.driver === 'target') {
        const wp = M3_LOOP[car.wp % M3_LOOP.length];
        const d = driveToward(car, wp.x, wp.y, dt, CAR.accel, 150);
        if (d < 64) car.wp += 1;
      } else if (car.driver === 'none') {
        car.x += car.vx * dt;
        car.y += car.vy * dt;
        car.vx *= Math.exp(-3.5 * dt);
        car.vy *= Math.exp(-3.5 * dt);
        car.fSpeed = Math.hypot(car.vx, car.vy);
      }
    }

    // Collisions: cars against buildings and the sea, then cars against cars.
    for (const car of state.cars) {
      if (car.removed) continue;
      for (const cc of carCircles(car)) {
        const probe = { x: cc.x, y: cc.y, vx: car.vx, vy: car.vy };
        collideCircle(probe, 12, 0.35);
        car.x += probe.x - cc.x;
        car.y += probe.y - cc.y;
        car.vx = probe.vx;
        car.vy = probe.vy;
      }
    }
    collideCars();

    // Running someone down is a crime.
    if (p.inCar) {
      const car = state.cars.find((c) => c.id === p.carId);
      if (car && Math.abs(car.fSpeed) > 50) {
        for (const ped of state.peds) {
          if (ped.down) continue;
          if (dist(ped.x, ped.y, car.x, car.y) < 26) {
            ped.down = true;
            ped.downT = 18;
            addStar(1);
            banner('You hit a pedestrian!');
          }
        }
      }
    }

    stepPeds(dt);
    missionStep(dt);

    // Bust and evade.
    if (state.wanted > 0) {
      const cops = policeCars();
      const nearCop = cops.some((c) => dist(c.x, c.y, p.x, p.y) < WANTED.bustRange);
      if (nearCop && p.speed < WANTED.bustSlowBelow) state.bustMeter += dt / WANTED.bustSeconds;
      else state.bustMeter = Math.max(0, state.bustMeter - dt / 3.5);
      if (state.bustMeter >= 1) doBust();
      const allLost = cops.every((c) => dist(c.x, c.y, p.x, p.y) > WANTED.evadeRange);
      if (allLost && cops.length > 0) {
        state.evadeT += dt;
        if (state.evadeT >= WANTED.evadeSeconds) {
          state.wanted = 0;
          state.evadeT = 0;
          clearPolice();
          banner('You lost the police');
          if (state.mission.active === 5 && state.mission.phase === 'evade') completeMission(5);
        }
      } else state.evadeT = 0;
    } else {
      state.bustMeter = Math.max(0, state.bustMeter - dt / 3.5);
      state.evadeT = 0;
    }

    updateObjective();
  }

  return { state, step };
}
