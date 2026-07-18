// game.js — renderer, animated skier rig, camera, HUD. Simulation lives in sim.js.
import * as THREE from './three.module.js';
import * as SIM from './sim.js';
import { STR } from './strings.js';
import * as ACC from './account.js';

// game shell state: 'flow' (login/create/customize/menu screens) or 'play'
let uiState = 'flow';

// ---------------- map selection (must happen before the world is built) ----------------
let currentMap = 'bluebird';
try { currentMap = localStorage.getItem('bp_map') || 'bluebird'; } catch (e) {}
if (!SIM.MAPS[currentMap]) currentMap = 'bluebird';
SIM.setMap(currentMap);

// ---------------- input (physical key codes only) ----------------
const BIND = {
  KeyA: 'left', ArrowLeft: 'left',
  KeyD: 'right', ArrowRight: 'right',
  KeyW: 'tuck', ArrowUp: 'tuck',
  KeyS: 'brake', ArrowDown: 'brake',
  Space: 'pop', KeyJ: 'grab1', KeyK: 'grab2', KeyL: 'grab3',
  KeyI: 'butter',
};
const held = new Set();
let popEdge = false, restartEdge = false, startEdge = false;
const inField = (e) => { const t = e.target; return t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
addEventListener('keydown', (e) => {
  if (inField(e)) return; // never steal keys from text fields (login, username, etc.)
  const c = BIND[e.code];
  if (c) {
    if (c === 'pop' && !held.has('pop')) { popEdge = true; startEdge = true; }
    held.add(c); e.preventDefault();
  }
  if (e.code === 'KeyR') { restartEdge = true; e.preventDefault(); }
  if (e.code === 'Enter') { startEdge = true; }
});
addEventListener('keyup', (e) => { const c = BIND[e.code]; if (c) held.delete(c); });

// ---------------- renderer / scene ----------------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const DPR_CAP = 1.5;
renderer.setPixelRatio(Math.min(devicePixelRatio || 1, DPR_CAP));
renderer.shadowMap.enabled = true; // rider-only casters -> cheap [batch item 4]
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
// sky mode comes from the map config: night, day, or sunset
const SKYMODE = SIM.MAPS[SIM.MAP_ID].sky || 'night';
const DAY = SKYMODE !== 'night'; // daylight-family: spring-resort look and decor
if (SKYMODE === 'day') {
  scene.fog = new THREE.Fog(0xd4e6f2, 220, 1000); // crisp spring haze
  renderer.setClearColor(0x9fc8e8);
} else if (SKYMODE === 'sunset') {
  scene.fog = new THREE.Fog(0xe8b498, 200, 950); // golden-hour haze
  renderer.setClearColor(0xd98a6a);
} else {
  scene.fog = new THREE.Fog(0x3a3560, 160, 820); // cool night haze
  renderer.setClearColor(0x0f163a);
}

const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.1, 1500);
function resize() {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize); addEventListener('orientationchange', resize); resize();

// lights — night: high moon; day: warm high sun; sunset: LOW golden sun raking the snow
const sun = new THREE.DirectionalLight(
  SKYMODE === 'day' ? 0xfff3d8 : SKYMODE === 'sunset' ? 0xffc088 : 0xcfdaff,
  SKYMODE === 'day' ? 1.55 : SKYMODE === 'sunset' ? 1.5 : 1.4);
const SUN_DIR = (SKYMODE === 'day' ? new THREE.Vector3(-0.38, 0.82, 0.28)
  : SKYMODE === 'sunset' ? new THREE.Vector3(-0.75, 0.3, 0.4)
  : new THREE.Vector3(-0.5, 0.62, 0.3)).normalize();
sun.position.copy(SUN_DIR).multiplyScalar(100);
sun.castShadow = true; // natural cast shadow under the rider [batch item 4]
sun.shadow.mapSize.set(1024, 1024);
sun.shadow.camera.left = -9; sun.shadow.camera.right = 9;
sun.shadow.camera.top = 9; sun.shadow.camera.bottom = -9;
sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
sun.shadow.bias = -0.0015;
scene.add(sun);
scene.add(sun.target);
scene.add(SKYMODE === 'day'
  ? new THREE.HemisphereLight(0xbfd9f2, 0xf0ebe0, 1.05)
  : SKYMODE === 'sunset'
    ? new THREE.HemisphereLight(0xd98ab0, 0xe8c4a0, 0.95)
    : new THREE.HemisphereLight(0x8a90d8, 0xa8b2dd, 0.95));

// SPRING DAY sky dome — clear blue with drifting cumulus and a bright sun glow
if (SKYMODE === 'day') {
  const cnv = document.createElement('canvas'); cnv.width = 2048; cnv.height = 1024;
  const x = cnv.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 1024);
  gr.addColorStop(0, '#4f92d2');      // deep spring blue zenith
  gr.addColorStop(0.32, '#7db4e2');
  gr.addColorStop(0.46, '#b8d9ee');   // pale band above the treeline
  gr.addColorStop(0.52, '#e8f2f6');   // bright horizon
  gr.addColorStop(0.62, '#c2d8e6');
  gr.addColorStop(1, '#b0cadd');
  x.fillStyle = gr; x.fillRect(0, 0, 2048, 1024);
  const rnd = SIM.mulberry32(777);
  // sun glow, high where the light comes from
  const sg = x.createRadialGradient(1430, 170, 0, 1430, 170, 260);
  sg.addColorStop(0, 'rgba(255,250,225,0.95)');
  sg.addColorStop(0.18, 'rgba(255,246,210,0.55)');
  sg.addColorStop(1, 'rgba(255,246,210,0)');
  x.fillStyle = sg; x.beginPath(); x.arc(1430, 170, 260, 0, 7); x.fill();
  // cumulus: soft stacked white blobs with shaded bellies
  const cloud = (cx, cy, sc) => {
    for (let i = 0; i < 9; i++) {
      const bx = cx + (rnd() - 0.5) * 190 * sc, by = cy + (rnd() - 0.5) * 44 * sc;
      const r = (34 + rnd() * 42) * sc;
      const g2 = x.createRadialGradient(bx, by - r * 0.25, 0, bx, by, r);
      g2.addColorStop(0, 'rgba(255,255,255,0.92)');
      g2.addColorStop(0.75, 'rgba(244,248,252,0.55)');
      g2.addColorStop(1, 'rgba(226,236,246,0)');
      x.fillStyle = g2; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
    }
  };
  cloud(320, 300, 1.1); cloud(760, 210, 0.85); cloud(1130, 330, 1.25);
  cloud(1700, 280, 0.9); cloud(1950, 380, 0.7); cloud(80, 400, 0.8);
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
}

// SUNSET sky dome (K Sessions) — the long Scandinavian golden hour: apricot to
// violet gradient, a huge low sun, lit cloud bands
if (SKYMODE === 'sunset') {
  const cnv = document.createElement('canvas'); cnv.width = 2048; cnv.height = 1024;
  const x = cnv.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 1024);
  gr.addColorStop(0, '#4a3a7a');      // violet zenith
  gr.addColorStop(0.26, '#8a4e86');   // magenta band
  gr.addColorStop(0.4, '#d0607a');    // rose
  gr.addColorStop(0.49, '#f08a5a');   // apricot
  gr.addColorStop(0.54, '#ffc07a');   // gold horizon
  gr.addColorStop(0.62, '#b0687a');
  gr.addColorStop(1, '#7a4a66');
  x.fillStyle = gr; x.fillRect(0, 0, 2048, 1024);
  const rnd = SIM.mulberry32(9090);
  // the big low sun with a wide glow
  const sg = x.createRadialGradient(1500, 505, 0, 1500, 505, 340);
  sg.addColorStop(0, 'rgba(255,240,205,1)');
  sg.addColorStop(0.1, 'rgba(255,214,140,0.9)');
  sg.addColorStop(0.4, 'rgba(255,170,110,0.4)');
  sg.addColorStop(1, 'rgba(255,170,110,0)');
  x.fillStyle = sg; x.beginPath(); x.arc(1500, 505, 340, 0, 7); x.fill();
  // long lit cloud bands catching the light from below
  for (let i = 0; i < 26; i++) {
    const by = 180 + rnd() * 320, bx = rnd() * 2048;
    const bw = 180 + rnd() * 380, bh = 8 + rnd() * 18;
    const warm = by > 330;
    const g2 = x.createLinearGradient(0, by - bh, 0, by + bh);
    g2.addColorStop(0, warm ? 'rgba(255,190,150,0.0)' : 'rgba(120,80,140,0.0)');
    g2.addColorStop(0.5, warm ? `rgba(255,190,150,${0.2 + rnd() * 0.25})` : `rgba(120,80,140,${0.18 + rnd() * 0.2})`);
    g2.addColorStop(1, warm ? 'rgba(255,190,150,0.0)' : 'rgba(120,80,140,0.0)');
    x.fillStyle = g2;
    x.beginPath(); x.ellipse(bx, by, bw, bh, 0, 0, 7); x.fill();
  }
  // first stars up top as the light fades
  for (let i = 0; i < 140; i++) {
    const sx = rnd() * 2048, sy = rnd() * rnd() * 220;
    x.fillStyle = `rgba(255,250,240,${0.2 + rnd() * 0.45})`;
    x.beginPath(); x.arc(sx, sy, 0.5 + rnd() * 0.9, 0, 7); x.fill();
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
}

