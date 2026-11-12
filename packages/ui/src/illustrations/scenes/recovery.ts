// Recoverable errors: a retry key lifted out of its socket, pressed on hover.
import {
  ease,
  group,
  type Composition,
  type Vec2,
} from "@lictory/ui/illustrations/lottie";
import {
  arcMark,
  cylinder,
  disc,
  flat,
  mark,
} from "@lictory/ui/illustrations/iso";
import {
  dropIn,
  guideTo,
  plate,
  popIn,
  rise,
} from "@lictory/ui/illustrations/kit";

const I = 60;
const R = 60;
const KEY = 12.5;

function key(x: number, y: number, t: number, ripple: number) {
  return group(
    [
      ...cylinder({ at: [x, y], r: KEY, z: 4, height: 4 }),
      flat(
        [x, y, 4],
        [
          mark(
            [
              [-4, 0],
              [4, 0],
            ],
            { paint: "line", width: 1.4 },
          ),
        ],
      ),
    ],
    {
      ...dropIn(t, 10, 18),
      offset: rise([
        [t, 10, ease.out],
        [t + 18, 0],
        [I + ripple, 0, ease.out],
        [I + ripple + 6, -1.5, ease.back],
        [I + ripple + 24, 0],
      ]),
    },
    "key",
  );
}

// The accent key: its height over the plate through the intro and a press.
const top = [
  [26, 44, ease.out],
  [48, 20],
  [I, 20, ease.in],
  [I + 9, 9],
  [I + 13, 9, ease.back],
  [I + 36, 20],
] as const;
const below = top.map(([t, z, e]) => [t, z - 4.5, e] as const);
const C: [number, number] = [4, 4];
const d = KEY / Math.SQRT2;

// A clockwise retry arrow.
const end = 210;
const rad = (end * Math.PI) / 180;
const tip: Vec2 = [
  5 * Math.cos(rad) - 1.4 * Math.sin(rad),
  5 * Math.sin(rad) + 1.4 * Math.cos(rad),
];
const T: Vec2 = [-Math.sin(rad), Math.cos(rad)];
const N: Vec2 = [Math.cos(rad), Math.sin(rad)];
const head = [
  [tip[0] - 3 * T[0] + 2.4 * N[0], tip[1] - 3 * T[1] + 2.4 * N[1]],
  tip,
  [tip[0] - 3 * T[0] - 2.4 * N[0], tip[1] - 3 * T[1] - 2.4 * N[1]],
] as Vec2[];

const retry = group(
  [
    ...cylinder({
      at: C,
      r: KEY,
      z: 0,
      height: 4.5,
      top: "accentFace",
      line: "accent",
    }),
    flat(
      [C[0], C[1], 0],
      [
        arcMark(5, -60, end, { paint: "accent", width: 1.5 }),
        mark(head, { paint: "accent", width: 1.5 }),
      ],
      [
        [30, -200, ease.out],
        [58, 0],
        [I + 6, 0, ease.inOut],
        [I + 44, 360],
      ],
    ),
  ],
  {
    offset: rise(top),
    opacity: [
      [26, 0],
      [36, 100],
    ],
  },
);

export const scene: Composition = {
  name: "recovery",
  intro: I,
  react: R,
  children: [
    plate([
      key(-24, -24, 12, 4),
      key(-22, 22, 16, 8),
      key(22, -22, 20, 12),
      group(
        [
          {
            type: "shape",
            geometry: [disc(...C, KEY, 0)],
            stroke: { paint: "accent", width: 2.5 },
          },
        ],
        popIn([C[0], C[1], 0], 24),
      ),
      group(
        [
          guideTo(C[0] - d, C[1] + d, 0, below),
          guideTo(C[0] + d, C[1] - d, 0, below),
        ],
        {
          opacity: [
            [34, 0],
            [46, 100],
          ],
        },
      ),
      retry,
    ]),
  ],
};
