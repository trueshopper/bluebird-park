// sim.js — pure simulation core (no THREE, no DOM). Track coords: s downhill, l lateral, y up.
// World mapping (renderer): x = l, z = -s.

export const G = 9.81;
// map-selected values — assigned by setMap() below
export let TRACK_LEN = 1320;
export let PARK_HALF = 40;
export let MAP_ID = 'bluebird';

// ---------- mountain shape (reads the ACTIVE map) ----------
export function centerline(s) { return ACTIVE.wind(s); }
// valley cross-section: natural banked walls following the curve
function valleyAdd(s, l) {
  const dl = l - centerline(s);
  return Math.min(ACTIVE.valleyK(s) * dl * dl, 18);
}
// rolling wind-buffed snow between the features
function rollerAdd(s) {
  let env = 0;
  for (const [a, b, amp] of ACTIVE.rollers) {
    if (s > a && s < b) { env = smooth01((s - a) / 12) * smooth01((b - s) / 12) * amp; break; }
  }
  if (env <= 0) return 0;
  return env * (0.42 * Math.sin(s * 0.5) + 0.25 * Math.sin(s * 0.23 + 1));
}

// ---------- deterministic RNG ----------
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- base slope profile (per map) ----------
let GRADE_PTS = [[0, 0.2]];
const BASE_STEP = 2;
let baseTable = [0, -0.4];
function rebuildBase() {
  const t = [0];
  let y = 0;
  for (let s = BASE_STEP; s <= TRACK_LEN; s += BASE_STEP) {
    const g = gradeAt(s - BASE_STEP / 2);
    y -= g * BASE_STEP;
    t.push(y);
  }
  baseTable = t;
}
function gradeAt(s) {
  if (s <= GRADE_PTS[0][0]) return GRADE_PTS[0][1];
  for (let i = 1; i < GRADE_PTS.length; i++) {
    if (s <= GRADE_PTS[i][0]) {
      const [s0, g0] = GRADE_PTS[i - 1], [s1, g1] = GRADE_PTS[i];
      const t = (s - s0) / (s1 - s0);
      return g0 + (g1 - g0) * t;
    }
  }
  return GRADE_PTS[GRADE_PTS.length - 1][1];
}
function baseY(s) {
  const c = Math.min(Math.max(s / BASE_STEP, 0), baseTable.length - 1.001);
  const i = Math.floor(c), f = c - i;
  return baseTable[i] * (1 - f) + baseTable[i + 1] * f;
}

// ---------- park features ----------
// REAL JUMP ANATOMY, life-size: the takeoff RAMP rises straight off the untouched
// slope (nothing before it — clean in-run), with open snow either side to roll
// past. Behind the lip the TABLE is a LEVEL shelf that sticks out of the hill as
// the slope falls away beneath it, ending in a rounded KNUCKLE that rolls into a
// steep landing matched to takeoff speed. s0 = lip.
export let KICKERS = [];
// rails: h = top height above snow at the anchor points. Types:
// box/rail/deck follow the snow line; rainbow arches; kink is flat-steep-flat;
// cannon stays straight while the ground falls away, then launches you.
// rails SPREAD down the mountain, each tied to a natural feature:
// glade spine rail, box below cliff 1, rainbow arcing a gully, kink dropping the
// rock step, SKYLINE spanning cliff 2, wave + deck between jumps, cannon by the XL
export let RAILS = [];
const RAIL_PTS_M = { box: 12, rail: 14, deck: 16, rainbow: 18, kink: 17, cannon: 15, wave: 18, launch: 22, ridge: 24, up: 20 , tube: 12 , down: 16 };
// the crystal cave corridor (visual shell + decor exclusion zone) — per map, may be null
export let CAVE = null;

function lerp(a, b, t) { return a + (b - a) * t; }
export function railTopY(r, s) {
  const t = Math.min(Math.max((s - r.s0) / (r.s1 - r.s0), 0), 1);
  if (r.type === 'rainbow') {
    const gy0 = terrainH(r.s0, r.l) + r.h, gy1 = terrainH(r.s1, r.l) + r.h;
    return lerp(gy0, gy1, t) + Math.sin(Math.PI * t) * r.arch;
  }
  if (r.type === 'kink') {
    const gy0 = terrainH(r.s0, r.l) + r.h, gy1 = terrainH(r.s1, r.l) + r.h;
    const kt = t < 0.3 ? t * 0.267 : t > 0.7 ? 0.92 + (t - 0.7) * 0.267 : 0.08 + (t - 0.3) * 2.1;
    return lerp(gy0, gy1, Math.min(kt, 1));
  }
  if (r.type === 'cannon' || r.type === 'launch') {
    return terrainH(r.s0, r.l) + r.h - (s - r.s0) * 0.02; // near-level barrel, snow falls away below
  }
  if (r.type === 'up') {
    return terrainH(r.s0, r.l) + r.h + (s - r.s0) * 0.16; // CLIMBS against the falling slope
  }
  if (r.type === 'down') {
    // a true DOWN RAIL: mounted high at the entry (gap on), diving steeper
    // than the slope to finish just above the snow
    const gy0 = terrainH(r.s0, r.l) + r.h + 1.2;
    const gy1 = terrainH(r.s1, r.l) + 0.35;
    return lerp(gy0, gy1, t);
  }
  if (r.type === 'elevated') {
    // straight chord between its ends — sails high over whatever drops beneath
    const gy0 = terrainH(r.s0, r.l) + r.h, gy1 = terrainH(r.s1, r.l) + r.h;
    return lerp(gy0, gy1, t);
  }
  if (r.type === 'wave') {
    const gy0 = terrainH(r.s0, r.l) + r.h, gy1 = terrainH(r.s1, r.l) + r.h;
    return lerp(gy0, gy1, t) + Math.sin(t * Math.PI * 4) * 0.45; // two humps, anchored ends
  }
  return terrainH(s, r.l) + r.h;
}
// THE LODGE: a solid building on the lodge-gap table. Ground or air contact
// below the ridge line inside the footprint is a wreck — the only ways through
// are over the roof or along the ridge rail.
export let LODGE = null;
export let JIB_LIPS = [];
export let FINISH_S = 1078;
export let ZONE_DEFS = [];

