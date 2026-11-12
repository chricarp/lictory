// Plans and boards: tiles waiting for work, with dashed room to grow.
import {
  ease,
  group,
  type Composition,
  type Key,
} from "@lictory/ui/illustrations/lottie";
import { roundRect, slab } from "@lictory/ui/illustrations/iso";
import {
  fadeIn,
  grid,
  guidesAround,
  plate,
  popIn,
  rise,
} from "@lictory/ui/illustrations/kit";

const I = 66;
const R = 60;
const Y = 4;
const TILE = 6.5;

function column(x: number, height: number, k: number) {
  const rect = [x - TILE, Y - TILE, x + TILE, Y + TILE] as const;
  const t = 18 + k * 5;
  const grow = 26 + k * 4;
  const wave = I + k * 5;
  const top: Key<number>[] = [
    [grow, 2.5, ease.out],
    [grow + 22, height],
    [wave, height, ease.out],
    [wave + 12, height + 10, ease.inOut],
    [wave + 32, height],
  ];
  return group([
    group(slab({ rect, radius: 2.5, height: 2.5, z: 2.5 }), {
      offset: rise([
        [t, 10, ease.out],
        [t + 16, 0],
      ]),
      opacity: fadeIn(t, 8),
    }),
    group(
      [
        ...guidesAround(rect, 2.5, 2.5, top),
        group(
          [
            {
              type: "shape",
              geometry: [{ type: "path", path: roundRect(rect, 2.5, 0) }],
              stroke: { paint: "ghost", width: 1.6, dash: [4, 4] },
            },
          ],
          { offset: rise(top) },
        ),
      ],
      { opacity: fadeIn(grow, 10) },
    ),
  ]);
}

const X = 46;
const accent = group(
  slab({
    rect: [X - TILE, Y - TILE, X + TILE, Y + TILE],
    radius: 2.5,
    height: 2.5,
    z: 2.5,
    top: "accentFace",
    line: "accent",
  }),
  {
    ...popIn([X, Y, 2], 44),
    offset: rise([
      [I + 16, 0, ease.out],
      [I + 28, 10, ease.in],
      [I + 40, 0, ease.out],
      [I + 46, 1.5, ease.in],
      [I + 52, 0],
    ]),
  },
);

export const scene: Composition = {
  name: "planning",
  intro: I,
  react: R,
  children: [
    plate([
      group(grid(), { opacity: fadeIn(10, 16) }),
      column(-38, 26, 0),
      column(-17, 36, 1),
      column(4, 20, 2),
      column(25, 30, 3),
      accent,
    ]),
  ],
};
