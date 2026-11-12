// "Ready for delivery": every check on the document passes.
import {
  ease,
  group,
  type Composition,
} from "@lictory/ui/illustrations/lottie";
import { cylinder, flat, mark, rows } from "@lictory/ui/illustrations/iso";
import { dropIn, plate, popIn, rise } from "@lictory/ui/illustrations/kit";
import { slab } from "@lictory/ui/illustrations/iso";

const I = 70;
const R = 56;
const RECT = [-40, -38, 32, 36] as const;
const TOP = 2.5;

const checks = [-20, -2, 16].map((y, k) => {
  const x = -27;
  const t = 30 + k * 7;
  const tick = I + k * 8;
  const check = mark(
    [
      [-2.6, 0.1],
      [-0.7, 2],
      [2.8, -1.9],
    ],
    { paint: "accent", width: 1.3 },
    false,
    {
      trim: {
        end: [
          [t + 6, 0, ease.out],
          [t + 18, 100],
          [tick, 100, ease.in],
          [tick + 5, 0],
          [tick + 8, 0, ease.out],
          [tick + 22, 100],
        ],
      },
    },
  );
  return group([
    group(
      [
        ...cylinder({
          at: [x, y],
          r: 5,
          z: TOP + 2,
          height: 2,
          top: "accentFace",
          line: "accent",
          width: 2,
        }),
        flat([x, y, TOP + 2], [check], -45),
      ],
      {
        ...popIn([x, y, TOP], t, 14),
        offset: rise([
          [tick + 5, 0, ease.out],
          [tick + 10, 3, ease.in],
          [tick + 18, 0],
        ]),
      },
    ),
    ...rows(-17, y, TOP, [[34, 44, 28][k]!], 6, "faint").map((row) => ({
      ...row,
      trim: {
        end: [
          [t + 4, 0, ease.out],
          [t + 20, 100],
        ] as const,
      },
    })),
  ]);
});

const title = rows(RECT[0] + 7, RECT[1] + 8, TOP, [24], 6, "line").map(
  (row) => ({
    ...row,
    stroke: { paint: "line" as const, width: 3.5 },
  }),
);

export const scene: Composition = {
  name: "ready",
  intro: I,
  react: R,
  children: [
    plate([
      group(
        [
          ...slab({ rect: RECT, radius: 5, z: TOP, height: 2.5 }),
          ...title,
          ...checks,
        ],
        {
          ...dropIn(12, 16),
          offset: rise([
            [12, 16, ease.out],
            [34, 0],
            [I, 0, ease.inOut],
            [I + 14, 2, ease.inOut],
            [I + 40, 0],
          ]),
        },
      ),
    ]),
  ],
};
