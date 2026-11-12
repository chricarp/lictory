// Reviewer coins shared by the personal and team review scenes.
import {
  ease,
  group,
  type Group,
  type Key,
} from "@lictory/ui/illustrations/lottie";
import { arcMark, cylinder, disc, flat } from "@lictory/ui/illustrations/iso";
import { fadeIn, guideTo, rise } from "@lictory/ui/illustrations/kit";

/** A floating avatar coin with a dashed guide down to the document. */
export function reviewer({
  at,
  r,
  z,
  base,
  accent,
  t,
  hop,
}: {
  at: [number, number];
  r: number;
  z: number;
  base: number;
  accent: boolean;
  /** Frame it drops in. */
  t: number;
  /** Frame its hop starts on hover. */
  hop: number;
}): Group {
  const height: Key<number>[] = [
    [t, z + 20, ease.out],
    [t + 22, z],
    [hop, z, ease.out],
    [hop + 12, z + 9, ease.in],
    [hop + 24, z, ease.out],
    [hop + 28, z - 1, ease.out],
    [hop + 34, z],
  ];
  const below = height.map(([f, h, e]) => [f, h - 3, e] as const);
  const d = r / Math.SQRT2;
  const ink = accent ? ("accent" as const) : ("line" as const);
  return group([
    group(
      [
        {
          type: "shape",
          geometry: [disc(at[0], at[1], r, base)],
          stroke: {
            paint: accent ? "accent" : "ghost",
            width: 1.6,
            dash: [4, 4],
          },
        },
      ],
      { opacity: fadeIn(t + 10, 10) },
    ),
    group(
      [
        guideTo(at[0] - d, at[1] + d, base, below),
        guideTo(at[0] + d, at[1] - d, base, below),
      ],
      { opacity: fadeIn(t + 14, 8) },
    ),
    group(
      [
        ...cylinder({
          at,
          r,
          z: 0,
          height: 3,
          top: accent ? "accentFace" : "face",
          line: ink,
        }),
        flat(
          [at[0], at[1], 0],
          [
            group([arcMark(r * 0.26, 0, 360, { paint: ink, width: 1.3 })], {
              offset: [0, -r * 0.12],
            }),
            group([arcMark(r * 0.5, 205, 335, { paint: ink, width: 1.3 })], {
              offset: [0, r * 0.62],
            }),
          ],
          -45,
        ),
      ],
      { offset: rise(height), opacity: fadeIn(t, 8) },
    ),
  ]);
}
