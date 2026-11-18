// The city of Sunset Bay: a 2400x1600 world. A grid of roads over city blocks, a beach
// and the sea along the south edge, one pier. Generation is seeded, so a seed always
// builds the same city. This module owns the static facts (buildings, palms, parked-car
// spots, points of interest), the collision answers, and the one-time render of the
// ground layer that the main loop blits every frame.

import { clamp } from './rng.js';

export const WORLD = {
  W: 2400,
  H: 1600,
  VX: [250, 650, 1050, 1450, 1850, 2210], // vertical road centre lines
  HY: [210, 550, 890, 1190],              // horizontal road centre lines (last = coast road)
  ROAD_HALF: 46,
  SAND_Y: 1305,
  WATER_Y: 1430,
  PIER: { x: 1542, y: 1305, w: 36, h: 195 },
};

// Named places the missions and the HUD refer to. All sit on a road, the promenade or
// the pier, so a car can always reach their marker.
export const POIS = {
  home:     { x: 322,  y: 1128, name: 'Home' },
  fixer:    { x: 706,  y: 1144, name: "Fixer's corner" },
  warehouse:{ x: 2062, y: 266,  name: 'Warehouse' },
  dock:     { x: 1560, y: 1272, name: 'The pier' },
  cafe:     { x: 1112, y: 612,  name: 'Café Lumen' },
  nwCorner: { x: 308,  y: 266,  name: 'NW corner' },
  tailStart:{ x: 1850, y: 890,  name: 'East avenue' },
  hideout:  { x: 308,  y: 606,  name: 'Hideout garage' },
  packages: [
    { x: 706,  y: 266,  name: 'Package — north market' },
    { x: 1506, y: 946,  name: 'Package — midtown' },
    { x: 2158, y: 1144, name: 'Package — east docks' },
  ],
};

const ROOF_COLORS = ['#b5654a', '#c98a5a', '#8a7f72', '#a34d5e', '#5e7a86', '#d0a35f', '#7a6a9a', '#4f7a6a'];
const CAR_COLORS = ['#c94f42', '#3f6fb5', '#e0a83c', '#4da35f', '#8a8f98', '#e5e0d5', '#7a4a8c', '#2f8f86'];

export function buildWorld(rng) {
  const buildings = [];
  const blocks = [];
  const palms = [];
  const lots = [];

  // City blocks: the rectangles between neighbouring roads, north of the promenade.
  for (let i = 0; i < WORLD.VX.length - 1; i++) {
    for (let j = 0; j < WORLD.HY.length - 1; j++) {
      const x0 = WORLD.VX[i] + WORLD.ROAD_HALF + 14;
      const x1 = WORLD.VX[i + 1] - WORLD.ROAD_HALF - 14;
      const y0 = WORLD.HY[j] + WORLD.ROAD_HALF + 14;
      const y1 = WORLD.HY[j + 1] - WORLD.ROAD_HALF - 14;
      const roll = rng.next();
      if (roll < 0.14) { lots.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind: 'park' }); continue; }
      if (roll < 0.26) { lots.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0, kind: 'lot' }); continue; }
      // A built block is solid from its kerb line inward: the whole rectangle between
      // the roads collides, not just the rooftops drawn inside it. The pavement strip
      // between a road's edge and the first building face is narrower than a car, so
      // letting cars nose into it only ever wedges them against a wall; parks and
      // parking lots stay open ground a car can cut across.
      blocks.push({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 });
      // Buildings: a 2x2 plot split, each plot usually built on.
      const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
      const plots = [
        { x: x0, y: y0, w: mx - x0, h: my - y0 }, { x: mx, y: y0, w: x1 - mx, h: my - y0 },
        { x: x0, y: my, w: mx - x0, h: y1 - my }, { x: mx, y: my, w: x1 - mx, h: y1 - my },
      ];
      for (const p of plots) {
        if (rng.chance(0.18)) continue;
        const inset = rng.range(7, 13);
        buildings.push({
          x: p.x + inset, y: p.y + inset, w: p.w - inset * 2, h: p.h - inset * 2,
          color: rng.pick(ROOF_COLORS), trim: rng.pick(ROOF_COLORS),
        });
      }
      if (rng.chance(0.7)) palms.push({ x: x0 + 8, y: y0 + 8 });
      if (rng.chance(0.7)) palms.push({ x: x1 - 8, y: y1 - 8 });
    }
  }

  // Palms along the promenade, jittered off a regular spacing.
  for (let x = 60; x < WORLD.W - 40; x += 88) {
    if (Math.abs(x - WORLD.PIER.x - WORLD.PIER.w / 2) < 60) continue;
    palms.push({ x: x + rng.range(-14, 14), y: WORLD.SAND_Y - 12 + rng.range(-4, 4) });
  }

  // Parked cars: hugging the kerbs of the vertical avenues and the cross streets,
  // never across an intersection, never on top of a point of interest. The kerb line
  // sits 37px off the centre, so a car driving the centre of its road clears a parked
  // car's mirror with room to spare.
  const parked = [];
  const poiList = Object.values(POIS).flatMap((p) => (Array.isArray(p) ? p : [p]));
  const clearOfPoi = (x, y) => poiList.every((p) => Math.hypot(p.x - x, p.y - y) > 78);
  for (const vx of WORLD.VX) {
    for (let y = 90; y < WORLD.SAND_Y - 60; y += rng.range(135, 195)) {
      if (WORLD.HY.some((hy) => Math.abs(y - hy) < 84)) continue;
      const side = rng.chance(0.5) ? -1 : 1;
      const x = vx + side * 37;
      if (clearOfPoi(x, y)) parked.push({ x, y, angle: side > 0 ? Math.PI / 2 : -Math.PI / 2, color: rng.pick(CAR_COLORS) });
    }
  }
  for (const hy of WORLD.HY) {
    for (let x = 90; x < WORLD.W - 60; x += rng.range(150, 215)) {
      if (WORLD.VX.some((vx) => Math.abs(x - vx) < 84)) continue;
      const side = rng.chance(0.5) ? -1 : 1;
      const y = hy + side * 37;
      if (clearOfPoi(x, y)) parked.push({ x, y, angle: side > 0 ? 0 : Math.PI, color: rng.pick(CAR_COLORS) });
    }
  }

  return { buildings, blocks, palms, lots, parked };
}

