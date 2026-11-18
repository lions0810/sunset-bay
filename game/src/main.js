// Boot and the one loop for Sunset Bay: input is read every frame, the world advances
// in fixed 1/60 s steps, and the renderer paints what is there. Screens: title, play,
// paused. The title screen idles the world (people wander, the bay sits still) behind
// its overlay.
//
// ?seed=N fixes the city and the day. ?shot=title|drive|mission (with &seed=N) stages
// that scene instead of running the loop, paints it twice and sets window.__shotReady.
// window.__game exposes the live state for scripted drivers.

import { STEP } from './config.js';
import { createRandom } from './random.js';
import { createWorld } from './world.js';
import { createInput, KEY } from './input.js';
import { createRenderer, SCREEN_PAUSED, SCREEN_PLAY, SCREEN_TITLE } from './render.js';
import { stageShot } from './shots.js';

const MAX_FRAME = 0.25;

const params = new URLSearchParams(window.location.search);
const shot = params.get('shot');
const seedParam = Number.parseInt(params.get('seed') ?? '', 10);
const seed = Number.isInteger(seedParam) ? seedParam : Math.floor(Math.random() * 4294967296);

const canvas = document.getElementById('game');
const status = document.getElementById('status');
const world = createWorld(createRandom(seed));
const renderer = createRenderer(canvas);
const input = createInput();

window.__game = { state: world.state, world, seed };

const IDLE_INPUT = { held: new Set(), takeActions: () => new Set() };

if (shot) {
  const screen = stageShot(shot, world, input);
  let painted = 0;
  const paint = () => {
    renderer.draw(world.state, screen);
    painted += 1;
    if (painted < 2) requestAnimationFrame(paint);
    else window.__shotReady = true;
  };
  requestAnimationFrame(paint);
  status.textContent = `Sunset Bay — staged scene "${shot}".`;
} else {
  let screen = SCREEN_TITLE;
  let accumulator = 0;
  let last = performance.now();

  document.addEventListener('visibilitychange', () => {
    if (document.hidden && screen === SCREEN_PLAY) screen = SCREEN_PAUSED;
  });

  function frame(now) {
    requestAnimationFrame(frame);
    accumulator += Math.min((now - last) / 1000, MAX_FRAME);
    last = now;

    const acts = input.peekActions();
    if (screen === SCREEN_TITLE && acts.has(KEY.confirm)) {
      screen = SCREEN_PLAY;
      input.takeActions();
      status.textContent = 'Day 1 in Sunset Bay. Follow the amber marker to the fixer.';
    } else if (screen === SCREEN_PLAY && acts.has(KEY.pause)) {
      screen = SCREEN_PAUSED;
      input.takeActions();
      status.textContent = 'Paused.';
    } else if (screen === SCREEN_PAUSED && (acts.has(KEY.pause) || acts.has(KEY.confirm))) {
      screen = SCREEN_PLAY;
      input.takeActions();
      status.textContent = 'Playing.';
    }

    if (screen === SCREEN_TITLE) {
      while (accumulator >= STEP) { world.step(STEP, IDLE_INPUT); accumulator -= STEP; }
    } else if (screen === SCREEN_PLAY) {
      while (accumulator >= STEP) { world.step(STEP, input); accumulator -= STEP; }
    } else {
      accumulator = 0;
    }
    renderer.draw(world.state, screen);
  }

  status.textContent = 'Sunset Bay. Press Enter to start.';
  requestAnimationFrame(frame);
}