// STARRY NIGHT sky dome — painted canvas: deep blue to purple with a pink horizon
// glow and emerald rim, a soft nebula band, two galaxies, ~900 stars, constellations
if (SKYMODE === 'night') {
  const cnv = document.createElement('canvas'); cnv.width = 2048; cnv.height = 1024;
  const x = cnv.getContext('2d');
  const gr = x.createLinearGradient(0, 0, 0, 1024);
  gr.addColorStop(0, '#0f163a');      // deep blue zenith
  gr.addColorStop(0.3, '#2c2260');    // purple
  gr.addColorStop(0.42, '#54307a');
  gr.addColorStop(0.485, '#a05a92');  // pink glow at the horizon
  gr.addColorStop(0.53, '#2e5f58');   // emerald rim
  gr.addColorStop(0.62, '#101830');
  gr.addColorStop(1, '#0c1228');
  x.fillStyle = gr; x.fillRect(0, 0, 2048, 1024);
  const rnd = SIM.mulberry32(4242);
  // THE MILKY WAY — a bold band sweeping up from the horizon right where the
  // rider looks (the camera faces u~0.75 of the dome). Layered: wide violet halo,
  // glowing body with pink/emerald pockets, a bright cream spine, a dark dust
  // lane, and dense star-dust along its length.
  const bandY = (bx) => 540 - 380 * Math.sin(Math.PI * bx / 2048);
  // halo
  for (let i = 0; i < 320; i++) {
    const bx = rnd() * 2048, by = bandY(bx) + (rnd() - 0.5) * 150;
    const r = 90 + rnd() * 80;
    const g2 = x.createRadialGradient(bx, by, 0, bx, by, r);
    g2.addColorStop(0, `rgba(150,150,225,${0.028 + rnd() * 0.03})`);
    g2.addColorStop(1, 'rgba(150,150,225,0)');
    x.fillStyle = g2; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  // glowing body with colored pockets
  for (let i = 0; i < 420; i++) {
    const bx = rnd() * 2048, by = bandY(bx) + (rnd() - 0.5) * 80;
    const r = 35 + rnd() * 45;
    const hue = rnd();
    const col = hue < 0.6 ? '205,210,255' : hue < 0.82 ? '240,165,220' : '120,235,195';
    const g2 = x.createRadialGradient(bx, by, 0, bx, by, r);
    g2.addColorStop(0, `rgba(${col},${0.06 + rnd() * 0.09})`);
    g2.addColorStop(1, `rgba(${col},0)`);
    x.fillStyle = g2; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  // bright cream spine
  for (let i = 0; i < 520; i++) {
    const bx = rnd() * 2048, by = bandY(bx) + (rnd() - 0.5) * 26;
    const r = 12 + rnd() * 16;
    const g2 = x.createRadialGradient(bx, by, 0, bx, by, r);
    g2.addColorStop(0, `rgba(248,244,255,${0.1 + rnd() * 0.12})`);
    g2.addColorStop(1, 'rgba(248,244,255,0)');
    x.fillStyle = g2; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  // dark dust lane threading through the spine
  for (let i = 0; i < 240; i++) {
    const bx = rnd() * 2048, by = bandY(bx) + 6 + (rnd() - 0.5) * 14;
    const r = 9 + rnd() * 15;
    const g2 = x.createRadialGradient(bx, by, 0, bx, by, r);
    g2.addColorStop(0, `rgba(12,16,38,${0.1 + rnd() * 0.1})`);
    g2.addColorStop(1, 'rgba(12,16,38,0)');
    x.fillStyle = g2; x.beginPath(); x.arc(bx, by, r, 0, 7); x.fill();
  }
  // star-dust concentrated along the band
  for (let i = 0; i < 1400; i++) {
    const bx = rnd() * 2048, by = bandY(bx) + (rnd() - 0.5) * 90 * rnd();
    const a = 0.3 + rnd() * 0.65;
    x.fillStyle = `rgba(255,253,248,${a})`;
    x.beginPath(); x.arc(bx, by, 0.4 + rnd() * 0.8, 0, 7); x.fill();
  }
  // galaxies: tilted elliptical glows with bright cores (one pink, one emerald)
  const galaxy = (gx, gy, size, col) => {
    for (let i = 0; i < 5; i++) {
      x.save(); x.translate(gx, gy); x.rotate(0.55); x.scale(1, 0.42); x.translate(-gx, -gy);
      const g3 = x.createRadialGradient(gx, gy, 0, gx, gy, size * (1 - i * 0.14));
      g3.addColorStop(0, `rgba(${col},${0.1 + i * 0.05})`);
      g3.addColorStop(1, `rgba(${col},0)`);
      x.fillStyle = g3; x.beginPath(); x.arc(gx, gy, size, 0, 7); x.fill(); x.restore();
    }
    const g4 = x.createRadialGradient(gx, gy, 0, gx, gy, size * 0.25);
    g4.addColorStop(0, 'rgba(255,250,240,0.55)'); g4.addColorStop(1, 'rgba(255,250,240,0)');
    x.fillStyle = g4; x.beginPath(); x.arc(gx, gy, size * 0.3, 0, 7); x.fill();
  };
  galaxy(520, 230, 95, '235,155,215');
  galaxy(1560, 360, 75, '110,230,190');
  // stars — bright field, denser toward the band, subtle color mix
  for (let i = 0; i < 900; i++) {
    const sx = rnd() * 2048, sy = rnd() * rnd() * 520;
    const sz = rnd() < 0.92 ? 0.6 + rnd() * 1.1 : 1.6 + rnd() * 1.7;
    const a = 0.35 + rnd() * 0.65;
    const tint = rnd();
    x.fillStyle = tint < 0.68 ? `rgba(255,255,255,${a})` : tint < 0.84 ? `rgba(195,212,255,${a})` : tint < 0.94 ? `rgba(255,215,235,${a})` : `rgba(180,255,225,${a})`;
    x.beginPath(); x.arc(sx, sy, sz, 0, 7); x.fill();
  }
  // constellations — linked bright stars (dipper, the W, a hunter)
  const CONS = [
    [[100, 180], [160, 168], [215, 175], [268, 196], [262, 258], [330, 268], [360, 215]],
    [[820, 140], [868, 180], [912, 150], [956, 196], [1004, 166]],
    [[1250, 400], [1330, 410], [1268, 470], [1296, 466], [1324, 462], [1240, 545], [1350, 535]],
  ];
  for (const con of CONS) {
    x.strokeStyle = 'rgba(205,215,255,0.28)'; x.lineWidth = 1.4;
    x.beginPath(); x.moveTo(con[0][0], con[0][1]);
    for (let i2 = 1; i2 < con.length; i2++) x.lineTo(con[i2][0], con[i2][1]);
    x.stroke();
    for (const [px, py] of con) {
      const g5 = x.createRadialGradient(px, py, 0, px, py, 7);
      g5.addColorStop(0, 'rgba(255,255,255,0.95)'); g5.addColorStop(0.35, 'rgba(220,230,255,0.5)'); g5.addColorStop(1, 'rgba(220,230,255,0)');
      x.fillStyle = g5; x.beginPath(); x.arc(px, py, 7, 0, 7); x.fill();
    }
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(1400, 32, 20),
    new THREE.MeshBasicMaterial({ map: tex, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -10;
  scene.add(sky);
}

// ---------------- terrain ----------------
const _dayWarm = new THREE.Color(0xfff3dd); // spring-sun tint for daylit faces
const _sunsetWarm = new THREE.Color(0xffcf9e); // golden-hour tint
// hand-painted palette: cream snow, sage forest, walnut wood, muted gold accents
const PAL = {
  snowA: new THREE.Color(0xfbf7ef), snowB: new THREE.Color(0xe9f0fa),
  shade: new THREE.Color(0xb4c4e8), moonlit: new THREE.Color(0xe8eeff),
  yellow: new THREE.Color(0xeac36a),
  slate: new THREE.Color(0x97948e), moss: new THREE.Color(0x7d9163),
  orange: new THREE.Color(0xe89257), pine: new THREE.Color(0x6a8f6b),
  pineDark: new THREE.Color(0x527257), pineDeep: new THREE.Color(0x44624e),
  trunk: new THREE.Color(0x8a6a50),
  jacket: 0xdd7a4f, pants: 0x53617a, helmet: 0xf2ede2, skin: 0xd9a066,
  ski: 0xeac36a, boot: 0x3a3f4a, mitt: 0x53617a,
};
// ---------------- PROCEDURAL SURFACE LIBRARY ----------------
// Painted-canvas textures + organic geometry breakers so nothing in the world
// reads as a bare primitive: snow gets wind grain, wood gets plank figure,
// steel gets brushing, cloth gets weave, rocks and pines lose their symmetry.
const TEXR = SIM.mulberry32(1337);
function _tex(size, paint) {
  const cnv = document.createElement('canvas'); cnv.width = cnv.height = size;
  paint(cnv.getContext('2d'), size);
  const t = new THREE.CanvasTexture(cnv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}
// layered soft blotches: [count, rMin, rVar, aMin, aVar, tone]
function _blotch(ctx, size, base, layers) {
  if (base >= 0) { ctx.fillStyle = 'rgb(' + base + ',' + base + ',' + base + ')'; ctx.fillRect(0, 0, size, size); }
  for (const [n, rMin, rVar, aMin, aVar, tone] of layers) {
    for (let i = 0; i < n; i++) {
      const x = TEXR() * size, y = TEXR() * size, r = rMin + TEXR() * rVar;
      const v = Math.max(0, Math.min(255, tone + Math.floor(TEXR() * 26 - 13)));
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const a = aMin + TEXR() * aVar;
      g.addColorStop(0, 'rgba(' + v + ',' + v + ',' + v + ',' + a.toFixed(3) + ')');
      g.addColorStop(1, 'rgba(' + v + ',' + v + ',' + v + ',0)');
      ctx.fillStyle = g;
      ctx.fillRect(x - r, y - r, r * 2, r * 2);
    }
  }
}
const TEX = {};
// SNOW: near-white grain so the painted vertex washes still carry the color,
// plus a dune/sastrugi bump layer with fine sparkle speckle
TEX.snowMap = _tex(256, (c, s) => _blotch(c, s, 247, [[70, 20, 40, 0.1, 0.12, 238], [200, 2, 5, 0.1, 0.15, 255], [140, 1, 2, 0.22, 0.28, 234]]));
TEX.snowBump = _tex(256, (c, s) => _blotch(c, s, 128, [[40, 30, 60, 0.22, 0.2, 156], [90, 9, 20, 0.18, 0.22, 100], [500, 1, 2.5, 0.28, 0.4, 172]]));
// CLOTH: tight weave + soft wrinkle swells for every garment
TEX.clothBump = _tex(128, (c, s) => {
  c.fillStyle = 'rgb(128,128,128)'; c.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y += 2) { c.fillStyle = y % 4 === 0 ? 'rgba(158,158,158,0.5)' : 'rgba(98,98,98,0.5)'; c.fillRect(0, y, s, 1); }
  for (let x = 0; x < s; x += 3) { c.fillStyle = 'rgba(112,112,112,0.25)'; c.fillRect(x, 0, 1, s); }
  _blotch(c, s, -1, [[22, 12, 24, 0.14, 0.14, 158], [22, 10, 20, 0.14, 0.14, 96]]);
});
// WOOD: plank figure — long grain streaks, seams, a few knots (near-white base
// so each timber keeps its own walnut tint)
TEX.woodMap = _tex(256, (c, s) => {
  c.fillStyle = 'rgb(234,226,214)'; c.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x++) {
    const v = 165 + Math.floor(30 * Math.sin(x * 0.55 + Math.sin(x * 0.13) * 3));
    c.fillStyle = 'rgba(' + (v - 20) + ',' + (v - 38) + ',' + (v - 56) + ',' + (0.2 + 0.1 * Math.abs(Math.sin(x * 0.9))).toFixed(3) + ')';
    c.fillRect(x, 0, 1, s);
  }
  for (let i = 0; i < 5; i++) { c.fillStyle = 'rgba(74,54,38,0.5)'; c.fillRect(Math.floor(TEXR() * s), 0, 2, s); }
  for (let i = 0; i < 7; i++) {
    const x = TEXR() * s, y = TEXR() * s, r = 3 + TEXR() * 5;
    const g = c.createRadialGradient(x, y, 0.5, x, y, r);
    g.addColorStop(0, 'rgba(84,58,38,0.75)'); g.addColorStop(0.55, 'rgba(140,108,80,0.3)'); g.addColorStop(1, 'rgba(140,108,80,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, 7); c.fill();
  }
});
TEX.woodBump = _tex(128, (c, s) => {
  c.fillStyle = 'rgb(128,128,128)'; c.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x++) {
    const v = 120 + Math.floor(26 * Math.sin(x * 0.7 + Math.sin(x * 0.19) * 2.4));
    c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.6)'; c.fillRect(x, 0, 1, s);
  }
});
// STEEL: fine horizontal brushing with a few deeper scratches
TEX.steelBump = _tex(128, (c, s) => {
  c.fillStyle = 'rgb(128,128,128)'; c.fillRect(0, 0, s, s);
  for (let y = 0; y < s; y++) { const v = 116 + Math.floor(TEXR() * 24); c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.5)'; c.fillRect(0, y, s, 1); }
  for (let i = 0; i < 9; i++) { const y = TEXR() * s; c.fillStyle = 'rgba(80,80,80,0.5)'; c.fillRect(0, y, s, 1); }
});
// ROCK: granite blotch + pit speckle
TEX.rockMap = _tex(256, (c, s) => _blotch(c, s, 238, [[50, 20, 44, 0.15, 0.15, 212], [160, 3, 8, 0.18, 0.2, 255], [130, 2, 6, 0.2, 0.24, 200]]));
TEX.rockBump = _tex(256, (c, s) => _blotch(c, s, 128, [[36, 26, 50, 0.3, 0.25, 88], [70, 10, 22, 0.25, 0.3, 170], [240, 2, 5, 0.3, 0.35, 98]]));
// FRESHLY GROOMED: tight corduroy grooves running downhill + faint groomer
// pass-seams — replaces the powder-dune fluff on machine-groomed parks
TEX.groomBump = _tex(256, (c, s) => {
  c.fillStyle = 'rgb(128,128,128)'; c.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x++) {
    const v = 128 + Math.round(34 * Math.sin(x * Math.PI * 2 / 4)); // ~4cm grooves
    c.fillStyle = 'rgba(' + v + ',' + v + ',' + v + ',0.85)'; c.fillRect(x, 0, 1, s);
  }
  for (let i = 0; i < 3; i++) { const x = 20 + Math.floor(TEXR() * 216); c.fillStyle = 'rgba(88,88,88,0.7)'; c.fillRect(x, 0, 2, s); } // pass seams
  _blotch(c, s, -1, [[24, 8, 16, 0.06, 0.06, 150]]); // whisper of unevenness only
});
TEX.groomMap = _tex(256, (c, s) => {
  c.fillStyle = 'rgb(249,249,249)'; c.fillRect(0, 0, s, s);
  for (let x = 0; x < s; x += 4) { c.fillStyle = 'rgba(232,236,244,0.5)'; c.fillRect(x, 0, 1, s); }
  for (let i = 0; i < 3; i++) { const x = 20 + Math.floor(TEXR() * 216); c.fillStyle = 'rgba(225,230,240,0.8)'; c.fillRect(x, 0, 2, s); }
});
function rep(t, x, y) { const c = t.clone(); c.needsUpdate = true; c.repeat.set(x, y); return c; }
function woodLam(col, rx = 1.6, ry = 1.6) {
  return new THREE.MeshLambertMaterial({ color: col, map: rep(TEX.woodMap, rx, ry), bumpMap: rep(TEX.woodBump, rx, ry), bumpScale: 0.16 });
}
const CLOTH_B = rep(TEX.clothBump, 3, 3);
// RAGGED: breaks a cone's silhouette into drooping branch tips
function ragged(geo, amp, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y2 = p.getY(i), z = p.getZ(i);
    const r = Math.hypot(x, z);
    if (r < 0.02) continue;
    const a = Math.atan2(z, x);
    const w = 1 + amp * (Math.sin(a * 5 + y2 * 7 + seed) * 0.6 + Math.sin(a * 11 - y2 * 3.7 + seed * 2) * 0.4);
    p.setX(i, x * w); p.setZ(i, z * w);
    p.setY(i, y2 - r * amp * 0.9 * (0.5 + 0.5 * Math.sin(a * 7 + seed)));
  }
  geo.computeVertexNormals();
  return geo;
}
// LUMPY: turns an icosphere into a weathered boulder
function lumpy(geo, amp, seed) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y2 = p.getY(i), z = p.getZ(i);
    const w = 1 + amp * (Math.sin(x * 2.1 + seed) + Math.sin(y2 * 2.7 + seed * 2) + Math.sin(z * 3.3 + seed * 3)) / 3 +
      amp * 0.4 * Math.sin(x * 5.9 + y2 * 4.3 + z * 5.1 + seed);
    p.setXYZ(i, x * w, y2 * w, z * w);
  }
  geo.computeVertexNormals();
  return geo;
}
const rndTerrain = SIM.mulberry32(777);
{
  // sculpture-grade mesh on K Sessions: 2x sampling keeps carved edges crisp
  // instead of smearing them across 1.4m cells
  const S_STEP = SIM.MAP_ID === 'kimbo' ? 0.85 : SIM.MAP_ID === 'lax' ? 0.9 : 1.1, L_STEP = SIM.MAP_ID === 'kimbo' ? 0.65 : SIM.MAP_ID === 'lax' ? 0.7 : 0.8, L_HALF = 66; // fine mesh everywhere: crisp cut edges [user]
  const rows = Math.floor(SIM.TRACK_LEN / S_STEP) + 1;
  const cols = Math.floor((L_HALF * 2) / L_STEP) + 1;
  const verts = new Float32Array(rows * cols * 3);
  const colors = new Float32Array(rows * cols * 3);
  const uvs = new Float32Array(rows * cols * 2);
  const idx = [];
  const n = { s: 0, l: 0, y: 1 };
  const c = new THREE.Color();
  for (let r = 0; r < rows; r++) {
    const s = r * S_STEP;
    for (let q = 0; q < cols; q++) {
      const l = -L_HALF + q * L_STEP;
      const y = SIM.terrainH(s, l);
      const i = (r * cols + q) * 3;
      verts[i] = l; verts[i + 1] = y; verts[i + 2] = -s;
      const iu = (r * cols + q) * 2; uvs[iu] = l * 0.4; uvs[iu + 1] = s * 0.4;
      // HAND-PAINTED SNOW: broad, soft gouache washes — low-frequency drift so
      // large areas never feel flat, never noisy. Cream in the light, cool blue
      // in the hollows, a warm kiss where the low sun rakes across.
      SIM.terrainNormal(s, l, n);
      const w1 = Math.sin(s * 0.021 + l * 0.043) * Math.sin(s * 0.0083 - l * 0.017 + 2.1);
      const w2 = Math.sin(s * 0.061 - l * 0.029 + 4.2);
      const wash = Math.min(1, Math.max(0, 0.5 + 0.32 * w1 + 0.2 * w2));
      c.copy(PAL.snowA).lerp(PAL.snowB, wash);
      const sunDot = Math.max(0, n.l * -0.5 + n.y * 0.62 - n.s * 0.3);
      c.lerp(PAL.shade, (1 - sunDot) * (DAY ? 0.13 : 0.26));       // softer shadows in daylight
      if (DAY) c.lerp(SKYMODE === 'sunset' ? _sunsetWarm : _dayWarm, Math.max(0, sunDot - 0.6) * (SKYMODE === 'sunset' ? 0.45 : 0.3)); // warm sun kiss, golden at dusk
      else c.lerp(PAL.moonlit, Math.max(0, sunDot - 0.7) * 0.35);  // cool moonlit faces
      // weathered rock on steep faces, moss creeping where it can hold — but
      // NOT at Kimbo: every steep face there is a BUILT snow feature [R], the
      // walls and volcano stay white like the footage
      if (SIM.MAP_ID !== 'kimbo') {
        if (n.y < 0.55) {
          c.lerp(PAL.slate, 0.62);
          c.lerp(PAL.moss, Math.max(0, Math.sin(s * 0.09 + l * 0.15)) * 0.16);
        } else if (n.y < 0.66) c.lerp(PAL.slate, 0.26);
      }
      if (Math.abs(l - SIM.centerline(s)) < 14 && Math.sin(s * 1.3) > 0.65) c.multiplyScalar(0.994); // whisper of corduroy
      // soft gold feature marking (readability, gently)
      for (const k of SIM.KICKERS) {
        if (Math.abs(s - k.s0) < 1.1 && Math.abs(l - k.lc) < 9) c.lerp(PAL.yellow, 0.42);
        if (Math.abs(s - (k.s0 + k.T)) < 0.8 && Math.abs(l - k.lc) < 7) c.lerp(PAL.orange, 0.3);
      }
      for (const j of SIM.JIB_LIPS) {
        if (s >= j.s0 && s <= j.s1 && Math.abs(l - j.l) < 1.9) c.lerp(PAL.yellow, 0.24);
      }
      colors[i] = c.r; colors[i + 1] = c.g; colors[i + 2] = c.b;
    }
  }
  for (let r = 0; r < rows - 1; r++) for (let q = 0; q < cols - 1; q++) {
    const a = r * cols + q, b = a + 1, d = a + cols, e = d + 1;
    idx.push(a, b, d, b, e, d); // CCW from above — face normals up
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // K Sessions is machine-groomed corduroy; the mountain runs keep wind-worked powder
  const GROOMED = SIM.MAP_ID === 'kimbo';
  window.__terrain = new THREE.Mesh(g, new THREE.MeshLambertMaterial({
    vertexColors: true, flatShading: false,
    map: rep(GROOMED ? TEX.groomMap : TEX.snowMap, 1, 1),
    bumpMap: rep(GROOMED ? TEX.groomBump : TEX.snowBump, 1, 1),
    bumpScale: GROOMED ? 0.18 : 0.4,
  }));
  window.__terrain.receiveShadow = true;
  scene.add(window.__terrain);
}

// ---------------- rails & boxes: segmented, terrain-following park builds ----------------
{
  // rail steel: Kläppen paints its park features red — LAX runs signal-red tubes
  const railMat = new THREE.MeshPhongMaterial({ color: DAY ? 0xd23a2e : PAL.yellow.getHex(), shininess: 62,
    specular: 0x666666, bumpMap: rep(TEX.steelBump, 1, 3), bumpScale: 0.02 });
  const legMat = new THREE.MeshLambertMaterial({ color: PAL.slate.getHex(), bumpMap: rep(TEX.steelBump, 1, 2), bumpScale: 0.03 });
  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xa6adb6, map: rep(TEX.rockMap, 1.4, 1.4), bumpMap: rep(TEX.steelBump, 1.5, 1.5), bumpScale: 0.04 });
  const topMat = new THREE.MeshPhongMaterial({ color: 0xf2ede2, shininess: 44, specular: 0x555555,
    bumpMap: rep(TEX.steelBump, 0.6, 4), bumpScale: 0.025 }); // waxed slide surface, scuffed along its length
  const _yUp = new THREE.Vector3(0, 1, 0), _d = new THREE.Vector3();
  const tube = (x1, y1, z1, x2, y2, z2, rad, mat, sides = 7) => {
    _d.set(x2 - x1, y2 - y1, z2 - z1);
    const len = _d.length();
    const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, sides), mat);
    m.position.set((x1 + x2) / 2, (y1 + y2) / 2, (z1 + z2) / 2);
    m.quaternion.setFromUnitVectors(_yUp, _d.normalize());
    scene.add(m);
    return m;
  };
  for (const r of SIM.RAILS) {
    const topAt = (s) => SIM.railTopY(r, s) - 0.03; // arches, kinks, cannons render from the same profile physics uses
    if (r.type === 'box') {
      // solid box body rising out of the snow, pale slide top, yellow edge tubes
      const SEG = 2.2;
      for (let s = r.s0; s < r.s1 - 0.01; s += SEG) {
        const s2 = Math.min(s + SEG, r.s1);
        const mid = (s + s2) / 2, len = s2 - s;
        const yA = topAt(s), yB = topAt(s2), yTop = (yA + yB) / 2;
        const gy = SIM.terrainH(mid, r.l);
        const tilt = -Math.atan2(yA - yB, len);
        const h = yTop - gy + 0.4;
        const body = new THREE.Mesh(new THREE.BoxGeometry(r.w * 2, h, len), bodyMat);
        body.position.set(r.l, yTop - h / 2, -mid);
        const top = new THREE.Mesh(new THREE.BoxGeometry(r.w * 2 + 0.05, 0.07, len + 0.04), topMat);
        top.position.set(r.l, yTop + 0.035, -mid); top.rotation.x = tilt;
        scene.add(body, top);
        for (const e of [-1, 1]) {
          const edge = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.06, len + 0.04), railMat);
          edge.position.set(r.l + e * (r.w - 0.02), yTop + 0.09, -mid); edge.rotation.x = tilt;
          scene.add(edge);
        }
      }
    } else if (r.type === 'ridge') {
      // the LODGE roof-ridge beam: a proud steel tube along the peak — the roof
      // itself carries it, so no snow legs or end caps
      const SEG = 2.6;
      for (let s = r.s0; s < r.s1 - 0.01; s += SEG) {
        const s2 = Math.min(s + SEG, r.s1);
        tube(r.l, topAt(s), -s, r.l, topAt(s2), -s2, 0.09, railMat);
      }
    } else if (r.type === 'tube') {
      // THE FLAT TUBE [R]: fat black pipe on its mound, downhill end elbowing
      // straight down into the snow — no legs, it sits proud of the drift
      const fat = 0.16;
      const tubeM = new THREE.MeshPhongMaterial({ color: 0x1c1e22, shininess: 58, specular: 0x555555 });
      const SEG = 2.4;
      for (let s = r.s0; s < r.s1 - 0.01; s += SEG) {
        const s2 = Math.min(s + SEG, r.s1);
        tube(r.l, topAt(s), -s, r.l, topAt(s2), -s2, fat, tubeM, 10);
      }
      tube(r.l, topAt(r.s1) + 0.02, -r.s1, r.l, SIM.terrainH(r.s1 + 0.7, r.l) - 0.35, -(r.s1 + 0.7), fat, tubeM, 10); // the elbow
      tube(r.l, SIM.terrainH(r.s0 + 1, r.l) - 0.2, -(r.s0 + 1), r.l, topAt(r.s0 + 1) - 0.06, -(r.s0 + 1), 0.06, legMat, 6);
    } else {
      // round tube following the snow line + round legs into the snow;
      // rainbows get fine segments so the arch reads ROUND, not angular
      const SEG = r.type === 'rainbow' ? 1.1 : 2.6;
      for (let s = r.s0; s < r.s1 - 0.01; s += SEG) {
        const s2 = Math.min(s + SEG, r.s1);
        tube(r.l, topAt(s), -s, r.l, topAt(s2), -s2, 0.075, railMat);
      }
      for (let s = r.s0 + 0.6; s <= r.s1 - 0.4; s += 2.6) {
        tube(r.l, SIM.terrainH(s, r.l) - 0.25, -s, r.l, topAt(s) - 0.06, -s, 0.05, legMat, 6);
      }
      // end caps angle down into the snow
      tube(r.l, topAt(r.s0), -r.s0, r.l, SIM.terrainH(r.s0 - 0.9, r.l) + 0.05, -(r.s0 - 0.9), 0.07, railMat);
      tube(r.l, topAt(r.s1), -r.s1, r.l, SIM.terrainH(r.s1 + 0.9, r.l) + 0.05, -(r.s1 + 0.9), 0.07, railMat);
    }
  }
  // park markers: orange takeoff flags at kicker lips + start-of-feature dye is baked in terrain
  const markM = new THREE.MeshLambertMaterial({ color: PAL.orange.getHex(), flatShading: false });
  for (const k of SIM.KICKERS) {
    for (const side of [-6.6, 6.6]) {
      const lx = k.lc + side;
      const y = SIM.terrainH(k.s0 - 0.5, lx);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.7, 6), markM);
      cone.position.set(lx, y + 0.35, -(k.s0 - 0.5));
      scene.add(cone);
    }
  }

  // ---------------- CRYSTAL CAVE: rock tunnel over the jib section, lit by crystals ----------------
  if (SIM.CAVE) {
    const CV = SIM.CAVE;
    const rnd = SIM.mulberry32(4242);
    // shell: chunky boulders packed into two walls and a ceiling arch that
    // follows the winding centerline — hand-set, craggy, stylized
    const rockG = lumpy(new THREE.IcosahedronGeometry(1, 2), 0.24, 7);
    const shellM = new THREE.MeshLambertMaterial({ color: 0x39415a, map: rep(TEX.rockMap, 1.5, 1.5), bumpMap: rep(TEX.rockBump, 1.5, 1.5), bumpScale: 0.3 });
    const shellM2 = new THREE.MeshLambertMaterial({ color: 0x4a4266, map: rep(TEX.rockMap, 2, 2), bumpMap: rep(TEX.rockBump, 2, 2), bumpScale: 0.3 }); // violet-washed chunks
    const steps = [];
    for (let s = CV.s0; s <= CV.s1; s += 3) steps.push(s);
    const perStep = 9;
    const nSh = steps.length * perStep;
    const shellA = new THREE.InstancedMesh(rockG, shellM, Math.ceil(nSh / 2));
    const shellB = new THREE.InstancedMesh(rockG, shellM2, Math.ceil(nSh / 2));
    const tmp2 = new THREE.Object3D();
    let ia = 0, ib = 0, k2 = 0;
    for (const s of steps) {
      const cl = SIM.centerline(s);
      const fy = SIM.terrainH(s, cl);
      for (let j = 0; j < perStep; j++) {
        const th = (0.08 + (j / (perStep - 1)) * 0.84) * Math.PI; // 15°..165° arch
        const rr = CV.r - 1 + rnd() * 2.5;
        tmp2.position.set(cl + Math.cos(th) * rr, fy + 0.6 + Math.sin(th) * rr * 0.75, -(s + rnd() * 2.6 - 1.3));
        tmp2.scale.setScalar(2.4 + rnd() * 2.2);
        tmp2.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        tmp2.updateMatrix();
        if (k2++ % 2 === 0) shellA.setMatrixAt(ia++, tmp2.matrix);
        else shellB.setMatrixAt(ib++, tmp2.matrix);
      }
    }
    shellA.count = ia; shellB.count = ib; // no stray identity instances at the origin
    scene.add(shellA, shellB);
    // portal rings: extra-large boulders crowning both mouths
    for (const ps of [CV.s0 - 2, CV.s1 + 2]) {
      const cl = SIM.centerline(ps), fy = SIM.terrainH(ps, cl);
      for (let j = 0; j < 7; j++) {
        const th = (0.1 + (j / 6) * 0.8) * Math.PI;
        const m = new THREE.Mesh(rockG, shellM);
        m.position.set(cl + Math.cos(th) * (CV.r + 1.5), fy + 0.6 + Math.sin(th) * (CV.r + 1.5) * 0.75, -ps);
        m.scale.setScalar(3.6 + rnd() * 2);
        m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
        scene.add(m);
      }
    }
    // CRYSTALS: glowing shards studding walls, ceiling, and floor edges
    const CRYSTAL_COLS = [0x8ff2d3, 0xf29ad2, 0xa88df2, 0x8fc9f2, 0xf2d98a];
    const shardG = new THREE.OctahedronGeometry(0.5, 0);
    const shardM = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const nCr = 110;
    const shards = new THREE.InstancedMesh(shardG, shardM, nCr);
    const col = new THREE.Color();
    for (let i = 0; i < nCr; i++) {
      const s = CV.s0 + 6 + rnd() * (CV.s1 - CV.s0 - 12);
      const cl = SIM.centerline(s);
      const fy = SIM.terrainH(s, cl);
      const th = rnd() * Math.PI;
      const onFloor = rnd() < 0.3;
      const rr = onFloor ? 9 + rnd() * 4 : CV.r - 2.2 - rnd() * 1.5;
      const x = cl + Math.cos(th) * rr;
      const y = onFloor ? SIM.terrainH(s, x) + 0.3 : fy + 0.6 + Math.sin(th) * rr * 0.75;
      tmp2.position.set(x, y, -s);
      tmp2.scale.set(0.6 + rnd() * 0.8, 1.6 + rnd() * 2.4, 0.6 + rnd() * 0.8); // elongated shards
      tmp2.rotation.set((rnd() - 0.5) * 1.2, rnd() * 3.14, (rnd() - 0.5) * 1.2);
      tmp2.updateMatrix();
      shards.setMatrixAt(i, tmp2.matrix);
      col.setHex(CRYSTAL_COLS[Math.floor(rnd() * CRYSTAL_COLS.length)]);
      shards.setColorAt(i, col);
    }
    scene.add(shards);
    // colored light wash pooling on the snow beneath the clusters
    const LIGHTS = [0x8ff2d3, 0xf29ad2, 0xa88df2, 0x8fc9f2, 0xf2d98a, 0x8ff2d3];
    LIGHTS.forEach((cc, i) => {
      const s = CV.s0 + 14 + (i / (LIGHTS.length - 1)) * (CV.s1 - CV.s0 - 28);
      const cl = SIM.centerline(s);
      const pl = new THREE.PointLight(cc, 14, 34, 1.6);
      pl.position.set(cl, SIM.terrainH(s, cl) + 8, -s);
      scene.add(pl);
    });
  }

  // ---------------- CAVE MOUNTAIN [user]: the crystal cave is BUILT INTO a
  // real mountain — snow-capped shell over the whole tunnel, trees on top ----
  if (SIM.CAVE && SIM.MAP_ID === 'bluebird') {
    const CV = SIM.CAVE;
    const rockWallM = new THREE.MeshLambertMaterial({ color: 0x4c5266, map: rep(TEX.rockMap, 3, 2.2), bumpMap: rep(TEX.rockBump, 3, 2.2), bumpScale: 0.4 });
    const driftM = new THREE.MeshLambertMaterial({ color: 0xeef1f6, map: rep(TEX.snowMap, 3, 3), bumpMap: rep(TEX.snowBump, 3, 3), bumpScale: 0.45 });
    const rT = SIM.mulberry32(919);
    const driftG = lumpy(new THREE.SphereGeometry(1, 14, 10), 0.14, 11); // soft irregular snow bodies
    const trunkM = new THREE.MeshLambertMaterial({ color: 0x5a4633 });
    const coneM = new THREE.MeshLambertMaterial({ color: 0x33584a });
    const capM2 = new THREE.MeshLambertMaterial({ color: 0xeef1f6 });
    const tree = (tx, ty, tz, tsc) => {
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * tsc, 0.13 * tsc, 0.8 * tsc, 5), trunkM);
      trunk.position.set(tx, ty + 0.4 * tsc, tz); scene.add(trunk);
      const cone = new THREE.Mesh(new THREE.ConeGeometry(0.85 * tsc, 2.2 * tsc, 7), coneM);
      cone.position.set(tx, ty + 1.7 * tsc, tz); scene.add(cone);
      const cp = new THREE.Mesh(new THREE.ConeGeometry(0.55 * tsc, 0.7 * tsc, 7), capM2);
      cp.position.set(tx, ty + 2.6 * tsc, tz); scene.add(cp);
    };
    const segStep = 20;
    for (let sSeg = CV.s0 - 4; sSeg <= CV.s1 + 4; sSeg += segStep) {
      const cl2 = SIM.centerline(sSeg);
      const fy = SIM.terrainH(sSeg, cl2);
      const topY = fy + 16.5;
      for (const sd of [-1, 1]) {
        // solid rock flank: tunnel edge out to the map wall
        const wall = new THREE.Mesh(new THREE.BoxGeometry(27, 26, segStep * 1.03), rockWallM);
        wall.position.set(cl2 + sd * 32.5, fy + 3.5, -sSeg);
        scene.add(wall);
      }
      // NATURAL snowpack [user]: overlapping wind-blown drifts LAID over the
      // rock — rolling and irregular, not a slab
      const nDrift = 4;
      for (let i = 0; i < nDrift; i++) {
        const dl = (i / (nDrift - 1)) * 2 - 1; // spread across the top
        const d = new THREE.Mesh(driftG, driftM);
        d.scale.set(15 + rT() * 8, 2.6 + rT() * 1.8, 12 + rT() * 6);
        d.position.set(cl2 + dl * 30 + (rT() - 0.5) * 6, topY + 0.4, -(sSeg + (rT() - 0.5) * 7));
        d.rotation.y = rT() * 3.14;
        scene.add(d);
      }
      // MANY trees rooted in the snowpack [user]
      for (let i = 0; i < 9; i++) {
        const tx = cl2 + (rT() * 2 - 1) * 40, tz = -(sSeg + (rT() * 2 - 1) * segStep * 0.48);
        tree(tx, topY + 1.9 + rT() * 1.2, tz, 0.5 + rT() * 0.75);
      }
    }
    // PORTAL FACES [user]: rock walls close off the outside of each entrance —
    // you ski INTO a massif, not past a free-standing pipe
    for (const [pS, dir] of [[CV.s0 - 7, 1], [CV.s1 + 7, -1]]) {
      const clP = SIM.centerline(pS);
      const fyP = SIM.terrainH(pS, clP);
      for (const sd of [-1, 1]) {
        const face = new THREE.Mesh(new THREE.BoxGeometry(28, 27, 7), rockWallM);
        face.position.set(clP + sd * 33, fyP + 4, -pS);
        scene.add(face);
        // drift on the face top
        const d = new THREE.Mesh(driftG, driftM);
        d.scale.set(13, 2.4, 5.5);
        d.position.set(clP + sd * 31, fyP + 17.9, -pS);
        scene.add(d);
        tree(clP + sd * 30 + 2, fyP + 19.2, -pS + 1.5, 0.6 + 0.3 * sd * dir * 0.2);
      }
    }
  }

  // ---------------- WATERFALL + STREAM [user]: the falls pour off the cave
  // cliff and feed a creek winding through the forest jump line ----------------
  if (SIM.MAP_ID === 'bluebird' && SIM.streamL) {
    const wfS = 437;
    const wfL = SIM.streamL(SIM.STREAM.s0 + 2);
    const topY = SIM.terrainH(wfS - 3, wfL);
    const botY = SIM.terrainH(SIM.STREAM.s0 + 2, wfL);
    const wMat = new THREE.MeshLambertMaterial({ color: 0x7fc4e8, transparent: true, opacity: 0.82 });
    const wMat2 = new THREE.MeshLambertMaterial({ color: 0xd9f0fa, transparent: true, opacity: 0.65 });
    const fall = new THREE.Mesh(new THREE.PlaneGeometry(5.2, topY - botY + 2), wMat);
    fall.position.set(wfL, (topY + botY) / 2 + 0.6, -(wfS + 4.5));
    scene.add(fall);
    const fall2 = new THREE.Mesh(new THREE.PlaneGeometry(3.4, topY - botY + 1), wMat2);
    fall2.position.set(wfL + 0.6, (topY + botY) / 2 + 0.9, -(wfS + 4.2));
    fall2.rotation.y = 0.15;
    scene.add(fall2);
    const foam = new THREE.Mesh(new THREE.CylinderGeometry(3.6, 3.6, 0.3, 14), wMat2);
    foam.position.set(wfL, botY + 0.12, -(SIM.STREAM.s0 + 3));
    scene.add(foam);
    // the creek: a ribbon following streamL(s) hugging the terrain
    const pts = [];
    for (let s2 = SIM.STREAM.s0; s2 <= SIM.STREAM.s1; s2 += 3) pts.push(s2);
    const n2 = pts.length;
    const pos2 = new Float32Array(n2 * 2 * 3);
    const idx = [];
    for (let i = 0; i < n2; i++) {
      const s2 = pts[i], l2 = SIM.streamL(s2);
      const y2 = SIM.terrainH(s2, l2) + 0.07;
      pos2[i * 6] = l2 - 3; pos2[i * 6 + 1] = y2; pos2[i * 6 + 2] = -s2; // 6m wide creek [user]
      pos2[i * 6 + 3] = l2 + 3; pos2[i * 6 + 4] = y2; pos2[i * 6 + 5] = -s2;
      if (i > 0) { const a3 = (i - 1) * 2; idx.push(a3, a3 + 1, a3 + 2, a3 + 1, a3 + 3, a3 + 2); }
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(pos2, 3));
    sg.setIndex(idx);
    sg.computeVertexNormals();
    const stream = new THREE.Mesh(sg, new THREE.MeshLambertMaterial({ color: 0x6db8e0, transparent: true, opacity: 0.85 }));
    scene.add(stream);
  }

  // ---------------- THE LODGE: grand timber ski lodge under the gap jump ----------------
  if (SIM.LODGE) {
    const L = SIM.LODGE;
    const mid = (L.s0 + L.s1) / 2, len = L.s1 - L.s0;
    const by = SIM.terrainH(mid, L.l);
    const g2 = new THREE.Group();
    const WOODY = { 0x8a6449: 1, 0x6a513c: 1, 0x5a4636: 1, 0x6a5343: 1 };
    const mk = (geo, col, x, y, z) => {
      const m = new THREE.Mesh(geo, WOODY[col] ? woodLam(col) : new THREE.MeshLambertMaterial({ color: col }));
      m.position.set(x, y, z); g2.add(m); return m;
    };
    // stone foundation + timber walls
    mk(new THREE.BoxGeometry(L.halfW * 2 + 0.6, 1.0, len + 0.6), 0x8d8a85, 0, 0.5, 0);
    mk(new THREE.BoxGeometry(L.halfW * 2, L.wallH - 0.6, len), 0x8a6449, 0, 0.6 + (L.wallH - 0.6) / 2, 0);
    // roof: two snow-laden panels meeting just under the ridge rail
    const RH = L.ridgeH - 0.45; // panel apex sits below the beam so the rail reads proud
    const ovh = 0.7;
    const slopeW = Math.sqrt((L.halfW + ovh) ** 2 + (RH - L.wallH) ** 2);
    const ang = Math.atan2(RH - L.wallH, L.halfW + ovh);
    for (const sgn of [-1, 1]) {
      const p = mk(new THREE.BoxGeometry(slopeW, 0.2, len + 1.4), 0x6a513c, sgn * (L.halfW + ovh) / 2, (L.wallH + RH) / 2, 0);
      p.rotation.z = -sgn * ang;
      const snow = mk(new THREE.BoxGeometry(slopeW * 0.98, 0.15, len + 1.4), PAL.snowA.getHex(), sgn * (L.halfW + ovh) / 2, (L.wallH + RH) / 2 + 0.16, 0);
      snow.rotation.z = -sgn * ang;
    }
    // ridge-beam support blocks up to the rail
    for (let z = -len / 2 + 1; z <= len / 2 - 1; z += 4) {
      mk(new THREE.BoxGeometry(0.14, 0.5, 0.14), 0x4a5568, 0, RH + 0.2, z);
    }
    // gable ends
    const tri = new THREE.Shape();
    tri.moveTo(-L.halfW, L.wallH - 0.05); tri.lineTo(L.halfW, L.wallH - 0.05); tri.lineTo(0, RH); tri.closePath();
    const triG = new THREE.ShapeGeometry(tri);
    for (const zs of [-1, 1]) {
      const gm = woodLam(0x8a6449); gm.side = THREE.DoubleSide;
      const m = new THREE.Mesh(triG, gm);
      m.position.set(0, 0, zs * len / 2); g2.add(m);
    }
    // warm lit windows down both long sides + a glowing gable window facing the jump
    const winM = new THREE.MeshBasicMaterial({ color: 0xffd08f });
    for (let i = -2; i <= 2; i++) for (const sgn of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.0), winM);
      w.position.set(sgn * (L.halfW + 0.02), 1.7, i * 4.2);
      w.rotation.y = sgn * Math.PI / 2;
      g2.add(w);
    }
    const gw = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.6), winM);
    gw.position.set(0, L.wallH + 0.45, len / 2 + 0.03); g2.add(gw);
    // door on the downhill face + a stout chimney
    mk(new THREE.BoxGeometry(1.6, 2.2, 0.15), 0x5a4636, 0, 1.1, -len / 2 - 0.06);
    mk(new THREE.BoxGeometry(1.0, 2.4, 1.0), 0x6a5343, L.halfW - 1.8, RH + 0.3, -len / 4);
    g2.position.set(L.l, by, -mid);
    scene.add(g2);
  }
}

