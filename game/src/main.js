// Sunset Bay: an original top-down 2D open-world crime game. This module owns the game
// state and the frame: a fixed-timestep step (input, physics, police, wanted, missions)
// and a canvas render (world, marks, actors, HUD, minimap). It also stages the three
// deterministic screenshot scenes behind ?shot=title|drive|mission and sets
// window.__shotReady when one is painted, the kit's screenshot protocol.

import { makeRng, clamp, angleDelta, dist } from './rng.js';
import { initInput, key, anyKey, tapped } from './input.js';
import { WORLD, POIS, buildWorld, paintWorld, surfaceAt, resolveCircle } from './world.js';
import { makeCar, stepCar, collideCars, drawCar, makePed, stepPed, drawPed, drawPlayer, policeControls, speedMag } from './actors.js';
import { Missions } from './missions.js';

const VIEW_W = 960, VIEW_H = 540;
const STEP = 1 / 60;

function createGame(seed) {
  const rng = makeRng(seed);
  const world = buildWorld(rng);
  const game = {
    rng, world, t: 0, state: 'title',
    cash: 0, day: 1, minutes: 8 * 60,
    wanted: 0, lastCrimeT: -99, cooldownT: 0, bust: 0, policeSpawnT: 0,
    player: { x: POIS.home.x, y: POIS.home.y, angle: 0, car: null, moving: false, speed: 0 },
    cars: [], police: [], peds: [], particles: [], skids: [],
    bannerQ: [], overlayT: 0, cam: { x: POIS.home.x, y: POIS.home.y },
    trafficT: 0,
  };
  const skidLast = new Map();

  // The player's own car, parked by the coast road at home. Every other civilian car
  // in the bay is somebody else's: taking one is a crime, once per car.
  const own = makeCar(392, 1196, 0, '#2f8f86');
  own.own = true;
  game.cars.push(own);
  for (const spec of world.parked) game.cars.push(makeCar(spec.x, spec.y, spec.angle, spec.color));
  for (let i = 0; i < 16; i++) {
    let x = 0, y = 0, ok = false;
    for (let k = 0; k < 20 && !ok; k++) {
      x = rng.range(120, WORLD.W - 120); y = rng.range(120, 1280);
      ok = surfaceAt(x, y) !== 'water' && !world.buildings.some((b) => x > b.x - 10 && x < b.x + b.w + 10 && y > b.y - 10 && y < b.y + b.h + 10);
    }
    game.peds.push(makePed(rng, x, y));
  }
  // Three ambient drivers looping the grid, so the streets are alive.
  const trafficRoutes = [
    [{ x: 650, y: 210 }, { x: 650, y: 1190 }, { x: 1850, y: 1190 }, { x: 1850, y: 210 }],
    [{ x: 2210, y: 550 }, { x: 250, y: 550 }, { x: 250, y: 890 }, { x: 2210, y: 890 }],
    [{ x: 1050, y: 1190 }, { x: 1050, y: 210 }, { x: 1450, y: 210 }, { x: 1450, y: 1190 }],
  ];
  game.traffic = trafficRoutes.map((route, i) => {
    const car = makeCar(route[0].x, route[0].y, 0, ['#8a8f98', '#c98a5a', '#5e7a86'][i]);
    car.driver = 'traffic';
    car.route = route; car.wp = 1;
    game.cars.push(car);
    return car;
  });

  game.playerPos = () => (game.player.car ? { x: game.player.car.x, y: game.player.car.y } : { x: game.player.x, y: game.player.y });
  game.pay = (n) => { game.cash += n; };
  game.addCrime = (n) => {
    const before = game.wanted;
    game.wanted = clamp(game.wanted + n, 0, 5);
    game.lastCrimeT = game.t;
    game.cooldownT = 0;
    if (game.wanted > before) game.banner('Wanted', `${game.wanted} star${game.wanted > 1 ? 's' : ''} — the bay is watching`);
  };
  game.setWantedAtLeast = (n) => { if (game.wanted < n) { game.wanted = n; game.lastCrimeT = game.t; } };
  game.banner = (title, sub) => { game.bannerQ.push({ title, sub, t: 0 }); if (game.bannerQ.length > 2) game.bannerQ.shift(); };
  game.sparkle = (x, y) => {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      game.particles.push({ x, y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 20, life: 0.55, max: 0.55, color: '#ffd23e', size: 2.4 });
    }
  };
  game.addCar = (car) => game.cars.push(car);
  game.removeCar = (car) => { game.cars = game.cars.filter((c) => c !== car); };
  game.dayComplete = () => { game.state = 'complete'; game.overlayT = 0; };

  game.carFx = (car) => {
    let n = 0;
    return {
      skid: (x, y) => {
        const k = car.id + ':' + (n++ % 2);
        const last = skidLast.get(k);
        if (last && dist(last.x, last.y, x, y) < 34) {
          game.skids.push({ x1: last.x, y1: last.y, x2: x, y2: y, life: 9 });
          if (game.skids.length > 850) game.skids.splice(0, game.skids.length - 850);
        }
        skidLast.set(k, { x, y });
      },
      bump: () => {
        for (let i = 0; i < 3; i++) game.particles.push({ x: car.x, y: car.y, vx: game.rng.range(-30, 30), vy: game.rng.range(-30, 30), life: 0.3, max: 0.3, color: '#cbbf9e', size: 2 });
      },
    };
  };

  game.missions = new Missions(game);
  return game;
}

