// Keyboard state for the game. Real key events fill a `held` set; one-shot actions
// (interact, confirm, pause) are queued on keydown and drained by the loop. The
// screenshot staging drives the same held set through setVirtual, so a staged scene
// is steered through exactly the code a player's keys steer.

export const KEY = {
  up: 'up',
  down: 'down',
  left: 'left',
  right: 'right',
  handbrake: 'handbrake',
  interact: 'interact',
  confirm: 'confirm',
  pause: 'pause',
};

const HELD_BY_CODE = new Map([
  ['KeyW', KEY.up],
  ['ArrowUp', KEY.up],
  ['KeyS', KEY.down],
  ['ArrowDown', KEY.down],
  ['KeyA', KEY.left],
  ['ArrowLeft', KEY.left],
  ['KeyD', KEY.right],
  ['ArrowRight', KEY.right],
  ['Space', KEY.handbrake],
]);

const ACTION_BY_CODE = new Map([
  ['KeyE', KEY.interact],
  ['Enter', KEY.confirm],
  ['Space', KEY.confirm],
  ['KeyP', KEY.pause],
  ['Escape', KEY.pause],
]);

export function createInput() {
  const held = new Set();
  const actions = new Set();

  window.addEventListener('keydown', (event) => {
    const heldKey = HELD_BY_CODE.get(event.code);
    if (heldKey) {
      held.add(heldKey);
      if (event.code === 'Space' || event.code.startsWith('Arrow')) event.preventDefault();
    }
    const action = ACTION_BY_CODE.get(event.code);
    if (action && !event.repeat) actions.add(action);
  });
  window.addEventListener('keyup', (event) => {
    const heldKey = HELD_BY_CODE.get(event.code);
    if (heldKey) held.delete(heldKey);
  });
  window.addEventListener('blur', () => held.clear());

  return {
    /** The held-keys view the world step reads each tick. */
    held,
    /** Staging hook: hold or release a key without a real event. */
    setVirtual(key, down) {
      if (down) held.add(key);
      else held.delete(key);
    },
    /** Queue a one-shot action as if its key was pressed. */
    press(action) {
      actions.add(action);
    },
    /** Drain and return the queued one-shot actions. */
    takeActions() {
      const taken = new Set(actions);
      actions.clear();
      return taken;
    },
    /** A copy of the queued one-shot actions, without draining them. */
    peekActions() {
      return new Set(actions);
    },
  };
}