// ---------------- decor: instanced trees & rocks, ridgeline, gates ----------------
{
  const decor = SIM.buildDecor(20260705);
  const tmp = new THREE.Object3D();
  // TREES: three soft layered foliage tiers (sage -> pine -> deep) with a gentle
  // cap of settled snow — rounded, hand-set, varied by scale and rotation
  const trunkG = new THREE.CylinderGeometry(0.15, 0.26, 1.6, 9);
  const coneG = ragged(new THREE.ConeGeometry(1.6, 2.7, 14, 5), 0.15, 11);
  const cone2G = ragged(new THREE.ConeGeometry(1.2, 2.2, 14, 4), 0.16, 23);
  const cone3G = ragged(new THREE.ConeGeometry(0.78, 1.7, 12, 3), 0.17, 37);
  const capG = ragged(new THREE.ConeGeometry(0.54, 0.7, 12, 2), 0.11, 51);
  const needleB = rep(TEX.rockBump, 2.4, 2.4); // reused as fine needle noise
  const trunkM = new THREE.MeshLambertMaterial({ color: PAL.trunk.getHex(), map: rep(TEX.woodMap, 1, 2), bumpMap: rep(TEX.woodBump, 1, 2), bumpScale: 0.22 });
  const pineM = new THREE.MeshLambertMaterial({ color: PAL.pine.getHex(), bumpMap: needleB, bumpScale: 0.12 });
  const pine2M = new THREE.MeshLambertMaterial({ color: PAL.pineDark.getHex(), bumpMap: needleB, bumpScale: 0.12 });
  const pine3M = new THREE.MeshLambertMaterial({ color: PAL.pineDeep.getHex(), bumpMap: needleB, bumpScale: 0.12 });
  const snowM = new THREE.MeshLambertMaterial({ color: PAL.snowA.getHex(), bumpMap: rep(TEX.snowBump, 1.5, 1.5), bumpScale: 0.1 });
  const n = decor.trees.length;
  const trunks = new THREE.InstancedMesh(trunkG, trunkM, n);
  const cones = new THREE.InstancedMesh(coneG, pineM, n);
  const cones2 = new THREE.InstancedMesh(cone2G, pine2M, n);
  const cones3 = new THREE.InstancedMesh(cone3G, pine3M, n);
  const caps = new THREE.InstancedMesh(capG, snowM, n);
  decor.trees.forEach((t, i) => {
    tmp.position.set(t.l, t.y + 0.7 * t.sc, -t.s); tmp.scale.setScalar(t.sc); tmp.rotation.y = t.s * 1.7;
    tmp.updateMatrix(); trunks.setMatrixAt(i, tmp.matrix);
    tmp.position.y = t.y + 2.5 * t.sc; tmp.updateMatrix(); cones.setMatrixAt(i, tmp.matrix);
    tmp.position.y = t.y + 3.6 * t.sc; tmp.updateMatrix(); cones2.setMatrixAt(i, tmp.matrix);
    tmp.position.y = t.y + 4.5 * t.sc; tmp.updateMatrix(); cones3.setMatrixAt(i, tmp.matrix);
    tmp.position.y = t.y + 5.15 * t.sc; tmp.updateMatrix(); caps.setMatrixAt(i, tmp.matrix);
  });
  scene.add(trunks, cones, cones2, cones3, caps);
  // ROCKS: rounded, weathered boulders — half plain, half brushed with moss
  const rockG = lumpy(new THREE.IcosahedronGeometry(0.9, 2), 0.26, 5);
  const rockM = new THREE.MeshLambertMaterial({ color: PAL.slate.getHex(), map: rep(TEX.rockMap, 1.4, 1.4), bumpMap: rep(TEX.rockBump, 1.4, 1.4), bumpScale: 0.32 });
  const mossM = new THREE.MeshLambertMaterial({ color: 0x8a9479, map: rep(TEX.rockMap, 1.8, 1.8), bumpMap: rep(TEX.rockBump, 1.8, 1.8), bumpScale: 0.32 });
  const nr = decor.rocks.length;
  const rocksA = new THREE.InstancedMesh(rockG, rockM, Math.ceil(nr / 2));
  const rocksB = new THREE.InstancedMesh(rockG, mossM, Math.floor(nr / 2));
  decor.rocks.forEach((t, i) => {
    tmp.position.set(t.l, t.y + 0.3 * t.sc, -t.s);
    tmp.scale.set(t.sc, t.sc * 0.8, t.sc); // squashed = settled by weather
    tmp.rotation.set(t.s * 0.3, t.l, 0);
    tmp.updateMatrix();
    if (i % 2 === 0) rocksA.setMatrixAt(i >> 1, tmp.matrix);
    else rocksB.setMatrixAt(i >> 1, tmp.matrix);
  });
  scene.add(rocksA, rocksB);
  // CABINS: warm little shelters along the run — wood, stone, snow, lit windows
  function cabin(cs, dl, rot) {
    const cl = SIM.centerline(cs) + dl;
    const cy = SIM.terrainH(cs, cl);
    const g2 = new THREE.Group();
    const WOODY = { 0x8a6449: 1, 0x6a513c: 1, 0x5a4636: 1, 0x6a5343: 1 };
    const mk = (geo, col, x, y, z) => {
      const m = new THREE.Mesh(geo, WOODY[col] ? woodLam(col) : new THREE.MeshLambertMaterial({ color: col }));
      m.position.set(x, y, z); g2.add(m); return m;
    };
    mk(new THREE.BoxGeometry(4.6, 0.8, 3.8), 0x8d8a85, 0, 0.3, 0);            // stone foundation
    mk(new THREE.BoxGeometry(4.2, 2.2, 3.4), 0x8a6449, 0, 1.7, 0);            // walnut walls
    const roof = mk(new THREE.ConeGeometry(3.4, 1.8, 4), 0x6a513c, 0, 3.6, 0); roof.rotation.y = Math.PI / 4;
    const cap = mk(new THREE.ConeGeometry(3.5, 0.55, 4), 0xf8f4ec, 0, 4.3, 0); cap.rotation.y = Math.PI / 4; // snow-laden roof
    const win = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.7), new THREE.MeshBasicMaterial({ color: 0xffd08f }));
    win.position.set(-0.9, 1.8, 1.72); g2.add(win);                            // warm lit window
    const win2 = win.clone(); win2.position.x = 0.9; g2.add(win2);
    mk(new THREE.BoxGeometry(0.5, 1.1, 0.5), 0x6a5343, 1.6, 4.0, -0.8);        // chimney
    g2.position.set(cl, cy, -cs);
    g2.rotation.y = rot;
    scene.add(g2);
  }
  for (const [cs, dl, rot] of [[64, -27, 0.5], [238, 25, -0.6], [1238, -21, 0.3]]) {
    if (cs < SIM.TRACK_LEN - 40 && !(SIM.CAVE && cs > SIM.CAVE.s0 - 10 && cs < SIM.CAVE.s1 + 10)) cabin(cs, dl, rot);
  }

  // far landscape: Bluebird = jagged night peaks; LAX = low rolling forested
  // Swedish hills, the Dalarna horizon — broad, gentle, tree-dark with pale tops
  const rr = SIM.mulberry32(99);
  if (DAY) {
    const hillM = new THREE.MeshLambertMaterial({ color: 0x5e7a6a, flatShading: false });   // distant pine
    const hillFarM = new THREE.MeshLambertMaterial({ color: 0x93aebc, flatShading: false }); // haze-blue far line
    for (let i = 0; i < 16; i++) {
      const far = i % 3 === 0;
      const h = far ? 60 + rr() * 70 : 30 + rr() * 45;
      const w = 180 + rr() * 260;
      const m = new THREE.Mesh(new THREE.ConeGeometry(w, h, 6), far ? hillFarM : hillM);
      m.scale.y = 0.55; // squat, rolling — nothing alpine here
      const side = i % 2 === 0 ? -1 : 1;
      m.position.set(side * (170 + rr() * 420), SIM.terrainH(SIM.TRACK_LEN, 0) - 25 + (h * 0.55) / 2 - 18, -(250 + rr() * 900));
      scene.add(m);
      if (!far) { // pale snow cap peeking through the trees
        const cap = new THREE.Mesh(new THREE.ConeGeometry(w * 0.35, h * 0.3, 6), new THREE.MeshLambertMaterial({ color: 0xeef3f6 }));
        cap.scale.y = 0.55;
        cap.position.set(m.position.x, m.position.y + h * 0.28, m.position.z);
        scene.add(cap);
      }
    }
  } else {
    const ridgeM = new THREE.MeshLambertMaterial({ color: 0xc2bcd6, flatShading: false });
    for (let i = 0; i < 14; i++) {
      const h = 120 + rr() * 260;
      const m = new THREE.Mesh(new THREE.ConeGeometry(90 + rr() * 160, h, 5), ridgeM);
      const side = i % 2 === 0 ? -1 : 1;
      m.position.set(side * (150 + rr() * 380), SIM.terrainH(SIM.TRACK_LEN, 0) - 60 + h / 2 - 40, -(300 + rr() * 1300));
      scene.add(m);
    }
  }
  // ---------------- LAX extras: the drag lift, event flags, and the DJ tower ----------------
  if (DAY) {
    const steelM = new THREE.MeshLambertMaterial({ color: 0x6a7280, bumpMap: rep(TEX.steelBump, 1, 2), bumpScale: 0.03 });
    const redM = new THREE.MeshLambertMaterial({ color: 0xd23a2e });
    const blackM = new THREE.MeshLambertMaterial({ color: 0x2b2f38 });
    const woodM = woodLam(0x8a6449);
    // THE DRAG LIFT (the platter that serves the park): pylons up the right edge,
    // two cables strung between the heads, platter hangers dangling along the line
    const liftL = SIM.MAP_ID === 'kimbo' ? -24 : 36; // Kimbo's private T-bar runs the lap's left [R/O]
    const poleTop = (s) => SIM.terrainH(s, SIM.centerline(s) + liftL) + 6.5;
    const poles = [];
    for (let s = 30; s <= SIM.TRACK_LEN - (SIM.MAP_ID === 'kimbo' ? 70 : 110); s += (SIM.MAP_ID === 'kimbo' ? 30 : 36)) poles.push(s); // ~30m tower spacing [R]
    for (const s of poles) {
      const lx = SIM.centerline(s) + liftL;
      const gy = SIM.terrainH(s, lx);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.2, 6.8, 8), steelM);
      pole.position.set(lx, gy + 3.4, -s); scene.add(pole);
      const arm = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.16, 0.16), steelM);
      arm.position.set(lx, gy + 6.5, -s); scene.add(arm);
    }
    for (let i = 0; i < poles.length - 1; i++) {
      const sA = poles[i], sB = poles[i + 1];
      const lA = SIM.centerline(sA) + liftL, lB = SIM.centerline(sB) + liftL;
      for (const side of [-0.95, 0.95]) {
        const a = new THREE.Vector3(lA + side, poleTop(sA), -sA);
        const b = new THREE.Vector3(lB + side, poleTop(sB), -sB);
        const mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= 0.35; // cable sag
        const cable = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, a.distanceTo(b), 5), blackM);
        cable.position.copy(mid);
        cable.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
        scene.add(cable);
      }
      // a couple of platter hangers on the uphill cable
      for (const t of [0.33, 0.72]) {
        const hs = sA + (sB - sA) * t;
        const hl = SIM.centerline(hs) + liftL + 0.95;
        const hy = poleTop(hs) - 0.4;
        const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 5), blackM);
        rod.position.set(hl, hy - 1.2, -hs); scene.add(rod);
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.24, 0.06, 10), redM);
        disc.position.set(hl, hy - 2.4, -hs); scene.add(disc);
      }
    }
    // EVENT FLAGS: red and black pennants staking out the twin lines + rail garden
    const flagPole = (s, dl) => {
      const lx = SIM.centerline(s) + dl;
      const gy = SIM.terrainH(s, lx);
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 2.6, 6), blackM);
      p.position.set(lx, gy + 1.3, -s); scene.add(p);
      const tri = new THREE.Shape();
      tri.moveTo(0, 0); tri.lineTo(0.95, -0.22); tri.lineTo(0, -0.44); tri.closePath();
      const f = new THREE.Mesh(new THREE.ShapeGeometry(tri),
        new THREE.MeshLambertMaterial({ color: (s * 7 | 0) % 2 ? 0xd23a2e : 0x2b2f38, side: THREE.DoubleSide }));
      f.position.set(lx, gy + 2.55, -s); scene.add(f);
    };
    const flagZones = SIM.MAP_ID === 'kimbo'
      ? [[34, 102, 26], [138, 214, 40], [228, 354, 44], [398, 560, 30]]  // + transfer alley [photo 3]
      : [[264, 480, 24], [534, 700, 20]];  // twin lines + rail garden
    for (const [f0, f1, fw] of flagZones) for (let s = f0; s <= f1; s += 24) { flagPole(s, -fw); flagPole(s + 12, fw); }
    // THE DJ TOWER by the finish corral: scaffold deck, speaker stack, red banner
    {
      const ts = SIM.MAP_ID === 'kimbo' ? 22 : 752, tl = SIM.centerline(ts) + (SIM.MAP_ID === 'kimbo' ? 30 : -20); // staging area at the top [drone]
      const gy = SIM.terrainH(ts, tl);
      const g2 = new THREE.Group();
      const mk = (geo, mat, x2, y2, z2) => { const m = new THREE.Mesh(geo, mat); m.position.set(x2, y2, z2); g2.add(m); return m; };
      for (const sx of [-1.6, 1.6]) for (const sz of [-1.4, 1.4])
        mk(new THREE.CylinderGeometry(0.09, 0.09, 3.4, 6), steelM, sx, 1.7, sz);
      mk(new THREE.BoxGeometry(3.8, 0.18, 3.2), woodM, 0, 3.5, 0);                 // deck
      for (const sz of [-1.5, 1.5]) mk(new THREE.BoxGeometry(3.8, 0.08, 0.08), steelM, 0, 4.3, sz); // rails
      for (const sx of [-1.85, 1.85]) mk(new THREE.BoxGeometry(0.08, 0.08, 3.2), steelM, sx, 4.3, 0);
      mk(new THREE.BoxGeometry(1.1, 1.3, 0.9), blackM, -0.9, 4.25, 0);             // speaker stack
      mk(new THREE.BoxGeometry(0.9, 0.9, 0.75), blackM, -0.9, 5.35, 0);
      mk(new THREE.BoxGeometry(1.5, 0.75, 0.5), woodM, 0.75, 3.95, 0);             // decks table
      const ban = mk(new THREE.BoxGeometry(3.8, 0.6, 0.05), redM, 0, 2.6, 1.45);   // red banner
      ban.rotation.y = 0;
      g2.position.set(tl, gy, -ts);
      g2.rotation.y = 0.35;
      scene.add(g2);
    }
    // BLOCK-GARDEN PROPS [photo 2] — unbranded stand-ins for the park cube,
    // the energy-can barrel, and the parked snowcat
    if (SIM.MAP_ID === 'kimbo') {
      const cs = 312, cl = SIM.centerline(cs) - 26;
      const cube = new THREE.Mesh(new THREE.BoxGeometry(1.5, 1.5, 1.5),
        new THREE.MeshLambertMaterial({ color: 0x1d2026 }));
      cube.position.set(cl, SIM.terrainH(cs, cl) + 0.72, -cs);
      cube.rotation.y = 0.5;
      scene.add(cube);
      const bs = 232, bl = SIM.centerline(bs) - 2;
      const can = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 1.7, 12),
        new THREE.MeshPhongMaterial({ color: 0x1f8f4e, shininess: 40, specular: 0x333333 }));
      can.position.set(bl, SIM.terrainH(bs, bl) + 0.85, -bs);
      scene.add(can);
      const ss2 = 266, sl2 = SIM.centerline(ss2) + 38;
      const g3 = new THREE.Group();
      const mk3 = (geo, col, x2, y2, z2) => { const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: col })); m.position.set(x2, y2, z2); g3.add(m); };
      mk3(new THREE.BoxGeometry(2.2, 1.1, 4.6), 0xd23a2e, 0, 1.15, 0);
      mk3(new THREE.BoxGeometry(1.8, 0.9, 1.6), 0x2b2f38, 0, 2.1, 0.9);
      for (const sx of [-1.25, 1.25]) mk3(new THREE.BoxGeometry(0.55, 0.7, 5.2), 0x1d2026, sx, 0.35, 0);
      g3.position.set(sl2, SIM.terrainH(ss2, sl2), -ss2);
      g3.rotation.y = -0.4;
      scene.add(g3);
    }
  }

  // START + FINISH GATES [user redesign]: proper arched event gates, each map
  // in its own colors — bluebird night blue/gold, Sweden blue/yellow, Kimbo
  // sunset red/black. Finish arch is wider and taller than the start.
  {
    const GATE_KITS = {
      bluebird: { tower: 0x3b6fd2, arch: 0xe8c23a, flag: 0xf2ede2, trim: 0x2b2f38 },
      lax:      { tower: 0x2456b0, arch: 0xf2c93a, flag: 0xf2c93a, trim: 0x1b4390 },
      kimbo:    { tower: 0xd23a2e, arch: 0x2b2f38, flag: 0xd23a2e, trim: 0x8a1f18 },
    };
    const gk = GATE_KITS[SIM.MAP_ID] || GATE_KITS.bluebird;
    const mTower = new THREE.MeshLambertMaterial({ color: gk.tower, flatShading: false });
    const mArch = new THREE.MeshLambertMaterial({ color: gk.arch, flatShading: false });
    const mFlag = new THREE.MeshLambertMaterial({ color: gk.flag, flatShading: false });
    const mTrim = new THREE.MeshLambertMaterial({ color: gk.trim, flatShading: false });
    const startS = SIM.MAP_ID === 'kimbo' ? 6 : 12;
    for (const [gs, fin] of [[startS, false], [SIM.FINISH_S, true]]) {
      const cl = SIM.centerline(gs) + (fin ? 0 : (SIM.MAP_ID === 'kimbo' ? 10 : 0));
      const halfW = fin ? 7.5 : 6;
      const towerH = fin ? 5.4 : 4.6;
      let topY = -1e9;
      for (const side of [-halfW, halfW]) {
        const gl = cl + side;
        const gy = SIM.terrainH(gs, gl);
        // tapered tower with a base plinth and a cap ball
        const base = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.7, 0.9), mTrim);
        base.position.set(gl, gy + 0.32, -gs); scene.add(base);
        const tower = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, towerH, 8), mTower);
        tower.position.set(gl, gy + 0.6 + towerH / 2, -gs); scene.add(tower);
        const cap = new THREE.Mesh(new THREE.SphereGeometry(0.24, 10, 8), mArch);
        cap.position.set(gl, gy + 0.68 + towerH, -gs); scene.add(cap);
        // pennant flag off each cap
        const fl = new THREE.Mesh(new THREE.BoxGeometry(0.85, 0.34, 0.04), mFlag);
        fl.position.set(gl + (side > 0 ? 0.55 : -0.55), gy + 0.5 + towerH, -gs);
        scene.add(fl);
        topY = Math.max(topY, gy + 0.55 + towerH);
      }
      // arched crossbar: three segments — two risers and the main banner
      const banner = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.6, fin ? 1.05 : 0.8, 0.12), mArch);
      banner.position.set(cl, topY + (fin ? 0.75 : 0.6), -gs); scene.add(banner);
      const under = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 + 0.2, 0.14, 0.1), mTrim);
      under.position.set(cl, topY + 0.12, -gs); scene.add(under);
      if (fin) { // checker strip under the finish banner
        for (let i = 0; i < 8; i++) {
          const c = new THREE.Mesh(new THREE.BoxGeometry(halfW * 2 / 8 - 0.08, 0.3, 0.13), i % 2 ? mTrim : mFlag);
          c.position.set(cl - halfW + (i + 0.5) * (halfW * 2 / 8), topY + 1.5, -gs); scene.add(c);
        }
      }
    }
  }
}

window.__dbgScene = scene; // temp debug handle
// ---------------- STATIC BATCHING ----------------
// Merge every static world mesh that shares a material into ONE draw call.
// Rails, lift towers, cables, flags, cabins — hundreds of draws become a dozen.
{
  const statics = [];
  scene.traverse((m) => {
    if (!m.isMesh || m.isInstancedMesh || m === window.__terrain) return;
    const mat = m.material;
    if (!mat || Array.isArray(mat) || mat.transparent || mat.isMeshBasicMaterial) return;
    if (!m.geometry.attributes.position) return;
    statics.push(m);
  });
  const byMat = new Map();
  for (const m of statics) {
    if (!byMat.has(m.material.uuid)) byMat.set(m.material.uuid, { mat: m.material, list: [] });
    byMat.get(m.material.uuid).list.push(m);
  }
  for (const { mat, list } of byMat.values()) {
    if (list.length < 6) continue;
    const parts = [];
    let total = 0;
    for (const m of list) {
      m.updateWorldMatrix(true, false);
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      g.applyMatrix4(m.matrixWorld);
      parts.push(g);
      total += g.attributes.position.count;
    }
    const hasUv = parts.every((g) => g.attributes.uv);
    if (mat.map && !hasUv) continue; // textured materials need uvs everywhere
    const pos = new Float32Array(total * 3), nor = new Float32Array(total * 3);
    const uv = hasUv ? new Float32Array(total * 2) : null;
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3);
      nor.set(g.attributes.normal.array, o * 3);
      if (uv) uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
    }
    const merged = new THREE.BufferGeometry();
    merged.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    merged.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    if (uv) merged.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    scene.add(new THREE.Mesh(merged, mat));
    for (const m of list) m.parent.remove(m);
  }
}

// ---------------- skier rig ----------------
// shared material pool — one material per color+variant instead of one per
// mesh (the rider alone was minting ~75 materials; this collapses them)
const MAT_POOL = new Map();
// PLAID FLANNEL [batch item 3, ref frame]: red/black check canvas + cloth weave bump
const plaidTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#a32c2c'; g.fillRect(0, 0, 128, 128);
  g.fillStyle = 'rgba(22,16,16,0.85)';
  for (const o of [0, 64]) { g.fillRect(o, 0, 26, 128); g.fillRect(0, o, 128, 26); }
  g.fillStyle = 'rgba(190,60,50,0.45)';
  for (const o of [40, 104]) { g.fillRect(o, 0, 7, 128); g.fillRect(0, o, 128, 7); }
  g.strokeStyle = 'rgba(240,228,205,0.6)'; g.lineWidth = 2;
  for (const o of [13, 77]) { g.beginPath(); g.moveTo(o, 0); g.lineTo(o, 128); g.moveTo(0, o); g.lineTo(128, o); g.stroke(); }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2.4, 2.4);
  return t;
})();
let FLANNEL_MAT = null;
function pooledMat(color, cloth) {
  const key = color + (cloth ? '|c' : '');
  let m = MAT_POOL.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, flatShading: false });
    if (cloth) { m.bumpMap = CLOTH_B; m.bumpScale = 0.05; }
    MAT_POOL.set(key, m);
  }
  return m;
}
function part(geo, color, px, py, pz) {
  const m = new THREE.Mesh(geo, pooledMat(color, false));
  m.position.set(px, py, pz);
  return m;
}
function limbGeo(w, len, d) { const g = new THREE.BoxGeometry(w, len, d); g.translate(0, -len / 2, 0); return g; }

const SKIER_SCALE = 0.88;             // a touch smaller against the mountain
// CHARACTER FACTORY — builds a complete skeleton instance. The game rider and
// the menu-preview rider are two independent instances of this.
function buildRiderRig() {
  const R = { J: {}, SKIS: {}, meshes: [] };
  R.rig = new THREE.Group();        // world position + surface/air orientation
  R.body = new THREE.Group();       // crouch offset
  R.body.scale.setScalar(SKIER_SCALE);
  R.rig.add(R.body);
  // model was authored facing +Z; travel is -Z — flip it so the skier faces forward
  R.modelFlip = new THREE.Group();
  R.modelFlip.rotation.y = Math.PI;
  R.body.add(R.modelFlip);
  const J2 = R.J;
  // hipsRoot carries position + legs; J.hips is the PELVIS ROTATION only
  R.hipsRoot = new THREE.Group(); R.hipsRoot.position.y = 0.8; R.modelFlip.add(R.hipsRoot);
  J2.hips = new THREE.Group(); R.hipsRoot.add(J2.hips);
  J2.spine = new THREE.Group(); J2.spine.position.y = 0.1; J2.hips.add(J2.spine);
  J2.neck = new THREE.Group(); J2.neck.position.y = 0.5; J2.spine.add(J2.neck);
  for (const side of ['L', 'R']) {
    const sgn = side === 'L' ? 1 : -1;
    const sh = new THREE.Group(); sh.position.set(sgn * 0.225, 0.42, 0); J2.spine.add(sh);
    const el = new THREE.Group(); el.position.y = -0.27; sh.add(el);
    J2['shoulder' + side] = sh; J2['elbow' + side] = el;
    const hip = new THREE.Group(); hip.position.set(sgn * 0.12, -0.06, 0); R.hipsRoot.add(hip);
    const knee = new THREE.Group(); knee.position.y = -0.34; hip.add(knee);
    const ankle = new THREE.Group(); ankle.position.y = -0.32; knee.add(ankle);
    J2['hip' + side] = hip; J2['knee' + side] = knee; J2['ankle' + side] = ankle;
  }
  return R;
}
const R1 = buildRiderRig(); // the in-game rider
const rig = R1.rig, body = R1.body, modelFlip = R1.modelFlip, J = R1.J;
const SKIS = R1.SKIS;
scene.add(rig);