// --- stepping ---------------------------------------------------------------------

function playerControls() {
  return {
    throttle: (anyKey('KeyW', 'ArrowUp') ? 1 : 0) + (anyKey('KeyS', 'ArrowDown') ? -1 : 0),
    steer: (anyKey('KeyD', 'ArrowRight') ? 1 : 0) + (anyKey('KeyA', 'ArrowLeft') ? -1 : 0),
    handbrake: key('Space'),
  };
}

function stepGame(game, dt) {
  game.t += dt;
  game.minutes += dt * 2; // two game-minutes a second: a long day, not a real one
  if (game.minutes >= 24 * 60) { game.minutes -= 24 * 60; game.day++; }
  const player = game.player;
  const world = game.world;

  // Banners age out.
  for (const b of game.bannerQ) b.t += dt;
  game.bannerQ = game.bannerQ.filter((b) => b.t < 3.4);

  // The player, on foot or driving.
  if (player.car) {
    const car = player.car;
    stepCar(world, car, playerControls(), dt, game.carFx(car));
    player.x = car.x; player.y = car.y; player.angle = car.angle;
    player.speed = speedMag(car);
    if (tapped('KeyE') && player.speed < 30) {
      car.driver = null;
      player.car = null;
      const side = car.angle + Math.PI / 2;
      player.x = car.x + Math.cos(side) * 26;
      player.y = car.y + Math.sin(side) * 26;
      const [rx, ry] = resolveCircle(world, player.x, player.y, 9);
      player.x = rx; player.y = ry;
    }
  } else {
    const mx = (anyKey('KeyD', 'ArrowRight') ? 1 : 0) - (anyKey('KeyA', 'ArrowLeft') ? 1 : 0);
    const my = (anyKey('KeyS', 'ArrowDown') ? 1 : 0) - (anyKey('KeyW', 'ArrowUp') ? 1 : 0);
    player.moving = mx !== 0 || my !== 0;
    const spd = surfaceAt(player.x, player.y) === 'sand' ? 118 : 178;
    player.speed = player.moving ? spd : 0;
    if (player.moving) {
      player.angle = Math.atan2(my, mx);
      const len = Math.hypot(mx, my);
      player.x += (mx / len) * spd * dt;
      player.y += (my / len) * spd * dt;
      const [rx, ry] = resolveCircle(world, player.x, player.y, 9);
      player.x = rx; player.y = ry;
    }
    if (tapped('KeyE')) {
      let best = null, bestD = 50;
      for (const car of game.cars) {
        if (car.kind !== 'civilian' || car.driver) continue;
        const d = dist(player.x, player.y, car.x, car.y);
        if (d < bestD) { best = car; bestD = d; }
      }
      if (best) {
        player.car = best;
        best.driver = 'player';
        if (!best.own && !best.stolen) {
          best.stolen = true;
          game.banner('Car stolen', 'Somebody saw that');
          game.addCrime(1);
        }
      }
    }
  }

  // Traffic follows its loop, and backs out when it wedges — a traffic car frozen
  // against a wall forever would block the road for everyone, the mark included.
  for (const car of game.traffic) {
    const wp = car.route[car.wp % car.route.length];
    if (dist(car.x, car.y, wp.x, wp.y) < 55) car.wp++;
    const want = Math.atan2(wp.y - car.y, wp.x - car.x);
    const speed = Math.abs(car.fSpeed || 0);
    if (car.reverseT > 0) {
      car.reverseT -= dt;
      stepCar(world, car, { throttle: -1, steer: clamp(angleDelta(car.angle, want) * -2, -1, 1), handbrake: false }, dt, null);
      continue;
    }
    if (speed < 12) car.stuckT += dt; else car.stuckT = 0;
    if (car.stuckT > 1.2) { car.stuckT = 0; car.reverseT = 0.7; }
    stepCar(world, car, { throttle: speed < 195 ? 1 : 0, steer: clamp(angleDelta(car.angle, want) * 2.2, -1, 1), handbrake: false }, dt, null);
  }

  stepWanted(game, dt);

  // Pedestrians, and the one crime the bay never forgives quietly.
  const threats = game.cars.filter((c) => c.driver === 'player' || c.kind === 'police').map((c) => ({ x: c.x, y: c.y, speed: speedMag(c) }));
  for (const ped of game.peds) stepPed(world, game.rng, ped, dt, threats);
  if (player.car && player.speed > 118) {
    for (const ped of game.peds) {
      if (ped.state !== 'fallen' && dist(player.car.x, player.car.y, ped.x, ped.y) < 19) {
        ped.state = 'fallen'; ped.fallenT = 4;
        game.banner('Pedestrian down', 'That was seen');
        game.addCrime(1);
        for (let i = 0; i < 8; i++) game.particles.push({ x: ped.x, y: ped.y, vx: game.rng.range(-70, 70), vy: game.rng.range(-70, 70), life: 0.4, max: 0.4, color: '#d9d2c2', size: 2.2 });
      }
    }
  }

  // Cars push each other; parked ones get nudged, then settled out of the walls.
  const cars = game.cars;
  for (let i = 0; i < cars.length; i++) for (let j = i + 1; j < cars.length; j++) {
    const a = cars[i], b = cars[j];
    if (Math.abs(a.x - b.x) > 34 || Math.abs(a.y - b.y) > 34) continue;
    collideCars(a, b);
  }

  game.missions.update(dt);

  // Skid marks fade; particles burn out.
  for (const s of game.skids) s.life -= dt;
  game.skids = game.skids.filter((s) => s.life > 0);
  for (const p of game.particles) { p.life -= dt; p.x += p.vx * dt; p.y += p.vy * dt; p.vy += 60 * dt; }
  game.particles = game.particles.filter((p) => p.life > 0);

  // Camera follows, clamped to the world.
  const pos = game.playerPos();
  const k = 1 - Math.exp(-7 * dt);
  game.cam.x += (pos.x - game.cam.x) * k;
  game.cam.y += (pos.y - game.cam.y) * k;
  game.cam.x = clamp(game.cam.x, VIEW_W / 2, WORLD.W - VIEW_W / 2);
  game.cam.y = clamp(game.cam.y, VIEW_H / 2, WORLD.H - VIEW_H / 2);
}

