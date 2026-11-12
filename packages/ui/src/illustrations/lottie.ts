// A small writer for the subset of Lottie (bodymovin 5) the state
// illustrations use: one shape layer of nested groups, bezier paths and
// ellipses, fills, strokes (optionally dashed), trims and animated group
// transforms. Every fill and stroke carries a paint role as its Lottie class
// (`cl`); the illustration stylesheet colors roles from the theme tokens, and
// the default colors below only matter in a plain Lottie viewer.

export type Vec2 = readonly [number, number];

/** A cubic bezier easing, as in CSS `cubic-bezier(x1, y1, x2, y2)`. */
export type Ease = readonly [number, number, number, number];

export const ease = {
  standard: [0.2, 0, 0, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.5, 0, 0.75, 0],
  inOut: [0.65, 0, 0.35, 1],
  /** Overshoots its target slightly, then settles. */
  back: [0.34, 1.5, 0.64, 1],
  linear: [0, 0, 1, 1],
} as const satisfies Record<string, Ease>;

/** A keyframe: [frame, value, easing of the segment that starts here]. */
export type Key<T> = readonly [number, T, Ease?];

/** A static value or keyframes. Before the first and after the last keyframe
    the value holds. */
export type Track<T> = T | readonly Key<T>[];

export function isKeys<T>(track: Track<T>): track is readonly Key<T>[] {
  return Array.isArray(track) && Array.isArray(track[0]);
}

/** A track's value at a frame as a flat list of numbers, eased like the
    player eases it. Paths flatten to their vertices and tangents. */
export function sample(
  track: Track<number | Vec2 | Bezier>,
  frame: number,
): number[] {
  const flat = (v: number | Vec2 | Bezier): number[] =>
    typeof v === "number"
      ? [v]
      : "v" in v
        ? [...v.v, ...v.i, ...v.o].flat()
        : [...v];
  if (!isKeys(track)) return flat(track);
  const keys = track;
  if (frame <= keys[0]![0]) return flat(keys[0]![1]);
  for (let k = 0; k < keys.length - 1; k += 1) {
    const [t0, v0, e = ease.standard] = keys[k]!;
    const [t1, v1] = keys[k + 1]!;
    if (frame > t1) continue;
    const p = bezierProgress(e, (frame - t0) / (t1 - t0));
    const b = flat(v1);
    return flat(v0).map((a, index) => a + (b[index]! - a) * p);
  }
  return flat(keys.at(-1)![1]);
}

function bezierProgress([x1, y1, x2, y2]: Ease, x: number) {
  const at = (a: number, b: number, t: number) =>
    3 * a * t * (1 - t) ** 2 + 3 * b * t ** 2 * (1 - t) + t ** 3;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 30; i += 1) {
    const mid = (lo + hi) / 2;
    if (at(x1, x2, mid) < x) lo = mid;
    else hi = mid;
  }
  return at(y1, y2, (lo + hi) / 2);
}

// ---------------------------------------------------------------------------
// Paint roles

export const paints = {
  /** Lit top faces. */
  face: { kind: "fill", color: "#ffffff" },
  /** Sides and recesses. */
  side: { kind: "fill", color: "#f0f1f3" },
  /** Accent faces: the one thing the scene is about. */
  accentFace: { kind: "fill", color: "#e9edfb" },
  accentSolid: { kind: "fill", color: "#3b5bdb" },
  /** Outlines. */
  line: { kind: "stroke", color: "#c8cad0" },
  /** Text lines and grids. */
  faint: { kind: "stroke", color: "#e3e4e8" },
  /** Dashed placeholders: where something could be. */
  ghost: { kind: "stroke", color: "#cfd1d6" },
  accent: { kind: "stroke", color: "#3b5bdb" },
  /** Strokes drawn in the face color, to cut a mark out of an accent fill. */
  knockout: { kind: "stroke", color: "#ffffff" },
} as const;

export type Paint = keyof typeof paints;
export type FillPaint = {
  [P in Paint]: (typeof paints)[P]["kind"] extends "fill" ? P : never;
}[Paint];
export type StrokePaint = Exclude<Paint, FillPaint>;

export const paintClass = (paint: Paint) =>
  `illo-${paint.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`;

// ---------------------------------------------------------------------------
// Scene graph

export type Bezier = {
  /** Vertices. */
  v: Vec2[];
  /** In and out tangents, relative to their vertex. */
  i: Vec2[];
  o: Vec2[];
  closed: boolean;
};

export type Geometry =
  | { type: "path"; path: Track<Bezier> }
  | { type: "ellipse"; center: Vec2; size: Track<Vec2> };

export type Stroke = {
  paint: StrokePaint;
  width?: number;
  dash?: readonly [number, number];
  /** Animated dash offset, for marching dashes. */
  dashOffset?: Track<number>;
  opacity?: Track<number>;
};

export type Shape = {
  type: "shape";
  name?: string;
  geometry: Geometry[];
  fill?: FillPaint;
  fillOpacity?: Track<number>;
  stroke?: Stroke;
  /** Draws the path progressively; 0..100 percent of its length. */
  trim?: { start?: Track<number>; end?: Track<number> };
};

export type Transform = {
  /** Pivot for scale and rotation, in parent coordinates. */
  anchor?: Vec2;
  /** Translation applied after scaling and rotation about `anchor`. */
  offset?: Track<Vec2>;
  scale?: Track<Vec2>;
  rotation?: Track<number>;
  opacity?: Track<number>;
};

export type Group = {
  type: "group";
  name?: string;
  children: Node[];
  transform?: Transform;
};

export type Node = Shape | Group;