// ---------- MAPS ----------
// bluebird: the original 1.3km night mountain (glades, crystal cave, cliff
//   cannon, jump line, lodge gap).
// lax: recreation of LAX P.A.R.K. at Kläppen, Sweden — the Kimbo Sessions hill.
//   Mellow, wide Swedish slope; transition-focused build: a roller garden, a
//   staggered fin/hip zone hittable from multiple directions (the Kimbo
//   signature), Kläppen's twin red/black kicker lines side by side, a dense
//   rail garden, and a final hip to the finish.
export const MAPS = {
  bluebird: {
    sky: 'night',
    trackLen: 1320, parkHalf: 40, finishS: 1180, // stretched: knuckle garden AND the lodge gap both live [user]
    wind: (s) => {
      let c = 9 * Math.sin(s * 0.008) + 5 * Math.sin(s * 0.0037 + 2);
      c *= smooth01(s / 50);
      if (s > 905) c *= smooth01((950 - s) / 45);
      return c;
    },
    valleyK: (s) => (s > 905 ? 0.002 + 0.008 * smooth01((950 - s) / 45) : 0.010),
    rollers: [[66, 172, 1], [466, 522, 1]],
    gradePts: [
      [0, 0.45], [30, 0.36], [60, 0.25], [125, 0.22], [178, 0.22], // steeper in-run to the opening jumps [user]
      [186.5, 0.24], [187.2, 1.35], [194, 1.35], [194.7, 0.42], [225, 0.22],
      [300, 0.18], [392, 0.2], [395, 0.55], [400, 0.55], [404, 0.2],
      [428, 0.26], [436.3, 0.3], [437, 1.5], [446, 1.5], [446.7, 0.48],
      [472, 0.3], [520, 0.27], [900, 0.23], // steeper in-runs feed the taller line
      [918, 0.21], [950, 0.22], [1068, 0.22], [1074, 0.32], [1088, 0.32], [1096, 0.24], [1140, 0.18], [1168, 0.06], // garden, then a headwall face fires the lodge gap [user]
      [1225, -0.08], [1320, -0.16],
    ],
    kickers: [
      { s0: 95,  La: 11, A: 2.8, T: 10, Ld: 12, off: 0,  name: 'S' },
      { s0: 142, La: 15, A: 4.0, T: 13, Ld: 15, off: 0,  name: 'MED' },   // medium with a knuckle run-up rail beside it
      // the STREAM JUMP LINE: each table launches the line across the creek,
      // landing on the far bank [user]
      { s0: 560, La: 16, A: 4.2, T: 15, Ld: 17, off: -5, gap: true, name: 'M' },
      { s0: 700, La: 19, A: 5.0, T: 15, Ld: 20, off: 6,  gap: true, name: 'L' },
      { s0: 840, La: 22, A: 5.6, T: 15, Ld: 22, off: -4, gap: true, name: 'XL' },
      // KNUCKLE GARDEN finale [user]: jumps with rails living ON the knuckle run-ups
      { s0: 905, La: 14, A: 4.0, T: 8, Ld: 15, off: -8, name: 'KG1' },
      { s0: 960, La: 15, A: 4.4, T: 8, Ld: 16, off: 6,  name: 'KG2' },
      { s0: 1014, La: 16, A: 4.8, T: 9, Ld: 17, off: -4, name: 'KG3' },
      // STEP-UP [user: unique to bluebird]: pop the lip, land ON TOP of the block
      { s0: 878, La: 12, A: 3.4, T: 6, Ld: 10, off: 10, name: 'STEPUP' },
      // small jumps INSIDE the crystal cave [user]
      { s0: 1090, La: 16, A: 5.2, T: 18, Ld: 16, off: 0, name: 'LODGE' }, // the roof gap rides again — steeper lip, honest-speed clear [user]
      { s0: 285, La: 9, A: 2.4, T: 8, Ld: 9, off: -4, name: 'CAVE1' },
      { s0: 355, La: 10, A: 2.6, T: 8, Ld: 10, off: 6, name: 'CAVE2' },
    ],
    rails: [
      { s0: 131, s1: 141, off: -6,  h: 0.65, w: 0.35, type: 'rail', lip: true },  // MED knuckle run-up bar [user]
      { s0: 250, s1: 264, off: 8,   h: 0.45, w: 0.55, type: 'box' },
      { s0: 320, s1: 334, off: -6,  h: 0.50, w: 0.35, type: 'rainbow', arch: 1.0 }, // cave rainbow [user: keep]
      { s0: 388, s1: 402, off: 5,   h: 0.55, w: 0.35, type: 'kink' },
      { s0: 414, s1: 436, off: 0,   h: 0.80, w: 0.50, type: 'wave' },  // cave-exit cannon -> WAVY rail off the falls cliff [user]
      { s0: 630, s1: 655, off: 10,  h: 0.70, w: 0.35, type: 'wave' },
      { s0: 770, s1: 800, off: -11, h: 1.05, w: 0.35, type: 'deck' },
      { s0: 893, s1: 903, off: -14, h: 0.65, w: 0.35, type: 'rail', lip: true },  // KG1 knuckle run-up bar
      { s0: 948, s1: 958, off: 12,  h: 0.60, w: 0.55, type: 'box', lip: true },   // KG2 knuckle run-up box
      { s0: 1002, s1: 1012, off: -10, h: 0.65, w: 0.35, type: 'rail', lip: true },  // KG3 knuckle run-up bar
      { s0: 1050, s1: 1066, off: 14, h: 0.6, w: 0.4, type: 'kink' },               // stair-set out, off the garden lane [unique]
      { s0: 1096, s1: 1104, off: 0, h: 4.6, w: 0.8, type: 'ridge' },              // lodge roof ridge [user]
    ],
    // taller cave [user] + small in-cave jumps live in kickers below
    cave: { s0: 240, s1: 436, r: 18 },
    lodge: { s0: 1096, s1: 1104, halfW: 6, wallH: 2.9, ridgeH: 4.6 }, // the lodge is BACK [user]
    rockBands: [[182, 26], [432, 30]],
    fins: [
      // STEP-UP landing block [unique]: flat-top platform you pop ONTO
      { s0: 892, l: 10, len: 12, h: 3.2, w: 4.5, flat: 4 },
      // WALL RIDE [unique]: long carved bank beside the garden line
      { s0: 958, l: -20, len: 22, h: 3.6, w: 2.6 },
    ],
    zones: [[48, 'zoneGlades'], [172, 'zoneCliff'], [225, 'zoneRails'], [424, 'zoneCliff'], [516, 'zoneJumps'], [955, 'zoneLodge']],
  },
  lax: {
    sky: 'day',
    trackLen: 840, parkHalf: 46, finishS: 508, // gate right after the jump line [user]
    // one wide, gentle Swedish slope — barely winds
    wind: (s) => 5 * Math.sin(s * 0.006) * smooth01(s / 50) * smooth01((700 - s) / 60),
    valleyK: () => 0.006,
    rollers: [[54, 118, 1.7]],
    gradePts: [
      // SHORT runup: a STEEP speed hill right out of the gate feeds the park,
      // then a steep IN-RUN FACE ahead of every jump pair so casual riders —
      // not just full-tuck racers — carry enough to clear the black tables
      [0, 0.42], [14, 0.52], [46, 0.52], [58, 0.21], [140, 0.2],
      [236, 0.2], [246, 0.34], [268, 0.34], [278, 0.22],   // face into line 1
      [326, 0.2], [334, 0.34], [348, 0.34], [358, 0.22],   // face into line 2
      [406, 0.2], [414, 0.34], [428, 0.34], [440, 0.22],   // face into line 3
      [520, 0.18], [550, 0.04], [600, -0.06], [840, -0.12], // flatten into the corral right past the gate
    ],
    kickers: [
      // FIN & HIP ZONE: staggered offset kickers — lines cross, hits come at angles
      { s0: 140, La: 11, A: 3.2, T: 4, Ld: 12, off: -14, name: 'FIN-L' },
      { s0: 168, La: 11, A: 3.2, T: 4, Ld: 12, off: 13,  name: 'FIN-R' },
      { s0: 200, La: 13, A: 4.0, T: 12, Ld: 14, off: 0,   name: 'HIP' },
      // TWIN LINES, side by side (Kläppen red/black): red = medium, black = large
      // REAL PROPORTIONS [user]: red lips ~2x skier, black lips ~3x; long
      // tables put the knuckle ~4 skiers above the landing base
      { s0: 272, La: 14, A: 3.8, T: 14, Ld: 18, off: -13, name: 'RED1' },
      { s0: 282, La: 18, A: 5.2, T: 17, Ld: 22, off: 13,  name: 'BLK1' },
      { s0: 352, La: 14, A: 3.8, T: 14, Ld: 18, off: -13, name: 'RED2' },
      { s0: 362, La: 18, A: 5.2, T: 17, Ld: 22, off: 13,  name: 'BLK2' },
      { s0: 432, La: 14, A: 4.0, T: 14, Ld: 18, off: -13, name: 'RED3' },
      { s0: 442, La: 18, A: 5.4, T: 17, Ld: 22, off: 13,  name: 'BLK3' },
    ],
    rails: [
      // KNUCKLE RAILS [user]: rails live ON the jumps, not in a separate garden.
      // Each sits 6m to the side of a table, run-up = the jump's own takeoff
      // shoulder, grind crosses the knuckle, hop off the end -> the jump's
      // landing catches you. One landing serves both hits.
      // rails sit ON THE RUN-UP beside each table [user]: grind the approach,
      // hop off just before the lip, fly onto the jump's landing
      { s0: 272, s1: 283, off: -19.2, h: 0.65, w: 0.35, type: 'rail', lip: true },  // RED1 run-up bar (lip at 284)
      { s0: 281, s1: 297, off: 19.2, h: 0.60, w: 0.55, type: 'box', lip: true },   // BLK1 run-up box (lip at 298)
      { s0: 352, s1: 363, off: -19.2, h: 0.55, w: 0.55, type: 'box', lip: true },   // RED2 run-up box (lip at 364)
      { s0: 360, s1: 377, off: 19.2, h: 0.70, w: 0.35, type: 'rail', lip: true },  // BLK2 run-up bar (lip at 378)
      { s0: 433, s1: 444, off: -19.2, h: 0.65, w: 0.35, type: 'rail', lip: true },  // RED3 run-up bar (lip at 445)
      { s0: 440, s1: 458, off: 19.2, h: 0.60, w: 0.55, type: 'box', lip: true }    // BLK3 run-up box (lip at 459)
    ],
    cave: null,
    lodge: null,
    rockBands: [],
    // sculpted snow fins woven between the hip kickers — slash or bonk them
    fins: [
      { s0: 152, l: 2,   len: 9,  h: 1.7, w: 1.3 },
      { s0: 178, l: -6,  len: 10, h: 1.9, w: 1.4 },
      { s0: 216, l: 9,   len: 9,  h: 1.6, w: 1.3 },
      { s0: 232, l: -12, len: 11, h: 2.0, w: 1.5 },
    ],
    zones: [[48, 'zoneRollers'], [128, 'zoneFins'], [258, 'zoneTwin']],
  },
  kimbo: {
    sky: 'sunset',
    // K SESSIONS — digital twin of the Kimbo Sessions park at Kläppen.
    // EVIDENCE: user drone aerial + block-garden photo + transfer-alley photo +
    // Alex Hall's edit (youtube z8pGsJEFed8). See design/kimbo-recon.md.
    // LAYOUT v5 — CORRIDOR RULE: every jump's landing + 15m runout is a clear
    // lane (center ±14m). Side features live OUTSIDE corridors; the next
    // feature's ramp begins only after the runout. Chains flow, never collide.
    trackLen: 640, parkHalf: 62, finishS: 596, startL: 10,
    wind: (s) => 2.5 * Math.sin(s * 0.011) * smooth01(s / 40) * smooth01((570 - s) / 50),
    valleyK: () => 0.004,
    rollers: [
      [8, 34, 1.3],    // steep pumping in-run
      [54, 80, 1.4],   // waves into the jump pair
      [246, 260, 1.1], // block-garden approach ripple
      [352, 380, 1.2], // gully run-out rolls into transfer alley
    ],
    gradePts: [
      [0, 0.16], [8, 0.31], [34, 0.31], [40, 0.22], [52, 0.28], [66, 0.26], [86, 0.27], [102, 0.25],
      [122, 0.18], [140, 0.21], [160, 0.18], [188, 0.21], [212, 0.19],
      [232, 0.18], [264, 0.17], [304, 0.18], [344, 0.19], [376, 0.17],
      [396, 0.2], [430, 0.19], [456, 0.2], [482, 0.18], [500, 0.19],
      [535, 0.24], [562, 0.16], [584, 0.06], [596, -0.02], [640, -0.1],
    ],
    kickers: [
      // THE BIG JUMP PAIR [drone] — lanes l=10 and l=32
      { s0: 88, La: 16, A: 4.6, T: 8, Ld: 20, off: 10, name: 'BIG-L' },   // lands 102-122, runout to 137
      { s0: 96, La: 15, A: 4.4, T: 13, Ld: 18, off: 32, name: 'BIG-R' },   // lands 109-127, runout to 142
      // BIG-3 chains the RIGHT line: ramp begins after BIG-R's runout
      { s0: 150, La: 13, A: 4.4, T: 8, Ld: 16, off: 30, name: 'BIG-3' },   // lands 158-174, runout to 189
      // BIG-4 chains the LEFT-CENTER line off the cannon's landing zone
      { s0: 204, La: 12, A: 4.0, T: 7, Ld: 15, off: 2, name: 'BIG-4' },    // lands 211-226, runout to 241
      // TRANSFER ALLEY [photo 3]: lips whose decks carry rails
      { s0: 396, La: 13, A: 3.6, T: 13, Ld: 18, off: -6, name: 'TSF-L' },  // lands 412-430, runout to 445
      { s0: 444, La: 14, A: 4.2, T: 13, Ld: 20, off: 22, name: 'TSF-R' },  // lands 460-480, runout to 495
      // the finale STEP-DOWN into the corral
      { s0: 548, La: 13, A: 4.6, T: 12, Ld: 24, off: 2, name: 'STEP-DN' }, // lands 560-584
    ],
    rails: [
      // flat tube at the top staging zone [video t=52-232; drone]
      { s0: 40, s1: 50, off: -4, h: 1.05, w: 0.5, type: 'tube' },
      // down tube on BIG-L's landing EDGE — corridor boundary, not mid-lane [drone]
      { s0: 108, s1: 120, off: 25, h: 0.85, w: 0.35, type: 'rail' },
      // FLAT RAIL on the roller's run-up [user]: ends at the crest — riding off
      // the end shoots you over the roll into its backside landing
      { s0: 143, s1: 153, off: 10, h: 0.7, w: 0.4, type: 'rail' },
      // the S-BENT GULLY TUBE rides the channel between spine arm and flank wall
      { s0: 168, s1: 190, off: -12, h: 0.8, w: 0.35, type: 'wave' },
      // bonk pole on its mound, LEFT of the BIG-4 corridor [video t=56.5]
      { s0: 216, s1: 219, off: -18, h: 1.15, w: 0.3, type: 'rail' },
      // THE BLOCK GARDEN [photo 2]
      { s0: 248, s1: 253, off: 14, h: 0.55, w: 0.4, type: 'rail' },   // flat bar on the knuckle
      { s0: 258, s1: 270, off: -10, h: 0.8, w: 0.35, type: 'rail' },  // silver down tube
      { s0: 268, s1: 280, off: 26, h: 1.0, w: 0.5, type: 'tube' },    // navy fat tube
      { s0: 276, s1: 288, off: 16, h: 0.7, w: 0.35, type: 'rail' },   // green rail
      // TRANSFER KNUCKLE RAILS [user]: beside the lips on each deck's shoulder —
      // on the knuckle, never blocking the jump lane
      { s0: 406, s1: 418, off: -16, h: 0.9, w: 0.35, type: 'rail' },
      { s0: 454, s1: 466, off: 33, h: 1.0, w: 0.5, type: 'tube' },
      // KNUCKLE SHOULDER RAILS: on the up-slope beside the lanes, arc-matched launch
      { s0: 98, s1: 112, off: -12, h: 0.8, w: 0.4, type: 'rainbow', arch: 3.65 }, // BIG rounded rainbow over the knuckle [user: +8ft tall, +10ft long]
      { s0: 108, s1: 112.5, off: 48, h: 0.8, w: 0.4, type: 'up' }, // half-length climb [user]
      // the DOWN RAIL you gap onto from the cannon's launch [user]
      { s0: 118, s1: 130, off: 48, h: 0.9, w: 0.35, type: 'down' },
    ],
    cave: null,
    lodge: null,
    rockBands: [],
    fins: [
      // the flat tube's mound
      { s0: 37, l: -4, len: 15, h: 0.9, w: 2.6, soft: 1 },
      // SPINE HEAD = FLAT LANDING PLATFORM [user]: the left cannon's arc sets
      // you down dead-flat on this deck; the tall spine begins below it
      { s0: 115, l: -11, len: 18, h: 1.9, w: 4.5, flat: 4.5, ramp: 0.3, rampOut: 0.4 },
      { s0: 138, l: -17, len: 18, h: 5.2, w: 4.5, flat: 1.4, ramp: 0.2, rampOut: 0.14 }, // cut square at the gap
      { s0: 163, l: -24, len: 30, h: 4.8, w: 4.5, flat: 1.4, ramp: 0.12 },
      // the roller under the middle flat rail [user]
      { s0: 146, l: 10, len: 16, h: 1.6, w: 4.0, soft: 1 },
      // flank wall frames the gully's right side (gully centered ~l -12)
      { s0: 166, l: 0, len: 25, h: 4.0, w: 4.0, flat: 1.2 },
      // THE WEDGE WALLS [drone] — right edge, AFTER BIG-3's runout
      { s0: 196, l: 33, len: 22, h: 6.0, w: 5.0, flat: 4.5, ramp: 0.12, rampOut: 0.45 },
      { s0: 230, l: 33, len: 24, h: 6.4, w: 5.0, flat: 4.5, ramp: 0.12, rampOut: 0.45 },
      // long low ridge by the left T-bar [drone]
      { s0: 66, l: -30, len: 28, h: 1.6, w: 2.5, flat: 0.8 },
      // bonk-pole mound (left of the BIG-4 corridor)
      { s0: 212, l: -18, len: 9, h: 1.1, w: 2.2, soft: 1 },
      // ---- THE BLOCK GARDEN [photo 2] ----
      { s0: 234, l: -34, len: 40, h: 2.4, w: 3.2, flat: 0.6 },  // snaking berm, left edge
      { s0: 240, l: -8, len: 10, h: 1.4, w: 3.0, soft: 1 },     // soft entry knuckles
      { s0: 242, l: 14, len: 10, h: 1.5, w: 3.0, soft: 1 },
      { s0: 246, l: 4, len: 8, h: 3.0, w: 2.2, flat: 0.3 },     // the little cone
      { s0: 262, l: -18, len: 26, h: 3.2, w: 6.0, flat: 8, ramp: 0.15 },  // left block
      { s0: 266, l: 6, len: 28, h: 3.4, w: 5.0, flat: 2.4, ramp: 0.18 }, // wide flat spine
      { s0: 270, l: 30, len: 26, h: 3.4, w: 5.5, flat: 7, ramp: 0.15 },  // right block
      { s0: 300, l: -30, len: 30, h: 2.2, w: 3.0, flat: 0.8 },  // cube berm
      { s0: 306, l: -12, len: 36, h: 3.6, w: 7.0, flat: 10, ramp: 0.12 }, // wedge tables + gully
      { s0: 314, l: 22, len: 40, h: 3.8, w: 7.0, flat: 10, ramp: 0.12 },
      // ---- TRANSFER ALLEY [photo 3] ----
      // linking roller moved to the RIGHT SHOULDER, outside both lanes
      { s0: 424, l: 42, len: 18, h: 3.0, w: 5.0, flat: 2.0, ramp: 0.2 },
      // wedge gates AFTER the TSF runouts, framing the step-down's approach gully
      { s0: 500, l: -20, len: 26, h: 4.6, w: 6.0, flat: 7, ramp: 0.12 },
      { s0: 508, l: 24, len: 26, h: 4.6, w: 6.0, flat: 7, ramp: 0.12 },
      // berm wall wrapping the alley's left edge
      { s0: 500, l: -38, len: 44, h: 2.6, w: 3.4, flat: 0.7 },
    ],
    zones: [[26, 'zoneTopTube'], [70, 'zoneBigJumps'], [110, 'zoneSpine'], [154, 'zoneChannel'], [192, 'zoneWedges'], [232, 'zoneBlocks'], [300, 'zoneGully'], [386, 'zoneTransfer'], [532, 'zoneStepDown']],
  },
};