function stepWanted(game, dt) {
  const player = game.player;
  const pos = game.playerPos();
  const world = game.world;

  if (game.wanted > 0) {
    game.policeSpawnT -= dt;
    const wantedCount = Math.min(game.wanted + 1, 4);
    if (game.police.length < wantedCount && game.policeSpawnT <= 0) {
      game.policeSpawnT = 2.2;
      const a = game.rng.range(0, Math.PI * 2);
      let x = clamp(pos.x + Math.cos(a) * 680, 40, WORLD.W - 40);
      let y = clamp(pos.y + Math.sin(a) * 680, 40, WORLD.H - 40);
      const [rx, ry] = resolveCircle(world, x, y, 16);
      const car = makeCar(rx, ry, Math.atan2(pos.y - ry, pos.x - rx), '#e8e8ea', 'police');
      car.driver = 'police';
      game.police.push(car);
      game.cars.push(car);
    }
  }

  const mySpeed = player.car ? speedMag(player.car) : player.speed;
  for (const car of [...game.police]) {
    if (game.wanted === 0) {
      // Heat's off: they head for the horizon and are gone.
      const exit = { x: car.x < WORLD.W / 2 ? -60 : WORLD.W + 60, y: car.y };
      const ctl = policeControls(car, { x: exit.x, y: exit.y, speed: 300 }, dt);
      stepCar(world, car, { ...ctl, throttle: 1 }, dt, null);
      if (dist(car.x, car.y, pos.x, pos.y) > 860 || car.x < 20 || car.x > WORLD.W - 20) {
        game.removeCar(car);
        game.police = game.police.filter((c) => c !== car);
      }
      continue;
    }
    const ctl = policeControls(car, { x: pos.x, y: pos.y, speed: mySpeed }, dt);
    stepCar(world, car, ctl, dt, game.carFx(car));
  }

  // Cooling off: no fresh crime and nobody close enough to see you, for a while.
  // Four hundred pixels — a few blocks of clear road — is enough of a head start to
  // count as slipped; ask for much more and a tail can never be shaken at all.
  const seen = game.police.some((c) => dist(c.x, c.y, pos.x, pos.y) < 400);
  if (game.wanted > 0 && game.t - game.lastCrimeT > 9 && !seen) {
    game.cooldownT += dt;
    if (game.cooldownT >= 6) {
      game.wanted--;
      game.cooldownT = 0;
      if (game.wanted === 0) game.banner('Heat lost', 'The bay forgets — for now');
    }
  } else game.cooldownT = Math.max(0, game.cooldownT - dt * 2);

  // The bust meter: cornered, slow, and surrounded is how a day ends early. It
  // takes a sustained 4.5s of it — long enough to break one clinch, short enough
  // that a real box still ends the day. (At 2.8s, any two-car grapple was a
  // sentence, however well it was driven out of.)
  const cornered = game.wanted > 0 && mySpeed < 45 && game.police.some((c) => dist(c.x, c.y, pos.x, pos.y) < 95);
  game.bust = clamp(game.bust + (cornered ? dt / 4.5 : -dt / 1.6), 0, 1);
  if (game.bust >= 1) doBusted(game);
}

