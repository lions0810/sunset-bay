// The moving things: cars (one arcade physics step for the player's car, the traffic
// and the police alike), pedestrians, and the police driver. A car is a position, a
// heading and a velocity; the step splits velocity into forward and lateral parts and
// grips the lateral part away, which is what makes the handbrake slide instead of spin.

import { angleDelta, clamp } from './rng.js';
import { resolveCircle, surfaceAt } from './world.js';

let nextId = 1;

export function makeCar(x, y, angle, color, kind = 'civilian') {
  return {
    id: nextId++, x, y, angle, vx: 0, vy: 0, color, kind,
    own: false, stolen: false, driver: null, stuckT: 0, reverseT: 0, flash: (x % 7) + (y % 3),
  };
}

export const carSpeed = (car) => car.vx * Math.cos(car.angle) + car.vy * Math.sin(car.angle);
export const speedMag = (car) => Math.hypot(car.vx, car.vy);

const TUNING = {
  civilian: { accel: 300, maxF: 428, maxR: -150 },
  // Interceptors: they launch a touch harder than a civilian car, but the bay's
  // whole fantasy is that a well-driven car can open a gap on a straight — so the
  // player's 428 keeps a real edge over the patrol's 385, not a rounding error.
  police:   { accel: 315, maxF: 385, maxR: -150 },
  target:   { accel: 260, maxF: 252, maxR: -110 },
};

// ctl: { throttle: -1..1, steer: -1..1, handbrake: bool }. fx may carry skid(x, y)
// (a rear tyre is sliding) — main turns those into marks and smoke.
export function stepCar(world, car, ctl, dt, fx) {
  const tune = TUNING[car.kind] || TUNING.civilian;
  const surf = surfaceAt(car.x, car.y);
  const gripMul = surf === 'sand' ? 0.55 : 1;
  const fxv = Math.cos(car.angle), fyv = Math.sin(car.angle);
  let fSpeed = car.vx * fxv + car.vy * fyv;
  let lSpeed = car.vx * -fyv + car.vy * fxv;

  if (ctl.throttle > 0) fSpeed += tune.accel * gripMul * dt * ctl.throttle;
  else if (ctl.throttle < 0) {
    if (fSpeed > 12) fSpeed -= 520 * dt;                       // braking
    else fSpeed += 190 * dt * ctl.throttle;                    // reversing
  }
  fSpeed = clamp(fSpeed, tune.maxR, tune.maxF * gripMul);
  fSpeed *= Math.exp(-(ctl.throttle === 0 ? 0.9 : 0.12) * dt); // drag / rolling resistance
  if (Math.abs(fSpeed) < 2 && ctl.throttle === 0) fSpeed = 0;

  const steerAuthority = clamp(Math.abs(fSpeed) / 150, 0, 1);
  const turn = ctl.steer * 2.35 * steerAuthority * (ctl.handbrake ? 1.45 : 1) * Math.sign(fSpeed || 1);
  car.angle += turn * dt;
  lSpeed *= Math.exp(-(ctl.handbrake ? 2.0 : 9.5) * dt);

  const nfx = Math.cos(car.angle), nfy = Math.sin(car.angle);
  car.vx = nfx * fSpeed + -nfy * lSpeed;
  car.vy = nfy * fSpeed + nfx * lSpeed;
  car.x += car.vx * dt;
  car.y += car.vy * dt;

  const [rx, ry] = resolveCircle(world, car.x, car.y, 15);
  if (rx !== car.x || ry !== car.y) {
    car.x = rx; car.y = ry;
    // Scrape along whatever stopped us: keep the tangential half of the velocity.
    const into = car.vx * nfx + car.vy * nfy;
    if (into > 0) { car.vx -= nfx * into * 0.55; car.vy -= nfy * into * 0.55; }
    if (fx && fx.bump) fx.bump(car);
  }

  if (fx && fx.skid && Math.abs(lSpeed) > 52 && Math.abs(fSpeed) > 110) {
    const bx = car.x - nfx * 11, by = car.y - nfy * 11;
    fx.skid(bx + -nfy * 7, by + nfx * 7);
    fx.skid(bx - -nfy * 7, by - nfx * 7);
  }
  car.fSpeed = fSpeed;
  // Brake lights are drawn from this: the pedal is down and the car is shedding
  // forward speed. Set here, where the pedal and the speed are both known.
  car.braking = ctl.throttle < 0 && fSpeed > 12;
  return car;
}