// ---------------- PROGRESSION: XP, levels, unlockable grabs / kits / riders ----------------
// ik: [hand, ski, local grab point on that ski] — the hand is IK-pulled onto
// the actual ski each frame so every grab CONNECTS regardless of rider fit
const GRAB_DEFS = {
  safety: { pose: 'safety', sl: -0.08, sr: -0.12, label: 'Safety', ik: [['R', 'R', 0.055, 0.04, 0.02]] },
  mute:   { pose: 'mute',   sl: -0.38, sr: -0.28, label: 'Mute', ik: [['R', 'L', -0.06, 0.05, 0.28]] }, // cross-grab: outside edge by the toe piece
  shifty: { pose: 'shifty', sl: 0.05,  sr: 0.05,  label: 'Shifty' },
  japan:  { pose: 'japan',  sl: -0.1,  sr: 1.15,  label: 'Japan', ik: [['R', 'L', 0.05, 0.05, -0.3]] },
  tail:   { pose: 'tail',   sl: 0.85,  sr: 1.45,  label: 'Tail Grab', ik: [['R', 'R', 0.045, 0.05, -0.7]] }, // behind the boot
  truck:  { pose: 'truck',  sl: -1.05, sr: -1.05, label: 'Truck Driver', ik: [['L', 'L', 0, 0.05, 0.66], ['R', 'R', 0, 0.05, 0.66]] },
};
const OUTFITS = {
  classic:  { label: 'Classic Ember', kit: null },
  teal:     { label: 'Teal Shell', kit: { jacket: 0x3aa8a0, jacketDark: 0x2d837d } },
  charcoal: { label: 'Charcoal Kit', kit: { jacket: 0x394150, jacketDark: 0x2b303c, pants: 0x23272f, pantsDark: 0x1b1e24 } },
  goldSkis: { label: 'Gold Skis', kit: { ski: 0xd9b25f } },
  violet:   { label: 'Violet Night', kit: { jacket: 0x7a5fd0, jacketDark: 0x5f49a8, pants: 0x2b2f38, pantsDark: 0x22252d } },
};
// riders: fit scales the clothing silhouette; style drives the air animation
// (counter-rotation, afterbang, phase fold) so each skis with their own look
// style dims (1 = neutral): counter = torso counter-rotation vs spin · bang =
// afterbang/absorb depth · fold = compactness through rotations · arms = air arm
// carriage width · butter = press depth · jib = rail lean/footwork exaggeration ·
// stance = base crouch depth. See design/style-bible.md for the evidence basis.
const CHARS = {
  default: { label: 'Rookie', fit: 1.0, desc: 'Balanced all-rounder. Every stat at baseline — learn the parks on this one.', style: {}, kit: null },
  harlaut: { label: 'Henrik Harlaut', fit: 1.22, hair: 'dreads', desc: 'Whips spins up the fastest and butters the deepest. The loosest style on the hill.',
    style: { counter: 1.55, bang: 1.45, fold: 1.25, arms: 1.15, butter: 1.2 },
    // [R LO&BEHOLD footage] baggy dark-green jacket + pants; Edollo-style gold topsheets
    kit: { jacket: 0x35502e, jacketDark: 0x283d22, pants: 0x3a5535, pantsDark: 0x2c4128, helmet: 0x8a6449, goggle: 0xf2d98a, ski: 0xe8b23a } },
  ahall:   { label: 'Alex Hall', fit: 0.94, desc: 'Snappy edge-to-edge with extra pop. Built for creative jib lines and quick setups.',
    style: { counter: 1.25, bang: 0.55, fold: 1.1, butter: 1.3, jib: 1.15 },
    // [R Kimbo edit] red jacket, black pants, white RB-style helmet (unbranded); ARV-style white skis
    kit: { jacket: 0xc8342a, jacketDark: 0x9c2820, pants: 0x23272f, pantsDark: 0x1b1e24, helmet: 0xf2f4f6, goggle: 0x8fc9f2, ski: 0xf2ede2 } },
  svancer: { label: 'Matej Svancer', fit: 1.05, desc: 'Fastest cork axis in the game. Compact rotations that come around in a blink.',
    // compact, fast-cycling rotations with quiet arms; the deepest butters
    style: { counter: 1.1, bang: 1.1, fold: 1.35, arms: 0.85, butter: 1.45 },
    kit: { jacket: 0xf2ede2, jacketDark: 0xd8d2c4, pants: 0x8fc9f2, pantsDark: 0x6faedd, helmet: 0x2b2f38, goggle: 0xa88df2, ski: 0xf2ede2 } },
  tjader:  { label: 'Jesper Tjäder', fit: 1.0, desc: 'The rail wizard. Spins freest on steel and turns sharpest into a feature.',
    // the rail wizard: exaggerated confident jib lean and footwork
    style: { counter: 1.2, bang: 0.85, jib: 1.5 },
    // [R Unrailistic footage: RB helmet] blue jacket per user spec; Head-style white skis
    kit: { jacket: 0x2456b0, jacketDark: 0x1b4390, pants: 0x23272f, pantsDark: 0x1b1e24, helmet: 0xf2f4f6, goggle: 0xa8d4f0, ski: 0xe8e8e8 } },
  candide: { label: 'Candide Thovex', fit: 0.98, desc: 'Fastest ski and razor carves, big pop, silent landings. Pure speed and flow.',
    // stillness: everything from the hips down, silent landings, low stance
    style: { counter: 0.65, bang: 0.35, fold: 0.9, arms: 0.6, butter: 0.9, jib: 0.9, stance: 1.25 },
    // all-white fit per user spec; Faction CT-style white topsheets
    kit: { jacket: 0xf2f2ee, jacketDark: 0xdfdfd9, pants: 0xefefeb, pantsDark: 0xdcdcd6, helmet: 0xf2f2ee, goggle: 0xcfd8e0, ski: 0xf5f5f0, glove: 0xe8e8e8, pole: 0xe8e8e8 } },
  jordy:   { label: '74 Jordy', fit: 1.02, desc: 'Biggest pop on the roster — sends the largest airs and flips a touch quicker.',
    // full-send freeride: open body, wide balancing arms, deep compressions
    style: { counter: 0.9, bang: 1.35, fold: 0.75, arms: 1.45, butter: 0.8, jib: 0.8, stance: 1.15 },
    // all-black fit + white goggles per user spec
    kit: { jacket: 0x1d1f24, jacketDark: 0x141619, pants: 0x17181c, pantsDark: 0x0f1013, helmet: 0x1d1f24, goggle: 0xe8ecf0, ski: 0x1d1f24, glove: 0x17181c } },
};
const UNLOCKS = [
  { lvl: 2, type: 'outfit', id: 'teal' },
  { lvl: 3, type: 'grab', id: 'japan' },
  { lvl: 4, type: 'outfit', id: 'charcoal' },
  { lvl: 5, type: 'grab', id: 'tail' },
  { lvl: 6, type: 'outfit', id: 'goldSkis' },
  { lvl: 7, type: 'char', id: 'harlaut' },
  { lvl: 8, type: 'grab', id: 'truck' },
  { lvl: 9, type: 'outfit', id: 'violet' },
  { lvl: 10, type: 'char', id: 'ahall' },
  { lvl: 12, type: 'char', id: 'svancer' },
  { lvl: 14, type: 'char', id: 'tjader' },
  { lvl: 16, type: 'char', id: 'candide' },
  { lvl: 18, type: 'char', id: 'jordy' },
];
const PROG = {
  xp: 0,
  needFor(n) { return 1200 + 800 * (n - 1); },           // xp to go from level n to n+1
  totalFor(n) { let t = 0; for (let i = 1; i < n; i++) t += this.needFor(i); return t; },
  level() { let n = 1; while (this.xp >= this.totalFor(n + 1)) n++; return n; },
  isUnlocked(type, id) {
    if (type === 'char') return true; // all signature riders selectable (user request)
    const u = UNLOCKS.find((x) => x.type === type && x.id === id);
    return !u || this.level() >= u.lvl;
  },
  unlockedList(type, all) { return Object.keys(all).filter((id) => this.isUnlocked(type, id)); },
  nextUnlock() { const lv = this.level(); return UNLOCKS.find((u) => u.lvl > lv); },
  award(points) {
    const before = this.level();
    this.xp += Math.round(points);
    try { localStorage.setItem('bp_xp', String(this.xp)); } catch (e) {}
    ACC.patchProfile({ xp: this.xp });
    const after = this.level();
    const ups = [];
    for (const u of UNLOCKS) if (u.lvl > before && u.lvl <= after) {
      const src = u.type === 'grab' ? GRAB_DEFS[u.id] : u.type === 'outfit' ? OUTFITS[u.id] : CHARS[u.id];
      ups.push(src.label);
    }
    return { gained: Math.round(points), before, after, ups };
  },
  save() { try { localStorage.setItem('bp_xp', String(this.xp)); } catch (e) {} },
};
try { PROG.xp = Math.max(0, parseInt(localStorage.getItem('bp_xp') || '0', 10) || 0); } catch (e) {}

// current selections (validated against unlocks so a cleared save can't cheat)
let curChar = 'default', curOutfit = 'classic';
let SLOT_BINDS = ['safety', 'mute', 'shifty']; // J / K / L
try {
  curChar = localStorage.getItem('bp_char2') || 'default';
  curOutfit = localStorage.getItem('bp_outfit') || 'classic';
  const sb = JSON.parse(localStorage.getItem('bp_binds') || 'null');
  if (Array.isArray(sb) && sb.length === 3 && sb.every((g2) => GRAB_DEFS[g2])) SLOT_BINDS = sb;
} catch (e) {}
if (!CHARS[curChar] || !PROG.isUnlocked('char', curChar)) curChar = 'default';
// ---- per-rider physics flavor [user]: each rider HANDLES different, not just
// animates different. Multipliers are modest (<=15%) so every line stays makeable.
const PHYS_KEYS = ['yawRateMax', 'pitchRateMax', 'corkRate', 'rotAccel', 'popBase', 'popCharge', 'dragTuck', 'turnRate', 'carveK', 'railSpinRate', 'railSpinAccel'];
const PHYS_BASE = {}; for (const k of PHYS_KEYS) PHYS_BASE[k] = SIM.TUNE[k];
const RIDER_PHYS = {
  default: {},
  harlaut: { yawRateMax: 1.1, rotAccel: 1.15, popBase: 1.05, turnRate: 0.95 },  // loose, whippy spins
  ahall:   { yawRateMax: 1.12, corkRate: 1.08, turnRate: 1.1, popBase: 1.08 },  // snappy + creative
  svancer: { corkRate: 1.15, pitchRateMax: 1.08, rotAccel: 1.2 },               // fastest rotations
  tjader:  { railSpinRate: 1.25, railSpinAccel: 1.2, turnRate: 1.12 },          // the rail wizard
  candide: { dragTuck: 0.93, carveK: 1.12, popBase: 1.1, popCharge: 1.1 },      // fastest, carves on rails-thin edges
  jordy:   { dragTuck: 0.95, popBase: 1.15, popCharge: 1.1, pitchRateMax: 1.05, turnRate: 0.95 }, // sends the biggest
};
function applyRiderPhys() {
  const m = RIDER_PHYS[curChar] || {};
  for (const k of PHYS_KEYS) SIM.TUNE[k] = PHYS_BASE[k] * (m[k] || 1);
}
applyRiderPhys();
if (!OUTFITS[curOutfit] || !PROG.isUnlocked('outfit', curOutfit)) curOutfit = 'classic';
SLOT_BINDS = SLOT_BINDS.map((g2) => (PROG.isUnlocked('grab', g2) ? g2 : 'safety'));
const STYLE_DEFAULTS = { counter: 1, bang: 1, fold: 1, arms: 1, butter: 1, jib: 1, stance: 1 };
function STYLE() { return { ...STYLE_DEFAULTS, ...CHARS[curChar].style }; }
function saveSelections() {
  try {
    localStorage.setItem('bp_char2', curChar);
    localStorage.setItem('bp_outfit', curOutfit);
    localStorage.setItem('bp_binds', JSON.stringify(SLOT_BINDS));
  } catch (e) {}
}

// ---------------- WARDROBE: the creator slots ----------------
const SKIN_TONES = [0xf2d3b3, 0xe8b48f, 0xd29c72, 0xb07a52, 0x8a5a3a, 0x5f3d28];
const WARDROBE = {
  skis: [
    { id: 'steel',  label: 'Steel Blues',  body: 0x53617a, tip: 0xf2ede2, binding: 0x232830 },
    { id: 'sunset', label: 'Sunset Fade',  body: 0xe8895a, tip: 0xf29ad2, binding: 0x2b2f38 },
    { id: 'forest', label: 'Forest Golds', body: 0x4a7a52, tip: 0xe8c23a, binding: 0x232830 },
    { id: 'gold',   label: 'Gold Skis',    body: 0xd9b25f, tip: 0xf2ede2, binding: 0x232830, unlockLvl: 6 },
  ],
  boots: [
    { id: 'blackB', label: 'Black Boots', color: 0x232830 },
    { id: 'whiteB', label: 'White Boots', color: 0xe8e8e8 },
    { id: 'brownB', label: 'Brown Boots', color: 0x6a5343 },
  ],
  pants: [
    { id: 'slate', label: 'Slate Baggies', color: 0x46536b, dark: 0x39445a },
    { id: 'blackP', label: 'Black Pants', color: 0x23272f, dark: 0x1b1e24 },
    { id: 'tan', label: 'Tan Pants', color: 0xb89a72, dark: 0x9a7f5c },
    { id: 'violetP', label: 'Violet Pants', color: 0x7a5fd0, dark: 0x5f49a8, unlockLvl: 9 },
  ],
  top: [
    { id: 'tee',    label: 'Black T-Shirt',  kind: 'tee',    color: 0x232830, dark: 0x1b1e24 },
    { id: 'crew',   label: 'Grey Crewneck',  kind: 'crew',   color: 0x9aa0a8, dark: 0x7e848c },
    { id: 'jacket', label: 'Orange Jacket',  kind: 'jacket', color: 0xd97a4e, dark: 0xb85f3a },
    { id: 'tealJ',  label: 'Teal Shell',     kind: 'jacket', color: 0x3aa8a0, dark: 0x2d837d, unlockLvl: 2 },
    { id: 'charJ',  label: 'Charcoal Shell', kind: 'jacket', color: 0x394150, dark: 0x2b303c, unlockLvl: 4 },
    { id: 'flannel', label: 'Plaid Flannel',  kind: 'crew',   tex: 'plaid', color: 0xa32c2c, dark: 0x6e1d1d },
  ],
  gloves: [
    { id: 'blackG2', label: 'Black Gloves', color: 0x2b303c },
    { id: 'whiteG2', label: 'White Gloves', color: 0xe8e8e8 },
    { id: 'redG', label: 'Red Gloves', color: 0xd23a2e },
  ],
  helmet: [
    { id: 'charH', label: 'Charcoal Helmet', color: 0x2f3542 },
    { id: 'whiteH', label: 'White Helmet', color: 0xf2ede2 },
    { id: 'redH', label: 'Red Helmet', color: 0xd23a2e },
  ],
  goggles: [
    { id: 'blackGo', label: 'Black Goggles', kind: 'goggle', lens: 0x2a2e38, strap: 0x232830 },
    { id: 'whiteGo', label: 'White Goggles', kind: 'goggle', lens: 0x9fd8d4, strap: 0xf2ede2 },
    { id: 'shades', label: 'Sunglasses', kind: 'shades' },
  ],
  poles: [
    { id: 'blackPl', label: 'Black Poles', color: 0x232830 },
    { id: 'whitePl', label: 'White Poles', color: 0xe8e8e8 },
    { id: 'noPl',    label: 'No Poles',    color: 0xd8d2c4 },
  ],
};
const DEFAULT_WARDROBE = { skis: 'steel', boots: 'blackB', pants: 'slate', top: 'jacket', gloves: 'blackG2', helmet: 'charH', goggles: 'blackGo', poles: 'blackPl' };
function wItem(slot, id) {
  return WARDROBE[slot].find((x) => x.id === id) || WARDROBE[slot][0];
}
function riderProfile() {
  const p = ACC.getProfile();
  return {
    username: (p && p.username) || 'Guest',
    gender: (p && p.gender) || 'm',
    skin: (p && p.skin != null) ? p.skin : 1,
    wardrobe: { ...DEFAULT_WARDROBE, ...((p && p.wardrobe) || {}) },
    best: (p && p.best) || {},
  };
}

// ---------------- RIDER: default skier — baggy jacket + pants, helmet, goggles, gloves ----------------
// smoothly TAPERED limb segment — round cross-section, no bubble ends; the flat
// caps bury inside the neighboring segment so joints read as one smooth limb
function limbSeg(rTop, rBot, len) {
  const g = new THREE.CylinderGeometry(rTop, rBot, len, 12);
  g.translate(0, -len / 2, 0);
  return g;
}
function dressRider(R = R1) {
  // dresses one character instance from the WARDROBE + selected rider.
  // Signature riders wear their own kit; the Rookie wears the player's closet.
  const def = CHARS[curChar] || CHARS.default;
  const P = riderProfile();
  const female = P.gender === 'f';
  const F = (def.fit || 1) * (female ? 0.92 : 1);
  const skin = SKIN_TONES[Math.min(SKIN_TONES.length - 1, Math.max(0, P.skin))];
  const isSig = curChar !== 'default' && !!def.kit; // sig kit on the game rig AND the cosmetics preview
  // resolve slots (signature kits override the closet)
  const top = isSig ? { kind: 'jacket', color: def.kit.jacket, dark: def.kit.jacketDark } : wItem('top', P.wardrobe.top);
  const pants = isSig ? { color: def.kit.pants, dark: def.kit.pantsDark } : wItem('pants', P.wardrobe.pants);
  const helmet = isSig ? { color: def.kit.helmet } : wItem('helmet', P.wardrobe.helmet);
  const goggles = isSig ? { kind: 'goggle', lens: def.kit.goggle, strap: 0xf2ede2 } : wItem('goggles', P.wardrobe.goggles);
  const gloves = isSig ? { color: def.kit.glove != null ? def.kit.glove : 0x2b303c } : wItem('gloves', P.wardrobe.gloves);
  const boots = isSig ? { color: 0x232830 } : wItem('boots', P.wardrobe.boots);
  const ski = isSig ? { body: def.kit.ski, tip: 0xf2ede2, binding: 0x232830 } : wItem('skis', P.wardrobe.skis);
  const J3 = R.J;
  for (const m of R.meshes) m.parent.remove(m);
  R.meshes.length = 0;
  const add = (parent, geo, color, x, y, z) => {
    const m = part(geo, color, x, y, z);
    m.material = pooledMat(color, true); // garments default to woven cloth (pooled)
    if (top.tex === 'plaid' && color === top.color) { // real fabric print [batch item 3]
      if (!FLANNEL_MAT) FLANNEL_MAT = new THREE.MeshLambertMaterial({ map: plaidTex, bumpMap: CLOTH_B, bumpScale: 0.05, flatShading: false });
      m.material = FLANNEL_MAT;
    }
    parent.add(m); R.meshes.push(m); return m;
  };
  const bare = (m) => { m.material = pooledMat(m.material.color.getHex(), false); return m; }; // skin, shells, lenses stay smooth
  const ball = (r) => new THREE.SphereGeometry(r, 12, 10);
  const jacket = top.kind === 'jacket';
  const tee = top.kind === 'tee';
  // REALISM PASS [R]: human torso is ~2 head-widths across; slimmer trunk, the
  // "baggy" read comes from the garment hanging off it, not from an inflated body
  const torsoR = jacket ? 0.2 : 0.16; // shells hang loose; tees and crews sit on the frame
  // seat of the pants — narrower than the shoulders
  add(J3.hips, ball(0.195 * F), pants.color, 0, 0.02, 0).scale.set(1.02, 0.8, 0.86);
  bare(add(J3.hips, new THREE.CylinderGeometry(0.152 * F, 0.152 * F, 0.035, 14), pants.dark || pants.color, 0, 0.135, 0)).scale.set(1, 1, 0.88); // waistband
  // TORSO: taller + slimmer capsule so the chest reads as a chest, not a barrel
  add(J3.spine, new THREE.CapsuleGeometry(torsoR * F, 0.27, 4, 14), top.color, 0, 0.22, 0).scale.set(1, 1, 0.82);
  if (jacket) {
    add(J3.spine, ball(0.205 * F), top.color, 0, 0.04, 0).scale.set(1, 0.6, 0.86);          // hem over the hips
    add(J3.spine, new THREE.BoxGeometry(0.022, 0.38, 0.018), top.dark, 0, 0.22, 0.168 * F); // zipper
    add(J3.spine, ball(0.1 * F), top.dark, 0, 0.42, -0.14).scale.set(1.3, 0.65, 0.8);       // hood
    add(J3.spine, new THREE.CylinderGeometry(0.095 * F, 0.115 * F, 0.09, 12), top.dark, 0, 0.46, 0); // collar
    bare(add(J3.spine, new THREE.CylinderGeometry(0.052, 0.06, 0.06, 10), skin, 0, 0.5, 0)); // neck above collar
  } else {
    bare(add(J3.spine, new THREE.CylinderGeometry(0.052, 0.062, 0.09, 10), skin, 0, 0.46, 0)); // bare neck
    // GARMENT SHAPE: ribbed collar ring + a loose hem that hangs over the pants
    bare(add(J3.spine, new THREE.CylinderGeometry(0.088, 0.096, 0.028, 12), top.dark || top.color, 0, 0.44, 0)).scale.set(1, 1, 0.85);
    add(J3.spine, new THREE.CylinderGeometry(0.175 * F, 0.192 * F, 0.08, 14), top.color, 0, 0.05, 0).scale.set(1, 1, 0.84); // hanging hem
    bare(add(J3.spine, new THREE.CylinderGeometry(0.177 * F, 0.177 * F, 0.012, 14), top.dark || 0x1b1e24, 0, 0.012, 0)).scale.set(1, 1, 0.84); // hem shadow
  }
  // HEAD: face + helmet + eyewear — smaller head lifts the body toward real
  // 7-heads proportions instead of the old toy-figure 6
  bare(add(J3.neck, ball(0.115), skin, 0, 0.1, 0.018)).scale.set(0.92, 1, 0.95);
  bare(add(J3.neck, ball(0.142), helmet.color, 0, 0.145, -0.008)).scale.set(0.96, 0.9, 1);
  { // HELMET SHAPE: front brim, vent slits, ear pads
    const brim = bare(add(J3.neck, new THREE.BoxGeometry(0.155, 0.016, 0.055), helmet.color, 0, 0.088, 0.122));
    brim.rotation.x = 0.28;
    for (let vi = -1; vi <= 1; vi++) bare(add(J3.neck, new THREE.BoxGeometry(0.015, 0.007, 0.095), 0x1d2026, vi * 0.044, 0.272, -0.015));
    for (const sgn2 of [-1, 1]) bare(add(J3.neck, ball(0.05), helmet.color, sgn2 * 0.125, 0.062, -0.005)).scale.set(0.48, 0.95, 0.95);
  }
  if (goggles.kind === 'goggle') {
    add(J3.neck, new THREE.CylinderGeometry(0.132, 0.132, 0.045, 16), goggles.strap, 0, 0.15, -0.008).scale.set(0.96, 1, 1);
    bare(add(J3.neck, ball(0.088), goggles.strap, 0, 0.145, 0.098)).scale.set(1.48, 0.7, 0.52); // goggle frame
    bare(add(J3.neck, ball(0.08), goggles.lens, 0, 0.145, 0.108)).scale.set(1.35, 0.58, 0.6);
  } else { // sunglasses: two small dark lenses + bridge, no strap
    for (const sgn of [-1, 1]) bare(add(J3.neck, ball(0.038), 0x14161c, sgn * 0.052, 0.115, 0.115)).scale.set(1, 0.85, 0.4);
    bare(add(J3.neck, new THREE.BoxGeometry(0.044, 0.013, 0.013), 0x14161c, 0, 0.12, 0.125));
    bare(add(J3.neck, new THREE.BoxGeometry(0.128, 0.011, 0.011), 0x14161c, 0, 0.138, 0.118)); // top bar
    for (const sgn2 of [-1, 1]) bare(add(J3.neck, new THREE.BoxGeometry(0.011, 0.011, 0.125), 0x14161c, sgn2 * 0.096, 0.128, 0.05)); // temple arms
  }
  if (def.hair === 'dreads' && isSig) {
    for (let i = 0; i < 5; i++) {
      const a2 = (i - 2) * 0.5;
      const d2 = bare(add(J3.neck, new THREE.CapsuleGeometry(0.028, 0.24, 3, 6), 0xd9b25f,
        Math.sin(a2) * 0.11, 0.02, -0.1 - Math.cos(a2) * 0.05));
      d2.rotation.x = 0.5 + Math.abs(a2) * 0.1;
    }
  } else if (female) { // ponytail out the back of the helmet
    const pt = bare(add(J3.neck, new THREE.CapsuleGeometry(0.035, 0.2, 4, 8), 0x5f4630, 0, 0.05, -0.16));
    pt.rotation.x = 0.85;
  }
  for (const side of ['L', 'R']) {
    // ARMS [R]: a real arm is roughly wrist ≈ half the bicep — thin segments,
    // steady taper. Shells add cloth width; a t-shirt shows the actual arm.
    const sleeveC = top.color;
    if (tee) {
      add(J3['shoulder' + side], limbSeg(0.068 * F, 0.056 * F, 0.14), sleeveC, 0, 0.02, 0); // short sleeve hugs the arm
      bare(add(J3['shoulder' + side], new THREE.CylinderGeometry(0.06 * F, 0.06 * F, 0.018, 10), top.dark || top.color, 0, -0.115, 0)); // open sleeve cuff
      bare(add(J3['shoulder' + side], limbSeg(0.048, 0.042, 0.18), skin, 0, -0.1, 0));      // bare upper arm
      bare(add(J3['elbow' + side], limbSeg(0.042, 0.032, 0.24), skin, 0, 0.02, 0));         // bare forearm → thin wrist
    } else {
      const sw = jacket ? 1 : 0.82;
      add(J3['shoulder' + side], limbSeg(0.078 * F * sw, 0.068 * F * sw, 0.3), sleeveC, 0, 0.02, 0);
      add(J3['elbow' + side], limbSeg(0.068 * F * sw, 0.054 * F * sw, 0.24), sleeveC, 0, 0.02, 0);
      if (jacket) add(J3['elbow' + side], new THREE.CylinderGeometry(0.062 * F, 0.05 * F, 0.05, 12), top.dark, 0, -0.235, 0);
    }
    { // GLOVE with real shape: mitt palm, thumb, and a gauntlet cuff
      const palm = bare(add(J3['elbow' + side], new THREE.BoxGeometry(0.072, 0.088, 0.105), gloves.color, 0, -0.288, 0.014));
      palm.rotation.x = -0.18;
      if (!R.HANDS) R.HANDS = {};
      R.HANDS[side] = palm; // IK anchor: pull THIS onto the ski during grabs
      const thumb = bare(add(J3['elbow' + side], new THREE.CapsuleGeometry(0.019, 0.042, 3, 6), gloves.color, (side === 'L' ? 1 : -1) * 0.046, -0.268, 0.035));
      thumb.rotation.z = (side === 'L' ? -0.85 : 0.85);
      add(J3['elbow' + side], new THREE.CylinderGeometry(0.05, 0.062, 0.055, 10), gloves.color, 0, -0.242, 0); // gauntlet cuff
    }
    { // POLE [user]: grip in the fist, ~1m shaft angled down-back, powder basket + tip
      const poleIt = wItem('poles', P.wardrobe.poles);
      if (!isSig && poleIt.id === 'noPl') { /* rides bare-handed */ } else {
      const poleC = isSig ? (def.kit.pole != null ? def.kit.pole : 0x232830) : poleIt.color;
      const pg = new THREE.Group();
      pg.position.set(0, -0.29, 0.02);
      pg.rotation.x = 0.42; // trails behind the hand like a real planted-back carry
      J3['elbow' + side].add(pg); R.meshes.push(pg);
      const mk = (geo, c, y) => { const m = part(geo, c, 0, y, 0); m.material = pooledMat(c, false); pg.add(m); return m; };
      mk(new THREE.CylinderGeometry(0.017, 0.015, 0.11, 8), 0x1b1e24, 0.02);      // rubber grip
      mk(new THREE.CylinderGeometry(0.008, 0.006, 0.98, 6), poleC, -0.52);        // shaft
      mk(new THREE.CylinderGeometry(0.052, 0.052, 0.012, 10), poleC, -0.93);      // basket
      mk(new THREE.CylinderGeometry(0.007, 0.009, 0.05, 6), 0x3a3f4a, -0.99);     // carbide tip
      }
    }
    // PANTS: baggy at the seat, tapering into the cuff — but legs, not columns
    add(J3['hip' + side], limbSeg(0.105 * F, 0.09 * F, 0.38), pants.color, 0, 0.03, 0);
    add(J3['knee' + side], limbSeg(0.09 * F, 0.078 * F, 0.33), pants.color, 0, 0.02, 0);
    add(J3['knee' + side], new THREE.CylinderGeometry(0.082 * F, 0.098 * F, 0.09, 12), pants.dark || pants.color, 0, -0.33, 0);
    add(J3['knee' + side], new THREE.CylinderGeometry(0.088 * F, 0.102 * F, 0.045, 12), pants.color, 0, -0.285, 0); // stacked cuff roll
    bare(add(J3['ankle' + side], ball(0.08), boots.color, 0, -0.05, 0.035)).scale.set(0.95, 0.95, 1.65); // hard boot shell
    // SKIS [R]: real plan-form — rounded tip and tail, sidecut waist, and a
    // rockered nose bent up along a smooth curve. One extruded outline per ski,
    // topsheet stripe + nose accent in the design's tip color.
    const skiG = new THREE.Group();
    skiG.position.set(0, -0.15, 0.1);
    const mk2 = (geo, col, x, y, z) => { const m = part(geo, col, x, y, z); skiG.add(m); return m; };
    {
      const LEN = 1.62, half = LEN / 2;
      const wTail = 0.068, wWaist = 0.056, wTip = 0.073;
      const wOf = (t) => (1 - t) * (1 - t) * wTail + 2 * t * (1 - t) * (wWaist * 0.94) + t * t * wTip;
      const shp = new THREE.Shape();
      const NS = 16, right = [], left = [];
      for (let i = 0; i <= NS; i++) {
        const t = i / NS, z = -half + t * LEN;
        right.push([wOf(t), z]); left.push([-wOf(t), z]);
      }
      shp.moveTo(right[0][0], right[0][1]);
      for (let i = 1; i < right.length; i++) shp.lineTo(right[i][0], right[i][1]);
      for (let i = 1; i < 8; i++) { const a2 = (i / 8) * Math.PI; shp.lineTo(Math.cos(a2) * wTip, half + Math.sin(a2) * 0.1); }
      for (let i = left.length - 1; i >= 0; i--) shp.lineTo(left[i][0], left[i][1]);
      for (let i = 1; i < 6; i++) { const a2 = (i / 6) * Math.PI; shp.lineTo(-Math.cos(a2) * wTail, -half - Math.sin(a2) * 0.045); }
      shp.closePath();
      const eg = new THREE.ExtrudeGeometry(shp, { depth: 0.03, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.004, bevelSegments: 1, curveSegments: 6 });
      eg.rotateX(Math.PI / 2);       // width x, length +z (tip forward), thickness downward
      eg.translate(0, 0.034, 0);
      const p2 = eg.attributes.position;
      for (let i = 0; i < p2.count; i++) {   // rocker the ends up
        const z = p2.getZ(i); let lift = 0;
        if (z > half * 0.55) { const t = (z - half * 0.55) / (half * 0.45 + 0.1); lift = t * t * 0.105; }
        else if (z < -half * 0.6) { const t = (-z - half * 0.6) / (half * 0.4 + 0.045); lift = t * t * 0.05; }
        p2.setY(i, p2.getY(i) + lift);
      }
      eg.computeVertexNormals();
      const skiMat = new THREE.MeshPhongMaterial({ color: ski.body, shininess: 52, specular: 0x444444 }); // waxed topsheet
      const bodyMesh = new THREE.Mesh(eg, skiMat);
      skiG.add(bodyMesh);
      mk2(new THREE.BoxGeometry(0.044, 0.007, 0.6), ski.tip, 0, 0.039, -0.02);                     // topsheet stripe
      const noseCap = mk2(new THREE.SphereGeometry(0.052, 10, 8), ski.tip, 0, 0.128, half + 0.055); // tip accent
      noseCap.scale.set(1.25, 0.34, 1.35); noseCap.rotation.x = -0.5;
      mk2(new THREE.BoxGeometry(0.088, 0.048, 0.24), ski.binding, 0, 0.055, 0.02);                 // binding plate
      mk2(new THREE.BoxGeometry(0.105, 0.034, 0.075), ski.binding, 0, 0.062, 0.155);               // toe piece
      mk2(new THREE.BoxGeometry(0.105, 0.034, 0.075), ski.binding, 0, 0.062, -0.115);              // heel piece
    }
    J3['ankle' + side].add(skiG);
    R.meshes.push(skiG);
    R.SKIS[side] = skiG;
  }
  R.rig.traverse((m2) => { if (m2.isMesh) m2.castShadow = true; }); // [batch item 4]
}
dressRider();