// What is under a point: 'road', 'land', 'sand', 'pier' or 'water'. Cars and walkers
// are blocked by water (off the pier) and slowed by sand.
export function surfaceAt(x, y) {
  const p = WORLD.PIER;
  if (x >= p.x && x <= p.x + p.w && y >= p.y && y <= p.y + p.h) return 'pier';
  if (y >= WORLD.WATER_Y) return 'water';
  if (y >= WORLD.SAND_Y) return 'sand';
  for (const vx of WORLD.VX) if (Math.abs(x - vx) <= WORLD.ROAD_HALF) return 'road';
  for (const hy of WORLD.HY) if (Math.abs(y - hy) <= WORLD.ROAD_HALF) return 'road';
  return 'land';
}

// Push a circle out of every built block and the world edge, and keep it out of the
// sea (the pier is the one dry way over the water). Returns the corrected [x, y].
// Collision uses the block rectangles, whose faces sit on the kerb lines, so a car
// sliding off a road stops at the pavement's edge instead of wedging into the strip
// between the kerb and a building face.
export function resolveCircle(world, x, y, r) {
  x = clamp(x, r + 4, WORLD.W - r - 4);
  y = clamp(y, r + 4, WORLD.H - r - 4);
  if (surfaceAt(x, y) === 'water') y = WORLD.WATER_Y - r - 1;
  for (const b of world.blocks || world.buildings) {
    const nx = clamp(x, b.x, b.x + b.w);
    const ny = clamp(y, b.y, b.y + b.h);
    const dx = x - nx, dy = y - ny;
    const d2 = dx * dx + dy * dy;
    if (d2 >= r * r) continue;
    if (d2 > 0.0001) {
      const d = Math.sqrt(d2);
      x = nx + (dx / d) * r;
      y = ny + (dy / d) * r;
    } else {
      // Centre inside the building: leave by the nearest face.
      const left = x - b.x, right = b.x + b.w - x, top = y - b.y, bottom = b.y + b.h - y;
      const m = Math.min(left, right, top, bottom);
      if (m === left) x = b.x - r; else if (m === right) x = b.x + b.w + r;
      else if (m === top) y = b.y - r; else y = b.y + b.h + r;
    }
  }
  return [x, y];
}

// --- the static ground layer, painted once onto its own canvas ---------------------

