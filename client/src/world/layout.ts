/** Hand-authored macro layout of the world: regions, points of interest, river, lake and roads. */

export const WORLD_SIZE = 2048;
export const WORLD_HALF = WORLD_SIZE / 2;
export const WATER_LEVEL = 0;

export type Vec2 = [number, number];

export interface Poi {
  id: string;
  name: string;
  x: number;
  z: number;
  /** Radius flattened for building. 0 = no flattening. */
  flat: number;
  kind: 'village' | 'arena' | 'castle' | 'ruin' | 'lake' | 'forest' | 'meadow' | 'camp';
}

export const POIS: Poi[] = [
  { id: 'ashford', name: 'Ashford', x: 0, z: 0, flat: 112, kind: 'village' },
  { id: 'arena', name: 'Training Grounds', x: -310, z: 170, flat: 82, kind: 'arena' },
  { id: 'brookhollow', name: 'Brookhollow', x: -120, z: 560, flat: 66, kind: 'village' },
  { id: 'castle', name: 'Highmere Castle', x: 540, z: -470, flat: 58, kind: 'castle' },
  { id: 'tower', name: 'Ruined Watchtower', x: -390, z: -540, flat: 24, kind: 'ruin' },
  { id: 'lake', name: 'Lake Mirren', x: 430, z: 340, flat: 0, kind: 'lake' },
  { id: 'blackwood', name: 'Blackwood', x: -560, z: -230, flat: 0, kind: 'forest' },
  { id: 'meadows', name: 'Sunreach Meadows', x: 150, z: 420, flat: 0, kind: 'meadow' },
  { id: 'camp_brigand', name: 'Brigand Camp', x: -170, z: -340, flat: 26, kind: 'camp' },
  { id: 'camp_knight', name: 'Knight Outpost', x: 360, z: -300, flat: 26, kind: 'camp' },
  { id: 'camp_imp', name: 'Mandrake Hollow', x: -640, z: -60, flat: 22, kind: 'camp' },
  { id: 'camp_golem', name: 'Golem Quarry', x: -650, z: 470, flat: 34, kind: 'camp' },
  { id: 'camp_warlock', name: 'Warlock Shrine', x: 660, z: 120, flat: 24, kind: 'camp' },
];

export const POI_BY_ID: Record<string, Poi> = Object.fromEntries(POIS.map((p) => [p.id, p]));

/** River centerline, north (mountains) to south-east edge, passing through the lake. */
export const RIVER: Vec2[] = [
  [140, -1060],
  [230, -760],
  [190, -520],
  [250, -300],
  [230, -120],
  [300, 90],
  [380, 250],
  [430, 340],
  [500, 450],
  [610, 640],
  [760, 860],
  [900, 1060],
];

export const LAKE = { x: 430, z: 340, r: 98 };

/** Roads between points of interest. Coordinates are control points (smoothed with Catmull-Rom). */
export const ROADS: Vec2[][] = [
  // Ashford → Training Grounds
  [[0, 0], [-90, 40], [-190, 110], [-310, 170]],
  // Ashford → Brookhollow
  [[0, 0], [20, 140], [-30, 300], [-80, 440], [-120, 560]],
  // Ashford → bridge → Highmere Castle
  [[0, 0], [110, -60], [238, -150], [330, -260], [440, -380], [540, -470]],
  // Ashford → Watchtower (along Blackwood's edge)
  [[0, 0], [-80, -110], [-170, -250], [-260, -400], [-390, -540]],
  // Ashford → Lake Mirren
  [[0, 0], [120, 90], [250, 200], [345, 290]],
  // Brookhollow → Training Grounds
  [[-120, 560], [-230, 380], [-310, 170]],
];

/** Bridge where the castle road crosses the river. */
export const BRIDGE = { x: 238, z: -150, angle: Math.atan2(-150 - -60, 238 - 110) };

export function catmullRom(points: Vec2[], samplesPerSeg: number): Vec2[] {
  const out: Vec2[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[Math.min(points.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSeg; s++) {
      const t = s / samplesPerSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      const f = (a: number, b: number, c: number, d: number) =>
        0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (-a + 3 * b - 3 * c + d) * t3);
      out.push([f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])]);
    }
  }
  out.push(points[points.length - 1]);
  return out;
}

/** Distance from point to a polyline, plus the parameter along it (0..1). */
export function distToPolyline(x: number, z: number, line: Vec2[]): { d: number; t: number } {
  let best = Infinity;
  let bestT = 0;
  let acc = 0;
  let total = 0;
  for (let i = 0; i < line.length - 1; i++) total += Math.hypot(line[i + 1][0] - line[i][0], line[i + 1][1] - line[i][1]);
  for (let i = 0; i < line.length - 1; i++) {
    const [ax, az] = line[i];
    const [bx, bz] = line[i + 1];
    const dx = bx - ax;
    const dz = bz - az;
    const len2 = dx * dx + dz * dz;
    const len = Math.sqrt(len2);
    let u = len2 > 0 ? ((x - ax) * dx + (z - az) * dz) / len2 : 0;
    u = Math.max(0, Math.min(1, u));
    const px = ax + dx * u;
    const pz = az + dz * u;
    const d = Math.hypot(x - px, z - pz);
    if (d < best) {
      best = d;
      bestT = (acc + u * len) / total;
    }
    acc += len;
  }
  return { d: best, t: bestT };
}

export const RIVER_SMOOTH = catmullRom(RIVER, 10);
export const ROADS_SMOOTH = ROADS.map((r) => catmullRom(r, 12));
