// Isometric (2:1 dimetric) geometry for the state illustrations. World units:
// x runs to the lower right, y to the lower left, z up; one unit is `UNIT`
// pixels along the screen diagonal. Everything sits on, or floats above,
// horizontal planes, so shapes are drawn in plane coordinates and projected.
// The projection is affine, which keeps bezier curves exact.

import {
  group,
  type Bezier,
  type FillPaint,
  type Group,
  type Node,
  type Shape,
  type Stroke,
  type StrokePaint,
  type Transform,
  type Track,
  type Vec2,
} from "@lictory/ui/illustrations/lottie";

export type Vec3 = readonly [number, number, number];

export const UNIT = 1.5;
const ORIGIN: Vec2 = [200, 208];

export function project([x, y, z]: Vec3): Vec2 {
  return [
    ORIGIN[0] + (x - y) * UNIT,
    ORIGIN[1] + ((x + y) * UNIT) / 2 - z * UNIT,
  ];
}

/** Screen offset of a world displacement. */
export function shift([x, y, z]: Vec3): Vec2 {
  return [(x - y) * UNIT, ((x + y) * UNIT) / 2 - z * UNIT];
}

/** Screen offset that raises something by `z` world units. */
export const lift = (z: number): Vec2 => [0, -z * UNIT];

// ---------------------------------------------------------------------------
// Paths in a horizontal plane

/** A path vertex with absolute control points, in plane coordinates. */
type Node2 = { p: Vec2; in: Vec2; out: Vec2 };

function toBezier(nodes: Node2[], z: number, closed: boolean): Bezier {
  const at = (p: Vec2) => project([p[0], p[1], z]);
  const v = nodes.map((n) => at(n.p));
  return {
    v,
    i: nodes.map((n, k) => sub(at(n.in), v[k]!)),
    o: nodes.map((n, k) => sub(at(n.out), v[k]!)),
    closed,
  };
}

const sub = (a: Vec2, b: Vec2): Vec2 => [a[0] - b[0], a[1] - b[1]];

