// "Recently updated": a line of revisions; the newest one pulses.
import {
  ease,
  group,
  type Composition,
} from "@lictory/ui/illustrations/lottie";
import {
  cylinder,
  disc,
  project,
  segment,
  slab,
} from "@lictory/ui/illustrations/iso";
import {
  card,
  fadeIn,
  plate,
  popIn,
  rise,
} from "@lictory/ui/illustrations/kit";

const I = 66;
const R = 60;
const Y = 30;
const NODES = [-40, -16, 8, 32];

const stack = [0, 1, 2].map((k) => {
  const z = k * 4;
  const rect = [-34 + k * 4, -46 + k * 4, 18 + k * 4, -4 + k * 4] as const;
  const shapes =
    k === 2
      ? card(rect, { z, rows: [0.7, 0.5], reveal: 30 })
      : slab({ rect, radius: 5, z: z + 2.5, height: 2.5 });
  const t = 10 + k * 6;
  return group(shapes, {
    offset: rise([
      [t, 14, ease.out],
      [t + 18, 0],
      ...(k === 2
        ? ([
            [I + 6, 0, ease.out],
            [I + 18, 8, ease.inOut],
            [I + 44, 0],
          ] as const)
        : []),
    ]),
    opacity: fadeIn(t, 8),
  });
});

const line = {
  type: "shape" as const,
  geometry: [
    {
      type: "path" as const,
      path: segment([NODES[0]!, Y, 0], [NODES.at(-1)!, Y, 0]),
    },
  ],
  stroke: { paint: "line" as const, width: 2.5 },
  trim: {
    end: [
      [20, 0, ease.out],
      [44, 100],
    ] as const,
  },
};

const nodes = NODES.map((x, k) => {
  const accent = k === NODES.length - 1;
  const t = 22 + k * 6;
  const hop = I + k * 5;
  return group(
    cylinder({
      at: [x, Y],
      r: accent ? 6 : 4.5,
      z: 3,
      height: 3,
      top: accent ? "accentFace" : "face",
      line: accent ? "accent" : "line",
      width: 2,
    }),
    {
      ...popIn([x, Y, 1], t, 14),
      offset: rise([
        [hop, 0, ease.out],
        [hop + 8, 3, ease.in],
        [hop + 18, 0],
      ]),
    },
  );
});

const last = NODES.at(-1)!;
const pulse = group(
  [
    {
      type: "shape",
      geometry: [disc(last, Y, 6, 0)],
      stroke: { paint: "accent", width: 2 },
    },
  ],
  {
    anchor: project([last, Y, 0]),
    scale: [
      [I + 18, [100, 100], ease.out],
      [I + 50, [320, 320], ease.linear],
      [I + 51, [100, 100]],
    ],
    opacity: [
      [I + 18, 0],
      [I + 20, 100],
      [I + 50, 0],
    ],
  },
);

export const scene: Composition = {
  name: "updated",
  intro: I,
  react: R,
  children: [plate([...stack, line, pulse, ...nodes])],
};