// ---- CARVE SNOW SPRAY [batch item 11]: capped ring-buffer particle emitter —
// powder kicks off the downhill edge, scales with edge angle x speed ----
const SPRAY_N = 220;
const sprayPos = new Float32Array(SPRAY_N * 3);
const sprayVel = new Float32Array(SPRAY_N * 3);
const sprayLife = new Float32Array(SPRAY_N);
const sprayGeo = new THREE.BufferGeometry();
sprayGeo.setAttribute('position', new THREE.BufferAttribute(sprayPos, 3));
const sprayPts = new THREE.Points(sprayGeo, new THREE.PointsMaterial({
  color: 0xffffff, size: 0.17, transparent: true, opacity: 0.8, depthWrite: false, sizeAttenuation: true }));
sprayPts.frustumCulled = false;
scene.add(sprayPts);
let sprayIdx = 0;
function spraySpawn(x, y, z, vx, vy, vz) {
  const i = sprayIdx; sprayIdx = (sprayIdx + 1) % SPRAY_N;
  sprayPos[i * 3] = x; sprayPos[i * 3 + 1] = y; sprayPos[i * 3 + 2] = z;
  sprayVel[i * 3] = vx; sprayVel[i * 3 + 1] = vy; sprayVel[i * 3 + 2] = vz;
  sprayLife[i] = 0.45 + Math.random() * 0.3;
}
function sprayTick(dt2) {
  for (let i = 0; i < SPRAY_N; i++) {
    if (sprayLife[i] <= 0) { sprayPos[i * 3 + 1] = -9999; continue; }
    sprayLife[i] -= dt2;
    sprayVel[i * 3 + 1] -= 21 * dt2;
    sprayPos[i * 3] += sprayVel[i * 3] * dt2;
    sprayPos[i * 3 + 1] += sprayVel[i * 3 + 1] * dt2;
    sprayPos[i * 3 + 2] += sprayVel[i * 3 + 2] * dt2;
  }
  sprayGeo.attributes.position.needsUpdate = true;
}
let carveEdgeG = 0, carveSpdG = 0; // fed by the carve pose block each frame

// blob shadow
let shadow;
{
  const cnv = document.createElement('canvas'); cnv.width = cnv.height = 128;
  const ctx = cnv.getContext('2d');
  const grad = ctx.createRadialGradient(64, 64, 6, 64, 64, 62);
  grad.addColorStop(0, 'rgba(60,70,100,0.4)'); grad.addColorStop(1, 'rgba(60,70,100,0)');
  ctx.fillStyle = grad; ctx.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(cnv);
  shadow = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 2.0),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.visible = false; // retired: the shadow-map shadow replaced the blob [batch item 4]
  scene.add(shadow);
}

// ---------------- pose system ----------------
// pose: joint -> [rx, ry, rz]
const POSES = {
  gate:    { hips: [0.1, 0, 0], spine: [0.22, 0, 0], neck: [-0.2, 0, 0], shoulderL: [0.3, 0, 0.5], shoulderR: [0.3, 0, -0.5], elbowL: [-0.7, 0, 0], elbowR: [-0.7, 0, 0], hipL: [-0.25, 0, 0], hipR: [-0.25, 0, 0], kneeL: [0.45, 0, 0], kneeR: [0.45, 0, 0], ankleL: [-0.2, 0, 0], ankleR: [-0.2, 0, 0] },
  glide:   { hips: [0.07, 0, 0], spine: [0.2, 0, 0], neck: [-0.22, 0, 0], shoulderL: [0.3, 0, 0.35], shoulderR: [0.3, 0, -0.35], elbowL: [-0.7, 0, 0], elbowR: [-0.7, 0, 0], hipL: [-0.32, 0, 0], hipR: [-0.32, 0, 0], kneeL: [0.55, 0, 0], kneeR: [0.55, 0, 0], ankleL: [-0.23, 0, 0], ankleR: [-0.23, 0, 0] },
  tuck:    { hips: [0.24, 0, 0], spine: [0.38, 0, 0], neck: [-0.36, 0, 0], shoulderL: [0.28, 0, 0.3], shoulderR: [0.28, 0, -0.3], elbowL: [-0.55, 0, 0], elbowR: [-0.55, 0, 0], hipL: [-0.72, 0, 0], hipR: [-0.72, 0, 0], kneeL: [1.15, 0, 0], kneeR: [1.15, 0, 0], ankleL: [-0.42, 0, 0], ankleR: [-0.42, 0, 0] }, // relaxed speed stance: upright chest, arms easy with a soft bend
  brake:   { hips: [0.2, 0, 0], spine: [0.35, 0, 0], neck: [-0.35, 0, 0], shoulderL: [0.2, 0, 0.9], shoulderR: [0.2, 0, -0.9], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0], hipL: [-0.5, 0, 0.14], hipR: [-0.5, 0, -0.14], kneeL: [0.85, 0, 0], kneeR: [0.85, 0, 0], ankleL: [-0.35, 0.35, 0], ankleR: [-0.35, -0.35, 0] },
  load:    { hips: [0.35, 0, 0], spine: [0.6, 0, 0], neck: [-0.6, 0, 0], shoulderL: [-0.5, 0, 0.3], shoulderR: [-0.5, 0, -0.3], elbowL: [-0.4, 0, 0], elbowR: [-0.4, 0, 0], hipL: [-0.95, 0, 0], hipR: [-0.95, 0, 0], kneeL: [1.5, 0, 0], kneeR: [1.5, 0, 0], ankleL: [-0.5, 0, 0], ankleR: [-0.5, 0, 0] },
  pop:     { hips: [-0.05, 0, 0], spine: [0.05, 0, 0], neck: [0, 0, 0], shoulderL: [-1.4, 0, 0.5], shoulderR: [-1.4, 0, -0.5], elbowL: [-0.25, 0, 0], elbowR: [-0.25, 0, 0], hipL: [-0.12, 0, 0], hipR: [-0.12, 0, 0], kneeL: [0.15, 0, 0], kneeR: [0.15, 0, 0], ankleL: [-0.05, 0, 0], ankleR: [-0.05, 0, 0] },
  airNeut: { hips: [0.05, 0, 0], spine: [0.1, 0, 0], neck: [-0.08, 0, 0], shoulderL: [0.15, 0, 0.55], shoulderR: [0.15, 0, -0.55], elbowL: [-0.35, 0, 0], elbowR: [-0.35, 0, 0], hipL: [-0.5, 0, 0], hipR: [-0.5, 0, 0], kneeL: [0.85, 0, 0], kneeR: [0.85, 0, 0], ankleL: [-0.35, 0, 0], ankleR: [-0.35, 0, 0] }, // loose, low, relaxed arms
  // SAFETY: right hand rests on the drawn-up right KNEE, relaxed reach — not a deep
  // fold — left arm high for balance
  safety:  { hips: [0.35, 0, -0.06], spine: [0.45, 0.12, -0.18], neck: [-0.4, -0.12, 0.1], shoulderL: [0.25, 0, 1.05], shoulderR: [1.15, 0, -0.18], elbowL: [-0.45, 0, 0], elbowR: [-0.35, 0, 0], hipL: [-1.1, 0, 0.05], hipR: [-1.3, 0, -0.08], kneeL: [1.6, 0, 0], kneeR: [1.85, 0, 0], ankleL: [-0.4, 0, 0], ankleR: [-0.45, 0, 0] },
  // MUTE (cover-art style): right hand crosses to grab the TIP of the left ski,
  // both skis swung together OFF TO THE SIDE, trail arm swept back-high for the tweak
  // MUTE [batch item 9, real-skier ref]: lead hand crosses the body to the OPPOSITE
  // ski's outside edge between toe piece and tip; skis cross into a slight X with
  // noses tweaked apart; trail arm swings high behind for balance
  mute:    { hips: [0.55, 0, 0.16], spine: [0.75, 0.5, -0.22], neck: [-0.6, -0.42, 0.05], shoulderL: [-1.15, 0, 1.25], shoulderR: [2.1, 0.55, -0.5], elbowL: [-0.2, 0, 0], elbowR: [-0.2, 0, 0], hipL: [-1.5, 0.45, 0.14], hipR: [-1.3, 0.45, -0.04], kneeL: [2.0, 0, 0], kneeR: [1.8, 0, 0], ankleL: [-0.4, 0.62, 0], ankleR: [-0.4, 0.62, 0] },
  // SHIFTY: the skis swing from the ANKLES/feet — hips barely rotate, torso counters
  shifty:  { hips: [0.15, 0, 0], spine: [0.25, -0.4, 0], neck: [-0.25, 0.38, 0], shoulderL: [0.3, 0, 1.1], shoulderR: [0.3, 0, -1.1], elbowL: [-0.5, 0, 0], elbowR: [-0.5, 0, 0], hipL: [-0.6, 0.28, 0], hipR: [-0.6, 0.28, 0], kneeL: [1.0, 0, 0], kneeR: [1.0, 0, 0], ankleL: [-0.4, 0.62, 0], ankleR: [-0.4, 0.62, 0] },
  // JAPAN (unlockable): back leg folded hard behind, opposite hand reaching back
  // across to it — the classic tweaked look
  japan:   { hips: [0.35, 0, 0.15], spine: [0.5, 0.3, -0.2], neck: [-0.4, -0.25, 0], shoulderL: [0.3, 0, 1.05], shoulderR: [-1.7, 0.3, -0.3], elbowL: [-0.45, 0, 0], elbowR: [-0.2, 0, 0], hipL: [-1.0, 0, 0.05], hipR: [0.3, 0.4, -0.35], kneeL: [1.5, 0, 0], kneeR: [2.5, 0, 0], ankleL: [-0.4, 0, 0], ankleR: [0.3, 0, 0] },
  // TAIL (unlockable): reach back to the tail of one ski, tails swept up
  // TAIL [batch item 5, ref]: trailing hand reaches back-down to the tail behind the
  // boot, knees pull the skis up hard, lead arm punches out-forward for balance
  tail:    { hips: [0.38, 0, 0], spine: [0.52, -0.62, 0.12], neck: [-0.42, 0.52, 0], shoulderL: [-0.95, 0, 1.15], shoulderR: [-2.25, 0, -0.5], elbowL: [-0.25, 0, 0], elbowR: [-0.05, 0, 0], hipL: [-0.78, 0, 0], hipR: [-1.62, 0, 0], kneeL: [1.05, 0, 0], kneeR: [2.3, 0, 0], ankleL: [-0.35, 0, 0], ankleR: [0.72, 0, 0] },
  // TRUCK DRIVER (unlockable): both hands on both tips, deep fold
  truck:   { hips: [0.55, 0, 0], spine: [0.8, 0, 0], neck: [-0.65, 0, 0], shoulderL: [1.3, 0, 0.4], shoulderR: [1.3, 0, -0.4], elbowL: [-0.1, 0, 0], elbowR: [-0.1, 0, 0], hipL: [-1.5, 0, 0], hipR: [-1.5, 0, 0], kneeL: [2.1, 0, 0], kneeR: [2.1, 0, 0], ankleL: [-0.3, 0, 0], ankleR: [-0.3, 0, 0] },
  // ASYMMETRIC harlaut fold: lead arm reaches across, trail arm hangs back-low,
  // head tucks toward the lead shoulder, knees pulled unevenly — never symmetric
  flip:    { hips: [0.5, 0, 0.12], spine: [0.72, -0.28, 0.15], neck: [-0.45, 0.4, 0.18], shoulderL: [1.35, 0, 0.4], shoulderR: [-0.5, 0, -0.85], elbowL: [-1.0, 0, 0], elbowR: [-0.3, 0, 0], hipL: [-1.6, 0, 0.05], hipR: [-1.3, 0, -0.05], kneeL: [2.15, 0, 0], kneeR: [1.8, 0, 0], ankleL: [-0.5, 0, 0], ankleR: [-0.45, 0, 0] },
  grind:   { hips: [0.25, 0, 0], spine: [0.4, -0.35, 0], neck: [-0.35, 0.35, 0], shoulderL: [0.3, 0, 1.15], shoulderR: [0.3, 0, -1.15], elbowL: [-0.45, 0, 0], elbowR: [-0.45, 0, 0], hipL: [-0.65, 0, 0.08], hipR: [-0.55, 0, -0.08], kneeL: [1.05, 0, 0], kneeR: [0.95, 0, 0], ankleL: [-0.4, 0, 0], ankleR: [-0.4, 0, 0] },
  fifty:   { hips: [0.15, 0, 0], spine: [0.25, 0, 0], neck: [-0.25, 0, 0], shoulderL: [0.3, 0, 0.9], shoulderR: [0.3, 0, -0.9], elbowL: [-0.6, 0, 0], elbowR: [-0.6, 0, 0], hipL: [-0.45, 0, 0], hipR: [-0.45, 0, 0], kneeL: [0.75, 0, 0], kneeR: [0.75, 0, 0], ankleL: [-0.3, 0, 0], ankleR: [-0.3, 0, 0] },
  bail:    { hips: [0.3, 0, 0.3], spine: [0.5, 0.4, 0], neck: [-0.3, 0, 0], shoulderL: [-1.8, 0, 1.2], shoulderR: [1.6, 0, -1.3], elbowL: [-0.3, 0, 0], elbowR: [-0.4, 0, 0], hipL: [-1.1, 0, 0.4], hipR: [-0.3, 0, -0.4], kneeL: [1.4, 0, 0], kneeR: [0.4, 0, 0], ankleL: [-0.3, 0, 0], ankleR: [-0.3, 0, 0] },
  finish:  { hips: [0, 0, 0], spine: [-0.15, 0, 0], neck: [0.1, 0, 0], shoulderL: [-2.6, 0, 0.4], shoulderR: [-2.6, 0, -0.4], elbowL: [-0.2, 0, 0], elbowR: [-0.2, 0, 0], hipL: [-0.15, 0, 0], hipR: [-0.15, 0, 0], kneeL: [0.3, 0, 0], kneeR: [0.3, 0, 0], ankleL: [-0.15, 0, 0], ankleR: [-0.15, 0, 0] },
  absorb:  { hips: [0.5, 0, 0], spine: [0.65, 0, 0], neck: [-0.55, 0, 0], shoulderL: [0.5, 0, 0.7], shoulderR: [0.5, 0, -0.7], elbowL: [-0.6, 0, 0], elbowR: [-0.6, 0, 0], hipL: [-1.05, 0, 0], hipR: [-1.05, 0, 0], kneeL: [1.7, 0, 0], kneeR: [1.7, 0, 0], ankleL: [-0.5, 0, 0], ankleR: [-0.5, 0, 0] },
  bang:    { hips: [-0.14, 0, 0], spine: [-0.2, 0, 0], neck: [0.16, 0, 0], shoulderL: [0.12, 0, 0.18], shoulderR: [0.12, 0, -0.18], elbowL: [-0.12, 0, 0], elbowR: [-0.12, 0, 0], hipL: [-0.05, 0, 0], hipR: [-0.05, 0, 0], kneeL: [0.1, 0, 0], kneeR: [0.1, 0, 0], ankleL: [-0.04, 0, 0], ankleR: [-0.04, 0, 0] },
};
const JOINT_RATE = {
  hips: 11, spine: 10, neck: 9,
  shoulderL: 8.5, shoulderR: 8.5, elbowL: 8.5, elbowR: 8.5,
  hipL: 12, hipR: 12, kneeL: 12, kneeR: 12, ankleL: 13, ankleR: 13,
};
const target = {};
for (const k in JOINT_RATE) target[k] = [0, 0, 0];

function setTargets(pose, blend = 1) {
  for (const k in JOINT_RATE) {
    const p = pose[k] || [0, 0, 0];
    const t = target[k];
    if (blend >= 1) { t[0] = p[0]; t[1] = p[1]; t[2] = p[2]; }
    else { t[0] += (p[0] - t[0]) * blend; t[1] += (p[1] - t[1]) * blend; t[2] += (p[2] - t[2]) * blend; }
  }
}
function addTargets(adj) {
  for (const k in adj) { const t = target[k], a = adj[k]; t[0] += a[0]; t[1] += a[1]; t[2] += a[2]; }
}

// ---------------- sim + HUD ----------------
const sim = SIM.createSim(20260705);
const params = new URLSearchParams(location.search);
const dev = params.has('dev');
// dev spawn: ?at=230 drops the run at s=230 on the centerline (verification tool)
const devAt = Math.max(0, parseFloat(params.get('at') || '0') || 0);
const GRABTEST = params.get('grabtest'); // dev pose-viewer: freeze a grab at the gate, full weight, slow spin
// ---- PROFILER (?prof=1): per-subsystem CPU ms + renderer stats, rolling ----
const PROF = params.has('prof') ? { t: {}, frames: 0, ftSum: 0, ftMax: 0, worst: [] } : null;
function pT(k, f) {
  if (!PROF) return f();
  const t0 = performance.now();
  const r = f();
  PROF.t[k] = (PROF.t[k] || 0) + (performance.now() - t0);
  return r;
}
if (PROF) window.__profReport = () => {
  const n = Math.max(1, PROF.frames);
  const out = { frames: n, avgFrameMs: +(PROF.ftSum / n).toFixed(2), fps: +(1000 / (PROF.ftSum / n)).toFixed(1), maxFrameMs: +PROF.ftMax.toFixed(1), buckets: {} };
  let acc2 = 0;
  for (const k in PROF.t) { const ms = PROF.t[k] / n; out.buckets[k] = +ms.toFixed(3); acc2 += ms; }
  out.buckets.otherJS = +((PROF.ftSum / n) - acc2).toFixed(3); // browser/GPU-wait/compositing remainder
  out.render = { calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures, programs: renderer.info.programs ? renderer.info.programs.length : 0 };
  PROF.t = {}; PROF.frames = 0; PROF.ftSum = 0; PROF.ftMax = 0;
  return JSON.stringify(out);
};
let devAtDone = false;
const $ = (id) => document.getElementById(id);
const els = {
  speed: $('speed'), score: $('score'), combo: $('combo'), toasts: $('toasts'),
  start: $('startOverlay'), finish: $('finishPanel'), dev: $('dev'), zone: $('zoneToast'),
  finStats: $('finStats'), charge: $('chargeFill'), chargeWrap: $('charge'),
  settings: $('settingsPanel'),
};

// ---------------- sound: fully procedural WebAudio, no assets ----------------
// Continuous layers (wind rush, snow carve, rail grind) driven per-frame by the
// sim; one-shots (pop, stomp, bail, chimes) fired off game events.
const SND = (() => {
  let ctx = null, master = null, noiseBuf = null;
  let wind, carve, grind;
  let prevMode = 'gate';
  let vol = 1;
  try { vol = Math.min(1, Math.max(0, parseFloat(localStorage.getItem('bp_vol') ?? '1'))); } catch (e) {}
  function loopLayer(type, freq, q) {
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; if (q) f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(master); src.start();
    return { f, g };
  }
  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    master = ctx.createGain(); master.gain.value = 0.45 * vol; master.connect(ctx.destination);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    wind = loopLayer('lowpass', 300);          // air rush
    carve = loopLayer('lowpass', 1600);        // snow hiss under the edges
    grind = loopLayer('bandpass', 2300, 5);    // metallic rail sizzle
  }
  function blip(f0, f1, dur, vol, type = 'sine') {
    if (!ctx) return;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function burst(freq, dur, vol) {
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t); src.stop(t + dur + 0.02);
  }
  return {
    init,
    get volume() { return vol; },
    setVolume(v) {
      vol = Math.min(1, Math.max(0, v));
      if (master) master.gain.setTargetAtTime(0.45 * vol, ctx.currentTime, 0.05);
      try { localStorage.setItem('bp_vol', String(vol)); } catch (e) {}
    },
    pop() { blip(160, 65, 0.16, 0.4); burst(900, 0.1, 0.15); },                    // legs fire
    land(amt) { burst(500 + 300 * amt, 0.22, 0.25 + 0.4 * amt); blip(110, 55, 0.14, 0.2 + 0.25 * amt); }, // stomp
    bail() { burst(420, 0.5, 0.7); blip(85, 35, 0.4, 0.45); },                     // wreck
    chime(clean) { blip(660, 660, 0.12, 0.18); setTimeout(() => blip(clean ? 990 : 620, clean ? 990 : 620, 0.16, 0.18), 90); },
    clank() { blip(2400, 1700, 0.07, 0.22, 'square'); burst(2600, 0.08, 0.18); },  // lock onto steel
    swap() { blip(480, 760, 0.1, 0.2); },                                          // hop tick
    bounce() { blip(130, 60, 0.12, 0.3); burst(520, 0.13, 0.28); },                // thunk off an obstacle
    go() { blip(440, 880, 0.25, 0.3); },
    finish() { blip(523, 523, 0.14, 0.22); setTimeout(() => blip(659, 659, 0.14, 0.22), 130); setTimeout(() => blip(784, 784, 0.25, 0.25), 260); },
    update(st) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const v = st.vel;
      const spd = Math.sqrt(v.s * v.s + v.l * v.l + v.y * v.y);
      // wind builds with speed, wilder in the air
      const airMul = st.mode === 'air' ? 1.4 : 1.0;
      wind.g.gain.setTargetAtTime(Math.min(0.4, Math.pow(spd / 42, 2) * 0.55) * airMul, t, 0.12);
      wind.f.frequency.setTargetAtTime(220 + spd * 16, t, 0.12);
      // snow hiss: speed + edge angle; butters scrape deeper
      let cv = 0, cf = 1600;
      if (st.mode === 'ground' || st.mode === 'gate') {
        const hspd = Math.sqrt(v.s * v.s + v.l * v.l);
        let edge = 0;
        if (hspd > 0.5) {
          edge = st.heading - Math.atan2(v.l, v.s);
          while (edge > Math.PI) edge -= 2 * Math.PI;
          while (edge < -Math.PI) edge += 2 * Math.PI;
        }
        cv = Math.min(0.5, hspd * 0.008 + Math.abs(edge) * 0.55);
        if (st.butter) { cv = Math.max(cv, 0.42); cf = 900; }
      } else if (st.mode === 'bail') { cv = 0.35; cf = 700; }
      carve.g.gain.setTargetAtTime(cv, t, 0.08);
      carve.f.frequency.setTargetAtTime(cf, t, 0.1);
      // rail sizzle pitched by speed
      const gv = st.mode === 'grind' ? Math.min(0.42, 0.14 + Math.abs(v.s) * 0.018) : 0;
      grind.g.gain.setTargetAtTime(gv, t, 0.04);
      if (st.mode === 'grind') grind.f.frequency.setTargetAtTime(1900 + Math.abs(v.s) * 55, t, 0.1);
      // transitions: pop on a real jump up, stomp on touchdown
      if (st.mode === 'air' && prevMode !== 'air' && v.y > 1.4) this.pop();
      if (prevMode === 'air' && st.mode === 'ground') this.land(st.afterbang ? st.afterbang.amt : 0.25);
      prevMode = st.mode;
    },
  };
})();
addEventListener('keydown', () => SND.init());

