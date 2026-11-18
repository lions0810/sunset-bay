// Sunset Bay tuning: the whole city and every speed that matters, in one place.
// Distances are world pixels; speeds are pixels per second; the world steps at 1/60 s.

export const VIEW_W = 960;
export const VIEW_H = 540;
export const WORLD_W = 2400;
export const WORLD_H = 1600;
export const STEP = 1 / 60;

/** The sea starts here: sand from BEACH_Y to WATER_Y, open water (solid to cross) below WATER_Y. */
export const BEACH_Y = 1300;
export const WATER_Y = 1450;

/** Road centrelines. Vertical roads run the city's height; horizontal ones stop at the promenade. */
export const ROADS_V = [360, 920, 1480, 2040];
export const ROADS_H = [330, 790, 1180];
export const ROAD_HALF = 65;

export const WALK_SPEED = 178;
export const PED_SPEED = 62;

export const CAR = {
  accel: 360, // the player's cars: with DRAG this tops out near 439 px/s
  policeAccel: 315, // police: tops out near 384 px/s, just under the player's car
  drag: 0.82,
  brake: 620,
  reverseAccel: 260,
  maxReverse: -150,
  turnRate: 2.65,
  grip: 9.5,
  driftGrip: 1.7,
};

export const WANTED = {
  bustRange: 120, // a police car this close, with you slow, starts the bust meter
  bustSlowBelow: 55,
  bustSeconds: 4.5, // of near-and-slow time to be busted
  evadeRange: 400, // every police car farther than this counts as lost
  evadeSeconds: 6, // of lost-police time clears the stars
  maxStars: 5,
};

export const TOUCH = 36; // how close to a marker counts as arriving
