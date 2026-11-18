// The fixer's chain: five jobs that pay $400 + $900 + $1,800 + $2,400 + $4,000 = $9,500.
// A small state machine: each mission is a few stages, each stage an objective line, a
// marker in the world, and an arrival or a condition. The class talks to the game only
// through a narrow surface (playerPos, pay, addCrime, banner, spawnTarget) so the main
// loop stays in charge of physics and rendering.

import { POIS } from './world.js';
import { angleDelta, clamp, dist } from './rng.js';
import { makeCar, stepCar } from './actors.js';

const PAY = [400, 900, 1800, 2400, 4000];
const ARRIVE_R = 46;

export class Missions {
  constructor(game) {
    this.game = game;
    this.idx = 0;          // 0..4 in the chain, 5 = chain complete
    this.stage = 'meet';
    this.timer = 0;        // M2's delivery countdown
    this.tailProgress = 0; // M3: seconds spent inside the band
    this.tooCloseT = 0;
    this.lostT = 0;
    this.tailAcquired = false; // M3: has the player got eyes on the mark yet?
    this.targetCar = null;
    this.wpIndex = 0;
    this.packages = POIS.packages.map((p) => ({ ...p, taken: false }));
    this.hud = null;       // { label, frac } progress bar for the HUD, when a stage has one
  }

  get done() { return this.idx >= 5; }

  objective() {
    const g = this.game;
    const at = (poi, text) => ({ text, marker: poi });
    switch (this.idx) {
      case 0:
        if (this.stage === 'meet') return at(POIS.fixer, 'Meet the fixer at his corner');
        if (this.stage === 'pickup') return at(POIS.warehouse, 'Pick up the package at the warehouse');
        return at(POIS.dock, 'Deliver the package to the pier');
      case 1:
        if (this.stage === 'pickup') return at(POIS.cafe, 'Pick up the rush order at Café Lumen');
        return at(POIS.nwCorner, `Deliver across town — ${Math.max(0, Math.ceil(this.timer))}s left`);
      case 2:
        if (this.targetCar && !this.tailAcquired) return { text: 'Get eyes on the orange car', marker: { x: this.targetCar.x, y: this.targetCar.y, name: 'The mark' } };
        return { text: `Tail the orange car — stay in the band (${Math.floor(this.tailProgress)}/40s)`, marker: this.targetCar ? { x: this.targetCar.x, y: this.targetCar.y, name: 'The mark' } : POIS.tailStart };
      case 3: {
        if (this.stage === 'deliver') return at(POIS.fixer, 'Bring the packages back to the fixer');
        const left = this.packages.filter((p) => !p.taken);
        const pos = g.playerPos();
        left.sort((a, b) => dist(pos.x, pos.y, a.x, a.y) - dist(pos.x, pos.y, b.x, b.y));
        return { text: `Collect the packages (${this.packages.length - left.length}/3)`, marker: left[0] };
      }
      case 4:
        if (this.stage === 'reach') return at(POIS.hideout, 'Get to the hideout garage');
        return { text: 'You made it — now lose the heat', marker: null };
      default:
        return { text: 'Free roam — Sunset Bay is yours', marker: null };
    }
  }

  payAndNext(bannerText) {
    const g = this.game;
    g.pay(PAY[this.idx]);
    g.banner(bannerText, `+$${PAY[this.idx].toLocaleString('en-US')}`);
    this.idx++;
    this.stage = this.idx === 1 ? 'pickup' : this.idx === 3 ? 'collect' : this.idx === 4 ? 'reach' : 'meet';
    this.hud = null;
  }