// ---------------- TOUCH CONTROLS (landscape mobile) ----------------
// Left: the direction circle — steer on snow; in the air N frontflip, NE/NW
// misty, E/W spin, SE/SW cork, S backflip. Right: charged JUMP with the three
// grabs arcing around it and BUTTER above. Unlabeled, uniform color, opacity
// adjustable in settings. Built for holding the phone HORIZONTALLY.
const TOUCH = matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || location.search.includes('touch=1');
let touchWrap = null;
if (TOUCH) buildTouchControls();
function buildTouchControls() {
  // lock mobile viewport behavior: no pinch zoom, no double-tap zoom, no scroll
  const vp = document.querySelector('meta[name="viewport"]');
  if (vp) vp.content = 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover';
  document.documentElement.style.touchAction = 'none';
  document.body.style.overscrollBehavior = 'none';

  const wrap = document.createElement('div');
  wrap.id = 'touchUI';
  wrap.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;user-select:none;-webkit-user-select:none;';
  document.body.append(wrap);
  touchWrap = wrap;
  let op = 0.85;
  try { op = Math.min(1, Math.max(0.2, parseFloat(localStorage.getItem('bp_ctlOp') ?? '0.85'))); } catch (e) {}
  wrap.style.opacity = op;

  // ONE color for everything — quiet glass circles that read by size and place
  const FILL = 'rgba(235,238,245,.2)';
  const EDGE = '2px solid rgba(235,238,245,.55)';
  const ACTIVE = 'rgba(235,238,245,.5)';

  // ---- DIRECTION CIRCLE (left thumb) ----
  const R = 76;
  const base = document.createElement('div');
  base.style.cssText = `position:absolute;left:max(22px, env(safe-area-inset-left));bottom:20px;width:${R * 2}px;height:${R * 2}px;border-radius:50%;` +
    `background:${FILL};border:${EDGE};pointer-events:auto;touch-action:none;`;
  const knob = document.createElement('div');
  knob.style.cssText = `position:absolute;left:50%;top:50%;width:58px;height:58px;border-radius:50%;background:${ACTIVE};transform:translate(-50%,-50%);`;
  base.append(knob);
  wrap.append(base);

  const stickActs = ['left', 'right', 'tuck', 'brake'];
  function setStick(dx, dy) { // unit-ish vector, screen coords (y down)
    for (const a2 of stickActs) held.delete(a2);
    knob.style.transform = `translate(calc(-50% + ${dx * (R - 30)}px), calc(-50% + ${dy * (R - 30)}px))`;
    if (Math.hypot(dx, dy) < 0.32) return; // deadzone
    let oct = Math.round(Math.atan2(-dy, dx) / (Math.PI / 4)); // 0=E 1=NE 2=N 3=NW ±4=W -3=SW -2=S -1=SE
    if (oct === 0) held.add('right');
    else if (oct === 1) { held.add('right'); held.add('tuck'); }   // misty right
    else if (oct === 2) held.add('tuck');                          // frontflip / tuck
    else if (oct === 3) { held.add('left'); held.add('tuck'); }    // misty left
    else if (oct === 4 || oct === -4) held.add('left');
    else if (oct === -3) { held.add('left'); held.add('brake'); }  // cork left
    else if (oct === -2) held.add('brake');                        // backflip / brake
    else if (oct === -1) { held.add('right'); held.add('brake'); } // cork right
  }
  let stickId = null;
  const track = (e) => {
    const r2 = base.getBoundingClientRect();
    let dx = ((e.clientX - r2.left) / r2.width) * 2 - 1;
    let dy = ((e.clientY - r2.top) / r2.height) * 2 - 1;
    const m = Math.hypot(dx, dy);
    if (m > 1) { dx /= m; dy /= m; }
    setStick(dx, dy);
  };
  base.addEventListener('pointerdown', (e) => { e.preventDefault(); stickId = e.pointerId; base.setPointerCapture(stickId); track(e); SND.init(); startEdge = true; });
  base.addEventListener('pointermove', (e) => { if (e.pointerId === stickId) { e.preventDefault(); track(e); } });
  const stickEnd = (e) => { if (e.pointerId === stickId) { stickId = null; setStick(0, 0); } };
  base.addEventListener('pointerup', stickEnd);
  base.addEventListener('pointercancel', stickEnd);

  // ---- RIGHT-THUMB CLUSTER: JUMP anchor, grabs arcing around it, butter on top ----
  const mkBtn = (act, size, right, bottom) => {
    const b = document.createElement('div');
    b.style.cssText = `position:absolute;right:calc(${right}px + env(safe-area-inset-right, 0px));bottom:${bottom}px;width:${size}px;height:${size}px;` +
      `border-radius:50%;background:${FILL};border:${EDGE};pointer-events:auto;touch-action:none;`;
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      if (act === 'pop' && !held.has('pop')) { popEdge = true; }
      if (act) held.add(act);
      startEdge = true;
      b.style.background = ACTIVE;
      SND.init();
    });
    const up = () => { if (act) held.delete(act); b.style.background = FILL; };
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    wrap.append(b);
    return b;
  };
  // landscape-tuned: everything inside the bottom ~170px thumb arc
  mkBtn('pop', 88, 22, 20);        // JUMP — the big anchor under the thumb
  mkBtn('grab1', 52, 118, 18);     // safety — arc position west of jump
  mkBtn('grab2', 52, 132, 78);     // mute — arc northwest
  mkBtn('grab3', 52, 96, 132);     // shifty — arc north-northwest
  mkBtn('butter', 58, 26, 116);    // butter — straight above jump
  // restart, top-left under the speed readout
  const rb = mkBtn(null, 42, 0, 0);
  rb.style.cssText = rb.style.cssText.replace(/right:[^;]+;bottom:[^;]+;/, 'left:max(20px, env(safe-area-inset-left));top:56px;');
  rb.addEventListener('pointerdown', () => { restartEdge = true; });

  // ---- PORTRAIT PROMPT: this game is built for horizontal play ----
  const rot = document.createElement('div');
  rot.textContent = STR.rotatePhone;
  rot.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;z-index:9;' +
    'background:rgba(15,22,58,.88);color:#faf6ee;font:800 22px system-ui;letter-spacing:1px;text-align:center;pointer-events:none;';
  document.body.append(rot);
  const checkOrient = () => { rot.style.display = innerHeight > innerWidth ? 'flex' : 'none'; };
  addEventListener('resize', checkOrient);
  addEventListener('orientationchange', checkOrient);
  checkOrient();
}
addEventListener('pointerdown', () => SND.init());

// ---------------- settings (turn sensitivity) ----------------
const BASE_TURN = SIM.TUNE.turnRate, BASE_YAW = SIM.TUNE.yawRateMax;
function applyTurnSens(m) {
  SIM.TUNE.turnRate = BASE_TURN * m;
  SIM.TUNE.yawRateMax = BASE_YAW * m;
}
let turnSens = 1;
try { turnSens = Math.min(1.5, Math.max(0.5, parseFloat(localStorage.getItem('bp_turnSens')) || 1)); } catch (e) {}
applyTurnSens(turnSens);
{
  $('settingsTitle').textContent = STR.settings;
  $('turnSensLabel').textContent = STR.turnSens;
  $('turnSensHint').textContent = STR.turnSensHint;
  $('settingsClose').textContent = STR.settingsClose;
  const slider = $('turnSens'), val = $('turnSensVal');
  slider.value = Math.round(turnSens * 100);
  val.textContent = Math.round(turnSens * 100) + '%';
  slider.addEventListener('input', () => {
    turnSens = slider.value / 100;
    val.textContent = slider.value + '%';
    applyTurnSens(turnSens);
    try { localStorage.setItem('bp_turnSens', String(turnSens)); } catch (e) {}
  });
  // sound volume — if the served HTML doesn't carry the row (page cache), build it
  if (!$('soundVol')) {
    const row = document.createElement('div');
    row.className = 'setRow'; row.style.marginTop = '18px';
    row.innerHTML = '<span id="soundVolLabel"></span><span id="soundVolVal"></span>';
    const sl = document.createElement('input');
    sl.type = 'range'; sl.id = 'soundVol'; sl.min = '0'; sl.max = '100'; sl.step = '5'; sl.value = '100';
    sl.style.cssText = 'width:100%;accent-color:#c96f4a;';
    const closeBtn = $('settingsClose');
    closeBtn.parentNode.insertBefore(row, closeBtn);
    closeBtn.parentNode.insertBefore(sl, closeBtn);
  }
  $('soundVolLabel').textContent = STR.soundVol;
  const vSlider = $('soundVol'), vVal = $('soundVolVal');
  vSlider.value = Math.round(SND.volume * 100);
  vVal.textContent = Math.round(SND.volume * 100) + '%';
  vSlider.addEventListener('input', () => {
    SND.setVolume(vSlider.value / 100);
    vVal.textContent = vSlider.value + '%';
  });
  // control opacity (touch devices) — fade the on-screen controls to taste
  if (TOUCH) {
    const row = document.createElement('div');
    row.className = 'setRow'; row.style.marginTop = '18px';
    row.innerHTML = '<span id="ctlOpLabel"></span><span id="ctlOpVal"></span>';
    const sl = document.createElement('input');
    sl.type = 'range'; sl.id = 'ctlOp'; sl.min = '20'; sl.max = '100'; sl.step = '5';
    sl.style.cssText = 'width:100%;accent-color:#c96f4a;';
    const closeBtn = $('settingsClose');
    closeBtn.parentNode.insertBefore(row, closeBtn);
    closeBtn.parentNode.insertBefore(sl, closeBtn);
    row.querySelector('#ctlOpLabel').textContent = STR.ctlOpacity;
    const cur = touchWrap ? Math.round(parseFloat(touchWrap.style.opacity || '0.85') * 100) : 85;
    sl.value = cur;
    row.querySelector('#ctlOpVal').textContent = cur + '%';
    sl.addEventListener('input', () => {
      const v = sl.value / 100;
      if (touchWrap) touchWrap.style.opacity = v;
      row.querySelector('#ctlOpVal').textContent = sl.value + '%';
      try { localStorage.setItem('bp_ctlOp', String(v)); } catch (e) {}
    });
  }
  // ---- PROGRESSION selectors: rider, outfit, grab bindings (cycle through unlocked) ----
  {
    const closeBtn = $('settingsClose');
    const cycleRow = (labelText, getOptions, getCur, setCur) => {
      const row = document.createElement('div');
      row.className = 'setRow'; row.style.marginTop = '14px'; row.style.alignItems = 'center';
      const lb = document.createElement('span'); lb.textContent = labelText; row.append(lb);
      const b = document.createElement('button');
      b.style.cssText = 'pointer-events:auto;cursor:pointer;border:none;border-radius:9px;padding:6px 14px;' +
        'font-size:13px;font-weight:800;font-family:inherit;background:#efe7d8;color:#4a5568;min-width:130px;';
      const refresh = () => { b.textContent = getCur(); };
      b.addEventListener('click', () => { setCur(); refresh(); });
      row.append(b);
      closeBtn.parentNode.insertBefore(row, closeBtn);
      refresh();
      return refresh;
    };
    const cycle = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
    // rider
    cycleRow(STR.rider,
      () => PROG.unlockedList('char', CHARS),
      () => CHARS[curChar].label,
      () => { curChar = cycle(PROG.unlockedList('char', CHARS), curChar); saveSelections(); applyRiderPhys(); dressRider(); });
    // three grab slots
    const slotKeys = ['J', 'K', 'L'];
    slotKeys.forEach((k2, i) => {
      cycleRow(STR.grabSlot + ' ' + k2,
        () => PROG.unlockedList('grab', GRAB_DEFS),
        () => GRAB_DEFS[SLOT_BINDS[i]].label,
        () => { SLOT_BINDS[i] = cycle(PROG.unlockedList('grab', GRAB_DEFS), SLOT_BINDS[i]); saveSelections(); });
    });
  }
  // ---- IN-GAME MENU: hamburger pinned top-right; MENU tab (map select that
  // drops straight into the run + main-menu exit) and a separate SETTINGS tab
  // holding every config row. Built programmatically — cache-proof.
  {
    const panel = $('settingsPanel');
    const closeBtn = $('settingsClose');
    const btn = $('settingsBtn');
    const title = $('settingsTitle');
    if (title) title.style.display = 'none';
    // the button becomes three lines in the top-right corner
    btn.textContent = '';
    for (let i = 0; i < 3; i++) {
      const line = document.createElement('div');
      line.style.cssText = 'width:22px;height:3px;border-radius:2px;background:#4a5568;margin:2.5px 0;';
      btn.append(line);
    }
    btn.style.cssText = 'position:fixed;top:calc(14px + env(safe-area-inset-top, 0px));' +
      'right:calc(14px + env(safe-area-inset-right, 0px));left:auto;bottom:auto;width:46px;height:42px;' +
      'display:flex;flex-direction:column;justify-content:center;align-items:center;pointer-events:auto;' +
      'cursor:pointer;border:none;border-radius:10px;background:rgba(245,239,227,.92);' +
      'box-shadow:0 3px 10px rgba(60,40,80,.25);z-index:8;';
    // everything already in the panel becomes the SETTINGS tab
    const tabMenu = document.createElement('div');
    const tabSet = document.createElement('div');
    for (const el2 of [...panel.children]) if (el2 !== title && el2 !== closeBtn) tabSet.append(el2);
    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:8px;justify-content:center;margin:2px 0 16px;';
    const mkTab = (label) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'pointer-events:auto;cursor:pointer;border:none;border-radius:9px;padding:7px 18px;' +
        'font-weight:800;font-size:13px;font-family:inherit;letter-spacing:1px;';
      bar.append(b); return b;
    };
    const tMenu = mkTab(STR.menuTab), tSet = mkTab(STR.settings);
    const sel = (which) => {
      tabMenu.style.display = which === 'menu' ? 'block' : 'none';
      tabSet.style.display = which === 'set' ? 'block' : 'none';
      for (const [b, on] of [[tMenu, which === 'menu'], [tSet, which === 'set']]) {
        b.style.background = on ? '#c96f4a' : '#efe7d8';
        b.style.color = on ? '#faf6ee' : '#4a5568';
      }
    };
    tMenu.addEventListener('click', () => sel('menu'));
    tSet.addEventListener('click', () => sel('set'));
    // MENU tab: pick a map (straight into that run) or head back to the main menu
    {
      const lb = document.createElement('div');
      lb.textContent = STR.chooseMap;
      lb.style.cssText = 'font-size:13px;font-weight:800;letter-spacing:1px;color:#7a8699;margin:2px 0 10px;';
      tabMenu.append(lb);
      const MBTN = 'pointer-events:auto;cursor:pointer;display:block;width:100%;border:none;border-radius:10px;' +
        'padding:11px;margin:0 0 8px;font-size:14.5px;font-weight:800;font-family:inherit;';
      for (const id of Object.keys(SIM.MAPS)) {
        const b = document.createElement('button');
        b.textContent = (STR.mapNames[id] || id) + (id === currentMap ? ' \u2713' : '');
        b.style.cssText = MBTN + (id === currentMap ? 'background:#c96f4a;color:#faf6ee;' : 'background:#efe7d8;color:#4a5568;');
        b.addEventListener('click', () => {
          if (id === currentMap) { panel.classList.add('hidden'); return; }
          // straight into the chosen map — the resume flag skips the shell
          try { localStorage.setItem('bp_map', id); localStorage.setItem('bp_resume', '1'); } catch (e) {}
          location.reload();
        });
        tabMenu.append(b);
      }
      const home = document.createElement('button');
      home.textContent = STR.mainMenu;
      home.style.cssText = MBTN + 'margin-top:14px;background:#39445a;color:#faf6ee;';
      home.addEventListener('click', () => {
        try { localStorage.removeItem('bp_resume'); } catch (e) {}
        location.reload(); // boots back into the shell's main menu
      });
      tabMenu.append(home);
    }
    panel.insertBefore(bar, panel.firstChild);
    panel.append(tabMenu, tabSet);
    panel.append(closeBtn); // pull Done back out (it may sit nested inside a moved row)
    window.bpOpenPanel = (tab) => { sel(tab); panel.style.zIndex = '9'; panel.classList.remove('hidden'); };
    btn.addEventListener('click', () => {
      if (panel.classList.contains('hidden')) window.bpOpenPanel('menu');
      else panel.classList.add('hidden');
    });
    closeBtn.addEventListener('click', () => panel.classList.add('hidden'));
    addEventListener('keydown', (e) => { if (e.code === 'Escape') panel.classList.add('hidden'); });
    sel('menu');
  }
}
$('gameTitle').textContent = STR.title;
$('gameSub').textContent = STR.subtitle;
$('pressStart').textContent = STR.pressStart;
// (map selection moved into the shell's PLAY flow)
{
  const go = $('pressStart');
  const lvBadge = document.createElement('div');
  const lv = PROG.level();
  const nxt = PROG.nextUnlock();
  const nxtLabel = nxt ? (nxt.type === 'grab' ? GRAB_DEFS[nxt.id] : nxt.type === 'outfit' ? OUTFITS[nxt.id] : CHARS[nxt.id]).label : null;
  lvBadge.textContent = STR.level + ' ' + lv + ' · ' + PROG.xp + ' XP' + (nxtLabel ? ' — ' + STR.nextUnlock.toLowerCase() + ': ' + nxtLabel : '');
  lvBadge.style.cssText = 'margin-top:8px;font-size:12.5px;font-weight:700;color:#7a8699;';
  go.parentNode.insertBefore(lvBadge, go);
}
$('finishTitle').textContent = STR.finish;
$('restartHint').textContent = STR.restartHint;
{
  const kc = $('controlList');
  for (const [k, v] of STR.controls) {
    const row = document.createElement('div'); row.className = 'ctlRow';
    const kk = document.createElement('span'); kk.className = 'key'; kk.textContent = k;
    const vv = document.createElement('span'); vv.textContent = v;
    row.append(kk, vv); kc.append(row);
  }
}
if (dev) els.dev.style.display = 'block';

function toast(text, cls = '') {
  const d = document.createElement('div');
  d.className = 'toast ' + cls; d.textContent = text;
  els.toasts.append(d);
  setTimeout(() => d.classList.add('show'), 10);
  setTimeout(() => { d.classList.add('gone'); setTimeout(() => d.remove(), 500); }, 1900);
}
const ZONES = SIM.ZONE_DEFS.map(([s, key]) => [s, STR[key] || key]);
let zoneIdx = 0;
function zoneToast() {} // zone titles removed per player preference

// ---------------- fixed-timestep loop ----------------
const STEP = 1000 / 120;
let acc = 0, last = performance.now(), paused = false;
// pause on tab visibility, not window blur — inside the platform iframe the window
// starts unfocused and blur-pausing would freeze the game before the first click
document.addEventListener('visibilitychange', () => {
  paused = document.hidden;
  if (!paused) last = performance.now();
});
// first click claims keyboard focus for the iframe; in the gate it also drops in
addEventListener('pointerdown', (e) => {
  window.focus();
  if (e.target && e.target.closest && e.target.closest('#settingsPanel,#settingsBtn,#startMapRow')) return;
  startEdge = true;
});


const input = { left: false, right: false, tuck: false, brake: false, pop: false, grab1: false, grab2: false, grab3: false, popEdge: false, restart: false, start: false };
function readInput() {
  if (uiState !== 'play') { // shell is up: the run stays frozen at the gate
    for (const k2 in input) input[k2] = false;
    popEdge = false; restartEdge = false; startEdge = false;
    return;
  }
  input.left = held.has('left'); input.right = held.has('right');
  input.tuck = held.has('tuck'); input.brake = held.has('brake');
  input.pop = held.has('pop'); input.grab1 = held.has('grab1'); input.grab2 = held.has('grab2');
  input.grab3 = held.has('grab3');
  input.butter = held.has('butter');
  input.popEdge = popEdge; input.restart = restartEdge; input.start = startEdge;
  popEdge = false; restartEdge = false; startEdge = false;
}

let shakeT = 0, shakeAmp = 0, lastAward = null;
function drainEvents() {
  for (const ev of sim.events) {
    if (ev.type === 'trick') { toast(`${ev.text}  +${ev.pts}`, ev.clean ? 'clean' : 'sketchy'); if (!ev.clean) { toast(STR.sketchy, 'sketchy small'); settleT = 0.5; } shakeT = 0.25; shakeAmp = ev.clean ? 0.12 : 0.3; SND.chime(ev.clean); }
    else if (ev.type === 'land') { toast(ev.clean ? STR.clean : STR.sketchy, ev.clean ? 'clean small' : 'sketchy small'); shakeT = 0.2; shakeAmp = 0.1; }
    else if (ev.type === 'bail') { toast(STR.bail, 'bail'); shakeT = 0.5; shakeAmp = 0.55; SND.bail(); }
    else if (ev.type === 'grindStart') { toast(ev.name, 'clean small'); SND.clank(); }
    else if (ev.type === 'swapHop') { toast(STR.swap, 'clean small'); SND.swap(); }
    else if (ev.type === 'bounce') { shakeT = 0.18; shakeAmp = 0.2; SND.bounce(); }
    else if (ev.type === 'go') { els.start.classList.add('hidden'); zoneToast(STR.go); SND.go(); }
    else if (ev.type === 'finish') {
      const pb = (ACC.getProfile() && ACC.getProfile().best) || {};
      if (!pb[SIM.MAP_ID] || sim.score > pb[SIM.MAP_ID]) ACC.patchProfile({ best: { ...pb, [SIM.MAP_ID]: Math.round(sim.score) } });
      lastAward = PROG.award(sim.score);
      for (const name of lastAward.ups) { toast(STR.unlocked + ': ' + name, 'clean'); SND.finish(); }
      showFinish(); SND.finish();
    }
  }
  sim.events.length = 0;
}
function showFinish() {
  els.finStats.innerHTML = '';
  const lv = PROG.level();
  const into = PROG.xp - PROG.totalFor(lv);
  const need = PROG.needFor(lv);
  const nxt = PROG.nextUnlock();
  const rows = [
    [STR.finalScore, String(Math.round(sim.score))],
    [STR.bestTrick, sim.best.name ? `${sim.best.name} (+${sim.best.pts})` : '—'],
    [STR.topSpeed, `${Math.round(sim.topSpeed * 3.6)} ${STR.speedUnit}`],
    [STR.bestRun, String(Math.round(Math.max(sim.bestScore || 0, sim.score)))],
    [STR.xpGained, lastAward ? '+' + lastAward.gained : '—'],
    [STR.level + ' ' + lv, `${into} / ${need} XP`],
  ];
  if (nxt) {
    const src2 = nxt.type === 'grab' ? GRAB_DEFS[nxt.id] : nxt.type === 'outfit' ? OUTFITS[nxt.id] : CHARS[nxt.id];
    rows.push([STR.nextUnlock, `${src2.label} (${STR.level} ${nxt.lvl})`]);
  }
  for (const [k, v] of rows) {
    const d = document.createElement('div'); d.className = 'statRow';
    const a = document.createElement('span'); a.textContent = k;
    const b = document.createElement('span'); b.className = 'statVal'; b.textContent = v;
    d.append(a, b); els.finStats.append(d);
  }
  els.finish.classList.remove('hidden');
}

// ---------------- per-frame visual update ----------------
const _up = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion(), _q4 = new THREE.Quaternion(), _q5 = new THREE.Quaternion();
const _axisZ = new THREE.Vector3(0, 0, 1);
// cork axes: ~35° off vertical — mostly spin with a dipped shoulder (corked, not side-flipped)
const CORK_TILT = 0.785; // 45deg: body-length parallel to the ground mid-cork [batch 2]
const AXIS_MISTY = new THREE.Vector3(0, Math.cos(CORK_TILT), -Math.sin(CORK_TILT)).normalize();
const AXIS_CORK = new THREE.Vector3(0, Math.cos(CORK_TILT), Math.sin(CORK_TILT)).normalize();
const _e = new THREE.Euler(), _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _camT = new THREE.Vector3(), _look = new THREE.Vector3(), _lookCur = new THREE.Vector3(0, 0, -30);
const _axisX = new THREE.Vector3(1, 0, 0), _axisY = new THREE.Vector3(0, 1, 0);
const _snorm = { s: 0, l: 0, y: 1 };
let smoothUp = new THREE.Vector3(0, 1, 0);
let visYaw = 0, bailSpin = 0, airSkiL = 0, airSkiR = 0, butterLift = 0, lastSpinSign = 1;
let grabIKReq = null; // set by the air pose branch; consumed after visuals update

// ---- GRAB IK [user request]: two-bone CCD that pulls the grabbing hand onto
// the ACTUAL grab point of the ACTUAL ski, so every grab connects for every
// rider fit. Runs after pose blending; the base pose supplies the style, the
// IK supplies the contact. Weighted by the grab ease so it ramps in naturally.
const _ikA = new THREE.Vector3(), _ikB = new THREE.Vector3(), _ikT = new THREE.Vector3(), _ikJP = new THREE.Vector3();
const _ikQd = new THREE.Quaternion(), _ikQs = new THREE.Quaternion(), _ikQp = new THREE.Quaternion(), _ikQpi = new THREE.Quaternion(), _ikQx = new THREE.Quaternion();
function applyGrabIK(R, req) {
  R.rig.updateMatrixWorld(true);
  for (const [hand, skiSide, px, py, pz] of req.ik) {
    const palm = R.HANDS && R.HANDS[hand], ski = R.SKIS && R.SKIS[skiSide];
    if (!palm || !ski) continue;
    _ikT.set(px, py, pz).applyMatrix4(ski.matrixWorld); // world grab point (ski already posed)
    for (let pass = 0; pass < 2; pass++) {
      for (const jn of ['elbow' + hand, 'shoulder' + hand]) {
        const j = R.J[jn];
        if (!j) continue;
        _ikJP.setFromMatrixPosition(j.matrixWorld);
        _ikA.setFromMatrixPosition(palm.matrixWorld).sub(_ikJP);
        const toT = _ikB.copy(_ikT).sub(_ikJP);
        if (_ikA.lengthSq() < 1e-6 || toT.lengthSq() < 1e-6) continue;
        _ikQd.setFromUnitVectors(_ikA.normalize(), toT.normalize());
        const ang = 2 * Math.acos(Math.min(1, Math.abs(_ikQd.w)));
        const k2 = ang > 1e-4 ? Math.min(1, (0.65 * req.w) * Math.min(ang, 0.55) / ang) : 0;
        _ikQs.identity().slerp(_ikQd, k2);
        j.parent.getWorldQuaternion(_ikQp);
        _ikQpi.copy(_ikQp).invert();
        j.quaternion.premultiply(_ikQx.copy(_ikQpi).multiply(_ikQs).multiply(_ikQp));
        j.updateMatrixWorld(true); // refresh the chain (palm included) for the next joint
      }
    }
  }
}
const camTrail = []; let swayT = 0; // the follow-filmer's memory of the rider's line
let settleT = 0; // off-axis landings get ridden back upright, not snapped
// ELITE AIR STYLE [style-bible]: every air gets its own tiny variation — no two
// jumps move identically — plus a continuous micro-adjustment clock
let AIRV = null, airVarSeed = 1, microT = 0;
function rollAirVariation() {
  const r = SIM.mulberry32((airVarSeed = (airVarSeed * 16807) % 2147483647));
  return {
    armL: (r() - 0.5) * 0.28, armR: (r() - 0.5) * 0.28,
    head: (r() - 0.5) * 0.22,
    hipY: (r() - 0.5) * 0.14,
    legAsym: (r() - 0.5) * 0.22,
    ext: (r() - 0.5) * 0.14,
    grabDelay: 0.04 + r() * 0.14,
  };
}
let prevVisMode = 'gate', throwT = 0, throwDir = 0; // arm-throw impulse at spin takeoff

function damp(cur, tgt, rate, dt) { return cur + (tgt - cur) * (1 - Math.exp(-rate * dt)); }