export const group = (
  children: (Node | false | null | undefined)[],
  transform?: Transform,
  name?: string,
): Group => ({
  type: "group",
  name,
  children: children.filter(Boolean) as Node[],
  transform,
});

// ---------------------------------------------------------------------------
// Composition

export const FPS = 60;
export const SIZE = 400;

export type Composition = {
  name: string;
  /** Frames 0..intro play once on mount and end on the resting pose. */
  intro: number;
  /** Frames intro..intro+react play on hover or tap and return to rest. */
  react: number;
  /** Back to front. */
  children: Node[];
};

export type LottieAnimation = {
  v: string;
  fr: number;
  ip: number;
  op: number;
  w: number;
  h: number;
  nm: string;
  ddd: 0;
  assets: [];
  layers: unknown[];
  markers: { tm: number; cm: string; dr: number }[];
};

export function compose(scene: Composition): LottieAnimation {
  const op = scene.intro + scene.react;
  return {
    v: "5.7.4",
    fr: FPS,
    ip: 0,
    op,
    w: SIZE,
    h: SIZE,
    nm: scene.name,
    ddd: 0,
    assets: [],
    layers: [
      {
        ddd: 0,
        ind: 1,
        ty: 4,
        nm: scene.name,
        sr: 1,
        ks: {
          o: still(100),
          r: still(0),
          p: still([0, 0, 0]),
          a: still([0, 0, 0]),
          s: still([100, 100, 100]),
        },
        ao: 0,
        shapes: [...scene.children].reverse().map(writeNode),
        ip: 0,
        op,
        st: 0,
        bm: 0,
      },
    ],
    markers: [
      { tm: 0, cm: "intro", dr: scene.intro },
      { tm: scene.intro, cm: "react", dr: scene.react },
    ],
  };
}

const still = <T>(k: T) => ({ a: 0, k });

const round = (n: number) => Math.round(n * 100) / 100;

function value(v: number | Vec2): number[] {
  return typeof v === "number" ? [round(v)] : v.map(round);
}

function prop<T extends number | Vec2>(
  track: Track<T>,
  map: (v: T) => unknown = (v) => (typeof v === "number" ? round(v) : value(v)),
) {
  if (!isKeys(track)) return still(map(track));
  const keys = track;
  return {
    a: 1,
    k: keys.map(([t, v, e = ease.standard], index) =>
      index === keys.length - 1
        ? { t, s: [map(v)].flat() }
        : {
            t,
            s: [map(v)].flat(),
            o: { x: [e[0]], y: [e[1]] },
            i: { x: [e[2]], y: [e[3]] },
          },
    ),
  };
}

function bezier(b: Bezier) {
  return {
    i: b.i.map(value),
    o: b.o.map(value),
    v: b.v.map(value),
    c: b.closed,
  };
}

function color(paint: Paint) {
  const hex = paints[paint].color;
  return [1, 3, 5]
    .map((at) => round(parseInt(hex.slice(at, at + 2), 16) / 255))
    .concat(1);
}

function writeGeometry(geometry: Geometry) {
  if (geometry.type === "ellipse")
    return {
      ty: "el",
      d: 1,
      p: still(value(geometry.center)),
      s: prop(geometry.size),
    };
  const track = geometry.path;
  if (!isKeys(track)) return { ty: "sh", ks: still(bezier(track)) };
  const keys = track;
  return {
    ty: "sh",
    ks: {
      a: 1,
      k: keys.map(([t, b, e = ease.standard], index) =>
        index === keys.length - 1
          ? { t, s: [bezier(b)] }
          : {
              t,
              s: [bezier(b)],
              o: { x: [e[0]], y: [e[1]] },
              i: { x: [e[2]], y: [e[3]] },
            },
      ),
    },
  };
}

function transform(t: Transform = {}) {
  const anchor = t.anchor ?? [0, 0];
  const offset = t.offset ?? [0, 0];
  return {
    ty: "tr",
    a: still(value(anchor)),
    p: prop(offset, (v) => [round(v[0] + anchor[0]), round(v[1] + anchor[1])]),
    s: prop(t.scale ?? [100, 100]),
    r: prop(t.rotation ?? 0),
    o: prop(t.opacity ?? 100),
    sk: still(0),
    sa: still(0),
  };
}

function writeNode(node: Node): unknown {
  if (node.type === "group")
    return {
      ty: "gr",
      nm: node.name ?? "group",
      it: [
        ...[...node.children].reverse().map(writeNode),
        transform(node.transform),
      ],
    };
  const items: unknown[] = node.geometry.map(writeGeometry);
  if (node.trim)
    items.push({
      ty: "tm",
      s: prop(node.trim.start ?? 0),
      e: prop(node.trim.end ?? 100),
      o: still(0),
      m: 1,
    });
  // Styles paint every path above them in the group; the stroke goes first so
  // it sits on top of the fill.
  if (node.stroke) {
    const {
      paint,
      width = 2.5,
      dash,
      dashOffset = 0,
      opacity = 100,
    } = node.stroke;
    items.push({
      ty: "st",
      cl: paintClass(paint),
      c: still(color(paint)),
      o: prop(opacity),
      w: still(width),
      lc: 2,
      lj: 2,
      ...(dash && {
        d: [
          { n: "d", nm: "dash", v: still(dash[0]) },
          { n: "g", nm: "gap", v: still(dash[1]) },
          { n: "o", nm: "offset", v: prop(dashOffset) },
        ],
      }),
    });
  }
  if (node.fill)
    items.push({
      ty: "fl",
      cl: paintClass(node.fill),
      c: still(color(node.fill)),
      o: prop(node.fillOpacity ?? 100),
      r: 1,
    });
  return { ty: "gr", nm: node.name ?? "shape", it: [...items, transform()] };
}