function doBusted(game) {
  const fine = 100 + 150 * game.wanted;
  game.cash = Math.max(0, game.cash - fine);
  game.bustedFine = fine;
  game.state = 'busted';
  game.overlayT = 0;
  game.wanted = 0;
  game.bust = 0;
  for (const car of game.police) game.removeCar(car);
  game.police = [];
  if (game.player.car) { game.player.car.driver = null; game.player.car = null; }
  game.player.x = POIS.home.x; game.player.y = POIS.home.y;
  game.cam.x = game.player.x; game.cam.y = game.player.y;
  game.day++;
  game.minutes = 8 * 60;
  const m = game.missions;
  if (m.idx === 1 && m.stage === 'deliver') m.stage = 'pickup';
  if (m.idx === 2 && m.targetCar) { game.removeCar(m.targetCar); m.targetCar = null; }
  // A bust is not a getaway: if the heat was shaken only because the day ended in
  // handcuffs, the last job has to be run again from the hideout door.
  if (m.idx === 4 && m.stage === 'evade') m.stage = 'reach';
}

// --- rendering ----------------------------------------------------------------------

let groundCache = null;

function draw(g, game) {
  if (!groundCache) groundCache = paintWorld(game.world);
  const camX = Math.round(game.cam.x - VIEW_W / 2), camY = Math.round(game.cam.y - VIEW_H / 2);
  g.fillStyle = '#20657f';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.drawImage(groundCache, camX, camY, VIEW_W, VIEW_H, 0, 0, VIEW_W, VIEW_H);

  g.save();
  g.translate(-camX, -camY);

  g.strokeStyle = 'rgba(22,20,18,0.5)';
  g.lineWidth = 3.4;
  g.beginPath();
  for (const s of game.skids) { g.moveTo(s.x1, s.y1); g.lineTo(s.x2, s.y2); }
  g.stroke();

  if (game.state !== 'title') drawObjectiveMarker(g, game);

  const parked = game.cars.filter((c) => !c.driver && c.kind === 'civilian');
  const driven = game.cars.filter((c) => c.driver || c.kind !== 'civilian');
  for (const car of parked) drawCar(g, car, game.t);
  for (const ped of game.peds) drawPed(g, ped, game.t);
  for (const car of driven) drawCar(g, car, game.t);
  if (!game.player.car) drawPlayer(g, game.player, game.t);

  for (const p of game.particles) {
    g.globalAlpha = clamp(p.life / p.max, 0, 1);
    g.fillStyle = p.color;
    g.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  g.globalAlpha = 1;
  g.restore();

  drawSunsetTint(g, game);
  if (game.state === 'title') drawTitle(g, game);
  else {
    drawHud(g, game);
    if (game.state === 'busted') drawBusted(g, game);
    if (game.state === 'complete') drawComplete(g, game);
  }
}

function drawObjectiveMarker(g, game) {
  const obj = game.missions.objective();
  const t = game.t;
  if (game.missions.idx === 3 && game.missions.stage === 'collect') {
    for (const p of game.missions.packages) if (!p.taken) drawMarkerAt(g, p.x, p.y, t, '#ffd23e');
  }
  if (obj.marker) {
    drawMarkerAt(g, obj.marker.x, obj.marker.y, t, '#ffd23e');
    // A route line from the player to the marker: the bay is big, the job is timed.
    const pos = game.playerPos();
    g.strokeStyle = 'rgba(255,210,62,0.4)';
    g.lineWidth = 2.5;
    g.setLineDash([10, 9]);
    g.beginPath(); g.moveTo(pos.x, pos.y); g.lineTo(obj.marker.x, obj.marker.y); g.stroke();
    g.setLineDash([]);
  }
}

function drawMarkerAt(g, x, y, t, color) {
  const pulse = 1 + Math.sin(t * 4.2) * 0.16;
  g.strokeStyle = color;
  g.lineWidth = 3;
  g.beginPath(); g.arc(x, y, 26 * pulse, 0, Math.PI * 2); g.stroke();
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, 6, 0, Math.PI * 2); g.fill();
  g.fillStyle = 'rgba(255,210,62,0.16)';
  g.beginPath(); g.moveTo(x - 9, y - 120); g.lineTo(x + 9, y - 120); g.lineTo(x, y); g.closePath(); g.fill();
}