export function paintWorld(world) {
  const c = document.createElement('canvas');
  c.width = WORLD.W; c.height = WORLD.H;
  const g = c.getContext('2d');

  g.fillStyle = '#20657f'; g.fillRect(0, 0, WORLD.W, WORLD.H);                    // the sea
  g.fillStyle = '#2b7d99'; g.fillRect(0, WORLD.WATER_Y + 60, WORLD.W, WORLD.H - WORLD.WATER_Y - 60);
  g.fillStyle = '#8f8a7c'; g.fillRect(0, 0, WORLD.W, WORLD.WATER_Y);             // city ground
  g.fillStyle = '#dec287'; g.fillRect(0, WORLD.SAND_Y, WORLD.W, WORLD.WATER_Y - WORLD.SAND_Y); // beach

  for (const lot of world.lots) {
    g.fillStyle = lot.kind === 'park' ? '#5d8a4a' : '#7c7668';
    g.fillRect(lot.x - 6, lot.y - 6, lot.w + 12, lot.h + 12);
  }

  // Roads: asphalt, kerb lines, dashed centres, crosswalks at the junctions.
  g.fillStyle = '#3a3d43';
  for (const vx of WORLD.VX) g.fillRect(vx - WORLD.ROAD_HALF, 0, WORLD.ROAD_HALF * 2, WORLD.SAND_Y + 20);
  for (const hy of WORLD.HY) g.fillRect(0, hy - WORLD.ROAD_HALF, WORLD.W, WORLD.ROAD_HALF * 2);
  g.strokeStyle = 'rgba(240,235,220,0.5)'; g.lineWidth = 2; g.setLineDash([16, 14]);
  for (const vx of WORLD.VX) { g.beginPath(); g.moveTo(vx, 0); g.lineTo(vx, WORLD.SAND_Y + 20); g.stroke(); }
  for (const hy of WORLD.HY) { g.beginPath(); g.moveTo(0, hy); g.lineTo(WORLD.W, hy); g.stroke(); }
  g.setLineDash([]);
  g.fillStyle = 'rgba(240,235,220,0.55)';
  for (const vx of WORLD.VX) for (const hy of WORLD.HY) {
    for (let i = -3; i <= 3; i++) g.fillRect(vx + i * 12 - 3, hy - WORLD.ROAD_HALF + 3, 6, 10);
  }

  // The pier: planks over the water.
  const p = WORLD.PIER;
  g.fillStyle = '#8a6a44'; g.fillRect(p.x, p.y, p.w, p.h);
  g.strokeStyle = 'rgba(60,40,20,0.5)'; g.lineWidth = 1;
  for (let y = p.y + 8; y < p.y + p.h; y += 12) { g.beginPath(); g.moveTo(p.x, y); g.lineTo(p.x + p.w, y); g.stroke(); }

  // Buildings: a soft shadow, the roof, a parapet line and a roof detail.
  for (const b of world.buildings) {
    g.fillStyle = 'rgba(20,16,8,0.28)'; g.fillRect(b.x + 7, b.y + 9, b.w, b.h);
    g.fillStyle = b.color; g.fillRect(b.x, b.y, b.w, b.h);
    g.strokeStyle = 'rgba(30,20,10,0.45)'; g.lineWidth = 2; g.strokeRect(b.x + 1, b.y + 1, b.w - 2, b.h - 2);
    g.fillStyle = b.trim; g.fillRect(b.x + b.w * 0.18, b.y + b.h * 0.18, b.w * 0.3, b.h * 0.3);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(b.x + 4, b.y + 4, b.w - 8, 5);
  }

  // Palms: a curved trunk and a fan of fronds.
  for (const palm of world.palms) {
    g.strokeStyle = '#7a5c38'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(palm.x, palm.y); g.quadraticCurveTo(palm.x + 3, palm.y - 7, palm.x + 6, palm.y - 12); g.stroke();
    g.strokeStyle = '#3f7d3a'; g.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + palm.x * 0.01;
      g.beginPath(); g.moveTo(palm.x + 6, palm.y - 12);
      g.quadraticCurveTo(palm.x + 6 + Math.cos(a) * 9, palm.y - 12 + Math.sin(a) * 5 - 3, palm.x + 6 + Math.cos(a) * 14, palm.y - 12 + Math.sin(a) * 8 + 3);
      g.stroke();
    }
  }
  return c;
}
