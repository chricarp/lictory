// Drafts: an outline still being written, with a caret at the end of a line.
import {
  ease,
  group,
  type Composition,
  type Key,
} from "@lictory/ui/illustrations/lottie";
import { cylinder, shift } from "@lictory/ui/illustrations/iso";
import { card, plate, popIn } from "@lictory/ui/illustrations/kit";

const I = 60;
const R = 64;
const RECT = [-42, -36, 32, 34] as const;
const shapes = card(RECT, {
  dashed: true,
  rows: [0.6, 0.85, 0.7, 0.45],
  reveal: 22,
});
const [outline, ...text] = shapes;
outline!.trim = {
  end: [
    [6, 0, ease.out],
    [34, 100],
  ],
};

// The last row is the one being written; the caret follows its end.
const last = text.at(-1)!;
const length = (RECT[2] - RECT[0] - 14) * 0.45;
const writing: Key<number>[] = [
  [I, 100, ease.in],
  [I + 8, 25],
  [I + 12, 25, ease.inOut],
  [I + 44, 100],
];
last.trim = {
  end: [
    [22 + (text.length - 1) * 4, 0, ease.out],
    [22 + (text.length - 1) * 4 + 16, 100],
    ...writing,
  ],
};

const x = RECT[0] + 7 + length + 3;
const y = RECT[1] + 7 + 9 + (text.length - 2) * 6;
const caret = group(
  [
    ...cylinder({
      at: [x, y],
      r: 1.8,
      z: 8,
      height: 8,
      top: "accentSolid",
      side: "accentSolid",
      line: "accent",
      width: 1.5,
    }),
  ],
  {
    ...popIn([x, y, 0], 40, 14),
    offset: writing.map(
      ([t, p, e]) => [t, shift([((p - 100) / 100) * length, 0, 0]), e] as const,
    ),
    opacity: [
      [I + 46, 100],
      [I + 47, 0],
      [I + 52, 0],
      [I + 53, 100],
    ],
  },
);

export const scene: Composition = {
  name: "drafts",
  intro: I,
  react: R,
  children: [plate([outline!, ...text, caret])],
};