function drawSunsetTint(g, game) {
  const h = game.minutes / 60;
  const dusk = clamp(1 - Math.abs(h - 13) / 6, 0, 1); // warmest away from midday
  g.fillStyle = `rgba(255,120,50,${(0.05 + dusk * 0.05).toFixed(3)})`;
  g.fillRect(0, 0, VIEW_W, VIEW_H);
}

function panel(g, x, y, w, h) {
  g.fillStyle = 'rgba(10,14,20,0.62)';
  g.beginPath(); g.roundRect(x, y, w, h, 8); g.fill();
}

function drawHud(g, game) {
  const obj = game.missions.objective();
  const pos = game.playerPos();

  panel(g, 12, 12, 196, 58);
  g.fillStyle = '#ffd23e';
  g.font = '700 25px "Avenir Next", "Segoe UI", sans-serif';
  g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillText(`$${game.cash.toLocaleString('en-US')}`, 24, 40);
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.font = '500 13.5px "Avenir Next", "Segoe UI", sans-serif';
  const hh = String(Math.floor(game.minutes / 60)).padStart(2, '0');
  const mm = String(Math.floor(game.minutes % 60)).padStart(2, '0');
  g.fillText(`Day ${game.day} · ${hh}:${mm}`, 24, 61);

  // Wanted stars, top right.
  if (game.wanted > 0) {
    panel(g, VIEW_W - 168, 12, 156, 40);
    g.font = '21px sans-serif';
    g.textAlign = 'center';
    for (let i = 0; i < 5; i++) {
      g.fillStyle = i < game.wanted ? '#ffd23e' : 'rgba(255,255,255,0.22)';
      g.fillText('★', VIEW_W - 138 + i * 27, 41);
    }
  }

  // Objective, top centre, with the distance to run.
  const text = obj.marker ? `${obj.text} · ${Math.round(dist(pos.x, pos.y, obj.marker.x, obj.marker.y) / 10)}m` : obj.text;
  g.font = '600 15.5px "Avenir Next", "Segoe UI", sans-serif';
  const w = Math.min(560, g.measureText(text).width + 34);
  panel(g, (VIEW_W - w) / 2, 12, w, 36);
  g.fillStyle = '#fff';
  g.textAlign = 'center';
  g.fillText(text, VIEW_W / 2, 36);
  if (game.missions.hud) {
    const { label, frac } = game.missions.hud;
    panel(g, (VIEW_W - 240) / 2, 54, 240, 16);
    g.fillStyle = '#ffd23e';
    g.beginPath(); g.roundRect((VIEW_W - 240) / 2 + 3, 57, 234 * clamp(frac, 0, 1), 10, 5); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.8)';
    g.font = '600 10.5px sans-serif';
    g.fillText(label.toUpperCase(), VIEW_W / 2, 79);
  }

  // Banners: the fixer's word and the bay's reactions.
  let by = 92;
  for (const b of game.bannerQ) {
    const a = b.t < 0.3 ? b.t / 0.3 : b.t > 2.8 ? Math.max(0, (3.4 - b.t) / 0.6) : 1;
    g.globalAlpha = a;
    g.font = '700 19px "Avenir Next", "Segoe UI", sans-serif';
    const bw = Math.max(g.measureText(b.title).width, g.measureText(b.sub || '').width) + 44;
    panel(g, (VIEW_W - bw) / 2, by, bw, b.sub ? 52 : 34);
    g.fillStyle = '#ffd23e'; g.textAlign = 'center';
    g.fillText(b.title, VIEW_W / 2, by + 24);
    if (b.sub) { g.fillStyle = 'rgba(255,255,255,0.88)'; g.font = '500 13.5px "Avenir Next", "Segoe UI", sans-serif'; g.fillText(b.sub, VIEW_W / 2, by + 43); }
    g.globalAlpha = 1;
    by += (b.sub ? 58 : 40);
  }

  if (game.bust > 0.02) {
    panel(g, (VIEW_W - 260) / 2, VIEW_H - 92, 260, 34);
    g.fillStyle = '#ff5a3c';
    g.beginPath(); g.roundRect((VIEW_W - 260) / 2 + 4, VIEW_H - 88, 252 * game.bust, 12, 6); g.fill();
    g.fillStyle = '#fff'; g.font = '700 12.5px sans-serif'; g.textAlign = 'center';
    g.fillText('BUSTED', VIEW_W / 2, VIEW_H - 44);
  }

  drawMinimap(g, game, obj);
}