  update(dt) {
    const g = this.game;
    const pos = g.playerPos();
    const near = (poi, r = ARRIVE_R) => dist(pos.x, pos.y, poi.x, poi.y) < r;
    this.hud = null;

    if (this.idx === 0) {
      if (this.stage === 'meet' && near(POIS.fixer)) { this.stage = 'pickup'; g.banner('The fixer', '“One package. No questions.”'); }
      else if (this.stage === 'pickup' && near(POIS.warehouse)) { this.stage = 'deliver'; g.banner('Package aboard', 'Take it to the pier'); }
      else if (this.stage === 'deliver' && near(POIS.dock)) this.payAndNext('Delivery made');
    } else if (this.idx === 1) {
      if (this.stage === 'pickup' && near(POIS.cafe)) { this.stage = 'deliver'; this.timer = 150; g.banner('Rush order aboard', 'Across town. Clock is running.'); }
      else if (this.stage === 'deliver') {
        this.timer -= dt;
        this.hud = { label: 'Time', frac: clamp(this.timer / 150, 0, 1) };
        if (near(POIS.nwCorner)) this.payAndNext('On time');
        else if (this.timer <= 0) { this.stage = 'pickup'; g.banner('Too slow', 'The client walked. Pick it up again.'); }
      }
    } else if (this.idx === 2) {
      this.updateTail(dt, pos);
    } else if (this.idx === 3) {
      if (this.stage === 'collect') {
        for (const p of this.packages) {
          if (!p.taken && dist(pos.x, pos.y, p.x, p.y) < 42) {
            p.taken = true;
            g.addCrime(1);
            g.sparkle(p.x, p.y);
            g.banner('Package taken', 'The bay notices. Keep moving.');
          }
        }
        if (this.packages.every((p) => p.taken)) this.stage = 'deliver';
      } else if (this.stage === 'deliver' && near(POIS.fixer)) this.payAndNext('All three delivered');
    } else if (this.idx === 4) {
      if (this.stage === 'reach' && near(POIS.hideout)) {
        this.stage = 'evade';
        g.setWantedAtLeast(3);
        g.banner('Safe house reached', 'Now shake the police');
      } else if (this.stage === 'evade' && g.wanted === 0) {
        this.payAndNext('Clean getaway');
        g.dayComplete();
      }
    }
  }

  // M3: the mark drives a loop on the east side; the player must hold the band.
  updateTail(dt, pos) {
    const g = this.game;
    if (!this.targetCar) {
      this.targetCar = makeCar(POIS.tailStart.x, POIS.tailStart.y, 0, '#e07b2a', 'target');
      this.targetCar.driver = 'mark';
      g.addCar(this.targetCar);
      this.wpIndex = 0;
      this.tailProgress = 0; this.tooCloseT = 0; this.lostT = 0;
      this.tailAcquired = false;
    }
    const car = this.targetCar;
    // The mark drives a rectangle of road centres on the east side — never a line
    // across a block, which is how a tail car ends up parked against a building.
    const LOOP = [
      { x: 1850, y: 210 }, { x: 1450, y: 210 }, { x: 1450, y: 890 }, { x: 2210, y: 890 }, { x: 2210, y: 210 }, { x: 1850, y: 210 }, { x: 1850, y: 890 },
    ];
    const wp = LOOP[this.wpIndex % LOOP.length];
    if (dist(car.x, car.y, wp.x, wp.y) < 60) this.wpIndex++;
    const want = Math.atan2(wp.y - car.y, wp.x - car.x);
    const speed = Math.abs(car.fSpeed || 0);
    // Even a careful driver wedges a bumper now and then: back out, then carry on.
    let ctl;
    if (car.reverseT > 0) {
      car.reverseT -= dt;
      ctl = { throttle: -1, steer: clamp(angleDelta(car.angle, want) * -2, -1, 1), handbrake: false };
    } else {
      if (speed < 12) car.stuckT += dt; else car.stuckT = 0;
      if (car.stuckT > 1) { car.stuckT = 0; car.reverseT = 0.7; }
      ctl = { throttle: speed < 225 ? 1 : 0, steer: clamp(angleDelta(car.angle, want) * 2.2, -1, 1), handbrake: false };
    }
    stepCar(g.world, car, ctl, dt, null);

    const d = dist(pos.x, pos.y, car.x, car.y);
    // The tail only starts when the player reaches the mark. Until then the band
    // timers stay off: the mark may be across town when the job begins, and a tail
    // that fails while you are still driving to it is no tail at all.
    if (!this.tailAcquired) {
      if (d < 340) {
        this.tailAcquired = true;
        g.banner('Eyes on the mark', 'Stay in the band — not too close, do not lose him.');
      }
      this.hud = { label: 'Tail', frac: 0 };
      return;
    }
    if (d >= 90 && d <= 280) { this.tailProgress += dt; this.tooCloseT = Math.max(0, this.tooCloseT - dt * 2); this.lostT = Math.max(0, this.lostT - dt * 2); }
    else if (d < 70) this.tooCloseT += dt;
    else if (d > 340) this.lostT += dt;
    this.hud = { label: 'Tail', frac: clamp(this.tailProgress / 40, 0, 1) };

    if (this.tooCloseT > 4 || this.lostT > 7) {
      const why = this.tooCloseT > 4 ? 'You spooked the mark' : 'You lost the mark';
      g.removeCar(car);
      this.targetCar = null;
      g.banner(why, 'The fixer sends another. Start the tail again.');
      return;
    }
    if (this.tailProgress >= 40) {
      g.removeCar(car);
      this.targetCar = null;
      g.addCrime(1); // a patrol clocked the tail
      this.payAndNext('Mark tailed to his door');
    }
  }
}
