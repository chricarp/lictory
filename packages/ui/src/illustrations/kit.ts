// Shared parts and timing for the state illustrations. Every scene stands on
// the same plate, keeps one accent object (the thing the state is about), plays
// a short intro that ends on its resting pose, and reacts to hover or tap with
// a segment that starts and ends on that same pose.

import {
  ease,
  group,
  type Bezier,
  type Group,
  type Key,
  type Shape,
  type StrokePaint,
  type Track,
  type Transform,
  type Vec2,
} from "@lictory/ui/illustrations/lottie";
import {
  extremes,
  lift,
  project,
  roundRect,
  rows,
  segment,
  slab,
  type Rect,
} from "@lictory/ui/illustrations/iso";

export const PLATE: Rect = [-56, -56, 56, 56];

/** The base every scene stands on; it rises into place first. */
export function plate(children: (Group | Shape | false)[] = []): Group {
  return group(
    [
      group(slab({ rect: PLATE, radius: 12, height: 7 }), {}, "plate"),
      ...children,
    ],
    {
      offset: [
        [0, lift(-6), ease.out],
        [20, [0, 0]],
      ],
      opacity: [
        [0, 0],
        [12, 100],
      ],
    },
  );
}

/** Faint grid lines across the plate's top face. */
export function grid(step = 16, inset = 8): Shape[] {
  const [x0, y0, x1, y1] = PLATE;
  const lines: Shape[] = [];
  for (let v = x0 + inset + step; v < x1 - inset; v += step) {
    lines.push(
      {
        type: "shape",
        geometry: [
          {
            type: "path",
            path: segment([v, y0 + inset, 0], [v, y1 - inset, 0]),
          },
        ],
        stroke: { paint: "faint", width: 1.6 },
      },
      {
        type: "shape",
        geometry: [
          {
            type: "path",
            path: segment([x0 + inset, v, 0], [x1 - inset, v, 0]),
          },
        ],
        stroke: { paint: "faint", width: 1.6 },
      },
    );
  }
  return lines;
}

/** A thin document card lying on a surface, with text rows. */
export function card(
  rect: Rect,
  {
    z = 0,
    rows: lengths = [0.55, 0.85, 0.7, 0.4],
    dashed = false,
    title = true,
    reveal,
  }: {
    z?: number;
    rows?: readonly number[];
    dashed?: boolean;
    title?: boolean;
    /** Frame at which the rows start writing themselves in. */
    reveal?: number;
  } = {},
): Shape[] {
  const [x0, y0, x1, y1] = rect;
  const top = z + 2.5;
  const body = dashed
    ? [
        {
          type: "shape" as const,
          geometry: [{ type: "path" as const, path: roundRect(rect, 5, z) }],
          stroke: { paint: "ghost" as const, width: 2, dash: [5, 4] as const },
        },
      ]
    : slab({ rect, radius: 5, z: top, height: 2.5 });
  const inset = 7;
  const width = x1 - x0 - inset * 2;
  const surface = dashed ? z : top;
  const lines = rows(
    x0 + inset,
    y0 + inset + (title ? 9 : 2),
    surface,
    lengths.map((l) => l * width),
    6,
  );
  const heading: Shape[] = title
    ? [
        {
          type: "shape" as const,
          geometry: [
            {
              type: "path" as const,
              path: segment(
                [x0 + inset, y0 + inset + 1, surface],
                [x0 + inset + width * 0.35, y0 + inset + 1, surface],
              ),
            },
          ],
          stroke: { paint: "line" as StrokePaint, width: 3.5 },
        },
      ]
    : [];
  const all = [...heading, ...lines];
  if (reveal !== undefined)
    all.forEach((shape, k) => {
      shape.trim = {
        end: [
          [reveal + k * 4, 0, ease.out],
          [reveal + k * 4 + 16, 100],
        ],
      };
    });
  void y1;
  return [...body, ...all];
}

// ---------------------------------------------------------------------------
// Timing

/** Height keyframes as screen offsets. */
export function rise(keys: readonly Key<number>[]): Track<Vec2> {
  return keys.map(([t, z, e]) => [t, lift(z), e] as const);
}

/** Drops in from `from` units above, fading in, landing at `t + duration`. */
export function dropIn(t: number, from = 18, duration = 22): Transform {
  return {
    offset: rise([
      [t, from, ease.out],
      [t + duration, 0],
    ]),
    opacity: [
      [t, 0],
      [t + duration * 0.5, 100],
    ],
  };
}

/** Grows from nothing about a world point. */
export function popIn(
  at: readonly [number, number, number],
  t: number,
  duration = 18,
): Transform {
  return {
    anchor: project(at),
    scale: [
      [t, [0, 0], ease.back],
      [t + duration, [100, 100]],
    ],
  };
}

export const fadeIn = (t: number, duration = 14): Track<number> => [
  [t, 0],
  [t + duration, 100],
];

/** A dashed vertical guide whose top follows a height track. */
export function guideTo(
  x: number,
  y: number,
  z0: number,
  top: Track<number>,
): Shape {
  const at = (z: number): Bezier => segment([x, y, z0], [x, y, z]);
  const path: Track<Bezier> = Array.isArray(top)
    ? (top as readonly Key<number>[]).map(([t, z, e]) => [t, at(z), e] as const)
    : at(top as number);
  return {
    type: "shape",
    name: "guide",
    geometry: [{ type: "path", path }],
    stroke: { paint: "ghost", width: 1.6, dash: [4, 4] },
  };
}

/** Guides at the left, right and front of a footprint, up to a height track. */
export function guidesAround(
  rect: Rect,
  r: number,
  z0: number,
  top: Track<number>,
  sides = ["left", "right", "front"] as const,
) {
  const points = extremes(rect, r);
  return sides.map((side) =>
    guideTo(points[side][0], points[side][1], z0, top),
  );
}