function drawMinimap(g, game, obj) {
  const MW = 196, MH = 132, x0 = VIEW_W - MW - 12, y0 = VIEW_H - MH - 12;
  const sx = MW / WORLD.W, sy = MH / WORLD.H;
  panel(g, x0 - 4, y0 - 4, MW + 8, MH + 8);
  g.fillStyle = '#274b3a';
  g.fillRect(x0, y0, MW, MH * (WORLD.WATER_Y / WORLD.H));
  g.fillStyle = '#dec287';
  g.fillRect(x0, y0 + WORLD.SAND_Y * sy, MW, (WORLD.WATER_Y - WORLD.SAND_Y) * sy);
  g.fillStyle = '#20657f';
  g.fillRect(x0, y0 + WORLD.WATER_Y * sy, MW, MH * (1 - WORLD.WATER_Y / WORLD.H));
  g.strokeStyle = 'rgba(230,228,220,0.65)';
  g.lineWidth = 1.4;
  for (const vx of WORLD.VX) { g.beginPath(); g.moveTo(x0 + vx * sx, y0); g.lineTo(x0 + vx * sx, y0 + WORLD.SAND_Y * sy); g.stroke(); }
  for (const hy of WORLD.HY) { g.beginPath(); g.moveTo(x0, y0 + hy * sy); g.lineTo(x0 + MW, y0 + hy * sy); g.stroke(); }

  if (obj.marker) {
    g.fillStyle = '#ffd23e';
    g.beginPath(); g.arc(x0 + obj.marker.x * sx, y0 + obj.marker.y * sy, 3.4 + Math.sin(game.t * 4.2) * 0.8, 0, Math.PI * 2); g.fill();
  }
  for (const car of game.police) {
    g.fillStyle = Math.sin(game.t * 10) > 0 ? '#ff4b3e' : '#4b7dff';
    g.fillRect(x0 + car.x * sx - 2, y0 + car.y * sy - 2, 4, 4);
  }
  const pos = game.playerPos();
  const ang = game.player.car ? game.player.car.angle : game.player.angle;
  g.save();
  g.translate(x0 + pos.x * sx, y0 + pos.y * sy);
  g.rotate(ang);
  g.fillStyle = '#fff';
  g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -3.6); g.lineTo(-4, 3.6); g.closePath(); g.fill();
  g.restore();
}

