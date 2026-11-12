// "Nothing needs review": the team's reviewer coins over a settled document.
import { group, type Composition } from "@lictory/ui/illustrations/lottie";
import { card, dropIn, plate } from "@lictory/ui/illustrations/kit";
import { reviewer } from "@lictory/ui/illustrations/scenes/reviewers";

const I = 66;
const R = 56;

export const scene: Composition = {
  name: "team-review",
  intro: I,
  react: R,
  children: [
    plate([
      group(card([-42, -40, 26, 28], { reveal: 24 }), dropIn(12, 16)),
      ...[-26, -2, 22].map((x, k) =>
        reviewer({
          at: [x, 16 - k * 2],
          r: 10,
          z: 18,
          base: 2.5,
          accent: k === 2,
          t: 28 + k * 6,
          hop: I + 2 + k * 7,
        }),
      ),
    ]),
  ],
};
