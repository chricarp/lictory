// Inbox: a tray with everything handled, and the last card checked off.
import {
  ease,
  group,
  type Composition,
  type Key,
} from "@lictory/ui/illustrations/lottie";
import {
  cylinder,
  extremes,
  flat,
  mark,
  outlineHalf,
  roundRect,
  segment,
  type Rect,
} from "@lictory/ui/illustrations/iso";
import {
  card,
  fadeIn,
  guidesAround,
  plate,
} from "@lictory/ui/illustrations/kit";
import { rise } from "@lictory/ui/illustrations/kit";

const I = 60;
const R = 56;
const WELL: Rect = [-38, -38, 38, 38];
const DEPTH = 6;
const CARD: Rect = [-28, -22, 24, 22];

const ends = extremes(WELL, 9);
const well = [
  {
    type: "shape" as const,
    geometry: [{ type: "path" as const, path: roundRect(WELL, 9, 0) }],
    fill: "side" as const,
  },
  {
    type: "shape" as const,
    geometry: [
      { type: "path" as const, path: outlineHalf(WELL, 9, -DEPTH, "back") },
      {
        type: "path" as const,
        path: segment(
          [ends.left[0], ends.left[1], 0],
          [ends.left[0], ends.left[1], -DEPTH],
        ),
      },
      {
        type: "path" as const,
        path: segment(
          [ends.right[0], ends.right[1], 0],
          [ends.right[0], ends.right[1], -DEPTH],
        ),
      },
    ],
    stroke: { paint: "faint" as const, width: 2 },
  },
  {
    type: "shape" as const,
    geometry: [{ type: "path" as const, path: roundRect(WELL, 9, 0) }],
    stroke: { paint: "line" as const, width: 2.5 },
  },
];

const height: Key<number>[] = [
  [16, 48, ease.out],
  [42, 20],
  [I, 20, ease.in],
  [I + 12, 4],
  [I + 14, 4, ease.back],
  [I + 40, 20],
];

const BADGE: [number, number] = [14, 10];
const check = mark(
  [
    [-3.5, 0.2],
    [-1, 2.8],
    [3.8, -2.6],
  ],
  { paint: "accent", width: 1.5 },
  false,
  {
    trim: {
      end: [
        [46, 0, ease.out],
        [58, 100],
        [I + 10, 100, ease.in],
        [I + 13, 0],
        [I + 22, 0, ease.out],
        [I + 38, 100],
      ],
    },
  },
);

const message = group(
  [
    ...card(CARD, { rows: [0.5, 0.8, 0.6] }),
    ...cylinder({
      at: BADGE,
      r: 7,
      z: 5,
      height: 2.5,
      top: "accentFace",
      line: "accent",
      width: 2,
    }),
    flat([BADGE[0], BADGE[1], 5], [check], -45),
  ],
  { offset: rise(height), opacity: fadeIn(16, 10) },
);

export const scene: Composition = {
  name: "inbox",
  intro: I,
  react: R,
  children: [
    plate([
      ...well,
      group(
        guidesAround(
          CARD,
          5,
          0,
          height.map(([t, z, e]) => [t, z, e] as const),
        ),
        { opacity: fadeIn(32, 10) },
      ),
      message,
    ]),
  ],
};