export function setMap(id) {
  const M2 = MAPS[id] || MAPS.bluebird;
  MAP_ID = MAPS[id] ? id : 'bluebird';
  ACTIVE = M2;
  TRACK_LEN = M2.trackLen; PARK_HALF = M2.parkHalf; FINISH_S = M2.finishS;
  GRADE_PTS = M2.gradePts;
  rebuildBase();
  KICKERS = M2.kickers.map((k) => ({ ...k, lc: centerline(k.s0) + k.off }));
  RAILS = M2.rails.map((r) => ({ ...r, l: centerline(r.s0) + r.off }));
  // snow entry lips in front of each jib; the roof ridge gets NO lip
  JIB_LIPS = RAILS.filter((r) => r.type !== 'ridge' && (r.lip ||
    !KICKERS.some((k) => Math.abs(k.lc - r.l) < 8 && r.s0 >= k.s0 - 2 && r.s0 <= k.s0 + k.T + 8))
  ).map((r) => ({ s0: r.s0 - 6.0, s1: r.s0 - 0.8, l: r.l, h: (r.type === 'up' || r.type === 'rainbow') ? r.h * 0.8 + 0.16 : r.lip ? r.h * 0.9 + 0.3 : r.h * 0.55 + 0.12 })); // low long lips; forced lips (jump-side rails on rising decks) stand taller
  CAVE = M2.cave ? { ...M2.cave } : null;
  LODGE = M2.lodge ? { ...M2.lodge, l: centerline(M2.lodge.s0) } : null;
  ZONE_DEFS = M2.zones;
  OBST = null; // obstacle grid rebuilds lazily for the new forest
}
let ACTIVE = MAPS.bluebird;
let OBST = null;
setMap('bluebird');

function smooth01(t) { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); }

function kickerAdd(s, l) {
  let add = 0;
  for (const k of KICKERS) {
    const a0 = k.s0 - k.La; // ramp base — NOTHING before this; the in-run is bare slope
    if (s < a0 || s > k.s0 + k.T + k.Ld) continue;
    const u = Math.abs(l - k.lc);
    // CARVED side walls: the deck and ramp end in straight cut planes, not
    // rounded shoulders — crisp edges like a real cat-built jump
    const dW = MAP_ID === 'kimbo' ? 12 : 10.2, dE = MAP_ID === 'kimbo' ? 16 : 12.4; // Kimbo wide; others get a tight 2.2m cut band [user: sharp edges]
    const qD = u <= dW ? 1 : u >= dE ? 0 : (dE - u) / (dE - dW);
    const qR = u <= 4.6 ? 1 : u >= 5.8 ? 0 : (5.8 - u) / 1.2; // crisper ramp side walls
    const envD = qD * qD; // defined deck edge, smooth blend into the snow
    const envR = qR * qR;
    let h = 0;
    if (envR > 0 && s <= k.s0) {
      const t = (s - a0) / k.La;
      // SCULPTED TAKEOFF (all maps): curved transition for the bottom 45%,
      // then a dead-straight cut face to the lip (slope-continuous join)
      const t0 = 0.45, a = 1 / (2 * t0 - t0 * t0);
      const f = t <= t0 ? a * t * t : a * t0 * t0 + 2 * a * t0 * (t - t0);
      h += k.A * f * envR;
    }
    if (envD > 0 && s > k.s0) {
      // LEVEL table at the RAMP-BASE elevation under the lip — the lip stands a
      // full A above it, and the shelf grows out of the hill as the slope falls
      const tableAdd = baseY(k.s0) - baseY(s);
      if (s <= k.s0 + k.T) h += (k.gap ? 0 : tableAdd) * envD; // gap jumps: void between lip and landing [user]
      else {
        const knuckleAdd = baseY(k.s0) - baseY(k.s0 + k.T);
        h += knuckleAdd * (1 - smooth01((s - k.s0 - k.T) / k.Ld)) * envD; // knuckle -> steep landing
      }
    }
    add += h;
  }
  return add;
}