function drawTitle(g, game) {
  const grad = g.createLinearGradient(0, 0, 0, VIEW_H);
  grad.addColorStop(0, 'rgba(16,18,44,0.66)');
  grad.addColorStop(0.55, 'rgba(70,26,54,0.42)');
  grad.addColorStop(1, 'rgba(255,110,48,0.30)');
  g.fillStyle = grad;
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.textAlign = 'center';
  g.fillStyle = '#ffd23e';
  g.font = '800 84px "Avenir Next", "Segoe UI", sans-serif';
  g.fillText('SUNSET BAY', VIEW_W / 2, 208);
  g.fillStyle = '#fff';
  g.font = '600 21px "Avenir Next", "Segoe UI", sans-serif';
  g.fillText('A tiny open-world crime game', VIEW_W / 2, 246);
  g.font = '500 16.5px "Avenir Next", "Segoe UI", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.92)';
  g.fillText('Five jobs from the fixer. $9,500 by sundown. Try not to get caught.', VIEW_W / 2, 300);
  g.fillText('Walk, steal, drive — the bay is watching.', VIEW_W / 2, 326);
  g.font = '700 18px "Avenir Next", "Segoe UI", sans-serif';
  g.fillStyle = Math.sin(game.t * 3) > -0.3 ? '#ffd23e' : 'rgba(255,210,62,0.35)';
  g.fillText('Press Enter to play', VIEW_W / 2, 396);
  g.font = '500 13.5px "Avenir Next", "Segoe UI", sans-serif';
  g.fillStyle = 'rgba(255,255,255,0.75)';
  g.fillText('WASD / arrows · E enter or exit a car · Space handbrake', VIEW_W / 2, 428);
}

function drawBusted(g, game) {
  g.fillStyle = 'rgba(120,10,10,0.45)';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.textAlign = 'center';
  g.fillStyle = '#fff';
  g.font = '800 62px "Avenir Next", "Segoe UI", sans-serif';
  g.fillText('BUSTED', VIEW_W / 2, 240);
  g.font = '600 19px "Avenir Next", "Segoe UI", sans-serif';
  g.fillText(`The bay fines you $${(game.bustedFine || 0).toLocaleString('en-US')}. A new day dawns.`, VIEW_W / 2, 282);
  g.font = '500 15px "Avenir Next", "Segoe UI", sans-serif';
  g.fillText('Press Enter to carry on', VIEW_W / 2, 322);
}