// Circles against circles: parked cars, traffic and police all push each other apart.
// A parked car barely yields — the moving car takes most of the push and slides around
// it, the way a scrape actually goes; two moving cars share the push evenly.
// The velocity answer is an arcade one: along the line of contact the two cars meet
// in the middle (the faster one's push becomes the slower one's shove), and across
// that line nothing is touched. An earlier version damped both cars' whole velocity
// on every step of contact, which glued any two touching cars to a ~28px/s crawl —
// a police car that reached your bumper owned you until the day ended. A scrape
// should cost a bump, not the whole drive.
export function collideCars(a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy), min = 30;
  if (d === 0 || d >= min) return;
  const ux = dx / d, uy = dy / d, overlap = min - d;
  const aParked = !a.driver && a.kind === 'civilian';
  const bParked = !b.driver && b.kind === 'civilian';
  let aShare = 0.5, bShare = 0.5;
  if (aParked && !bParked) { aShare = 0.18; bShare = 0.82; }
  else if (bParked && !aParked) { aShare = 0.82; bShare = 0.18; }
  a.x -= ux * overlap * aShare; a.y -= uy * overlap * aShare;
  b.x += ux * overlap * bShare; b.y += uy * overlap * bShare;
  const va = a.vx * ux + a.vy * uy, vb = b.vx * ux + b.vy * uy;
  if (va > vb) {
    const meet = (va + vb) / 2;
    a.vx += ux * (meet - va); a.vy += uy * (meet - va);
    b.vx += ux * (meet - vb); b.vy += uy * (meet - vb);
    if (aParked) { a.vx = 0; a.vy = 0; }
    if (bParked) { b.vx = 0; b.vy = 0; }
  }
}