// ---------- solid obstacles: trees, rocks, the lodge ----------
// below CRASH_SPD you BOUNCE off; above it you crash
export const CRASH_SPD = 25 / 3.6; // 25 km/h
function obstacleGrid() {
  if (OBST) return OBST;
  const d = buildDecor(20260705); // deterministic — same forest the renderer draws
  const grid = new Map();
  const put = (o) => {
    const k = Math.floor(o.s / 6);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(o);
  };
  // solid within the run, but the CENTRAL LANE stays fair — you can't be
  // killed by a boulder hiding in a blind landing on the main line
  const inPlay = (o) => { const d2 = Math.abs(o.l - centerline(o.s)); return d2 < PARK_HALF + 4 && d2 > (MAP_ID === 'kimbo' ? PARK_HALF + 1 : 9); };
  for (const t of d.trees) if (inPlay(t)) put({ s: t.s, l: t.l, r: 0.28 * t.sc + 0.14 });
  for (const r2 of d.rocks) if (inPlay(r2)) put({ s: r2.s, l: r2.l, r: 0.8 * r2.sc });
  OBST = grid;
  return grid;
}
export function hitObstacle(s, l) {
  const grid = obstacleGrid();
  const k = Math.floor(s / 6);
  for (let kk = k - 1; kk <= k + 1; kk++) {
    const cell = grid.get(kk);
    if (!cell) continue;
    for (const o of cell) {
      const ds = s - o.s, dl = l - o.l;
      const rr = o.r + 0.3;
      if (ds * ds + dl * dl < rr * rr) return o;
    }
  }
  return null;
}

// solid-lodge collision test against the ACTUAL triangular roof profile —
// clearing the sloped roof off-center is fine; only real contact is a wreck
export function hitsLodge(s, l, y) {
  if (!LODGE) return false;
  const dl = Math.abs(l - LODGE.l);
  if (s < LODGE.s0 || s > LODGE.s1 || dl > LODGE.halfW) return false;
  const roofY = LODGE.wallH + (1 - dl / LODGE.halfW) * (LODGE.ridgeH - LODGE.wallH);
  return y < terrainH(s, LODGE.l) + roofY - 0.35;
}

function bermAdd(l) {
  const u = Math.abs(l);
  if (u <= PARK_HALF - 1) return 0;
  const t = u - (PARK_HALF - 1);
  return Math.min(0.55 * t * t, 12); // capped shoulder walls, not 300m cliffs
}

// SNOW FINS — CARVED, not blown: real built features are cut to planes. Cross
// section = flat deck + straight sides (crisp arris where they meet); length
// profile = linear end ramps. f.flat = deck width, f.ramp/f.rampOut = end-ramp
// fractions (small ramp = near-vertical cut face). f.soft = natural drift
// (keeps the old rounded gaussian).
function finAdd(s, l) {
  let add = 0;
  for (const f of ACTIVE.fins || []) {
    if (s < f.s0 - 2 || s > f.s0 + f.len + 2) continue;
    const t = (s - f.s0) / f.len;
    if (f.soft) {
      const env = smooth01(Math.min(t, 1 - t) * 4 + 0.0001);
      const dl = (l - f.l) / f.w;
      add += f.h * env * Math.exp(-dl * dl);
      continue;
    }
    if (t < 0 || t > 1) continue;
    // SCULPTED, then CUT: the deck is a flat plane with a defined edge; the
    // walls fall away in a smooth curve that melts into the slope at the base.
    // (ease-out x^2: full slope at the deck edge, zero slope at the snow)
    const rIn = f.ramp != null ? f.ramp : 0.28;
    const rOut = f.rampOut != null ? f.rampOut : rIn;
    const eA = Math.min(1, t / rIn), eB = Math.min(1, (1 - t) / rOut);
    const env = Math.min(eA * eA, eB * eB);
    const u = Math.abs(l - f.l);
    const half = (f.flat || 0) / 2;
    const w2 = Math.max(0, 1 - Math.max(0, u - half) / f.w);
    add += f.h * env * w2 * w2;
  }
  return add;
}

function jibLipAdd(s, l) {
  let add = 0;
  for (const j of JIB_LIPS) {
    if (s < j.s0 || s > j.s1) continue;
    const du = Math.abs(l - j.l);
    if (du > 1.8) continue;
    const env = du <= 1.0 ? 1 : smooth01((1.8 - du) / 0.8);
    const u = (s - j.s0) / (j.s1 - j.s0);
    add += j.h * Math.pow(u, 1.8) * env; // ramps up then drops off — natural takeoff fires
  }
  return add;
}

export function terrainH(s, l) {
  s = Math.min(Math.max(s, 0), TRACK_LEN);
  return baseY(s) + valleyAdd(s, l) + rollerAdd(s) + kickerAdd(s, l) + jibLipAdd(s, l) + finAdd(s, l) + bermAdd(l);
}

const EPS = 0.22;
export function terrainNormal(s, l, out) {
  const dHds = (terrainH(s + EPS, l) - terrainH(s - EPS, l)) / (2 * EPS);
  const dHdl = (terrainH(s, l + EPS) - terrainH(s, l - EPS)) / (2 * EPS);
  let ns = -dHds, nl = -dHdl, ny = 1;
  const m = Math.sqrt(ns * ns + nl * nl + 1);
  out.s = ns / m; out.l = nl / m; out.y = ny / m;
  return out;
}

// ---------- decor (deterministic) ----------
function clearOfFeatures(s, l) {
  for (const r of RAILS) if (s > r.s0 - 8 && s < r.s1 + 8 && Math.abs(l - r.l) < 6) return false;
  for (const k of KICKERS) if (s > k.s0 - k.La - 8 && s < k.s0 + k.T + k.Ld + 6 && Math.abs(l - k.lc) < 14) return false;
  if (LODGE && s > LODGE.s0 - 35 && s < LODGE.s1 + 26 && Math.abs(l - LODGE.l) < 16) return false; // lodge gap + landing kept clear
  if (s > FINISH_S - 15) return false;
  return true;
}

// stream path through the forest section (bluebird only) [user]
export const STREAM = { s0: 452, s1: 872 };
// control points: (s, offset from centerline). The creek slips THROUGH each
// gap jump and swings clear of every table, rail and landing in between.
const STREAM_PTS = [[452, -14], [520, -18], [556, -5], [578, -5], [640, -19], [696, 6], [717, 6], [744, -6], [788, -19], [836, -4], [858, -4], [872, -9]];
export function streamL(s) {
  let a = STREAM_PTS[0], b = STREAM_PTS[STREAM_PTS.length - 1];
  for (let i = 0; i < STREAM_PTS.length - 1; i++) {
    if (s >= STREAM_PTS[i][0] && s <= STREAM_PTS[i + 1][0]) { a = STREAM_PTS[i]; b = STREAM_PTS[i + 1]; break; }
  }
  const t = b[0] === a[0] ? 0 : Math.min(1, Math.max(0, (s - a[0]) / (b[0] - a[0])));
  const sm = t * t * (3 - 2 * t);
  return centerline(s) + a[1] + (b[1] - a[1]) * sm;
}
export function buildDecor(seed) {
  const rnd = mulberry32(seed);
  const trees = [], rocks = [];
  for (let s = 4; s < TRACK_LEN; s += 4.5) {
    const c = centerline(s);
    for (const side of [-1, 1]) {
      // dense forest walls outside the run
      if (rnd() < 0.8) {
        const l = c + side * (Math.max(32, MAP_ID !== 'bluebird' ? PARK_HALF + 5 : 0) + rnd() * 26);
        trees.push({ s: s + rnd() * 4, l, sc: 0.75 + rnd() * 0.95, y: terrainH(s, l) });
      }
      // scattered GLADE trees inside the bowl — ski between them (none inside
      // the cave, and NONE at Kimbo: the aerial shows a fully clean park)
      if (MAP_ID === 'bluebird' && rnd() < 0.2 && (!CAVE || s < CAVE.s0 - 6 || s > CAVE.s1 + 8)) {
        const l = c + side * (13 + rnd() * 15);
        const ss = s + rnd() * 4;
        if (clearOfFeatures(ss, l)) trees.push({ s: ss, l, sc: 0.6 + rnd() * 0.7, y: terrainH(ss, l) });
      }
      if (rnd() < 0.12) {
        const l = c + side * (Math.max(24, MAP_ID !== 'bluebird' ? PARK_HALF + 5 : 0) + rnd() * 22);
        rocks.push({ s: s + rnd() * 4, l, sc: 0.5 + rnd() * 1.4, y: terrainH(s, l) });
      }
    }
  }
  // rock outcrops studding both cliff bands + boulders below them — but the
  // LANDING CORRIDORS below the cliffs stay perfectly clear [user]
  for (const band of ACTIVE.rockBands) {
    for (let i = 0; i < 24; i++) {
      const s = band[0] + rnd() * band[1];
      const l = centerline(s) + (rnd() - 0.5) * 46;
      if (CAVE && s > CAVE.s0 && s < CAVE.s1 && Math.abs(l - centerline(s)) < 16) continue; // cave interior stays clear
      if (Math.abs(l - centerline(s)) < 15) continue; // cliff + rail landings: no rocks in the lane
      if (clearOfFeatures(s, l)) rocks.push({ s, l, sc: 0.9 + rnd() * 2.0, y: terrainH(s, l) });
    }
  }
  if (MAP_ID === 'bluebird') {
    // FOREST AROUND THE STREAM [user]: dense banks of trees hugging the creek
    const r2 = mulberry32(seed + 7);
    for (let s = STREAM.s0 + 6; s < STREAM.s1; s += 3.2) {
      for (const side of [-1, 1]) {
        if (r2() < 0.72) {
          const l = streamL(s) + side * (4.5 + r2() * 7);
          if (clearOfFeatures(s, l) && Math.abs(l - centerline(s)) < 44) trees.push({ s: s + r2() * 2.4, l, sc: 0.7 + r2() * 0.85, y: terrainH(s, l) });
        }
      }
    }
  }
  return { trees, rocks };
}

