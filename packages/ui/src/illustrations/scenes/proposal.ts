// "Start with a proposal": a document and a key that adds another.
import {
  ease,
  group,
  type Composition,
} from "@lictory/ui/illustrations/lottie";
import { cylinder, flat, mark, roundRect } from "@lictory/ui/illustrations/iso";
import {
  card,
  dropIn,
  popIn,
  plate,
  rise,
} from "@lictory/ui/illustrations/kit";

const I = 60;
const R = 56;
const CARD = [-40, -34, 20, 22] as const;
const KEY: [number, number] = [34, 30];

const document = group(card(CARD, { reveal: 24 }), dropIn(12, 16));

// A dashed copy of the document lifts off it while the key is pressed.
const ghost = group(
  [
    {
      type: "shape",
      geometry: [{ type: "path", path: roundRect(CARD, 5, 2.5) }],
      stroke: { paint: "ghost", width: 2, dash: [5, 4] },
    },
  ],
  {
    offset: rise([
      [I + 6, 2, ease.out],
      [I + 40, 22],
      // Back into place once it has faded out.
      [I + 46, 22, ease.linear],
      [I + 47, 2],
    ]),
    opacity: [
      [I + 6, 0],
      [I + 14, 100],
      [I + 30, 100],
      [I + 44, 0],
    ],
  },
);

const press = rise([
  [I, 0, ease.in],
  [I + 8, -3],
  [I + 10, -3, ease.back],
  [I + 28, 0],
]);

const plus = group(
  [
    ...cylinder({
      at: KEY,
      r: 12,
      z: 6,
      height: 6,
      top: "accentFace",
      line: "accent",
    }),
    flat(
      [KEY[0], KEY[1], 6],
      [
        mark(
          [
            [-4.5, 0],
            [4.5, 0],
          ],
          { paint: "accent", width: 1.6 },
        ),
        mark(
          [
            [0, -4.5],
            [0, 4.5],
          ],
          { paint: "accent", width: 1.6 },
        ),
      ],
      [
        [34, -135, ease.back],
        [52, -45],
        [I + 6, -45, ease.inOut],
        [I + 36, 315],
      ],
    ),
  ],
  { ...popIn([KEY[0], KEY[1], 3], 34, 20), offset: press },
);

export const scene: Composition = {
  name: "proposal",
  intro: I,
  react: R,
  children: [plate([document, ghost, plus])],
};