function updateVisuals(dt) {
  if (GRABTEST && sim.mode === 'gate' && GRAB_DEFS[GRABTEST]) {
    const gd = GRAB_DEFS[GRABTEST];
    setTargets(POSES.airNeut);
    setTargets(POSES[gd.pose] || POSES.safety, 1);
    airSkiL = gd.sl; airSkiR = gd.sr;
    grabIKReq = gd.ik ? { ik: gd.ik, w: 1 } : null;
    for (const k in JOINT_RATE) { const j2 = J[k], t2 = target[k]; j2.rotation.set(t2[0], t2[1], t2[2]); }
    if (R1.SKIS) { R1.SKIS.L.rotation.x = airSkiL; R1.SKIS.R.rotation.x = airSkiR; }
    if (grabIKReq) applyGrabIK(R1, grabIKReq);
    { // orbit the CAMERA around the frozen pose, not the rig
      const rp = R1.rig.position, a2 = performance.now() * 0.0004;
      camera.position.set(rp.x + Math.sin(a2) * 3.4, rp.y + 1.3, rp.z + Math.cos(a2) * 3.4);
      camera.lookAt(rp.x, rp.y + 0.55, rp.z);
    }
    return;
  }
  const st = sim;
  const p = st.pos;
  // THROW: the instant a spinning takeoff leaves the snow, the wound-up arms get
  // hurled with the rotation — a brief impulse that decays into the counter-rotation
  if (st.mode === 'air' && prevVisMode !== 'air' && Math.abs(st.air.yawVel) > 1.2) {
    throwT = 0.45; throwDir = Math.sign(st.air.yawVel);
  }
  prevVisMode = st.mode;
  // --- pose targets by mode ---
  if (st.mode === 'gate') setTargets(POSES.gate);
  else if (st.mode === 'finish') setTargets(POSES.finish);
  else if (st.mode === 'bail') setTargets(POSES.bail);
  else if (st.mode === 'grind') {
    const g = st.grind;
    // pose blends continuously with orientation: 50-50 when aligned, boardslide
    // balance shape when sideways — no snapping, mirrors the free rail spin
    const w = g ? Math.abs(Math.sin(g.spinA)) : 0;
    setTargets(POSES.fifty);
    setTargets(POSES.grind, w);
    if (g) {
      const jS = STYLE().jib;
      const sv = Math.max(-1, Math.min(1, g.spinVel / 3)) * jS;
      addTargets({ spine: [0, -0.3 * sv, 0], shoulderL: [0, 0, -0.3 * sv], shoulderR: [0, 0, -0.3 * sv], neck: [0, 0.2 * sv, 0] });
      // frontslide/backslide: lift a foot, weight over the standing leg
      if (input.grab1) addTargets({ hipL: [-1.2 * jS, 0, 0.12], kneeL: [1.75 * jS, 0, 0], hips: [0, 0, -0.14 * jS], spine: [0, 0, 0.14 * jS], shoulderL: [0, 0, 0.5 * jS] });
      else if (input.grab3) addTargets({ hipR: [-1.2 * jS, 0, -0.12], kneeR: [1.75 * jS, 0, 0], hips: [0, 0, 0.14 * jS], spine: [0, 0, -0.14 * jS], shoulderR: [0, 0, -0.5 * jS] });
      // loading a hop on the rail: sink into the legs
      if (st.charge >= 0) setTargets(POSES.load, 0.55);
      // controlled swap: a soft unweight while the body pivots — legs extend
      // through the middle of the turn, then settle back into the slide
      if (g && g.swapAnim > 0) setTargets(POSES.pop, Math.sin(Math.PI * Math.min(1, g.swapAnim / 0.45)) * 0.5);
      // SKI SCISSOR [batch item 8, ref]: through the swap the skis shear across the
      // rail line in opposite directions — a continuous weighted pivot, never a snap
      const swA = g && g.swapAnim > 0 ? Math.sin(Math.PI * Math.min(1, g.swapAnim / 0.45)) : 0;
      airSkiL = 0.42 * swA; airSkiR = -0.42 * swA;
    }
  }
  else if (st.mode === 'air') {
    const a = st.air;
    const flipping = Math.abs(a.pitchVel) > 1.2 || Math.abs(a.corkVel) > 1.4;
    // GRABS never snap: the hand reaches, finds the ski, settles with a soft
    // overshoot, and eases off on release (the damp blend handles the recover)
    if (!AIRV) AIRV = rollAirVariation();
    const gEase = (t2) => {
      const x = Math.max(0, Math.min(1, (t2 - AIRV.grabDelay) / 0.42));
      if (x <= 0) return 0;
      const b = 1.6, u = x - 1;
      return 1 + (b + 1) * u * u * u + b * u * u; // reach with a settle-overshoot
    };
    // the pose AND ski tweak follow whatever grab is BOUND to the key (fixes
    // hardcoded safety/mute/shifty poses ignoring the player's binds)
    const gSlot = input.grab1 ? 0 : input.grab2 ? 1 : input.grab3 ? 2 : -1;
    grabIKReq = null;
    if (gSlot >= 0) {
      const gd = GRAB_DEFS[SLOT_BINDS[gSlot]] || GRAB_DEFS.safety;
      const gt = gSlot === 0 ? a.grab1T : gSlot === 1 ? a.grab2T : a.shiftyT;
      const gw = gEase(gt);
      setTargets(POSES.airNeut); setTargets(POSES[gd.pose] || POSES.safety, gw);
      airSkiL = gd.sl * gw; airSkiR = gd.sr * gw;
      if (gd.ik) grabIKReq = { ik: gd.ik, w: gw };
    }
    if (gSlot < 0 && flipping) {
      // HARLAUT PHASING: fold compact through the middle of the rotation, open
      // up to spot the landing — the shape breathes with the trick
      const src = a.comboAxis && Math.abs(a.corkVel) > 1.2 ? a.corkA : a.pitchAccum;
      const cyc = Math.abs(src) % (2 * Math.PI);
      const fold = Math.sin(Math.PI * (cyc / (2 * Math.PI)));
      setTargets(POSES.airNeut);
      setTargets(POSES.flip, Math.min(1, (0.3 + 0.7 * fold) * STYLE().fold));
      airSkiL = 0; airSkiR = 0;
    }
    else if (gSlot < 0) { setTargets(POSES.airNeut); airSkiL = 0; airSkiR = 0; }
    // COUNTER-ROTATION (the harlaut loose look): legs lead, torso counters hard,
    // head stays spotting the landing — upper and lower body read independently
    const w = Math.max(-1.3, Math.min(1.3, ((a.yawVel + a.corkVel * 0.7) / 4) * STYLE().counter));
    if (Math.abs(a.yawVel) > 0.5 || Math.abs(a.corkVel) > 0.5) lastSpinSign = Math.sign(a.yawVel + a.corkVel) || lastSpinSign;
    addTargets({
      shoulderL: [0, 0, -0.42 * w], shoulderR: [0, 0, -0.42 * w],
      spine: [0, -0.45 * w, 0], neck: [0, 0.34 * w, 0],
      hipL: [0, 0.34 * w, 0], hipR: [0, 0.34 * w, 0],
    });
    // ARM CARRIAGE (style): wide active balance arms vs quiet disciplined ones
    const armS = STYLE().arms - 1;
    if (armS !== 0) addTargets({ shoulderL: [0, 0, armS * 0.38], shoulderR: [0, 0, -armS * 0.38], elbowL: [armS * 0.15, 0, 0], elbowR: [armS * 0.15, 0, 0] });
    // off-axis dip while corking/mistying
    const rv = Math.max(-1, Math.min(1, a.rollVel / 3));
    if (rv !== 0) addTargets({ spine: [0, 0, -0.2 * rv], hips: [0, 0, -0.15 * rv] });
    // ARM THROW: right off the lip the arms sweep hard WITH the spin — momentum made
    // visible — easing out as the counter-rotated steeze takes over
    if (throwT > 0) {
      throwT = Math.max(0, throwT - dt);
      // LAUNCH SEQUENCE [batch 2]: the head turns into the spin FIRST, the
      // torso winds up after it, and the legs trail last — catching up as the
      // throw resolves. Top-down rotation, like a real skier.
      const p2 = throwT / 0.45, u = 1 - p2;
      const d2 = throwDir, aS = STYLE().arms;
      addTargets({
        neck: [0, 0.7 * d2 * Math.pow(p2, 0.5), 0],                                // head: instant lead, eases off
        spine: [0, 0.45 * d2 * Math.sin(Math.PI * Math.min(1, u / 0.75)), 0],      // torso: follows through the middle
        hips: [0, -0.15 * d2 * p2, 0],
        hipL: [0, -0.3 * d2 * Math.pow(p2, 1.3), 0], hipR: [0, -0.3 * d2 * Math.pow(p2, 1.3), 0], // legs: last to come around
        shoulderL: [0, 0, 0.7 * d2 * Math.pow(p2, 1.5) * aS], shoulderR: [0, 0, 0.7 * d2 * Math.pow(p2, 1.5) * aS],
      });
    }
    // ---- ELITE AIR PHYSICS LAYER ----
    microT += dt;
    {
      const S2 = STYLE();
      // 1) constant subconscious micro-corrections — asymmetric phases, never
      // mirrored, calmer when the rotation is fast, busier while floating
      const calm = 1 - Math.min(1, (Math.abs(a.yawVel) + Math.abs(a.corkVel)) * 0.14);
      const m = 0.045 * S2.arms * (0.55 + 0.45 * calm);
      addTargets({
        shoulderL: [Math.sin(microT * 2.1) * m, 0, Math.sin(microT * 1.3 + 1) * m * 1.5 + AIRV.armL],
        shoulderR: [Math.sin(microT * 1.7 + 2) * m, 0, -Math.sin(microT * 1.5 + 4) * m * 1.5 + AIRV.armR],
        elbowL: [Math.sin(microT * 2.7 + 1) * m * 1.2, 0, 0],
        elbowR: [Math.sin(microT * 2.3 + 3) * m * 1.2, 0, 0],
        spine: [Math.sin(microT * 1.1) * 0.018, AIRV.hipY * 0.3, Math.sin(microT * 0.9 + 2) * 0.018],
        hipL: [AIRV.legAsym * 0.4 + Math.sin(microT * 1.9) * 0.02, 0, 0],
        hipR: [-AIRV.legAsym * 0.35 + Math.sin(microT * 2.2 + 1) * 0.02, 0, 0],
        kneeL: [AIRV.ext * 0.5 + Math.sin(microT * 2.4) * 0.028, 0, 0],
        kneeR: [AIRV.ext * 0.5 - AIRV.legAsym * 0.4 + Math.sin(microT * 2.0 + 2) * 0.028, 0, 0],
        ankleL: [Math.sin(microT * 3.1) * 0.022, 0, 0],
        ankleR: [Math.sin(microT * 2.8 + 1) * 0.022, 0, 0],
      });
      // 2) THE HIPS DRIVE: pelvis leads the rotation, shoulders trail behind it,
      // the head looks INTO the spin ahead of everything
      const lead = Math.max(-0.5, Math.min(0.5, a.yawVel * 0.1));
      addTargets({ hips: [0, lead * 0.7, 0], spine: [0, -lead * 0.5 * S2.counter, 0], neck: [0, lead * 1.2 + AIRV.head, 0] });
      // 3) LANDING PREPARATION: spot the touchdown, extend the legs to meet the
      // snow, arms widen to stabilize — blended in over the final ~0.4s
      const hAbove = Math.max(0, p.y - SIM.terrainH(p.s, p.l));
      const tLand = st.vel.y < -0.5 ? hAbove / -st.vel.y : 9;
      const prep = Math.max(0, Math.min(1, (0.55 - tLand) / 0.4));
      if (prep > 0) addTargets({
        neck: [-0.32 * prep, 0, 0],
        kneeL: [-0.45 * prep, 0, 0], kneeR: [-0.45 * prep, 0, 0],
        hipL: [0.22 * prep, 0, 0], hipR: [0.22 * prep, 0, 0],
        ankleL: [0.15 * prep, 0, 0], ankleR: [0.15 * prep, 0, 0],
        shoulderL: [0, 0, 0.28 * prep], shoulderR: [0, 0, -0.28 * prep],
      });
    }
  } else {
    // ground: glide/tuck/brake/load + carve lean
    if (st.charge >= 0) {
      // PROGRESSIVE CROUCH [batch item 7]: sinks deeper the longer the load;
      // the release extension comes from the pop/throw on takeoff
      const cf0 = Math.min(1, st.charge / SIM.TUNE.chargeMax);
      setTargets(POSES.glide);
      setTargets(POSES.load, 0.32 + 0.68 * cf0);
      // WINDUP: charging while holding a turn coils the body AGAINST the coming
      // spin — torso twists away, both arms sweep to the opposite side, deeper
      // the longer the charge — so the release reads as a real throw
      const wdir = (input.left ? 1 : 0) - (input.right ? 1 : 0);
      if (wdir !== 0) {
        const cf = st.charge / SIM.TUNE.chargeMax;
        const w2 = wdir * (0.35 + 0.65 * cf) * STYLE().arms;
        addTargets({
          spine: [0, -0.6 * w2, 0], hips: [0, -0.18 * w2, 0], neck: [0, 0.5 * w2, 0],
          shoulderL: [0.15, 0, -0.55 * w2], shoulderR: [0.15, 0, -0.55 * w2],
        });
        // SWITCH WIND-UP [batch item 1, ref]: deeper coil — arms wrap and cock,
        // head buries over the trailing shoulder, knees compress into the load
        if (st.switchStance) { const aw = Math.abs(w2);
          addTargets({ neck: [0, 0.45 * Math.sign(w2), 0], spine: [0.08 * aw, -0.3 * w2, 0],
            elbowL: [-0.55 * aw, 0, 0], elbowR: [-0.55 * aw, 0, 0],
            kneeL: [0.3 * aw, 0, 0], kneeR: [0.3 * aw, 0, 0], hips: [0.1 * aw, 0, 0] }); }
      }
    }
    else if (input.tuck) setTargets(POSES.tuck);
    else if (input.brake) setTargets(POSES.brake);
    else setTargets(POSES.glide);
    // AFTERBANG: quick absorb at touchdown, then legs lock out and hold the stomp —
    // deeper and longer the bigger the drop
    if (st.afterbang) {
      const ab = st.afterbang;
      const phase = 1 - ab.t / ab.T;
      const w = ab.amt * Math.min(1, ab.t / 0.15) * STYLE().bang; // eases off at the end; big for style riders
      setTargets(phase < 0.22 ? POSES.absorb : POSES.bang, Math.min(1, w));
      // the harlaut afterbang: the upper body reads like it's STILL rotating a
      // touch after the stomp — residual twist in the spin direction, arms low
      addTargets({
        spine: [0, 0.32 * lastSpinSign * w, 0], neck: [0, 0.24 * lastSpinSign * w, 0],
        shoulderL: [0, 0, 0.14 * w], shoulderR: [0, 0, -0.14 * w],
      });
    }
    // lean tracks the ACTUAL edge angle (heading vs momentum), not raw input —
    // the body banks with the arc it is carving
    const hspd = Math.sqrt(st.vel.s * st.vel.s + st.vel.l * st.vel.l);
    let leadV = 0;
    if (hspd > 0.5) {
      leadV = st.heading - Math.atan2(st.vel.l, st.vel.s);
      while (leadV > Math.PI) leadV -= 2 * Math.PI;
      while (leadV < -Math.PI) leadV += 2 * Math.PI;
    }
    const leadN = Math.max(-1, Math.min(1, leadV / 0.52)); // -1..1 edge amount
    carveEdgeG = st.mode === 'ground' ? leadN : 0; carveSpdG = hspd; // -> spray emitter
    const lean = -leadN * Math.min(0.78, 0.12 + hspd * 0.032); // speed digs the bank deeper [batch 3]: ~24deg at cruise, ~45deg railing at speed
    // ANGULATION [user]: real carving stacks the chest — the pelvis and legs
    // bank INTO the arc while the spine counters back so the shoulders stay
    // level and the upper body reads solid, not swaying with the ski
    const edge = Math.abs(leadN);
    addTargets({ // [batch item 6, ref]: hips sink low INTO the arc, knees drive laterally,
      // chest stays tall over the outside ski — sharper edge = deeper commit
      hips: [0.1 * edge, 0, lean * 1.18],
      spine: [0.05 * edge, -leadN * 0.2, -lean * 0.55],
      neck: [0, -leadN * 0.3, -lean * 0.3],
      shoulderL: [0.1 * edge, 0, 0.14 * edge],
      shoulderR: [0.1 * edge, 0, -0.14 * edge],
      elbowL: [-0.14 * edge, 0, 0], elbowR: [-0.14 * edge, 0, 0],
      kneeL: [0.3 * edge + (leadN < 0 ? 0.24 : 0), 0, -lean * 0.26],
      kneeR: [0.3 * edge + (leadN > 0 ? 0.24 : 0), 0, -lean * 0.26],
      hipL: [-0.12 * edge, 0, lean * 0.2], hipR: [-0.12 * edge, 0, lean * 0.2],
    });
    { // slope-adaptive body composition
      const dirS2 = st.vel.s >= 0 ? 1 : -1;
      const slp = (SIM.terrainH(st.pos.s + dirS2 * 3, st.pos.l) - SIM.terrainH(st.pos.s - dirS2 * 3, st.pos.l)) / 6; // + = climbing
      const climb = Math.max(-1, Math.min(1, slp / 0.35));
      if (climb > 0.05) addTargets({
        hips: [0.3 * climb, 0, 0], spine: [0.22 * climb, 0, 0], neck: [-0.2 * climb, 0, 0],
        shoulderL: [0.25 * climb, 0, 0], shoulderR: [0.25 * climb, 0, 0],
        hipL: [-0.3 * climb, 0, 0], hipR: [-0.3 * climb, 0, 0],
        kneeL: [0.38 * climb, 0, 0], kneeR: [0.38 * climb, 0, 0],
        ankleL: [-0.16 * climb, 0, 0], ankleR: [-0.16 * climb, 0, 0],
      });
      else if (climb < -0.05) { const dn = -climb; addTargets({
        hips: [-0.1 * dn, 0, 0], spine: [-0.08 * dn, 0, 0], neck: [0.1 * dn, 0, 0],
        hipL: [-0.16 * dn, 0, 0], hipR: [-0.16 * dn, 0, 0],
        kneeL: [0.22 * dn, 0, 0], kneeR: [0.22 * dn, 0, 0], ankleL: [-0.08 * dn, 0, 0], ankleR: [-0.08 * dn, 0, 0],
      }); }
    }
    const stS = STYLE().stance - 1;
    if (stS !== 0) addTargets({ hipL: [-stS * 0.35, 0, 0], hipR: [-stS * 0.35, 0, 0], kneeL: [stS * 0.6, 0, 0], kneeR: [stS * 0.6, 0, 0], hips: [stS * 0.12, 0, 0], ankleL: [-stS * 0.2, 0, 0], ankleR: [-stS * 0.2, 0, 0] });
    if (st.switchStance) addTargets({ // [batch item 1, ref]: twisted torso, head back over the shoulder, arms wide + trailing
      neck: [-0.05, 1.0, 0], spine: [0.06, 0.44, 0], hips: [0.02, 0.14, 0],
      shoulderL: [0.12, 0, 0.5], shoulderR: [0.12, 0, -0.5], elbowL: [-0.3, 0, 0], elbowR: [-0.3, 0, 0],
    });
    // NOSE BUTTER [R]: athletic stacked press — ~45° ankle / 45° knee / 45° hip
    // flexion, chest UP, arms winged for balance. The press comes from the legs
    // driving the tips, not from folding at the waist.
    if (st.butter) {
      const bS = STYLE().butter;
      addTargets({
        hips: [0.05 * bS, 0, 0], spine: [0.05 * bS, 0, 0], neck: [-0.12 * bS, 0, 0], // upright chest
        shoulderL: [-0.7, 0, 0.85], shoulderR: [-0.7, 0, -0.85],
        elbowL: [-0.15, 0, 0], elbowR: [-0.15, 0, 0],
        hipL: [-0.17 * bS, 0, 0], hipR: [-0.17 * bS, 0, 0],
        kneeL: [0.26 * bS, 0, 0], kneeR: [0.26 * bS, 0, 0],
        ankleL: [-0.5 * bS, 0, 0], ankleR: [-0.5 * bS, 0, 0], // deep ankle flexion drives the press
      });
    }
  }
  // --- blend joints toward targets (the smooth body transitions) ---
  for (const k in JOINT_RATE) {
    const j = J[k], t = target[k], r = JOINT_RATE[k];
    j.rotation.x = damp(j.rotation.x, t[0], r, dt);
    j.rotation.y = damp(j.rotation.y, t[1], r, dt);
    j.rotation.z = damp(j.rotation.z, t[2], r, dt);
  }
  // skis: ON SNOW they cancel leg-chain pitch to stay flat (tips never dig in);
  // IN AIR they take the grab pose angle — mute crosses via ankle yaw, safety near-flat
  const airborne = st.mode === 'air' || st.mode === 'bail';
  if (st.mode !== 'air') AIRV = null; // next air rolls a fresh variation
  for (const side of ['L', 'R']) {
    const jitter = airborne ? Math.sin(microT * 19 + (side === 'L' ? 0 : 2.1)) * 0.011 : 0; // ski inertia never fully settles
    const lvl = (airborne ? (side === 'L' ? airSkiL : airSkiR)
      : -(J['hip' + side].rotation.x + J['knee' + side].rotation.x + J['ankle' + side].rotation.x)) + jitter;
    SKIS[side].rotation.x = damp(SKIS[side].rotation.x, lvl, side === 'L' ? 11 : 13, dt); // slight L/R lag split
  }
  // ground clamp: place the body so the lower ski base sits exactly on the snow.
  // leg-chain vertical drop from hipsRoot given current (blended) flex angles:
  const dropOf = (s2) => 0.06 + 0.34 * Math.cos(J['hip' + s2].rotation.x) +
    0.32 * Math.cos(J['hip' + s2].rotation.x + J['knee' + s2].rotation.x);
  const legDrop = Math.max(dropOf('L'), dropOf('R'));
  body.position.y = SKIER_SCALE * (legDrop + 0.178 - 0.8); // 0.178 = ankle-to-ski-base; scaled with the rider

  // --- rig world transform ---
  rig.position.set(p.l, p.y, -p.s);
  SIM.terrainNormal(p.s, p.l, _snorm);
  _up.set(_snorm.l, _snorm.y, -_snorm.s);
  if (st.mode === 'air') _up.lerp(_v1.set(0, 1, 0), 0.6);
  smoothUp.lerp(_up, 1 - Math.exp(-8 * dt)).normalize();
  _q1.setFromUnitVectors(_v2.set(0, 1, 0), smoothUp);

  // NOTE: the modelFlip group already turns the mesh to face -Z (travel);
  // adding another PI here would flip him backwards again (the v3 bug).
  let yaw, pitch = 0, roll = 0, corkA = 0, corkMisty = false;
  if (st.mode === 'air') {
    yaw = -(st.air.baseHeading + st.air.yawAccum) + (st.air.startSwitch ? Math.PI : 0);
    pitch = st.air.pitchAccum;
    roll = st.air.rollAccum;
    corkA = st.air.corkA;
    corkMisty = st.air.comboAxis === 'misty';
  } else if (st.mode === 'grind') {
    const g = st.grind;
    yaw = g ? -(g.spinA) : visYaw; // body rotates freely on the rail
    visYaw = yaw;
  } else if (st.mode === 'bail') {
    bailSpin += dt * 7;
    yaw = visYaw + bailSpin * 0.6; pitch = bailSpin;
  } else {
    yaw = -st.heading + (st.switchStance ? Math.PI : 0) - (st.butter ? st.butter.a : 0);
    if (st.butter) pitch = -0.34; // NOSE butter: pressed over the tips, tails up
    visYaw = yaw; bailSpin = 0;
  }
  visYaw = yaw;
  _q2.setFromAxisAngle(_axisY, yaw);
  _q3.setFromAxisAngle(_axisX, pitch);
  _q4.setFromAxisAngle(_axisZ, roll);
  _q5.setFromAxisAngle(corkMisty ? AXIS_MISTY : AXIS_CORK, -corkA); // tilted-axis cork
  _q1.multiply(_q2).multiply(_q3).multiply(_q4).multiply(_q5);
  settleT = Math.max(0, settleT - dt);
  rig.quaternion.slerp(_q1, 1 - Math.exp(-(settleT > 0 ? 6.5 : 14) * dt)); // sketchy landings wrestle back upright
  if (st.mode === 'bail') rig.position.y += 0.15; // low tumble
  // nose butter pivots over the ski tips: lift the body so the noses graze the snow
  butterLift = damp(butterLift, st.butter && (st.mode === 'ground' || st.mode === 'gate') ? 0.27 : 0, 8, dt);
  rig.position.y += butterLift;

  // --- blob shadow ---
  const gY = SIM.terrainH(p.s, p.l);
  const h = Math.max(0, p.y - gY);
  shadow.position.set(p.l, gY + 0.04, -p.s);
  SIM.terrainNormal(p.s, p.l, _snorm);
  shadow.lookAt(p.l + _snorm.l, gY + 0.04 + _snorm.y, -p.s - _snorm.s);
  const ssc = 1 + h * 0.10;
  shadow.scale.setScalar(ssc);
  shadow.material.opacity = Math.max(0.06, 0.6 - h * 0.05);

  // --- camera: FOLLOW-FILMER — the camera rides the skier's OWN LINE a few
  // meters behind, like a filmer chasing the shot. At a lip the filmer is
  // still low on the run-in (low angle: skier framed against the sky); right
  // after you land they're still flying off the lip above you (high angle,
  // looking down). Fixed downhill orientation — the world frame never rotates.
  const spd = Math.sqrt(st.vel.s * st.vel.s + st.vel.l * st.vel.l + st.vel.y * st.vel.y);
  const dist = 3.5 + spd * 0.055 + (st.mode === 'air' ? 0.6 : 0); // tight follow — the skier fills the frame
  if (camTrail.length && Math.abs(p.s - camTrail[camTrail.length - 1].s) > 20) camTrail.length = 0; // restart/teleport
  camTrail.push({ s: p.s, l: p.l, y: p.y });
  if (camTrail.length > 720) camTrail.splice(0, camTrail.length - 720);
  let flm = camTrail[0];
  for (let ci = camTrail.length - 1; ci >= 0; ci--) if (p.s - camTrail[ci].s >= dist) { flm = camTrail[ci]; break; }
  // the filmer's eye: their height on the line back then, kept within a
  // dramatic-but-sane window around the rider
  const eyeY = Math.max(Math.min(flm.y + 1.55, p.y + 6.0), p.y - 4.5);
  _camT.set(flm.l * 0.55 + p.l * 0.45, eyeY, -p.s + dist);
  const camGy = SIM.terrainH(Math.max(0, p.s - dist), _camT.x) + 1.0;
  if (_camT.y < camGy) _camT.y = camGy;
  { // bump-proof rig: slow vertical damping, snappy horizontal
    const kH = 1 - Math.exp(-5 * dt), kV = 1 - Math.exp(-2.1 * dt);
    camera.position.x += (_camT.x - camera.position.x) * kH;
    camera.position.z += (_camT.z - camera.position.z) * kH;
    camera.position.y += (_camT.y - camera.position.y) * kV;
    // never lag out of frame on real drops/climbs
    camera.position.y = Math.max(Math.min(camera.position.y, p.y + 7), p.y - 5.5);
  }
  // handheld: a filmer's breath and footwork, always slightly alive
  swayT += dt;
  const sway = 0.035 + Math.min(0.1, spd * 0.003);
  camera.position.x += Math.sin(swayT * 1.7) * sway + Math.sin(swayT * 3.9 + 1.3) * sway * 0.45;
  camera.position.y += Math.sin(swayT * 2.3 + 0.7) * sway * 0.6;
  if (shakeT > 0) {
    shakeT -= dt;
    camera.position.x += (Math.random() - 0.5) * shakeAmp;
    camera.position.y += (Math.random() - 0.5) * shakeAmp;
  }
  _look.set(p.l, p.y + 0.9, -p.s - 9); // always looking straight down the fall line
  { const kH = 1 - Math.exp(-8 * dt), kV = 1 - Math.exp(-3.2 * dt); // soft vertical tracking: no nodding over bumps
    _lookCur.x += (_look.x - _lookCur.x) * kH;
    _lookCur.z += (_look.z - _lookCur.z) * kH;
    _lookCur.y += (_look.y - _lookCur.y) * kV;
    _lookCur.y = Math.max(Math.min(_lookCur.y, p.y + 4), p.y - 4); }
  camera.lookAt(_lookCur);
  const fovT = 56 + Math.min(10, spd * 0.35);
  camera.fov = damp(camera.fov, fovT, 3, dt);
  camera.updateProjectionMatrix();
  // the sun's shadow box rides along with the skier [batch item 4]
  sun.position.set(p.l + SUN_DIR.x * 60, p.y + SUN_DIR.y * 60, -p.s + SUN_DIR.z * 60);
  sun.target.position.set(p.l, p.y, -p.s);
  sun.target.updateMatrixWorld();
  { // NEVER LOSE THE RIDER [user]: project the skier into the frame — if they
    // drift toward an edge (big airs), the look-damping breaks and the filmer
    // whips to re-center. Guarantees the skier stays on screen.
    camera.updateMatrixWorld(true);
    _v2.set(p.l, p.y + 0.7, -p.s).project(camera);
    const ox = Math.max(0, Math.abs(_v2.x) - 0.72), oy = Math.max(0, Math.abs(_v2.y) - 0.62);
    if (_v2.z > 1 || ox > 0 || oy > 0) {
      const k3 = _v2.z > 1 ? 1 : Math.min(1, (ox + oy) * 3.2);
      _lookCur.lerp(_look, k3);
      camera.lookAt(_lookCur);
    }
  }

  // --- HUD ---
  els.speed.textContent = `${Math.round(spd * 3.6)} ${STR.speedUnit}`;
  els.score.textContent = `${STR.score} ${Math.round(st.score)}`;
  els.combo.textContent = st.combo > 1.01 ? `${STR.combo} ×${st.combo.toFixed(1)}` : '';
  if (st.charge >= 0) {
    els.chargeWrap.style.opacity = '1';
    els.charge.style.width = `${(st.charge / SIM.TUNE.chargeMax) * 100}%`;
  } else els.chargeWrap.style.opacity = '0';
  while (zoneIdx < ZONES.length && p.s > ZONES[zoneIdx][0]) { zoneToast(ZONES[zoneIdx][1]); zoneIdx++; }
  if (st.pos.s < 10 && zoneIdx > 0) zoneIdx = 0; // after restart
}