// ---------- physics tuning ----------
export const TUNE = {
  friction: 0.016,
  dragGlide: 0.0093,   // slower overall run [batch item 10]
  dragTuck: 0.0058,    // tuck still sends, but no more warp speed [batch item 10]
  dragBrake: 0.036,
  brakeFriction: 0.11,
  carveK: 2.8,         // path turn rate per rad of edge angle (1/s)
  maxTurnRate: 1.9,    // rad/s cap on how fast the momentum line can bend
  maxEdgeAngle: 0.52,  // rad, max ski angle off the momentum line (carve, not pivot)
  skidK: 3.3,          // brake+turn: pivoty skid mode
  skidMaxLead: 1.1,
  skidMaxTurnRate: 2.6,
  turnRate: 3.1,       // rad/s base (how fast you set the edge)
  skateAccel: 1.4,     // m/s^2 poling/skating boost below skateSpeed
  skateSpeed: 8,
  popBase: 0.95,       // modest launch: low peak height, float does the carrying [batch item 10]
  popCharge: 1.3,      // extra at full charge
  chargeMax: 0.5,      // s
  yawRateMax: 4.55,     // rad/s in air — max spin speed trimmed again [batch 2]
  pitchRateMax: 4.55,   // flips follow the same clock
  rollRateMax: 4.6,    // (legacy, unused by combos)
  corkRate: 4.55,      // rad/s about the tilted cork axis
  corkSnap: 4.5,       // rad/s snap-through to complete the rotation after release
  corkTilt: 0.785,     // 45° axis: mid-cork the body lies parallel to the ground [batch 2]
  rotAccel: 28.6,        // rad/s^2 ease for air rotation
  unwindRate: 3.6,     // rad/s auto-level for roll/tilt after combo release
  grindFriction: 0.018,
  railSpinRate: 3.8,   // rad/s free body rotation while on a rail (Shred Sauce style)
  railSpinAccel: 14,
  bailTime: 1.25,
  detachTol: 0.055,
};

// ---------- trick naming/scoring ----------
const SPIN_NAMES = { 180: '180', 360: '360', 540: '540', 720: '720', 900: '900', 1080: '1080' };
function nearestMult(v, m) { return Math.round(v / m) * m; }

function trickResult(st, STRN) {
  const a = st.air;
  const yawDeg = Math.abs(a.yawAccum) * 180 / Math.PI;
  const pitchDeg = Math.abs(a.pitchAccum) * 180 / Math.PI;
  const rollDeg = Math.abs(a.rollAccum) * 180 / Math.PI;
  const spin = nearestMult(yawDeg, 180);
  const flips = Math.round(pitchDeg / 360);
  const yawRes = Math.abs(yawDeg - spin);
  const pitchRes = Math.abs(pitchDeg - flips * 360);
  const corkDeg = Math.abs(a.corkA) * 180 / Math.PI;
  const corkMult = nearestMult(corkDeg, 360); // the cork axis must come around FULL — the yaw layer carries the switch
  const corkRes = Math.abs(corkDeg - corkMult);
  // REAL ATTITUDE: leftover cork angle is NOT raw roll — rotating theta about
  // the ~57deg tilted cork axis tips the ski plane by less. Judge the landing
  // by the ACTUAL tilt: cos(tilt) = cos(theta) + cos^2(57)*(1-cos(theta)).
  const cr = corkRes * Math.PI / 180;
  const corkTilt = Math.acos(Math.max(-1, Math.min(1, Math.cos(cr) + 0.5 * (1 - Math.cos(cr))))) * 180 / Math.PI; // cos^2(45deg) axis geometry [batch 2]
  const rollRes = Math.max(Math.abs(rollDeg - nearestMult(rollDeg, 360)), corkDeg > 60 ? corkTilt * 0.82 : 0); // legs absorb the last of the tilt
  let pts = 0;
  const parts = [];
  const corkCombo = corkDeg > 120 && a.comboAxis;
  if (corkCombo) {
    // flat spin layered onto the cork counts INTO the trick number: two corks
    // with 720 of extra spin is a Cork 1440, not "Cork 720 + 720"
    const spinFold = nearestMult(yawDeg, 180);
    pts += Math.max(corkMult + spinFold, 360) * 1.4 + 180; // off-axis premium
    parts.push((a.comboAxis === 'misty' ? STRN.misty : STRN.cork) + ' ' + Math.max(corkMult + spinFold, 360));
  }
  if (flips > 0) {
    pts += flips * 550;
    const dirN = a.pitchAccum > 0 ? STRN.backflip : STRN.frontflip;
    parts.push(flips > 1 ? STRN.double + ' ' + dirN : dirN);
  }
  if (spin >= 180 && !corkCombo) {
    pts += spin * 1.15;
    parts.push(SPIN_NAMES[Math.min(spin, 1080)] || String(spin));
  }
  // grab naming follows the player's BINDINGS — st.grabNames holds the label
  // for each of the three grab slots
  const gts = [a.grab1T, a.grab2T, a.shiftyT];
  const gi = gts.indexOf(Math.max(gts[0], gts[1], gts[2]));
  if (gts[gi] > 0.18) {
    pts += 120 + 90 * Math.min(gts[gi], 1.2); // style bonus, capped — rotations are the money
    parts.push((st.grabNames || ['Safety', 'Mute', 'Shifty'])[gi]);
  }
  if (st.air.railPts > 0) {
    pts += st.air.railPts;
    parts.unshift(st.air.railName);
  }
  let name = parts.length ? parts.join(' ') : (st.air.airTime > 0.55 ? STRN.air : '');
  if (st.air.startSwitch && parts.length) { name = STRN.switch + ' ' + name; pts *= 1.15; }
  return { pts, name, yawRes, pitchRes, rollRes };
}

// ---------- state ----------
export function createSim(seed = 20260705) {
  return {
    seed,
    mode: 'gate', // gate | ground | air | grind | bail | finish
    t: 0,
    pos: { s: 8, l: (ACTIVE.startL || 0), y: terrainH(8, ACTIVE.startL || 0) },
    vel: { s: 0, l: 0, y: 0 },
    heading: 0,          // rad, 0 = downhill
    grabNames: ['Safety', 'Mute', 'Shifty'], // labels for the three grab slots (set by bindings)
    switchStance: false, // true = riding backwards (skis point uphill)
    charge: -1,          // -1 = not charging
    crouchVis: 0,
    n: { s: 0, l: 0, y: 1 },
    air: null,
    grind: null,
    butter: null,
    afterbang: null,
    bailT: 0,
    score: 0, combo: 1, comboN: 0,
    best: { name: '', pts: 0 },
    topSpeed: 0,
    events: [],          // drained by renderer
    finished: false,
    stats: { airs: 0, grinds: 0, bails: 0 },
  };
}

function startAir(st, fromRail, spinBoost = 1) {
  st.mode = 'air';
  st.charge = -1; // a held charge is lost once airborne — release before the lip
  const butterCarry = st.butter ? st.butter.a : 0;
  const butterVel = st.butter ? st.butter.vel : 0;
  st.butter = null;
  st.afterbang = null;

  st.air = {
    yawAccum: butterCarry, pitchAccum: 0, yawVel: butterVel, pitchVel: 0,
    rollAccum: 0, rollVel: 0, maxRollDeg: 0, comboAxis: null,
    corkA: 0, corkVel: 0, spinBoost,
    grab1T: 0, grab2T: 0, shiftyT: 0, airTime: 0, graceT: 0.12,
    baseHeading: st.heading,
    startSwitch: st.switchStance,
    apexY: st.pos.y, startY: st.pos.y,
    railPts: fromRail ? fromRail.pts : 0,
    railName: fromRail ? fromRail.name : '',
  };
}

function speedOf(v) { return Math.sqrt(v.s * v.s + v.l * v.l + v.y * v.y); }

// ---------- main step ----------
// input: {left,right,tuck,brake,pop,grab1,grab2,restart,start}
export function simStep(st, dt, inp, STRN) {
  st.t += dt;
  if (inp.restart) { const b = bestOf(st); const ns = createSim(st.seed); ns.bestScore = b; Object.assign(st, ns); return; }

  if (st.mode === 'gate') {
    st.crouchVis += (0.35 - st.crouchVis) * Math.min(1, dt * 6);
    if (inp.start || inp.pop) {
      st.mode = 'ground';
      st.vel.s = 3.8; // push out of the gate
      st.events.push({ type: 'go' });
    }
    return;
  }
  if (st.mode === 'finish') return;

  if (st.mode === 'bail') {
    st.bailT -= dt;
    // tumble downhill, heavy decel
    const n = terrainNormal(st.pos.s, st.pos.l, st.n);
    st.vel.s += (-G * n.s * n.y) * dt; // rough downhill pull
    const sp = speedOf(st.vel);
    const dec = Math.min(sp, 6.5 * dt);
    if (sp > 0.01) { const f = (sp - dec) / sp; st.vel.s *= f; st.vel.l *= f; }
    st.pos.s += st.vel.s * dt; st.pos.l += st.vel.l * dt;
    // the tumble piles up against the lodge wall instead of sliding through it
    if (hitsLodge(st.pos.s, st.pos.l, st.pos.y)) { st.pos.s = Math.min(st.pos.s, LODGE.s0 - 0.4); st.vel.s = 0; }
    st.pos.y = terrainH(st.pos.s, st.pos.l);
    if (st.bailT <= 0) { st.mode = 'ground'; st.vel.y = 0; }
    return;
  }

  if (st.mode === 'grind') grindStep(st, dt, inp, STRN);
  else if (st.mode === 'air') airStep(st, dt, inp, STRN);
  else groundStep(st, dt, inp, STRN);

  const sp = speedOf(st.vel);
  if (sp > st.topSpeed) st.topSpeed = sp;

  // finish line
  if (st.mode === 'ground' && st.pos.s >= FINISH_S) {
    st.mode = 'finish'; st.finished = true;
    st.events.push({ type: 'finish' });
  }
  // safety: out of bounds reset to center (shouldn't happen with berms)
  if (Math.abs(st.pos.l) > 58) { st.pos.l = Math.sign(st.pos.l) * 56; st.vel.l = 0; }
}

