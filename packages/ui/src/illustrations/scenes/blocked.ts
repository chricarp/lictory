// "Nothing blocked": the barrier in front of the document stays raised.
import {
  ease,
  group,
  type Composition,
  type Key,
} from "@lictory/ui/illustrations/lottie";
import { cylinder, project, slab } from "@lictory/ui/illustrations/iso";
import {
  card,
  dropIn,
  fadeIn,
  plate,
  rise,
} from "@lictory/ui/illustrations/kit";

const I = 60;
const R = 60;
const POST = 30;

const post = (y: number, t: number) =>
  group(cylinder({ at: [38, y], r: 3.5, z: POST, height: POST }), {
    anchor: project([38, y, 0]),
    scale: [
      [t, [100, 0], ease.out],
      [t + 20, [100, 100]],
    ],
    opacity: fadeIn(t, 6),
  });

// Height of the bar's underside above the plate.
const bar: Key<number>[] = [
  [30, POST + 18, ease.out],
  [50, POST - 6],
  [I + 4, POST - 6, ease.in],
  [I + 16, 6],
  [I + 18, 6, ease.out],
  [I + 22, 9, ease.in],
  [I + 26, 6],
  [I + 32, 6, ease.inOut],
  [I + 56, POST - 6],
];

export const scene: Composition = {
  name: "blocked",
  intro: I,
  react: R,
  children: [
    plate([
      group(card([-42, -36, 22, 30], { reveal: 22 }), dropIn(10, 16)),
      post(-22, 16),
      post(22, 22),
      group(
        slab({
          rect: [42.5, -28, 49.5, 28],
          radius: 3.5,
          z: 4.5,
          height: 4.5,
          top: "accentFace",
          line: "accent",
        }),
        { offset: rise(bar), opacity: fadeIn(30, 8) },
      ),
    ]),
  ],
};
