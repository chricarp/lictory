// Search and missing resources: a magnifier sweeps over empty slots.
import {
  ease,
  group,
  type Composition,
  type Shape,
  type Track,
  type Vec2,
} from "@lictory/ui/illustrations/lottie";
import {
  arcMark,
  cylinder,
  disc,
  flat,
  roundRect,
  shift,
  slab,
} from "@lictory/ui/illustrations/iso";
import {
  fadeIn,
  guideTo,
  plate,
  popIn,
  rise,
} from "@lictory/ui/illustrations/kit";

const I = 60;
const R = 64;
const LENS = 21;
const Z = 26;

const slots: Shape[] = [];
for (const x of [-30, 0, 30])
  for (const y of [-30, 0, 30]) {
    const t = 10 + ((x + y) / 30 + 2) * 4;
    slots.push({
      type: "shape",
      geometry: [
        {
          type: "path",
          path: roundRect([x - 11, y - 11, x + 11, y + 11], 5, 0),
        },
      ],
      stroke: { paint: "ghost", width: 2, dash: [5, 4], opacity: fadeIn(t) },
    });
  }

// The lens visits two neighbouring slots and comes back.
const path: [number, number, number][] = [
  [I, 0, 0],
  [I + 20, -30, 0],
  [I + 40, 0, -30],
  [I + 58, 0, 0],
];
const travel: Track<Vec2> = path.map(
  ([t, x, y]) => [t, shift([x, y, 0]), ease.inOut] as const,
);
const bob = rise([
  [I, 0, ease.inOut],
  [I + 10, 4, ease.inOut],
  [I + 20, 0, ease.inOut],
  [I + 30, 4, ease.inOut],
  [I + 40, 0, ease.inOut],
  [I + 49, 4, ease.inOut],
  [I + 58, 0],
]);

const spotlight = group(
  [
    {
      type: "shape",
      geometry: [disc(0, 0, LENS - 2, 0)],
      fill: "accentFace",
      fillOpacity: 70,
      stroke: { paint: "accent", width: 2.5 },
    },
  ],
  { ...popIn([0, 0, 0], 36), offset: travel },
);

const d = LENS / Math.SQRT2;
const magnifier = group(
  [
    group(
      [
        guideTo(-d, d, 0, [
          [22, Z + 20, ease.out],
          [46, Z - 3.5],
        ]),
        guideTo(d, -d, 0, [
          [22, Z + 20, ease.out],
          [46, Z - 3.5],
        ]),
      ],
      { opacity: fadeIn(34) },
    ),
    group(
      [
        ...slab({
          rect: [LENS - 3, -3.5, LENS + 22, 3.5],
          radius: 3.5,
          z: Z,
          height: 3.5,
        }),
        ...cylinder({ at: [0, 0], r: LENS, z: Z, height: 3.5 }),
        {
          type: "shape",
          geometry: [disc(0, 0, LENS - 4.5, Z)],
          fill: "side",
          stroke: { paint: "line", width: 2 },
        },
        flat(
          [0, 0, Z],
          [arcMark(LENS - 8, 200, 250, { paint: "knockout", width: 1.6 })],
        ),
      ],
      {
        offset: rise([
          [22, 20, ease.out],
          [46, 0],
        ]),
        opacity: fadeIn(22, 10),
      },
    ),
  ],
  { offset: travel },
);
const lensBob = group([magnifier], { offset: bob });

export const scene: Composition = {
  name: "search",
  intro: I,
  react: R,
  children: [plate([spotlight, group(slots), lensBob])],
};