function groundStep(st, dt, inp, STRN) {
  if (st.afterbang) { st.afterbang.t -= dt; if (st.afterbang.t <= 0) st.afterbang = null; }
  const n = terrainNormal(st.pos.s, st.pos.l, st.n);
  const v = st.vel;
  // project velocity onto surface
  let dot = v.s * n.s + v.l * n.l + v.y * n.y;
  v.s -= dot * n.s; v.l -= dot * n.l; v.y -= dot * n.y;

  // NATURAL TAKEOFF: if the ground ahead falls away from the current trajectory
  // (a kicker lip), leave the ground with the ramp velocity — no pop needed.
  // Popping still adds extra height on top of this.
  const hspd0 = Math.sqrt(v.s * v.s + v.l * v.l);
  if (hspd0 > 4) {
    const look = 0.7;
    const yAhead = st.pos.y + (v.y / hspd0) * look;
    const hAhead = terrainH(st.pos.s + (v.s / hspd0) * look, st.pos.l + (v.l / hspd0) * look);
    if (yAhead - hAhead > 0.35) {
      // a held charge auto-releases AT the lip: load in, the lip fires the pop
      let boost = 1;
      if (st.charge >= 0) {
        const cf = st.charge / TUNE.chargeMax;
        const pop = TUNE.popBase + TUNE.popCharge * cf;
        v.s += n.s * pop; v.l += n.l * pop; v.y += n.y * pop;
        boost = 1 + cf; // half bar 1.5x spin, full bar 2x [user spec]
      }
      startAir(st, null, boost);
      st.pos.s += v.s * dt; st.pos.l += v.l * dt; st.pos.y += v.y * dt;
      updateCrouch(st, dt, inp);
      return;
    }
  }

  // steering: rotate horizontal velocity toward heading (world right = +l, so D/right -> +heading)
  const turnIn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);

  // BUTTER: SHIFT alone initiates the press — A/D only feed the rotation while
  // pressed. Odd 180s leave you riding switch; rotation carries into any takeoff.
  const buttering = inp.butter && speedOf(v) > 3;
  if (st.butter || buttering) {
    if (!st.butter) st.butter = { a: 0, vel: 0 };
    const b = st.butter;
    const bt = buttering ? turnIn * 3.6 : 0;
    b.vel += Math.min(Math.max(bt - b.vel, -12 * dt), 12 * dt);
    b.a += b.vel * dt;
    const spB = speedOf(v);
    if (spB > 0.01) { const f = Math.max(0, (spB - 0.004 * spB * spB * dt) / spB); v.s *= f; v.l *= f; v.y *= f; }
    if (!buttering && Math.abs(b.vel) < 0.3) {
      const deg = Math.abs(b.a) * 180 / Math.PI;
      const halves = Math.round(deg / 180);
      if (halves >= 1) {
        let pts = Math.round((halves * 180 * 0.9 + 60) * st.combo);
        st.score += pts;
        st.comboN++;
        st.combo = Math.min(1 + st.comboN * 0.12, 2.0);
        if (pts > st.best.pts) st.best = { name: STRN.butter + ' ' + halves * 180, pts };
        st.events.push({ type: 'trick', text: STRN.butter + ' ' + halves * 180, pts, clean: true });
        if (halves % 2 === 1) st.switchStance = !st.switchStance;
      }
      st.butter = null;
    }
  }
  const sp = speedOf(v);
  const tr = TUNE.turnRate / (1 + sp * 0.016);
  // BUTTERING SUSPENDS STEERING: A/D feeds the press-spin only — the body pirouettes
  // while the momentum vector rides straight through, unchanged
  if (!st.butter) st.heading += turnIn * tr * dt;
  // clamp heading to sane range (no skiing backwards up)
  st.heading = Math.min(Math.max(st.heading, -1.45), 1.45);
  const hsp = Math.sqrt(v.s * v.s + v.l * v.l);
  if (hsp > 0.4 && !st.butter) {
    const phi = Math.atan2(v.l, v.s);
    let lead = st.heading - phi;
    while (lead > Math.PI) lead -= 2 * Math.PI;
    while (lead < -Math.PI) lead += 2 * Math.PI;
    // CARVE MODEL: path CURVATURE is proportional to edge angle — small edge, long
    // arc; full edge, tight arc. Momentum is guided, never snapped.
    // Low speed unlocks extra ski pivot (agility); brake+turn = SKID mode: big
    // pivoty direction changes that burn speed (hockey-stop style).
    const skid = inp.brake && turnIn !== 0;
    let maxLead = skid ? TUNE.skidMaxLead
      : TUNE.maxEdgeAngle * (sp < 8 ? 1 + 0.55 * (1 - sp / 8) : 1);
    if (lead > maxLead) { st.heading = phi + maxLead; lead = maxLead; }
    else if (lead < -maxLead) { st.heading = phi - maxLead; lead = -maxLead; }
    const k = skid ? TUNE.skidK : TUNE.carveK;
    const cap = skid ? TUNE.skidMaxTurnRate : TUNE.maxTurnRate;
    const turnV = Math.min(Math.max(lead * k, -cap), cap);
    const rot = turnV * dt;
    const c = Math.cos(rot), s2 = Math.sin(rot);
    const ns2 = v.s * c - v.l * s2, nl2 = v.s * s2 + v.l * c;
    v.s = ns2; v.l = nl2;
    // edge-pressure scrub; skidding scrubs much harder
    const scrub = lead * lead * (skid ? 1.3 : 0.5) * dt;
    v.s *= 1 - scrub; v.l *= 1 - scrub;
  } else if (hsp <= 0.4 && st.pos.s > 2) {
    // barely moving: nudge downhill so player never stalls
    v.s += 1.2 * dt;
  }

  // gravity along surface: a_t = g - (g·n)n, g = (0,0,-G), g·n = -G*ny
  const gn = -G * n.y;
  v.s += (0 - gn * n.s) * dt;
  v.l += (0 - gn * n.l) * dt;
  v.y += (-G - gn * n.y) * dt;

  // skating/poling: quick acceleration from low speed
  const spSk = speedOf(v);
  if (spSk < TUNE.skateSpeed && !inp.brake) {
    const a = TUNE.skateAccel * (1 - spSk / TUNE.skateSpeed) * dt;
    v.s += Math.cos(st.heading) * a; v.l += Math.sin(st.heading) * a;
  }

  // friction + drag
  const braking = inp.brake;
  const mu = TUNE.friction + (braking ? TUNE.brakeFriction : 0);
  const drag = braking ? TUNE.dragBrake : (inp.tuck ? TUNE.dragTuck : TUNE.dragGlide);
  const sp2 = speedOf(v);
  if (sp2 > 0.01) {
    const fdec = mu * G * Math.max(n.y, 0.2) * dt + drag * sp2 * sp2 * dt;
    const f = Math.max(0, (sp2 - fdec) / sp2);
    v.s *= f; v.l *= f; v.y *= f;
  }

  // charge / pop
  if (inp.pop) {
    if (st.charge < 0) st.charge = 0;
    st.charge = Math.min(st.charge + dt, TUNE.chargeMax);
  } else if (st.charge >= 0) {
    const chargeFrac = st.charge / TUNE.chargeMax;
    const pop = TUNE.popBase + TUNE.popCharge * chargeFrac;
    st.charge = -1;
    v.s += n.s * pop; v.l += n.l * pop; v.y += n.y * pop;
    // THE OLLIE CHARGES YOUR SPIN: no pop = lazy rotation, full load = whipped
    startAir(st, null, 1 + chargeFrac); // half bar 1.5x spin, full 2x [user spec]
    st.pos.s += v.s * dt; st.pos.l += v.l * dt; st.pos.y += v.y * dt;
    updateCrouch(st, dt, inp);
    return;
  }

  // integrate all three components; v is surface-tangent (projected at step start),
  // so y follows terrain naturally. Convex lips leave the ground -> air; concave
  // transitions penetrate slightly -> snap up, next-step projection absorbs the hit.
  st.pos.s += v.s * dt; st.pos.l += v.l * dt; st.pos.y += v.y * dt;
  // skiing into the lodge: above 25 km/h = wreck; slower = BOUNCE off the logs
  if (hitsLodge(st.pos.s, st.pos.l, st.pos.y)) {
    if (Math.sqrt(v.s * v.s + v.l * v.l) > CRASH_SPD) { doBail(st, STRN); return; }
    st.pos.s = Math.min(st.pos.s, LODGE.s0 - 0.4);
    v.s = -Math.abs(v.s) * 0.4;
    st.events.push({ type: 'bounce' });
  }
  // TREES & ROCKS ARE SOLID: slow hits bounce you off the contact normal with
  // some spring; fast hits (>25 km/h) put you in the snow
  const ob = hitObstacle(st.pos.s, st.pos.l);
  if (ob) {
    if (Math.sqrt(v.s * v.s + v.l * v.l) > CRASH_SPD) { doBail(st, STRN); return; }
    let ns = st.pos.s - ob.s, nl = st.pos.l - ob.l;
    const nd = Math.sqrt(ns * ns + nl * nl) || 1;
    ns /= nd; nl /= nd;
    const rr = ob.r + 0.32;
    st.pos.s = ob.s + ns * rr; st.pos.l = ob.l + nl * rr;
    const vn = v.s * ns + v.l * nl;
    if (vn < 0) { v.s -= 1.45 * vn * ns; v.l -= 1.45 * vn * nl; } // ~45% restitution
    st.events.push({ type: 'bounce' });
  }
  const gY = terrainH(st.pos.s, st.pos.l);
  if (st.pos.y > gY + TUNE.detachTol) {
    let boost = 1;
    if (st.charge >= 0) { // crest detach also releases a held charge
      const cf = st.charge / TUNE.chargeMax;
      boost = 1 + cf;
      st.vel.y += (TUNE.popBase + TUNE.popCharge * cf) * 0.8;
    }
    startAir(st, null, boost);
  } else {
    st.pos.y = gY;
  }
  updateCrouch(st, dt, inp);
}

function updateCrouch(st, dt, inp) {
  let target = 0;
  if (st.charge >= 0) target = 0.4 + 0.6 * (st.charge / TUNE.chargeMax);
  else if (inp.tuck && st.mode === 'ground') target = 0.75;
  else if (inp.brake && st.mode === 'ground') target = 0.35;
  st.crouchVis += (target - st.crouchVis) * Math.min(1, dt * 9);
}

