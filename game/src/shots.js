// The screenshot scenes behind ?shot=title|drive|mission. Each one plays the real
// rules forward from a fresh world, steered through the same held-key set a player's
// keyboard fills, so the frame is what a short game really looks like — and the same
// seed always gives the same frame.

import { STEP } from './config.js';
import { KEY } from './input.js';
import { SCREEN_PLAY, SCREEN_TITLE } from './render.js';

const MOVE_KEYS = [KEY.up, KEY.down, KEY.left, KEY.right, KEY.handbrake];

function setKeys(input, on) {
  for (const k of MOVE_KEYS) input.setVirtual(k, on.includes(k));
}

function angDiff(a, b) {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

/** Steer the player toward (tx, ty) for up to `seconds`; stops early when `until` holds. */
function pilotTo(world, input, tx, ty, seconds, until) {
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    if (until && until()) break;
    const p = world.state.player;
    const keys = [];
    if (!p.inCar) {
      if (tx - p.x > 6) keys.push(KEY.right);
      else if (p.x - tx > 6) keys.push(KEY.left);
      if (ty - p.y > 6) keys.push(KEY.down);
      else if (p.y - ty > 6) keys.push(KEY.up);
    } else {
      const diff = angDiff(Math.atan2(ty - p.y, tx - p.x), p.angle);
      if (diff > 0.07) keys.push(KEY.right);
      else if (diff < -0.07) keys.push(KEY.left);
      keys.push(KEY.up);
    }
    setKeys(input, keys);
    world.step(STEP, input);
  }
  setKeys(input, []);
}

/** Follow a path of waypoints (road centres, so the run stays on the streets). */
function pilotPath(world, input, points, seconds) {
  let wp = 0;
  const steps = Math.round(seconds / STEP);
  for (let i = 0; i < steps && wp < points.length; i += 1) {
    const p = world.state.player;
    const [tx, ty] = points[wp];
    if (Math.hypot(tx - p.x, ty - p.y) < 90) { wp += 1; continue; }
    const diff = angDiff(Math.atan2(ty - p.y, tx - p.x), p.angle);
    const keys = [KEY.up];
    if (diff > 0.07) keys.push(KEY.right);
    else if (diff < -0.07) keys.push(KEY.left);
    setKeys(input, keys);
    world.step(STEP, input);
  }
  setKeys(input, []);
}

/** Walk to the car waiting south of the spawn corner and get in. */
function takeSpawnCar(world, input) {
  pilotTo(world, input, 319, 540, 2.5, () => !!world.state.nearestCar);
  world.step(STEP, input); // let the world register the nearest car
  if (world.state.nearestCar) {
    input.press(KEY.interact);
    world.step(STEP, input);
  }
}

/**
 * Set `world` to the named scene (title, drive or mission; any other name is title)
 * and return the screen to draw over it.
 */
export function stageShot(name, world, input) {
  if (name === 'drive') {
    takeSpawnCar(world, input);
    pilotPath(world, input, [[352, 790], [352, 1140]], 5);
    return SCREEN_PLAY;
  }
  if (name === 'mission') {
    pilotTo(world, input, world.state.fixer.x, world.state.fixer.y + 6, 3, () => world.state.mission.active === 1);
    takeSpawnCar(world, input);
    pilotPath(world, input, [[352, 790], [1480, 790], [1620, 950]], 6.5);
    return SCREEN_PLAY;
  }
  for (let i = 0; i < 90; i += 1) world.step(STEP, input);
  return SCREEN_TITLE;
}
