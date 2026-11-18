// Keyboard input. `down` is the set of codes currently held; `pressed` is the set that
// went down since the last frame's consume, for one-shot actions (E to enter a car, Enter
// to start). The game reads both through helpers so the rest of the code never touches
// event objects.

const down = new Set();
const pressed = new Set();
const HANDLED = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space']);

export function initInput(target) {
  target.addEventListener('keydown', (e) => {
    if (HANDLED.has(e.code)) e.preventDefault();
    if (!e.repeat) pressed.add(e.code);
    down.add(e.code);
  });
  target.addEventListener('keyup', (e) => down.delete(e.code));
  target.addEventListener('blur', () => { down.clear(); pressed.clear(); });
}

export const key = (code) => down.has(code);
export const anyKey = (...codes) => codes.some((c) => down.has(c));

// One-shot: true only on the first frame after the press.
export function tapped(code) {
  if (!pressed.has(code)) return false;
  pressed.delete(code);
  return true;
}

export function clearTaps() { pressed.clear(); }
