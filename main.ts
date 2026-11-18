// Sunset Bay, an entry for gta6-01 (Node 22, standard library only): the game is this
// directory's game/ folder, plain static files a desktop browser loads offline
// (game/index.html and its ES modules, no library and no network request), and the program
// hands it in. It copies game/ and screenshots/ from beside this file to /output and writes
// /output/dossier.json, the summary the judge reads, with the vendored make.fun library.
// The game itself is an original top-down 2D open-world crime game: a walkable, drivable
// coastal city, a wanted system with pursuing police, and a five-mission chain from a fixer
// worth $9,500. Three renders of it live in screenshots/ (the first by name is the cover).
// Past the starter's plumbing, this file also checks the three promised renders exist and
// writes a sha256 manifest of the hand-in beside the dossier (see below).
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-game.ts';

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

// --- Sunset Bay additions (the entrypoint's own code, not the starter's) ---
// The three renders this entry promises, by the names shots.json gives them. The starter
// copies whatever screenshots/ holds and lets buildDossier complain later; this entry
// refuses to hand in at all when one of its named renders is missing or empty, so a
// packaging mistake fails here, loudly, instead of in front of the judge.
const EXPECTED_SHOTS = ['01-title.png', '02-drive.png', '03-mission.png'];

function requireScreenshots(dir: string): void {
  for (const name of EXPECTED_SHOTS) {
    const file = join(dir, 'screenshots', name);
    if (!existsSync(file)) throw new Error(`main.ts: screenshots/${name} is missing: this entry promises the three renders named in shots.json`);
    if (statSync(file).size === 0) throw new Error(`main.ts: screenshots/${name} is empty`);
  }
}

// Every file under a directory, as output-relative paths in sorted order, so the manifest
// below is byte-stable between runs on the same tree.
function walkFiles(root: string, base: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const full = join(root, entry.name);
    if (entry.isDirectory()) found.push(...walkFiles(full, base));
    else if (entry.isFile()) found.push(relative(base, full).split('\\').join('/'));
  }
  return found.sort();
}

// A manifest of what was actually handed in: each output file's path, byte size and
// sha256, computed from the copied tree (never the source tree), so it describes the
// artefact the judge receives. It rides beside dossier.json as manifest.json; the
// dossier itself stays exactly the bytes buildDossier writes, as the scorer requires.
function manifestOf(root: string): { path: string; bytes: number; sha256: string }[] {
  return walkFiles(root, root).map((path) => {
    const bytes = readFileSync(join(root, path));
    return { path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  });
}

requireScreenshots(here);

mkdirSync(out, { recursive: true });
cpSync(join(here, 'game'), join(out, 'game'), { recursive: true });
mkdirSync(join(out, 'screenshots'), { recursive: true });
if (existsSync(join(here, 'screenshots'))) cpSync(join(here, 'screenshots'), join(out, 'screenshots'), { recursive: true });

// The scorer's own caps (reference/gate.json): only text_max_bytes shapes the bytes; the others refuse an entry the
// scorer would refuse (more than 4 screenshots or one over 256 KiB; more than 993 files in game/ or 48 MiB of game
// files, in all, or a path under game/ over 1000 bytes: game/ counts beside /output's own 1000-entry cap, its
// screenshots/ and dossier.json).
writeFileSync(
  join(out, 'dossier.json'),
  buildDossier(out, {
    text_max_bytes: 163840,
    screenshots: { max: 4, max_bytes: 262144 },
    game_max_files: 993,
    game_max_bytes: 50331648,
    game_path_max_bytes: 1000,
  }),
);

// The manifest goes last, once game/, screenshots/ and dossier.json are all in place, so
// its hashes cover the finished hand-in (dossier.json included, manifest.json itself not).
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifestOf(out), null, 2) + '\n');
