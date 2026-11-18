// Canvas rendering for Sunset Bay: the city from above (roads, kerbs and rooftops,
// sand and sea), the cars and people in it, then the HUD — cash, clock, wanted stars,
// the objective with its route line and pulsing marker, the bust meter, and a minimap.

import {
  BEACH_Y, ROADS_H, ROADS_V, ROAD_HALF, VIEW_H, VIEW_W, WATER_Y, WORLD_H, WORLD_W,
} from './config.js';
import { createRandom } from './random.js';

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSED = 'paused';

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function money(n) {
  return `$${n.toLocaleString('en-US')}`;
}

function clockText(clockMin) {
  const total = Math.floor(clockMin) % (24 * 60);
  const day = 1 + Math.floor(clockMin / (24 * 60));
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return { day, text: `${hh}:${mm}` };
}

export function createRenderer(canvas) {
  const ctx = canvas.getContext('2d');
  // Static decoration speckles, fixed once so the ground never flickers between frames.
  const decor = createRandom(20240);
  const sandDots = Array.from({ length: 260 }, () => ({ x: decor.range(0, WORLD_W), y: decor.range(BEACH_Y, WATER_Y), r: decor.range(1, 2.6) }));
  const grassDots = Array.from({ length: 300 }, () => ({ x: decor.range(0, WORLD_W), y: decor.range(0, BEACH_Y), r: decor.range(1, 2.2) }));

  function drawWorld(state) {
    const p = state.player;
    const camX = clamp(p.x - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    const camY = clamp(p.y - VIEW_H / 2, 0, WORLD_H - VIEW_H);
    ctx.save();
    ctx.translate(-camX, -camY);

    // Ground: city blocks, then the promenade, sand and sea.
    ctx.fillStyle = '#66705c';
    ctx.fillRect(0, 0, WORLD_W, BEACH_Y);
    ctx.fillStyle = 'rgba(255,255,255,0.05)';
    for (const d of grassDots) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#8f8a7d';
    ctx.fillRect(0, 1245, WORLD_W, BEACH_Y - 1245);
    ctx.fillStyle = '#dec084';
    ctx.fillRect(0, BEACH_Y, WORLD_W, WATER_Y - BEACH_Y);
    ctx.fillStyle = 'rgba(160,120,60,0.35)';
    for (const d of sandDots) { ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill(); }
    ctx.fillStyle = '#256d85';
    ctx.fillRect(0, WATER_Y, WORLD_W, WORLD_H - WATER_Y);
    ctx.strokeStyle = 'rgba(255,255,255,0.25)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 7; i += 1) {
      const y = WATER_Y + 18 + i * 20;
      const off = Math.sin(state.time * 0.9 + i * 1.7) * 14;
      ctx.beginPath();
      ctx.moveTo(off, y);
      ctx.lineTo(WORLD_W + off, y);
      ctx.stroke();
    }

    // Roads, edge lines and centre dashes.
    ctx.fillStyle = '#33333d';
    for (const vx of ROADS_V) ctx.fillRect(vx - ROAD_HALF, 0, ROAD_HALF * 2, BEACH_Y);
    for (const hy of ROADS_H) ctx.fillRect(0, hy - ROAD_HALF, WORLD_W, ROAD_HALF * 2);
    ctx.strokeStyle = 'rgba(240,240,230,0.5)';
    ctx.lineWidth = 2;
    for (const vx of ROADS_V) {
      ctx.beginPath(); ctx.moveTo(vx - ROAD_HALF + 3, 0); ctx.lineTo(vx - ROAD_HALF + 3, BEACH_Y); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(vx + ROAD_HALF - 3, 0); ctx.lineTo(vx + ROAD_HALF - 3, BEACH_Y); ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(216,177,58,0.75)';
    ctx.lineWidth = 4;
    ctx.setLineDash([26, 22]);
    for (const vx of ROADS_V) { ctx.beginPath(); ctx.moveTo(vx, 0); ctx.lineTo(vx, BEACH_Y); ctx.stroke(); }
    for (const hy of ROADS_H) { ctx.beginPath(); ctx.moveTo(0, hy); ctx.lineTo(WORLD_W, hy); ctx.stroke(); }
    ctx.setLineDash([]);

    // Buildings: kerb strip (the collision footprint), face, roof panel.
    state.buildings.forEach((b, i) => {
      ctx.fillStyle = '#9aa0a3';
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x + 9, b.y + 9, b.w - 18, b.h - 18);
      ctx.fillStyle = b.roof;
      ctx.fillRect(b.x + 20, b.y + 20, b.w - 40, b.h - 40);
      ctx.fillStyle = 'rgba(255,244,190,0.5)';
      const seed = Math.sin(i * 127.1) * 43758.5;
      const frac = seed - Math.floor(seed);
      if (frac > 0.4) ctx.fillRect(b.x + 26 + frac * 30, b.y + 26, 7, 7);
      if (frac > 0.65) ctx.fillRect(b.x + b.w - 40, b.y + b.h - 34, 7, 7);
    });

    // Palms.
    for (const palm of state.palms) {
      ctx.strokeStyle = '#6d4c2f';
      ctx.lineWidth = 3 * palm.s;
      ctx.beginPath(); ctx.moveTo(palm.x, palm.y); ctx.lineTo(palm.x + 3, palm.y - 9 * palm.s); ctx.stroke();
      ctx.strokeStyle = '#3e8e4f';
      ctx.lineWidth = 2.4 * palm.s;
      for (let k = 0; k < 5; k += 1) {
        const a = (k / 5) * Math.PI * 2 + palm.s;
        ctx.beginPath();
        ctx.moveTo(palm.x + 3, palm.y - 9 * palm.s);
        ctx.quadraticCurveTo(
          palm.x + 3 + Math.cos(a) * 10 * palm.s, palm.y - 9 * palm.s + Math.sin(a) * 4 - 3,
          palm.x + 3 + Math.cos(a) * 15 * palm.s, palm.y - 9 * palm.s + Math.sin(a) * 7 + 4,
        );
        ctx.stroke();
      }
    }

    // Skid marks under the cars.
    for (const s of state.skids) {
      ctx.fillStyle = `rgba(18,18,18,${s.a.toFixed(3)})`;
      ctx.beginPath(); ctx.arc(s.x, s.y, 3, 0, 7); ctx.fill();
    }

    // Route line to the objective.
    const obj = state.objective;
    if (obj && obj.dist > 40) {
      ctx.strokeStyle = 'rgba(245,183,49,0.65)';
      ctx.lineWidth = 3;
      ctx.setLineDash([12, 10]);
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(obj.x, obj.y); ctx.stroke();
      ctx.setLineDash([]);
    }

    // Packages waiting in job 4.
    if (state.mission.active === 4) {
      for (const pk of state.mission.remaining) drawMarker(state, pk.x, pk.y, '#7fd069');
    }
    // The pulsing objective marker.
    if (obj && obj.dist >= 1) drawMarker(state, obj.x, obj.y, '#f5b731');

    // The fixer, when a job is waiting.
    if (!state.mission.active && state.mission.next <= 5) {
      drawPerson(state.fixer.x, state.fixer.y, -Math.PI / 2, '#f5f0e6', '#26418f');
      ctx.fillStyle = '#f5b731';
      ctx.font = 'bold 17px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', state.fixer.x, state.fixer.y - 24 - Math.sin(state.time * 3) * 2);
    }

    // Pedestrians.
    for (const ped of state.peds) {
      if (ped.down) {
        ctx.fillStyle = 'rgba(90,90,90,0.8)';
        ctx.beginPath(); ctx.ellipse(ped.x, ped.y, 11, 5, ped.angle, 0, 7); ctx.fill();
      } else drawPerson(ped.x, ped.y, ped.angle, ped.color, '#3a3a44');
    }

    // Cars.
    for (const car of state.cars) {
      if (!car.removed) drawCar(state, car);
    }

    // The player on foot.
    if (!p.inCar) {
      drawPerson(p.x, p.y, p.angle, '#e8762d', '#20303a');
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.arc(p.x, p.y, 14 + Math.sin(state.time * 3) * 1.5, 0, 7); ctx.stroke();
    }

    ctx.restore();
    return { camX, camY };
  }

  function drawMarker(state, x, y, color) {
    const pulse = 21 + Math.sin(state.time * 4) * 5;
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, pulse, 0, 7); ctx.stroke();
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(x, y, 5.5, 0, 7); ctx.fill();
  }

  function drawPerson(x, y, angle, shirt, pants) {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.fillStyle = pants;
    ctx.fillRect(-3, -7, 6, 5);
    ctx.fillRect(-3, 2, 6, 5);
    ctx.fillStyle = shirt;
    ctx.fillRect(-5, -4, 10, 8);
    ctx.fillStyle = '#e8bd93';
    ctx.beginPath(); ctx.arc(1, 0, 4.2, 0, 7); ctx.fill();
    ctx.restore();
  }

  function drawCar(state, car) {
    ctx.save();
    ctx.translate(car.x, car.y);
    ctx.rotate(car.angle);
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.fillRect(-19, -8, 42, 20);
    ctx.fillStyle = '#191919';
    ctx.fillRect(-15, -11, 9, 4); ctx.fillRect(7, -11, 9, 4);
    ctx.fillRect(-15, 7, 9, 4); ctx.fillRect(7, 7, 9, 4);
    ctx.fillStyle = car.color;
    ctx.beginPath(); ctx.roundRect(-20, -10, 40, 20, 5); ctx.fill();
    ctx.fillStyle = 'rgba(20,26,34,0.9)';
    ctx.beginPath(); ctx.roundRect(-8, -8, 17, 16, 3); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(-19, -10, 40, 4);
    if (car.kind === 'police') {
      ctx.fillStyle = '#e8e8e8';
      ctx.fillRect(-6, -10, 12, 20);
      const phase = Math.floor(state.time * 2.4) % 2 === 0;
      ctx.fillStyle = phase ? '#e33' : '#36c';
      ctx.fillRect(-4, -6, 8, 4);
      ctx.fillStyle = phase ? '#36c' : '#e33';
      ctx.fillRect(-4, 2, 8, 4);
    }
    if (car.kind === 'target') {
      ctx.strokeStyle = '#f5b731';
      ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.roundRect(-20, -10, 40, 20, 5); ctx.stroke();
    }
    if (car.braking) {
      // Brake lights: a lit pair at the rear corners, with a little halo in the dusk.
      ctx.fillStyle = 'rgba(255,60,40,0.35)';
      ctx.fillRect(-24, -9.5, 2.4, 7);
      ctx.fillRect(-24, 2.5, 2.4, 7);
      ctx.fillStyle = '#ff3524';
      ctx.fillRect(-21.6, -8.5, 3.4, 5);
      ctx.fillRect(-21.6, 3.5, 3.4, 5);
    }
    ctx.restore();
  }

  function drawMinimap(state) {
    const w = 168;
    const h = 112;
    const x0 = VIEW_W - w - 10;
    const y0 = 48;
    const sx = w / WORLD_W;
    const sy = h / WORLD_H;
    ctx.fillStyle = 'rgba(12,16,22,0.78)';
    ctx.beginPath(); ctx.roundRect(x0, y0, w, h, 5); ctx.fill();
    ctx.fillStyle = '#256d85';
    ctx.fillRect(x0, y0 + WATER_Y * sy, w, (WORLD_H - WATER_Y) * sy);
    ctx.strokeStyle = 'rgba(220,220,220,0.4)';
    ctx.lineWidth = 2;
    for (const vx of ROADS_V) { ctx.beginPath(); ctx.moveTo(x0 + vx * sx, y0); ctx.lineTo(x0 + vx * sx, y0 + BEACH_Y * sy); ctx.stroke(); }
    for (const hy of ROADS_H) { ctx.beginPath(); ctx.moveTo(x0, y0 + hy * sy); ctx.lineTo(x0 + w, y0 + hy * sy); ctx.stroke(); }
    for (const car of state.cars) {
      if (car.removed || car.kind !== 'police') continue;
      ctx.fillStyle = '#5aa2ff';
      ctx.fillRect(x0 + car.x * sx - 2, y0 + car.y * sy - 2, 4, 4);
    }
    const obj = state.objective;
    if (obj && state.mission.active) {
      ctx.fillStyle = '#f5b731';
      ctx.beginPath(); ctx.arc(x0 + obj.x * sx, y0 + obj.y * sy, 3.4, 0, 7); ctx.fill();
    }
    const p = state.player;
    ctx.save();
    ctx.translate(x0 + p.x * sx, y0 + p.y * sy);
    ctx.rotate(p.angle);
    ctx.fillStyle = '#fff';
    ctx.beginPath(); ctx.moveTo(5.5, 0); ctx.lineTo(-4, -3.4); ctx.lineTo(-4, 3.4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function drawHud(state, screen) {
    const p = state.player;
    // Cash and clock, top-left.
    ctx.fillStyle = 'rgba(12,16,22,0.66)';
    ctx.beginPath(); ctx.roundRect(10, 10, 196, 56, 6); ctx.fill();
    ctx.fillStyle = '#ffd964';
    ctx.font = 'bold 25px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText(money(state.cash), 22, 38);
    const clock = clockText(state.clockMin);
    ctx.fillStyle = '#e8e2d4';
    ctx.font = '14px Georgia, serif';
    ctx.fillText(`Day ${clock.day} · ${clock.text}`, 22, 59);

    // Wanted stars, top-right.
    ctx.font = '21px Georgia, serif';
    ctx.textAlign = 'right';
    for (let i = 0; i < 5; i += 1) {
      ctx.fillStyle = i < state.wanted ? '#ffcf3f' : 'rgba(255,255,255,0.28)';
      ctx.fillText('★', VIEW_W - 14 - (4 - i) * 24, 34);
    }
    drawMinimap(state);

    // Objective line, bottom-centre.
    const obj = state.objective;
    if (obj) {
      ctx.font = '16px Georgia, serif';
      const label = obj.dist > 40 ? `${obj.text} · ${obj.dist}m` : obj.text;
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(12,16,22,0.66)';
      ctx.beginPath(); ctx.roundRect((VIEW_W - tw) / 2 - 12, VIEW_H - 40, tw + 24, 28, 6); ctx.fill();
      ctx.fillStyle = '#f5e9c8';
      ctx.textAlign = 'center';
      ctx.fillText(label, VIEW_W / 2, VIEW_H - 21);
    }

    // Interact prompt.
    ctx.font = '14px Georgia, serif';
    ctx.textAlign = 'center';
    if (!p.inCar && state.nearestCar) {
      ctx.fillStyle = '#ffe9a8';
      ctx.fillText('E — take this car', VIEW_W / 2, VIEW_H - 52);
    } else if (p.inCar && p.speed < 25) {
      ctx.fillStyle = 'rgba(255,233,168,0.8)';
      ctx.fillText('E — get out', VIEW_W / 2, VIEW_H - 52);
    }

    // Bust meter.
    if (state.bustMeter > 0.02) {
      ctx.fillStyle = 'rgba(12,16,22,0.7)';
      ctx.beginPath(); ctx.roundRect(VIEW_W / 2 - 110, 76, 220, 20, 5); ctx.fill();
      ctx.fillStyle = '#e33';
      ctx.beginPath(); ctx.roundRect(VIEW_W / 2 - 106, 80, 212 * Math.min(1, state.bustMeter), 12, 4); ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = 'bold 12px Georgia, serif';
      ctx.fillText('BUSTED', VIEW_W / 2, 90);
    }

    // Banner.
    if (state.banner) {
      const a = clamp(state.banner.t / 0.6, 0, 1);
      ctx.fillStyle = `rgba(245,233,200,${a.toFixed(2)})`;
      ctx.font = 'bold 21px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.shadowColor = 'rgba(0,0,0,0.8)';
      ctx.shadowBlur = 6;
      ctx.fillText(state.banner.text, VIEW_W / 2, 118);
      ctx.shadowBlur = 0;
    }

    // Controls hint, bottom-left.
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.font = '12px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.fillText('WASD drive · E enter/exit · Space handbrake · P pause', 12, VIEW_H - 12);

    if (screen === SCREEN_PAUSED) {
      ctx.fillStyle = 'rgba(8,8,14,0.55)';
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = '#f5e9c8';
      ctx.font = 'bold 40px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', VIEW_W / 2, VIEW_H / 2);
    }

    // Day-complete summary.
    if (state.dayComplete && state.summaryT > 0) {
      ctx.fillStyle = 'rgba(10,12,18,0.82)';
      ctx.beginPath(); ctx.roundRect(VIEW_W / 2 - 230, VIEW_H / 2 - 92, 460, 184, 10); ctx.fill();
      ctx.strokeStyle = '#f5b731';
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(VIEW_W / 2 - 230, VIEW_H / 2 - 92, 460, 184, 10); ctx.stroke();
      ctx.fillStyle = '#ffd964';
      ctx.font = 'bold 34px Georgia, serif';
      ctx.textAlign = 'center';
      ctx.fillText('DAY COMPLETE', VIEW_W / 2, VIEW_H / 2 - 38);
      const earned = state.payouts.reduce((a, b) => a + b, 0);
      ctx.fillStyle = '#f5e9c8';
      ctx.font = '19px Georgia, serif';
      ctx.fillText(`Five jobs done — ${money(earned)} earned`, VIEW_W / 2, VIEW_H / 2 + 2);
      ctx.font = '15px Georgia, serif';
      ctx.fillStyle = '#cbbfa8';
      ctx.fillText(`Cash in hand ${money(state.cash)} · busted ${state.bustedCount}× · the bay is yours now`, VIEW_W / 2, VIEW_H / 2 + 30);
    }
  }

  function drawTitle(state) {
    const grad = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    grad.addColorStop(0, 'rgba(30,10,40,0.55)');
    grad.addColorStop(0.55, 'rgba(70,25,45,0.35)');
    grad.addColorStop(1, 'rgba(16,10,24,0.72)');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffb347';
    ctx.font = 'bold 84px Georgia, serif';
    ctx.shadowColor = 'rgba(0,0,0,0.65)';
    ctx.shadowBlur = 12;
    ctx.fillText('SUNSET BAY', VIEW_W / 2, 168);
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#ffe9c8';
    ctx.font = 'italic 21px Georgia, serif';
    ctx.fillText('One fixer. Five jobs. One long day by the sea.', VIEW_W / 2, 208);
    ctx.fillStyle = '#ffd964';
    ctx.font = 'bold 19px Georgia, serif';
    ctx.fillText('Press Enter to start', VIEW_W / 2, 300);
    ctx.fillStyle = 'rgba(245,233,200,0.85)';
    ctx.font = '15px Georgia, serif';
    ctx.fillText('WASD / arrows — walk and drive      E — enter or exit a car', VIEW_W / 2, 348);
    ctx.fillText('Space — handbrake      P — pause      Follow the amber marker to work', VIEW_W / 2, 374);
  }

  function draw(state, screen) {
    drawWorld(state);
    if (screen === SCREEN_TITLE) drawTitle(state);
    else drawHud(state, screen);
  }

  return { draw };
}