/** A 45° arc piece from angle a to b (radians) around c. */
function arc(c: Vec2, r: number, a: number, b: number): [Node2, Node2] {
  const h = (4 / 3) * Math.tan((b - a) / 4) * r;
  const pa: Vec2 = [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
  const pb: Vec2 = [c[0] + r * Math.cos(b), c[1] + r * Math.sin(b)];
  return [
    { p: pa, in: pa, out: [pa[0] - h * Math.sin(a), pa[1] + h * Math.cos(a)] },
    { p: pb, in: [pb[0] + h * Math.sin(b), pb[1] - h * Math.cos(b)], out: pb },
  ];
}

/**
 * Outline of a rounded rectangle, clockwise from the back corner. Each corner
 * is split at 45°, where the screen silhouette turns: node 4 is the rightmost
 * point and node 10 the leftmost.
 */
function roundRectNodes(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  r: number,
) {
  const q = Math.PI / 4;
  const corners: [Vec2, number][] = [
    [[x0 + r, y0 + r], 4 * q],
    [[x1 - r, y0 + r], 6 * q],
    [[x1 - r, y1 - r], 0],
    [[x0 + r, y1 - r], 2 * q],
  ];
  const nodes: Node2[] = [];
  for (const [c, start] of corners) {
    const [a, m1] = arc(c, r, start, start + q);
    const [m2, b] = arc(c, r, start + q, start + 2 * q);
    nodes.push(a, { p: m1.p, in: m1.in, out: m2.out }, b);
  }
  return nodes;
}

export type Rect = readonly [x0: number, y0: number, x1: number, y1: number];

export function roundRect(rect: Rect, r: number, z: number): Bezier {
  return toBezier(roundRectNodes(...rect, r), z, true);
}

/** The near (front) or far (back) half of a rounded rectangle's outline,
    between its leftmost and rightmost screen points, left to right. */
export function outlineHalf(
  rect: Rect,
  r: number,
  z: number,
  half: "front" | "back",
): Bezier {
  const nodes = roundRectNodes(...rect, r);
  const part =
    half === "front"
      ? nodes
          .slice(4, 11)
          .reverse()
          .map((n) => ({ p: n.p, in: n.out, out: n.in }))
      : [...nodes.slice(10), ...nodes.slice(0, 5)];
  const b = toBezier(part, z, false);
  b.i[0] = [0, 0];
  b.o[b.o.length - 1] = [0, 0];
  return b;
}

/** Leftmost and rightmost screen points of a rounded rectangle, in the plane. */
export function extremes(
  rect: Rect,
  r: number,
): { left: Vec2; right: Vec2; front: Vec2 } {
  const d = r - r * Math.SQRT1_2;
  return {
    left: [rect[0] + d, rect[3] - d],
    right: [rect[2] - d, rect[1] + d],
    front: [rect[2] - d, rect[3] - d],
  };
}

/** A circle lying in the plane: an axis-aligned ellipse on screen. */
export function disc(cx: number, cy: number, r: number, z: number) {
  return {
    type: "ellipse" as const,
    center: project([cx, cy, z]),
    size: [2 * Math.SQRT2 * UNIT * r, Math.SQRT2 * UNIT * r] as Vec2,
  };
}

/** A straight segment between two world points. */
export function segment(a: Vec3, b: Vec3): Bezier {
  const pa = project(a);
  const pb = project(b);
  return {
    v: [pa, pb],
    i: [
      [0, 0],
      [0, 0],
    ],
    o: [
      [0, 0],
      [0, 0],
    ],
    closed: false,
  };
}

// ---------------------------------------------------------------------------
// Solids

const path = (b: Track<Bezier>) => ({ type: "path" as const, path: b });

/** Visible side wall of an extruded rounded rectangle. */
function slabSide(rect: Rect, r: number, z: number, h: number): Bezier {
  const nodes = roundRectNodes(...rect, r).slice(4, 11);
  const top = toBezier(nodes, z, false);
  const bottom = toBezier(
    [...nodes].reverse().map((n) => ({ p: n.p, in: n.out, out: n.in })),
    z - h,
    false,
  );
  const zero = (b: Bezier, index: number, key: "i" | "o") => {
    b[key][index] = [0, 0];
  };
  zero(top, 0, "i");
  zero(top, top.v.length - 1, "o");
  zero(bottom, 0, "i");
  zero(bottom, bottom.v.length - 1, "o");
  return {
    v: [...top.v, ...bottom.v],
    i: [...top.i, ...bottom.i],
    o: [...top.o, ...bottom.o],
    closed: true,
  };
}

export type SlabOptions = {
  rect: Rect;
  radius?: number;
  /** Height of the top face. */
  z?: number;
  /** Thickness. */
  height?: number;
  top?: FillPaint;
  side?: FillPaint;
  line?: StrokePaint;
  width?: number;
};

/** A rounded rectangular block: plates, cards, keys and tiles. */
export function slab({
  rect,
  radius = 6,
  z = 0,
  height = 4,
  top = "face",
  side = "side",
  line = "line",
  width = 2.5,
}: SlabOptions): Shape[] {
  const stroke: Stroke = { paint: line, width };
  return [
    {
      type: "shape",
      name: "side",
      geometry: [path(slabSide(rect, radius, z, height))],
      fill: side,
      stroke,
    },
    {
      type: "shape",
      name: "top",
      geometry: [path(roundRect(rect, radius, z))],
      fill: top,
      stroke,
    },
  ];
}

export type CylinderOptions = {
  at: readonly [number, number];
  r: number;
  z?: number;
  height?: number;
  top?: FillPaint;
  side?: FillPaint;
  line?: StrokePaint;
  width?: number;
};

/** A short cylinder: coins, avatars, key caps and posts. */
export function cylinder({
  at: [x, y],
  r,
  z = 0,
  height = 4,
  top = "face",
  side = "side",
  line = "line",
  width = 2.5,
}: CylinderOptions): Shape[] {
  const [cx, cy] = project([x, y, z]);
  const a = Math.SQRT2 * UNIT * r;
  const b = (UNIT * r) / Math.SQRT2;
  const d = height * UNIT;
  const k = 0.5523;
  // Left top, down, the front half of the bottom ellipse, up, and the front
  // half of the top ellipse back to the start.
  const side_: Bezier = {
    v: [
      [cx - a, cy],
      [cx - a, cy + d],
      [cx, cy + d + b],
      [cx + a, cy + d],
      [cx + a, cy],
      [cx, cy + b],
    ],
    i: [
      [0, k * b],
      [0, 0],
      [-k * a, 0],
      [0, k * b],
      [0, 0],
      [k * a, 0],
    ],
    o: [
      [0, 0],
      [0, k * b],
      [k * a, 0],
      [0, 0],
      [0, k * b],
      [-k * a, 0],
    ],
    closed: true,
  };
  const stroke: Stroke = { paint: line, width };
  return [
    {
      type: "shape",
      name: "side",
      geometry: [path(side_)],
      fill: side,
      stroke,
    },
    {
      type: "shape",
      name: "top",
      geometry: [disc(x, y, r, z)],
      fill: top,
      stroke,
    },
  ];
}

// ---------------------------------------------------------------------------
// Lines and marks

export function line(
  geometry: Track<Bezier>,
  stroke: Stroke,
  extra: Partial<Pick<Shape, "trim" | "name">> = {},
): Shape {
  return { type: "shape", geometry: [path(geometry)], stroke, ...extra };
}

/** Text-like rows on a card, running along x. */
export function rows(
  x: number,
  y: number,
  z: number,
  lengths: readonly number[],
  gap = 6,
  paint: StrokePaint = "faint",
): Shape[] {
  return lengths.map((length, k) =>
    line(segment([x, y + k * gap, z], [x + length, y + k * gap, z]), {
      paint,
      width: 3,
    }),
  );
}

/**
 * A mark drawn flat on a horizontal plane in its own 2D frame, centered on a
 * world point, that can rotate within that plane: rotation happens in plane
 * coordinates, then the plane is foreshortened.
 */
export function flat(
  center: Vec3,
  children: Node[],
  spin?: Track<number>,
  transform?: Transform,
): Group {
  const c = project(center);
  // Foreshortening = scale(1, 1/2) · rotate(45°) · scale(√2 · UNIT).
  return group(
    [
      group([group(children, { offset: c })], {
        anchor: c,
        rotation: spinTrack(spin),
        scale: [Math.SQRT2 * UNIT * 100, Math.SQRT2 * UNIT * 100],
      }),
    ],
    { anchor: c, scale: [100, 50], ...transform },
  );
}

function spinTrack(spin: Track<number> | undefined): Track<number> {
  if (spin === undefined) return 45;
  if (typeof spin === "number") return spin + 45;
  return spin.map(([t, v, e]) => [t, v + 45, e] as const);
}

/** A 2D path for `flat`, in units around (0, 0). */
export function mark(
  points: readonly Vec2[],
  stroke: Stroke,
  closed = false,
  extra: Partial<Shape> = {},
): Shape {
  return {
    type: "shape",
    geometry: [
      {
        type: "path",
        path: {
          v: points.map((p) => [...p] as Vec2),
          i: points.map(() => [0, 0] as Vec2),
          o: points.map(() => [0, 0] as Vec2),
          closed,
        },
      },
    ],
    stroke,
    ...extra,
  };
}

/** A circular arc for `flat`, from angle a to b in degrees (clockwise). */
export function arcMark(
  r: number,
  a: number,
  b: number,
  stroke: Stroke,
  extra: Partial<Shape> = {},
): Shape {
  const pieces = Math.max(1, Math.ceil(Math.abs(b - a) / 45));
  const step = ((b - a) / pieces) * (Math.PI / 180);
  const v: Vec2[] = [];
  const i: Vec2[] = [];
  const o: Vec2[] = [];
  const h = (4 / 3) * Math.tan(step / 4) * r;
  for (let k = 0; k <= pieces; k += 1) {
    const t = a * (Math.PI / 180) + k * step;
    v.push([r * Math.cos(t), r * Math.sin(t)]);
    const tangent: Vec2 = [-Math.sin(t) * h, Math.cos(t) * h];
    i.push(k === 0 ? [0, 0] : [-tangent[0], -tangent[1]]);
    o.push(k === pieces ? [0, 0] : tangent);
  }
  return {
    type: "shape",
    geometry: [{ type: "path", path: { v, i, o, closed: false } }],
    stroke,
    ...extra,
  };
}