function airStep(st, dt, inp, STRN) {
  const a = st.air, v = st.vel;
  a.airTime += dt;
  // rotation with eased rates. Combos go OFF-AXIS:
  //   W + A/D = MISTY (forward-tilted rolled spin)   S + A/D = CORK (back-tilted rolled spin)
  const dir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  const combo = dir !== 0 && (inp.tuck || inp.brake);
  if (dir !== 0) a.lastDir = dir;
  // CORK MODEL: one rotation about an axis tilted ~57° from vertical. The body is
  // upright again exactly when the angle completes 360° — so full corks/mistys
  // rotate back to a normal stance by construction.
  const boost = a.spinBoost || 1; // ollie charge sets rotation speed
  let pitchT = 0;
  let corkT = 0;
  let comboYawT = 0;
  if (combo) {
    a.comboAxis = inp.tuck ? 'misty' : 'cork';
    // NO CAP [user]: hold the combo and keep corking — triples, quads, whatever
    // the airtime allows. Release still snap-resolves forward onto full marks.
    const ph = (Math.abs(a.corkA) % (2 * Math.PI)) / (2 * Math.PI);
    corkT = dir * TUNE.corkRate * boost * (0.72 + 0.66 * ph); // slow entry, snap to finish [batch 2]
    comboYawT = 0;
  }
  else pitchT = ((inp.brake ? 1 : 0) - (inp.tuck ? 1 : 0)) * TUNE.pitchRateMax * boost; // S=back, W=front
  // HARLAUT AXIS: pure flips never ride a clean axis — a subtle auto-cork roll
  // and a lazy yaw drift make inverts read organic, never gyroscopic
  const flipStyle = !combo && pitchT !== 0;
  // FLAT SPINS: uncharged 360 in ~1.3s, charge multiplies straight through
  // JIB AIRS (hopping onto or off a rail) spin much snappier — quick 2s and
  // 4s on and off the steel without needing kicker-sized hang time
  let yawT = combo ? comboYawT : dir * TUNE.yawRateMax * boost * (a.jibAir ? 1.6 : 1);
  if (flipStyle && dir === 0) yawT += Math.sign(pitchT) * 0.26 * boost;
  // SWAP HOP: the rotation carries itself — no decay while hands-off, so the
  // swap arrives on time; holding a direction can still add or fight it
  if (a.hopSwap && dir === 0) yawT = a.yawVel;
  const rollT = flipStyle ? Math.sign(pitchT) * 0.5 : 0;
  a.yawVel += Math.min(Math.max(yawT - a.yawVel, -TUNE.rotAccel * dt), TUNE.rotAccel * dt);
  a.pitchVel += Math.min(Math.max(pitchT - a.pitchVel, -TUNE.rotAccel * dt), TUNE.rotAccel * dt);
  a.corkVel += Math.min(Math.max(corkT - a.corkVel, -TUNE.rotAccel * dt), TUNE.rotAccel * dt);
  a.rollVel += Math.min(Math.max(rollT - a.rollVel, -TUNE.rotAccel * dt), TUNE.rotAccel * dt);
  a.yawAccum += a.yawVel * dt;
  a.pitchAccum += a.pitchVel * dt;
  a.corkA += a.corkVel * dt;
  a.rollAccum += a.rollVel * dt;
  // released style-roll settles back level before touchdown
  if (rollT === 0 && Math.abs(a.rollVel) < 0.4 && a.rollAccum !== 0) {
    const nearestR = Math.round(a.rollAccum / (2 * Math.PI)) * 2 * Math.PI;
    const dR = nearestR - a.rollAccum;
    a.rollAccum += Math.sign(dR) * Math.min(Math.abs(dR), 3.2 * dt);
  }
  // released cork SNAPS THROUGH to the nearest full rotation — but the snap
  // never acts AGAINST the momentum you carry. Release early and you stay
  // under-rotated; the landing judges what you brought.
  if (corkT === 0 && Math.abs(a.corkVel) < 0.9 && a.corkA !== 0) {
    const dirS = a.lastDir || Math.sign(a.corkA) || 1;
    // FORWARD RESOLVE: once past 40% of the way to the next full rotation the
    // cork pulls through onto your feet — never rewinds, never strands you
    // just short. (A cork 540 = this full cork + the yaw layer's 180.)
    const frac = (Math.abs(a.corkA) % (2 * Math.PI)) / (2 * Math.PI);
    const nearest = frac > 0.4
      ? (dirS > 0 ? Math.ceil(a.corkA / (2 * Math.PI) - 0.02) : Math.floor(a.corkA / (2 * Math.PI) + 0.02)) * 2 * Math.PI
      : Math.round(a.corkA / (2 * Math.PI)) * 2 * Math.PI;
    const d = nearest - a.corkA;
    if (d * dirS >= 0) {
      a.corkA += Math.sign(d) * Math.min(Math.abs(d), TUNE.corkSnap * dt);
      // the layered flat spin tidies home with the cork — same forward-only rule
      if (a.comboAxis && comboYawT === 0 && Math.abs(a.yawVel) < 0.9 && a.yawAccum !== 0) {
        const nearestY = Math.round(a.yawAccum / Math.PI) * Math.PI;
        const dY = nearestY - a.yawAccum;
        if (dY * dirS >= 0) a.yawAccum += Math.sign(dY) * Math.min(Math.abs(dY), TUNE.corkSnap * dt);
      }
    }
  }
  // small uncommitted pitch lean drifts back level
  if (!combo && pitchT === 0 && Math.abs(a.pitchAccum) < 1.5 && Math.abs(a.pitchVel) < 0.4 && a.pitchAccum !== 0) {
    const uw = Math.min(Math.abs(a.pitchAccum), TUNE.unwindRate * 0.8 * dt);
    a.pitchAccum -= Math.sign(a.pitchAccum) * uw;
  }
  if (inp.grab1) a.grab1T += dt;
  if (inp.grab2) a.grab2T += dt;
  if (inp.grab3) a.shiftyT += dt;

  // APEX FLOAT: gravity eases through the top of the arc — but ONLY on real
  // airs (a proper rise off a lip, or a big drop). Utility hops onto rails
  // stay crisp so the steel under you doesn't outrun your fall.
  const realAir = (a.apexY - a.startY > 1.1) || (a.startY - st.pos.y > 1.5);
  v.y -= G * dt * (realAir ? (Math.abs(v.y) < 2.8 ? 0.4 : 0.76) : 1); // gravity dialed to 0.76 [user]
  const sp = speedOf(v);
  if (sp > 0.01) {
    const f = Math.max(0, (sp - 0.0014 * sp * sp * dt) / sp);
    v.s *= f; v.l *= f; v.y *= f;
  }
  st.pos.s += v.s * dt; st.pos.l += v.l * dt; st.pos.y += v.y * dt;
  if (st.pos.y > a.apexY) a.apexY = st.pos.y;

  // rail attach — only on the way DOWN, so a spin thrown over the rail keeps
  // rotating through the hop instead of getting snatched mid-air on the way up
  if (v.y < 0.05 && a.airTime > 0.1) {
    for (const r of RAILS) {
      if (st.pos.s >= r.s0 && st.pos.s <= r.s1 && Math.abs(st.pos.l - r.l) < r.w + 0.55) {
        const railY = railTopY(r, st.pos.s);
        if (st.pos.y > railY - 0.22 && st.pos.y < railY + 0.65) {
          attachRail(st, r, STRN);
          return;
        }
      }
    }
  }

  // THE LODGE IS SOLID: coming down inside the footprint below the ridge line —
  // wall, roof slope, anywhere but the ridge rail — is a wreck
  if (hitsLodge(st.pos.s, st.pos.l, st.pos.y)) { doBail(st, STRN); return; }

  // landing — a short grace after takeoff so skimming the last of a lip doesn't
  // count as touching down (deep penetration overrides the grace)
  a.graceT -= dt;
  const gY = terrainH(st.pos.s, st.pos.l);
  if (st.pos.y <= gY + 0.02 && (a.graceT <= 0 || st.pos.y < gY - 0.4)) {
    st.pos.y = gY;
    land(st, STRN, inp.butter);
  }
}

function attachRail(st, r, STRN) {
  st.mode = 'grind';
  const spinIn = Math.abs(st.air.yawAccum) * 180 / Math.PI;
  // you lock on in EXACTLY the orientation you arrive — no snapping. Rotation on
  // the rail is free (A/D), and whatever you're holding at dismount carries out.
  let bodyYaw = st.air.baseHeading + st.air.yawAccum + (st.air.startSwitch ? Math.PI : 0);
  // ...except swap hops, which settle onto the nearest clean stance (50-50,
  // boardslide, or switch) so the swap finishes crisp
  if (st.air.hopSwap) bodyYaw = Math.round(bodyYaw / (Math.PI / 2)) * (Math.PI / 2);
  st.grind = {
    rail: r, dist: 0, spinA: bodyYaw, spinVel: st.air.hopSwap ? 0 : st.air.yawVel * 0.8, // spin carries INTO the grind
    pts: st.air.railPts + (spinIn > 65 ? nearestMult(spinIn, 90) * 1.4 : 0),
    grabCarry: Math.max(st.air.grab1T, st.air.grab2T),
  };
  st.heading = 0; // travel straight along the rail
  // SLIDE-IN LOCK: keep where you actually touched down and ease to the rail's
  // center over the first moments — no teleport to the middle
  st.grind.lIn = Math.max(-1.1, Math.min(1.1, st.pos.l - r.l));
  st.pos.l = r.l + st.grind.lIn;
  st.pos.y = railTopY(r, st.pos.s);
  st.vel.l = 0; st.vel.y = 0;
  if (st.vel.s < 2.0) st.vel.s = 2.0;
  st.air = null;
  st.events.push({ type: 'grindStart', name: STRN.rails[r.type] });
}