export function drawCar(g, car, t) {
  g.save();
  g.translate(car.x, car.y);
  g.rotate(car.angle);
  g.fillStyle = 'rgba(15,12,6,0.3)';
  g.fillRect(-15, -6, 34, 17);
  g.fillStyle = car.color;
  roundRect(g, -17, -9, 34, 18, 5); g.fill();
  g.fillStyle = 'rgba(20,24,30,0.85)';
  roundRect(g, -3, -7, 11, 14, 3); g.fill();          // cabin glass
  g.fillStyle = 'rgba(255,255,255,0.25)';
  g.fillRect(6, -7, 3, 14);                            // windscreen shine
  g.fillStyle = '#f5eeda';
  g.fillRect(15, -7, 2, 4); g.fillRect(15, 3, 2, 4);   // headlights
  if (car.braking) {
    // Brake lights: a hot core and a halo, so a following driver (or a player
    // being paced by one) can read the slowdown at a glance.
    g.fillStyle = 'rgba(255,60,40,0.35)';
    g.fillRect(-19, -8, 4, 6); g.fillRect(-19, 2, 4, 6);
    g.fillStyle = '#ff3524';
    g.fillRect(-17, -7, 2, 4); g.fillRect(-17, 3, 2, 4);
  } else {
    g.fillStyle = '#c23b2e';
    g.fillRect(-17, -7, 2, 4); g.fillRect(-17, 3, 2, 4);
  }
  if (car.kind === 'police') {
    g.fillStyle = '#f2f2f2'; roundRect(g, -8, -9, 13, 18, 4); g.fill();
    g.fillStyle = '#22242a'; g.fillRect(-8, -9, 13, 5); g.fillRect(-8, 4, 13, 5);
    const on = Math.sin(t * 10 + car.flash) > 0;
    g.fillStyle = on ? '#ff4b3e' : '#4b7dff';
    g.fillRect(-2, -3, 5, 6);
    g.fillStyle = on ? '#4b7dff' : '#ff4b3e';
    g.fillRect(3, -3, 1.5, 6);
  }
  if (car.kind === 'target') {
    g.fillStyle = '#ffb52e'; g.fillRect(-14, -2, 28, 4);
  }
  g.restore();
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

// --- pedestrians ---------------------------------------------------------------

const SHIRTS = ['#d96b4f', '#4f83d9', '#e3c04f', '#5fb56a', '#c95f9e', '#e8e4da', '#5fc4c9'];

export function makePed(rng, x, y) {
  return {
    x, y, angle: rng.range(0, Math.PI * 2), tx: x, ty: y, state: 'wander', timer: rng.range(0, 2),
    shirt: rng.pick(SHIRTS), skin: rng.pick(['#e8b98d', '#c98d5f', '#8a5a34', '#f0cfa8']),
    fallenT: 0, id: nextId++,
  };
}

function pointFree(world, x, y) {
  if (surfaceAt(x, y) === 'water') return false;
  return !world.buildings.some((b) => x > b.x - 6 && x < b.x + b.w + 6 && y > b.y - 6 && y < b.y + b.h + 6);
}

export function stepPed(world, rng, ped, dt, threats) {
  ped.timer -= dt;
  if (ped.state === 'fallen') {
    ped.fallenT -= dt;
    if (ped.fallenT <= 0) ped.state = 'wander';
    return;
  }
  // A fast car close by is worth running from.
  let flee = null;
  for (const th of threats) {
    const d = Math.hypot(th.x - ped.x, th.y - ped.y);
    if (d < 92 && th.speed > 130) { flee = th; break; }
  }
  if (flee) { ped.state = 'flee'; ped.timer = 0.9; ped.tx = ped.x + (ped.x - flee.x) * 2; ped.ty = ped.y + (ped.y - flee.y) * 2; }
  else if (ped.state === 'flee' && ped.timer <= 0) ped.state = 'wander';

  if (ped.state === 'wander' && (Math.hypot(ped.tx - ped.x, ped.ty - ped.y) < 8 || ped.timer <= 0)) {
    for (let i = 0; i < 8; i++) {
      const nx = ped.x + rng.range(-280, 280), ny = ped.y + rng.range(-280, 280);
      if (nx > 16 && ny > 16 && nx < 2384 && ny < 1560 && pointFree(world, nx, ny)) { ped.tx = nx; ped.ty = ny; break; }
    }
    ped.timer = rng.range(4, 9);
  }
  const speed = ped.state === 'flee' ? 138 : 52;
  const want = Math.atan2(ped.ty - ped.y, ped.tx - ped.x);
  ped.angle += clamp(angleDelta(ped.angle, want), -6 * dt, 6 * dt);
  ped.x += Math.cos(ped.angle) * speed * dt;
  ped.y += Math.sin(ped.angle) * speed * dt;
  const [rx, ry] = resolveCircle(world, ped.x, ped.y, 8);
  ped.x = rx; ped.y = ry;
}

export function drawPed(g, ped, t) {
  g.save();
  g.translate(ped.x, ped.y);
  g.fillStyle = 'rgba(15,12,6,0.3)';
  g.beginPath(); g.ellipse(0, 2, 7, 4, 0, 0, Math.PI * 2); g.fill();
  if (ped.state === 'fallen') {
    g.rotate(ped.angle);
    g.fillStyle = ped.shirt; roundRect(g, -9, -3.5, 18, 7, 3); g.fill();
    g.fillStyle = ped.skin; g.beginPath(); g.arc(11, 0, 3.6, 0, Math.PI * 2); g.fill();
  } else {
    const bob = Math.sin(t * 9 + ped.id * 1.7) * 1.1;
    g.fillStyle = ped.shirt;
    g.beginPath(); g.arc(0, bob * 0.3, 5.4, 0, Math.PI * 2); g.fill();
    g.fillStyle = ped.skin;
    g.beginPath(); g.arc(0, -1 + bob * 0.3, 3.4, 0, Math.PI * 2); g.fill();
  }
  g.restore();
}

export function drawPlayer(g, player, t) {
  g.save();
  g.translate(player.x, player.y);
  g.fillStyle = 'rgba(15,12,6,0.35)';
  g.beginPath(); g.ellipse(0, 2, 8, 4.5, 0, 0, Math.PI * 2); g.fill();
  const bob = player.moving ? Math.sin(t * 11) * 1.2 : 0;
  g.fillStyle = '#ffd23e';
  g.beginPath(); g.arc(0, bob * 0.3, 6.4, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#20303c';
  g.beginPath(); g.arc(0, -1 + bob * 0.3, 4, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#ffd23e'; g.lineWidth = 2.4;
  g.beginPath();
  g.moveTo(0, 0);
  g.lineTo(Math.cos(player.angle) * 9, Math.sin(player.angle) * 9);
  g.stroke();
  g.restore();
}

// --- the police driver -----------------------------------------------------------
// Controls for one police car chasing the player. The rule that matters: as the gap
// closes the police match the player's speed instead of ramming — inside 110px they
// aim for the player's speed plus a small closing allowance, inside 55px for the
// player's speed itself, and alongside a stopped player they stop too.

export function policeControls(car, target, dt) {
  const d = Math.hypot(target.x - car.x, target.y - car.y);
  const want = Math.atan2(target.y - car.y, target.x - car.x);
  const mySpeed = Math.abs(car.fSpeed || 0);
  const theirSpeed = target.speed;

  if (car.reverseT > 0) {
    car.reverseT -= dt;
    return { throttle: -1, steer: clamp(angleDelta(car.angle, want) * -2, -1, 1), handbrake: false };
  }
  if (mySpeed < 14) car.stuckT += dt; else car.stuckT = 0;
  if (car.stuckT > 0.95 && d > 60) { car.stuckT = 0; car.reverseT = 0.7; }

  let throttle;
  if (d > 230) throttle = 1;
  else if (d > 110) throttle = mySpeed < theirSpeed + 70 ? 1 : mySpeed > theirSpeed + 105 ? -1 : 0;
  else if (d > 55) throttle = mySpeed < theirSpeed + 16 ? 1 : mySpeed > theirSpeed + 34 ? -1 : 0;
  else throttle = mySpeed < theirSpeed + 2 ? 0.6 : mySpeed > theirSpeed + 12 ? -1 : 0;
  if (d < 30 && theirSpeed < 18) throttle = mySpeed > 4 ? -1 : 0;

  return { throttle, steer: clamp(angleDelta(car.angle, want) * 2.4, -1, 1), handbrake: false };
}
