// Knowledge: a page lifted off a stack of pages.
import {
  ease,
  group,
  type Composition,
  type Key,
} from "@lictory/ui/illustrations/lottie";
import { roundRect, slab } from "@lictory/ui/illustrations/iso";
import {
  PLATE,
  card,
  fadeIn,
  guidesAround,
  plate,
  popIn,
  rise,
} from "@lictory/ui/illustrations/kit";

const I = 66;
const R = 56;
const Z = 22;
const HEIGHT = 5;

const height: Key<number>[] = [
  [20, Z + 30, ease.out],
  [46, Z],
  [I, Z, ease.out],
  [I + 16, Z + 10, ease.inOut],
  [I + 42, Z],
];

const layer = (z: number, t: number) =>
  group(slab({ rect: PLATE, radius: 12, z, height: 2.5 }), {
    opacity: fadeIn(t, 10),
  });

const squares = [-40, -28, -16, -4].map((x, k) => {
  const accent = k === 3;
  const rect = [x - 4.5, 26, x + 4.5, 35] as const;
  return group(
    [
      {
        type: "shape" as const,
        geometry: [{ type: "path" as const, path: roundRect(rect, 2.5, 0) }],
        fill: accent ? ("accentFace" as const) : ("face" as const),
        stroke: {
          paint: accent ? ("accent" as const) : ("line" as const),
          width: 2,
        },
      },
    ],
    {
      ...popIn([x, 30.5, 0], 44 + k * 3, 14),
      ...(accent && {
        scale: [
          [47, [0, 0], ease.back],
          [61, [100, 100]],
          [I + 16, [100, 100], ease.back],
          [I + 26, [135, 135], ease.inOut],
          [I + 42, [100, 100]],
        ],
      }),
    },
  );
});

const page = group(
  [
    ...slab({ rect: PLATE, radius: 12, z: 0, height: HEIGHT }),
    ...card([-42, -42, 26, 12], { z: 0, rows: [0.75, 0.9, 0.55], reveal: 34 }),
    ...squares,
  ],
  { offset: rise(height), opacity: fadeIn(20, 10) },
);

export const scene: Composition = {
  name: "knowledge",
  intro: I,
  react: R,
  children: [
    layer(-17, 4),
    layer(-12, 8),
    plate([
      group(
        guidesAround(
          PLATE,
          12,
          0,
          height.map(([t, z, e]) => [t, z - HEIGHT, e] as const),
        ),
        { opacity: fadeIn(36, 10) },
      ),
      page,
    ]),
  ],
};