// restart also resets overlays
let lastMode = 'gate';
function watchRestart() {
  if (sim.mode === 'gate' && lastMode !== 'gate') {
    els.finish.classList.add('hidden');
    els.start.classList.remove('hidden');
    zoneIdx = 0;
  }
  lastMode = sim.mode;
}


// ==================== GAME SHELL: accounts, creator, main menu ====================
// flow: login/create -> username -> body -> wardrobe -> MAIN MENU -> mode -> map -> play
els.start.classList.add('hidden'); // the shell decides when the drop-in card shows
const FLOW = (() => {
  const wrap = document.createElement('div');
  wrap.id = 'flowUI';
  wrap.style.cssText = 'position:fixed;inset:0;z-index:7;display:none;font-family:"Avenir Next","Segoe UI",system-ui,sans-serif;';
  document.body.append(wrap);

  // ---- painted sunset-mountain backdrop ----
  const bg = document.createElement('canvas');
  bg.width = 1920; bg.height = 1080;
  bg.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;object-fit:cover;';
  wrap.append(bg);
  {
    const x = bg.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 0, 1080);
    gr.addColorStop(0, '#4a3a7a'); gr.addColorStop(0.3, '#8a4e86'); gr.addColorStop(0.48, '#d0607a');
    gr.addColorStop(0.58, '#f08a5a'); gr.addColorStop(0.66, '#ffc07a'); gr.addColorStop(1, '#e8a06a');
    x.fillStyle = gr; x.fillRect(0, 0, 1920, 1080);
    const sg = x.createRadialGradient(1380, 640, 0, 1380, 640, 320);
    sg.addColorStop(0, 'rgba(255,240,205,1)'); sg.addColorStop(0.15, 'rgba(255,214,140,0.85)'); sg.addColorStop(1, 'rgba(255,190,120,0)');
    x.fillStyle = sg; x.beginPath(); x.arc(1380, 640, 320, 0, 7); x.fill();
    const ridge = (baseY2, amp, col, seed) => {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, 1080);
      for (let px = 0; px <= 1920; px += 8) {
        const y2 = baseY2 - amp * (0.55 + 0.45 * Math.sin(px * 0.004 + seed)) * Math.abs(Math.sin(px * 0.0021 + seed * 2));
        x.lineTo(px, y2);
      }
      x.lineTo(1920, 1080); x.closePath(); x.fill();
    };
    ridge(760, 210, '#b06a8a', 1.7);      // far violet range
    ridge(830, 260, '#7a5276', 4.2);      // mid range
    ridge(950, 300, '#f2e6ee', 2.9);      // snowy foreground slopes
    ridge(1040, 240, '#faf3f6', 6.1);
    // scattered pines on the near slope
    x.fillStyle = '#3d3350';
    const rnd = (s2) => { const v = Math.sin(s2 * 127.1) * 43758.5; return v - Math.floor(v); };
    for (let i = 0; i < 60; i++) {
      const px = rnd(i) * 1920, py = 900 + rnd(i + 99) * 160, sc = 12 + rnd(i + 7) * 22;
      x.beginPath(); x.moveTo(px, py - sc * 2); x.lineTo(px - sc * 0.6, py); x.lineTo(px + sc * 0.6, py); x.closePath(); x.fill();
    }
  }

  // ---- 3D rider preview (its own tiny scene) ----
  const pvCanvas = document.createElement('canvas');
  const pv = { renderer: null, scene: null, cam: null, R: null, on: false };
  function initPreview() {
    if (pv.renderer) return;
    pv.renderer = new THREE.WebGLRenderer({ canvas: pvCanvas, alpha: true, antialias: true });
    pv.renderer.setSize(300, 400);
    pv.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    pv.scene = new THREE.Scene();
    pv.scene.add(new THREE.HemisphereLight(0xd98ab0, 0xe8c4a0, 1.1));
    const dl = new THREE.DirectionalLight(0xffe0b0, 1.5);
    dl.position.set(-2, 3, 3); pv.scene.add(dl);
    pv.cam = new THREE.PerspectiveCamera(38, 300 / 400, 0.1, 20);
    pv.cam.position.set(0.4, 1.15, 3.1);
    pv.cam.lookAt(0, 0.72, 0);
    pv.R = buildRiderRig();
    // relaxed standing pose
    const j = pv.R.J;
    const set = (n, x2, y2, z2) => { j[n].rotation.set(x2, y2, z2); };
    set('hips', 0.05, 0, 0); set('spine', 0.12, 0, 0); set('neck', -0.1, 0, 0);
    set('shoulderL', 0.2, 0, 0.32); set('shoulderR', 0.2, 0, -0.32);
    set('elbowL', -0.5, 0, 0); set('elbowR', -0.5, 0, 0);
    set('hipL', -0.32, 0, 0); set('hipR', -0.32, 0, 0);
    set('kneeL', 0.55, 0, 0); set('kneeR', 0.55, 0, 0);
    set('ankleL', -0.23, 0, 0); set('ankleR', -0.23, 0, 0);
    pv.R.body.position.y = SKIER_SCALE * (0.06 + 0.34 * Math.cos(0.32) + 0.32 * Math.cos(0.23) + 0.178 - 0.8);
    pv.scene.add(pv.R.rig);
  }
  function pvLoop() {
    if (!pv.on) return;
    pv.R.rig.rotation.y += 0.008;
    pv.renderer.render(pv.scene, pv.cam);
    requestAnimationFrame(pvLoop);
  }
  function startPreview() { initPreview(); dressRider(pv.R); if (!pv.on) { pv.on = true; pvLoop(); } }
  function stopPreview() { pv.on = false; }

  // ---- UI primitives ----
  const CARD = 'background:rgba(250,246,238,.96);border-radius:22px;padding:28px 36px;box-shadow:0 18px 60px rgba(74,66,90,.35);pointer-events:auto;';
  const BTN = 'display:block;width:100%;margin-top:12px;padding:13px;border:none;border-radius:12px;cursor:pointer;font:800 16px inherit;background:#c96f4a;color:#faf6ee;';
  const BTN2 = BTN.replace('#c96f4a', '#efe7d8').replace('color:#faf6ee', 'color:#4a5568');
  const INPUT = 'display:block;width:100%;margin-top:10px;padding:12px;border:2px solid #e0d8c8;border-radius:10px;font:600 15px inherit;background:#fff;color:#3f4a5a;box-sizing:border-box;';
  const stage = document.createElement('div');
  stage.style.cssText = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;';
  wrap.append(stage);
  function screen(html) { stage.innerHTML = html; return stage; }
  const esc = (s2) => String(s2).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // ---- screens ----
  function showLogin(err) {
    stopPreview();
    screen('<div style="' + CARD + 'width:340px;text-align:center;">' +
      '<h1 style="margin:0 0 4px;font-size:30px;letter-spacing:3px;color:#c96f4a;">' + STR.title + '</h1>' +
      '<div style="font-size:13px;color:#7a8699;font-weight:600;">' + STR.loginSub + '</div>' +
      '<input id="fEmail" type="email" placeholder="' + STR.email + '" style="' + INPUT + '">' +
      '<input id="fPw" type="password" placeholder="' + STR.password + '" style="' + INPUT + '">' +
      (err ? '<div style="margin-top:10px;font-size:13px;font-weight:700;color:#a9412e;">' + esc(err) + '</div>' : '') +
      '<button id="fLogin" style="' + BTN + '">' + STR.logIn + '</button>' +
      '<button id="fCreate" style="' + BTN2 + '">' + STR.createAccount + '</button></div>');
    const email = () => document.getElementById('fEmail').value;
    const pw = () => document.getElementById('fPw').value;
    document.getElementById('fLogin').onclick = async () => {
      const r = await ACC.login(email(), pw());
      if (!r.ok) return showLogin(r.error);
      afterAuth();
    };
    document.getElementById('fCreate').onclick = async () => {
      const r = await ACC.createAccount(email(), pw());
      if (!r.ok) return showLogin(r.error);
      showUsername();
    };
  }

  function showUsername(err) {
    screen('<div style="' + CARD + 'width:340px;text-align:center;">' +
      '<h1 style="margin:0;font-size:24px;letter-spacing:2px;color:#c96f4a;">' + STR.chooseUsername + '</h1>' +
      '<input id="fUser" maxlength="24" placeholder="' + STR.username + '" style="' + INPUT + '">' +
      (err ? '<div style="margin-top:10px;font-size:13px;font-weight:700;color:#a9412e;">' + esc(err) + '</div>' : '') +
      '<button id="fNext" style="' + BTN + '">' + STR.next + '</button></div>');
    document.getElementById('fNext').onclick = () => {
      const u = document.getElementById('fUser').value.trim();
      if (!u) return showUsername(STR.usernameEmpty);
      ACC.patchProfile({ username: u });
      showBody();
    };
  }

  function showBody() {
    const p = riderProfile();
    let gender = p.gender, skin = p.skin;
    function render() {
      const tones = SKIN_TONES.map((c, i) =>
        '<div data-skin="' + i + '" style="width:38px;height:38px;border-radius:50%;cursor:pointer;background:#' + c.toString(16).padStart(6, '0') + ';' +
        'border:4px solid ' + (i === skin ? '#c96f4a' : 'transparent') + ';box-sizing:border-box;"></div>').join('');
      screen('<div style="' + CARD + 'width:380px;text-align:center;">' +
        '<h1 style="margin:0 0 14px;font-size:24px;letter-spacing:2px;color:#c96f4a;">' + STR.yourSkier + '</h1>' +
        '<div style="display:flex;gap:10px;">' +
        '<button id="gM" style="' + (gender === 'm' ? BTN : BTN2) + 'margin-top:0;">' + STR.male + '</button>' +
        '<button id="gF" style="' + (gender === 'f' ? BTN : BTN2) + 'margin-top:0;">' + STR.female + '</button></div>' +
        '<div style="margin:18px 0 8px;font-size:13px;font-weight:700;color:#57616f;text-align:left;">' + STR.skinTone + '</div>' +
        '<div style="display:flex;gap:9px;justify-content:center;">' + tones + '</div>' +
        '<button id="fNext" style="' + BTN + '">' + STR.next + '</button></div>');
      document.getElementById('gM').onclick = () => { gender = 'm'; render(); };
      document.getElementById('gF').onclick = () => { gender = 'f'; render(); };
      stage.querySelectorAll('[data-skin]').forEach((el2) => { el2.onclick = () => { skin = +el2.dataset.skin; render(); }; });
      document.getElementById('fNext').onclick = () => { ACC.patchProfile({ gender, skin }); showWardrobe(false); };
    }
    render();
  }

  function showWardrobe(fromMenu) {
    const p = riderProfile();
    const w = { ...p.wardrobe };
    let slot = 'skis';
    let page = 'cosmetics'; // 'cosmetics' | 'riders' — riders live on their own page
    const SLOTS = ['skis', 'boots', 'pants', 'top', 'gloves', 'helmet', 'goggles', 'poles'];
    function render() {
      ACC.patchProfile({ wardrobe: w });
      startPreview();
      const lv = PROG.level();
      let panel;
      if (page === 'riders') {
        // DEDICATED RIDERS PAGE: name + what they're good at, preview on the left
        const cards = Object.keys(CHARS).map((id) => {
          const c = CHARS[id];
          const sel = curChar === id;
          const swatchC = (c.kit ? c.kit.jacket : 0xd97a4e).toString(16).padStart(6, '0');
          return '<button data-rider="' + id + '" style="display:flex;align-items:flex-start;gap:11px;width:100%;margin-top:9px;padding:11px 12px;border:none;border-radius:11px;cursor:pointer;font:800 14px inherit;text-align:left;' +
            (sel ? 'background:#c96f4a;color:#faf6ee;' : 'background:#efe7d8;color:#4a5568;') + '">' +
            '<span style="width:22px;height:22px;border-radius:50%;background:#' + swatchC + ';border:2px solid rgba(0,0,0,.15);flex:none;margin-top:1px;"></span>' +
            '<span>' + esc(c.label) +
            '<span style="display:block;font:600 11.5px inherit;opacity:.8;margin-top:3px;line-height:1.4;">' + esc(c.desc || '') + '</span></span></button>';
        }).join('');
        panel = '<h1 style="margin:0 0 12px;font-size:22px;letter-spacing:2px;color:#c96f4a;">' + STR.ridersTitle + '</h1>' +
          '<button id="fBackCos" style="padding:8px 13px;border:none;border-radius:9px;cursor:pointer;font:800 12px inherit;background:#efe7d8;color:#4a5568;">&#8592; ' + STR.customize + '</button>' +
          cards + '<button id="fConfirm" style="' + BTN + '">' + STR.confirm + '</button>';
      } else {
        // COSMETICS SECTION: slot tabs, plus a RIDERS entry up top that opens the page
        const tabs = SLOTS.map((s2) =>
          '<button data-slot="' + s2 + '" style="padding:7px 11px;border:none;border-radius:9px;cursor:pointer;font:800 12px inherit;' +
          (s2 === slot ? 'background:#c96f4a;color:#faf6ee;' : 'background:#efe7d8;color:#4a5568;') + '">' + STR.slots[s2] + '</button>').join('');
        const items = WARDROBE[slot].map((it) => {
          const locked = (it.unlockLvl || 0) > lv;
          const sel = w[slot] === it.id;
          const swatchC = it.color != null ? it.color : it.body != null ? it.body : it.lens != null ? it.lens : 0x232830;
          return '<button data-item="' + it.id + '" ' + (locked ? 'disabled' : '') + ' style="display:flex;align-items:center;gap:10px;width:100%;margin-top:8px;padding:10px 12px;border:none;border-radius:10px;cursor:pointer;font:700 13.5px inherit;text-align:left;' +
            (sel ? 'background:#c96f4a;color:#faf6ee;' : 'background:#efe7d8;color:#4a5568;') + (locked ? 'opacity:.45;cursor:default;' : '') + '">' +
            '<span style="width:20px;height:20px;border-radius:50%;background:#' + swatchC.toString(16).padStart(6, '0') + ';border:2px solid rgba(0,0,0,.15);flex:none;"></span>' +
            esc(it.label) + (locked ? ' — ' + STR.level + ' ' + it.unlockLvl : '') + '</button>';
        }).join('');
        panel = '<h1 style="margin:0 0 12px;font-size:22px;letter-spacing:2px;color:#c96f4a;">' + STR.customize + '</h1>' +
          '<button id="fRiders" style="display:block;width:100%;margin-bottom:11px;padding:11px;border:none;border-radius:10px;cursor:pointer;font:800 13px inherit;background:#4a5568;color:#faf6ee;letter-spacing:1.5px;text-align:center;">' + STR.ridersTitle + ' &#8594;</button>' +
          '<div style="display:flex;flex-wrap:wrap;gap:6px;">' + tabs + '</div>' +
          '<div>' + items + '</div>' +
          '<button id="fConfirm" style="' + BTN + '">' + STR.confirm + '</button>';
      }
      screen('<div style="display:flex;gap:22px;align-items:stretch;pointer-events:auto;">' +
        '<div style="' + CARD + 'width:300px;display:flex;align-items:center;justify-content:center;" id="pvHolder"></div>' +
        '<div style="' + CARD + 'width:330px;max-height:72vh;overflow-y:auto;">' + panel + '</div></div>');
      document.getElementById('pvHolder').append(pvCanvas);
      const rb = document.getElementById('fRiders'); if (rb) rb.onclick = () => { page = 'riders'; render(); };
      const bb = document.getElementById('fBackCos'); if (bb) bb.onclick = () => { page = 'cosmetics'; render(); };
      stage.querySelectorAll('[data-slot]').forEach((el2) => { el2.onclick = () => { slot = el2.dataset.slot; render(); }; });
      stage.querySelectorAll('[data-rider]').forEach((el2) => {
        el2.onclick = () => { curChar = el2.dataset.rider; saveSelections(); applyRiderPhys(); dressRider(pv.R); dressRider(R1); render(); };
      });
      stage.querySelectorAll('[data-item]').forEach((el2) => {
        el2.onclick = () => { w[slot] = el2.dataset.item; ACC.patchProfile({ wardrobe: w }); dressRider(pv.R); dressRider(R1); render(); };
      });
      document.getElementById('fConfirm').onclick = () => { ACC.patchProfile({ wardrobe: w }); dressRider(R1); showMenu(); };
    }
    render();
  }

  function showMenu() {
    const p = riderProfile();
    startPreview();
    screen('<div style="position:absolute;inset:0;pointer-events:auto;">' +
      '<div style="position:absolute;left:6%;bottom:10%;text-align:center;">' +
      '<div style="font:800 17px inherit;color:#faf6ee;text-shadow:0 2px 8px rgba(60,40,80,.6);letter-spacing:1px;margin-bottom:6px;">' + esc(p.username) + '</div>' +
      '<div id="pvHolder"></div>' +
      '<button id="fCustomize" style="' + BTN2 + 'width:200px;margin:10px auto 0;">' + STR.customize + '</button></div>' +
      '<div style="position:absolute;left:50%;top:50%;transform:translate(-50%,-56%);text-align:center;width:340px;">' +
      '<h1 style="margin:0 0 26px;font-size:52px;letter-spacing:6px;color:#faf6ee;text-shadow:0 4px 18px rgba(60,40,80,.55);">' + STR.title + '</h1>' +
      '<button id="fPlay" style="' + BTN + 'font-size:22px;padding:17px;letter-spacing:2px;">' + STR.play + '</button>' +
      '<button id="fSettings" style="' + BTN2 + '">' + STR.settings + '</button></div></div>');
    document.getElementById('pvHolder').append(pvCanvas);
    document.getElementById('fCustomize').onclick = () => showWardrobe(true);
    document.getElementById('fPlay').onclick = () => showMode();
    document.getElementById('fSettings').onclick = () => window.bpOpenPanel('set');
  }

  function showMode() {
    screen('<div style="' + CARD + 'width:360px;text-align:center;">' +
      '<h1 style="margin:0 0 16px;font-size:26px;letter-spacing:3px;color:#c96f4a;">' + STR.chooseMode + '</h1>' +
      '<button id="fFree" style="' + BTN + 'font-size:18px;">' + STR.freeSki + '</button>' +
      '<button id="fLeague" style="' + BTN2 + 'opacity:.55;cursor:default;">' + STR.league + '<br><span style="font-size:11.5px;font-weight:600;">' + STR.leagueSoon + '</span></button>' +
      '<button id="fBack" style="' + BTN2 + '">' + STR.back + '</button></div>');
    document.getElementById('fFree').onclick = () => showMapSelect();
    document.getElementById('fBack').onclick = () => showMenu();
  }

  function showMapSelect() {
    const p = riderProfile();
    const rows = Object.keys(SIM.MAPS).map((id) => {
      const best = p.best[id];
      return '<button data-map="' + id + '" style="' + BTN + 'text-align:center;">' + (STR.mapNames[id] || id) +
        '<br><span style="font-size:12px;font-weight:600;opacity:.85;">' + STR.highScore + ': ' + (best ? Math.round(best) : '—') + '</span></button>';
    }).join('');
    screen('<div style="' + CARD + 'width:360px;text-align:center;">' +
      '<h1 style="margin:0 0 14px;font-size:26px;letter-spacing:3px;color:#c96f4a;">' + STR.chooseMap + '</h1>' +
      rows + '<button id="fBack" style="' + BTN2 + '">' + STR.back + '</button></div>');
    stage.querySelectorAll('[data-map]').forEach((el2) => {
      el2.onclick = () => {
        const id = el2.dataset.map;
        if (id === currentMap) { enterPlay(); return; }
        try { localStorage.setItem('bp_map', id); localStorage.setItem('bp_resume', '1'); } catch (e) {}
        location.reload(); // world rebuilds into the chosen map, then drops straight to the start gate
      };
    });
    document.getElementById('fBack').onclick = () => showMode();
  }

  function enterPlay() {
    stopPreview();
    wrap.style.display = 'none';
    uiState = 'play';
    els.start.classList.remove('hidden');
    // the click that chose the map must not double as the drop-in tap
    setTimeout(() => { startEdge = false; popEdge = false; }, 0);
    startEdge = false; popEdge = false;
  }

  function afterAuth() {
    const p = ACC.getProfile();
    if (!p || !p.username) return showUsername();
    if (p.gender == null || p.skin == null) return showBody();
    if (!p.wardrobe) return showWardrobe(false);
    dressRider(R1);
    showMenu();
  }

  function boot() {
    // per-account progression: the profile's XP is the truth once logged in
    const p = ACC.getProfile();
    if (p && typeof p.xp === 'number') PROG.xp = Math.max(PROG.xp, p.xp);
    let resume = false;
    try { resume = localStorage.getItem('bp_resume') === '1'; localStorage.removeItem('bp_resume'); } catch (e) {}
    if (resume && p && p.username && p.wardrobe) { dressRider(R1); uiState = 'play'; els.start.classList.remove('hidden'); return; }
    wrap.style.display = 'block';
    if (!ACC.currentEmail()) showLogin();
    else afterAuth();
  }

  return { boot, enterPlay };
})();
FLOW.boot();

// ---------------- main loop ----------------
let frames = 0, fpsAt = performance.now();
// adaptive quality: if sustained fps sags, shed pixel density, then bump maps —
// smoothness beats sparkle
let perfMs = 0, perfN = 0, perfStage = 0;
function perfTick(ft) {
  perfMs += ft; perfN++;
  if (perfMs < 4000 || uiState !== 'play') { if (perfMs >= 4000) { perfMs = 0; perfN = 0; } return; }
  const fps = perfN * 1000 / perfMs;
  perfMs = 0; perfN = 0;
  if (fps >= 44 || perfStage >= 2) return;
  perfStage++;
  if (perfStage === 1) renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.0));
  else if (perfStage === 2 && window.__terrain) {
    window.__terrain.material.bumpMap = null;
    window.__terrain.material.needsUpdate = true;
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (paused) { last = now; return; }
  let ft = Math.min(now - last, 100);
  last = now;
  acc += ft;
  perfTick(ft);
  if (PROF) { PROF.frames++; PROF.ftSum += ft; PROF.ftMax = Math.max(PROF.ftMax, ft); }
  pT('input', readInput);
  if (devAt > 0 && !devAtDone && sim.mode === 'ground') {
    sim.pos.s = Math.min(devAt, SIM.TRACK_LEN - 30);
    sim.pos.l = SIM.centerline(sim.pos.s);
    sim.pos.y = SIM.terrainH(sim.pos.s, sim.pos.l);
    sim.vel.s = 6; devAtDone = true;
    // snap the film rig with the teleport so dev spawns frame correctly
    camera.position.set(sim.pos.l, sim.pos.y + 2.6, -(sim.pos.s - 7));
    _lookCur.set(sim.pos.l, sim.pos.y + 0.9, -sim.pos.s - 9);
  }
  pT('physicsSim', () => {
    while (acc >= STEP) {
      SIM.simStep(sim, STEP / 1000, input, STR);
      input.popEdge = false; input.restart = false; input.start = false; // edges fire once
      acc -= STEP;
    }
  });
  sim.grabNames = SLOT_BINDS.map((g2) => GRAB_DEFS[g2].label);
  pT('eventsAudio', () => { drainEvents(); watchRestart(); SND.update(sim); });
  pT('animPoseIK', () => updateVisuals(ft / 1000));
  if (grabIKReq && sim.mode === 'air') pT('grabIK', () => applyGrabIK(R1, grabIKReq));
  { // carve spray emission [batch item 11]
    const dt2 = ft / 1000;
    const e = Math.abs(carveEdgeG);
    if (sim.mode === 'ground' && e > 0.22 && carveSpdG > 5) {
      const side = Math.sign(carveEdgeG);
      const n = Math.min(6, 1 + Math.floor(e * carveSpdG * 0.2));
      for (let i = 0; i < n; i++) {
        spraySpawn(
          sim.pos.l - side * (0.3 + Math.random() * 0.25), sim.pos.y + 0.05, -sim.pos.s + (Math.random() - 0.5) * 0.7,
          -side * (1.2 + Math.random() * 2.0 + carveSpdG * 0.07),
          1.3 + Math.random() * 2.2 + e * carveSpdG * 0.1,
          -(sim.vel.s * 0.25) + (Math.random() - 0.5) * 1.2);
      }
    }
    pT('spray', () => sprayTick(dt2));
  }
  pT('renderSubmit', () => renderer.render(scene, camera));
  if (dev) {
    frames++;
    if (now - fpsAt >= 500) {
      const fps = Math.round((frames * 1000) / (now - fpsAt));
      els.dev.textContent = `${fps} fps · ${renderer.info.render.calls} calls · ${(renderer.info.render.triangles / 1000).toFixed(0)}k tris`;
      frames = 0; fpsAt = now;
    }
  }
}
requestAnimationFrame(frame);
