// "No reviews waiting for you": your reviewer coin over a settled document.
import { group, type Composition } from "@lictory/ui/illustrations/lottie";
import { card, dropIn, plate } from "@lictory/ui/illustrations/kit";
import { reviewer } from "@lictory/ui/illustrations/scenes/reviewers";

const I = 60;
const R = 50;

export const scene: Composition = {
  name: "personal-review",
  intro: I,
  react: R,
  children: [
    plate([
      group(card([-40, -38, 24, 26], { reveal: 24 }), dropIn(12, 16)),
      reviewer({
        at: [12, 14],
        r: 14,
        z: 22,
        base: 2.5,
        accent: true,
        t: 30,
        hop: I + 2,
      }),
    ]),
  ],
};