function drawComplete(g, game) {
  g.fillStyle = 'rgba(12,30,20,0.55)';
  g.fillRect(0, 0, VIEW_W, VIEW_H);
  g.textAlign = 'center';
  g.fillStyle = '#ffd23e';
  g.font = '800 54px "Avenir Next", "Segoe UI", sans-serif';
  g.fillText('DAY COMPLETE', VIEW_W / 2, 226);
  g.fillStyle = '#fff';
  g.font = '600 20px "Avenir Next", "Segoe UI", sans-serif';
  g.fillText(`All five jobs done — $${game.cash.toLocaleString('en-US')} in your pocket.`, VIEW_W / 2, 268);
  g.font = '500 15.5px "Avenir Next", "Segoe UI", sans-serif';
  g.fillText('Press Enter to keep roaming Sunset Bay', VIEW_W / 2, 306);
}

// --- boot, staging, the loop ----------------------------------------------------------

function stageShot(game, shot) {
  const player = game.player;
  if (shot === 'title') {
    game.state = 'title';
    game.cam.x = 1560; game.cam.y = 1150;
    player.x = 1500; player.y = 1270; player.angle = -0.6;
    return;
  }
  game.state = 'play';
  if (shot === 'drive') {
    // A clean stretch of coast road for the cover drive: parked cars in the corridor
    // step aside, and the northbound traffic car starts further up its route.
    game.cars = game.cars.filter((c) => c.driver || c.own || !(c.x > 460 && c.x < 1580 && c.y > 1085 && c.y < 1295));
    game.traffic[2].x = 1050; game.traffic[2].y = 470;
    const car = game.cars[0];
    car.x = 1080; car.y = 1190; car.angle = Math.PI; car.vx = -235; car.vy = 0; car.driver = 'player';
    player.car = car;
    player.x = car.x; player.y = car.y;
    game.cam.x = car.x; game.cam.y = car.y;
    for (let i = 0; i < 55; i++) stepGame(game, STEP);
    return;
  }
  if (shot === 'mission') {
    game.cash = 400;
    game.missions.idx = 0;
    game.missions.stage = 'pickup';
    const car = game.cars[0];
    car.x = 1900; car.y = 300; car.angle = 0.5; car.vx = 120; car.vy = 40; car.driver = 'player';
    player.car = car;
    player.x = car.x; player.y = car.y;
    game.wanted = 1; game.lastCrimeT = game.t;
    const cop = makeCar(1768, 356, 0.4, '#e8e8ea', 'police');
    cop.driver = 'police';
    game.police.push(cop); game.cars.push(cop);
    game.cam.x = car.x; game.cam.y = car.y;
    for (let i = 0; i < 20; i++) stepGame(game, STEP);
  }
}

function boot() {
  const canvas = document.getElementById('game');
  const g = canvas.getContext('2d');
  const params = new URLSearchParams(location.search);
  const seed = Number.parseInt(params.get('seed') || '1', 10) || 1;
  const shot = params.get('shot');
  const game = createGame(seed);
  initInput(window);
  window.__game = game;

  if (shot) {
    stageShot(game, shot);
    let frames = 0;
    const paint = () => {
      draw(g, game);
      frames++;
      if (frames >= 3) { window.__shotReady = true; return; }
      requestAnimationFrame(paint);
    };
    requestAnimationFrame(paint);
    return;
  }

  let last = performance.now();
  let acc = 0;
  const frame = (now) => {
    acc += Math.min((now - last) / 1000, 0.1);
    last = now;
    while (acc >= STEP) {
      if (game.state === 'title') {
        game.t += STEP;
        if (tapped('Enter')) game.state = 'play';
      } else if (game.state === 'busted' || game.state === 'complete') {
        game.overlayT += STEP;
        if (tapped('Enter')) game.state = 'play';
      } else {
        stepGame(game, STEP);
      }
      acc -= STEP;
    }
    draw(g, game);
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}

boot();