function grindStep(st, dt, inp, STRN) {
  const g = st.grind, r = g.rail;
  // gravity pull follows the RAIL's own profile (rainbows decelerate up the arch,
  // accelerate down; kinks dump speed through the steep section)
  const grade = railTopY(r, st.pos.s + 0.5) - railTopY(r, st.pos.s - 0.5);
  st.vel.s += -grade * G * 0.9 * dt;
  st.vel.s -= TUNE.grindFriction * G * dt * Math.sign(st.vel.s);
  st.pos.s += st.vel.s * dt;
  g.dist += Math.abs(st.vel.s) * dt;
  st.pos.y = railTopY(r, st.pos.s);
  g.lIn = (g.lIn || 0) * Math.exp(-9 * dt); // easing slide toward center lock
  st.pos.l = r.l + g.lIn;

  // FREE SPIN on the rail: A/D rotates the body continuously — boardslides,
  // pretzels, 270-out all live here. Rotation held at dismount carries into the air.
  const spinIn = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  if (g.swapTgt != null) {
    // CONTROLLED SWAP in progress: an eased pivot — quick through the middle,
    // settling softly onto the mark, skis never leaving the steel
    const d2 = g.swapTgt - g.spinA;
    const rate = (1.3 + 6.8 * Math.min(1, Math.abs(d2))) * (g.swapRate || 1);
    const step = Math.sign(d2) * Math.min(Math.abs(d2), rate * dt);
    g.spinA += step;
    g.spinVel = (step / dt) * 0.5; // keeps the counter-lean visuals alive
    if (Math.abs(d2) < 0.02) { g.spinA = g.swapTgt; g.swapTgt = null; g.spinVel = 0; }
  } else {
    const spinT = spinIn * TUNE.railSpinRate;
    g.spinVel += Math.min(Math.max(spinT - g.spinVel, -TUNE.railSpinAccel * dt), TUNE.railSpinAccel * dt);
    g.spinA += g.spinVel * dt;
  }
  if (g.swapAnim > 0) g.swapAnim -= dt;
  if (Math.abs(g.spinVel) > 1) g.pts += 30 * dt; // style ticks while rotating
  // FRONTSLIDE / BACKSLIDE: J lifts the left foot, L lifts the right — one-ski press
  if (inp.grab1) { g.liftLT = (g.liftLT || 0) + dt; g.pts += 20 * dt; }
  if (inp.grab3) { g.liftRT = (g.liftRT || 0) + dt; g.pts += 20 * dt; }

  // CHARGE ON THE RAIL: space loads the legs mid-grind, the RELEASE fires —
  // with A/D held it's a SWAP HOP back onto the rail, alone it pops off
  if (inp.pop) {
    if (st.charge < 0) st.charge = 0;
    st.charge = Math.min(st.charge + dt, TUNE.chargeMax);
  }
  const releasing = st.charge >= 0 && !inp.pop;
  const cf = releasing ? st.charge / TUNE.chargeMax : 0;
  if (releasing) st.charge = -1;
  const swapDir = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
  if (releasing && swapDir !== 0 && g.swapTgt == null) {
    // CONTROLLED SWAP: no air at all — the body unweights and pivots a clean
    // 180 (a full bar pivots 360) while the skis stay ON the rail
    g.swapTgt = g.spinA + swapDir * Math.PI * (1 + Math.round(cf));
    g.swapRate = 1 + cf; // full bar pivots twice as fast — same rule as corks and spins
    g.swapAnim = 0.45; // brief unweight in the legs while the pivot happens
    g.pts += 45 + 55 * cf;
    st.events.push({ type: 'swapHop' });
  }
  const done = st.pos.s > r.s1;
  const popOff = releasing && swapDir === 0; // a release WITH direction is a swap, not a dismount
  if (done || popOff || st.vel.s < 1.2) {
    let pts = g.pts + g.dist * (RAIL_PTS_M[r.type] || 12);
    let name = STRN.rails[r.type] + ' ' + Math.round(g.dist) + 'm';
    if ((g.liftLT || 0) > 0.3) name = STRN.frontslide + ' ' + name;
    else if ((g.liftRT || 0) > 0.3) name = STRN.backslide + ' ' + name;
    const spinA = g.spinA, spinVel = g.spinVel;
    st.grind = null;
    if (st.vel.s < 1.2 && !done && !popOff) { doBail(st, STRN); return; }
    if (r.type === 'launch' && done) { st.vel.y = 4.2; pts += 300; }      // fired off the cliff out the cave mouth
    else if (r.type === 'up' && done) {
      // CANNON ARC MATCHING: test several pops ballistically and take the one
      // whose touchdown meets the slope below FLUSH — over the knuckle, then
      // smoothly down the landing's own grade
      let bestVy = 3.2, bestImp = 1e9;
      const n2 = { s: 0, l: 0, y: 1 };
      for (const vyC of [3.4, 2.8, 2.2, 1.6, 1.1]) {
        let ss = st.pos.s, yy = st.pos.y + 0.01, vy2 = vyC, imp = 1e9;
        for (let t2 = 0; t2 < 3; t2 += 0.03) {
          ss += st.vel.s * 0.03; vy2 -= G * 0.03; yy += vy2 * 0.03;
          if (yy <= terrainH(ss, st.pos.l)) {
            terrainNormal(ss, st.pos.l, n2);
            imp = Math.abs(st.vel.s * n2.s + vy2 * n2.y);
            break;
          }
        }
        if (imp < bestImp) { bestImp = imp; bestVy = vyC; }
      }
      st.vel.y = bestVy; pts += 220;
    }
    else if (r.type === 'cannon' && done) { st.vel.y = 3.4; pts += 150; } // fired out the barrel
    else st.vel.y = popOff ? 2.4 + 1.4 * cf : 1.1;
    startAir(st, { pts, name }, popOff ? 1 + cf : 1); // off-rail airs follow the same charge clock: 1x base, up to 2x
    // orientation carries out of the rail — spin-out counts toward the landing
    st.air.yawAccum = spinA;
    st.air.yawVel = spinVel;
    st.air.startSwitch = false;
    st.air.jibAir = true; // off-rail airs spin snappy
  }
}

function land(st, STRN, butterHeld) {
  const res = trickResult(st, STRN);
  const airTime = st.air.airTime;
  const dropH = st.air.apexY - st.pos.y;
  // ---- REAL LANDING PHYSICS ----
  // What decides a landing is where your MOMENTUM goes, not the raw angle:
  //  impact  = speed driven INTO the snow along the surface normal — brutal on
  //            a flat, soft when a steep landing face carries it away
  //  latLoad = sideways momentum the ski edges must absorb = planar speed x
  //            sin(slip angle). 40 degrees off at crawl speed skids out fine;
  //            the same angle at 70 km/h is an edge-catch.
  const nrm = terrainNormal(st.pos.s, st.pos.l, st.n);
  const dotV = st.vel.s * nrm.s + st.vel.l * nrm.l + st.vel.y * nrm.y;
  const ps = st.vel.s - dotV * nrm.s, pl = st.vel.l - dotV * nrm.l, py = st.vel.y - dotV * nrm.y;
  const planar = Math.hypot(ps, pl, py);
  // vertical punishment stays a DESIGN rule (big drop to true flat), because the
  // park's built drops are meant to be ridden: physics governs the edges below
  const surfDrop = (terrainH(st.pos.s - 1, st.pos.l) - terrainH(st.pos.s + 1, st.pos.l)) / 2;
  const flatLanding = dropH > 8 && surfDrop < 0.07;
  // BUTTER LANDING: the press absorbs ANY yaw misalignment — the leftover
  // rotation rides on as a live ground butter instead of a wreck.
  let butterCarry = null;
  if (butterHeld) {
    const nearest = Math.round(st.air.yawAccum / Math.PI) * Math.PI;
    butterCarry = { a: st.air.yawAccum - nearest, vel: Math.max(-3.8, Math.min(3.8, st.air.yawVel)) };
    res.yawRes = 0;
  }
  // LANDING LOCK-ON: skis want to run — a small grace window absorbs
  // near-clean residuals so an almost-stomped trick IS stomped
  res.yawRes = Math.max(0, res.yawRes - 22);
  res.pitchRes = Math.max(0, res.pitchRes - 19);
  res.rollRes = Math.max(0, res.rollRes - 19);
  const beta = Math.min(res.yawRes, 90) * Math.PI / 180;
  const latLoad = planar * Math.sin(beta);
  // odd count of half-spins flips the stance — the yaw layer carries the
  // switch (a cork 540 = full cork + 180 yaw, landed switch)
  const halfSpins = Math.round(Math.abs(st.air.yawAccum) / Math.PI);
  if (halfSpins % 2 === 1) st.switchStance = !st.switchStance;
  st.air = null;
  st.mode = 'ground';
  st.stats.airs++;

  // attitude (pitch/roll) still judged as body position; yaw judged by physics
  // edges scrub laterally over a skid, they don't absorb instantly — so the
  // allowance grows with speed (a fixed skid ANGLE budget) on top of a base:
  // slow slashes land sideways fine, high-speed landings demand precision
  const clean = latLoad < 3.0 + 0.18 * planar && !flatLanding && res.pitchRes < 34 && res.rollRes < 40;
  // wider rideable band: slightly-off lands sketchy and scrubs, it doesn't
  // ragdoll — and at crawling speed attitude alone never bails you
  const slow = planar < 4.5;
  const sketchy = !clean && latLoad < 5.2 + 0.46 * planar &&
    res.pitchRes < (slow ? 88 : 78) && res.rollRes < (slow ? 88 : 80) && res.yawRes < 100;

  if (!clean && !sketchy) { doBail(st, STRN); return; }
  if (butterCarry) st.butter = butterCarry; // the spin butters out on the snow

  if (res.pts > 1) {
    let pts = res.pts * (clean ? 1.2 : 0.8) * st.combo;
    pts = Math.round(pts);
    st.score += pts;
    st.comboN++;
    st.combo = Math.min(1 + st.comboN * 0.12, 2.0);
    if (pts > st.best.pts) st.best = { name: res.name, pts };
    st.events.push({ type: 'trick', text: res.name, pts, clean });
  } else if (airTime > 0.4) {
    st.events.push({ type: 'land', clean });
  }
  // AFTERBANG: stomp it and lock out — deeper and longer the further you fell
  if (dropH > 2) {
    st.afterbang = {
      T: Math.min(1.1, 0.3 + dropH * 0.07),
      t: Math.min(1.1, 0.3 + dropH * 0.07),
      amt: Math.min(1, dropH / 9),
    };
  }
  // landing speed retention: edges scrub what they absorb — sideways landings
  // and hard flat impacts bleed speed, stomped landings keep it
  // off-axis touchdowns sink into the landing: heavy scrub, not a ragdoll
  const tiltScrub = 0.0022 * Math.max(0, res.pitchRes + res.rollRes - 30);
  const keep = (clean ? 0.985 : 0.93 - tiltScrub) * Math.max(0.72, 1 - 0.012 * latLoad);
  st.vel.s *= keep; st.vel.l *= keep;
  const n = terrainNormal(st.pos.s, st.pos.l, st.n);
  const dot = st.vel.s * n.s + st.vel.l * n.l + st.vel.y * n.y;
  st.vel.s -= dot * n.s; st.vel.l -= dot * n.l; st.vel.y -= dot * n.y;
  // heading resets to travel direction (mod 180 — switch landing supported visually)
  st.heading = Math.min(Math.max(Math.atan2(st.vel.l, st.vel.s), -1.45), 1.45);
}

function doBail(st, STRN) {
  st.mode = 'bail';
  st.bailT = TUNE.bailTime;
  st.air = null; st.grind = null;
  st.combo = 1; st.comboN = 0;
  st.switchStance = false; // you get up facing forward
  st.stats.bails++;
  st.vel.s *= 0.62; st.vel.l *= 0.5; st.vel.y = 0;
  st.events.push({ type: 'bail' });
}

function bestOf(st) { return Math.max(st.bestScore || 0, st.score); }
