// Every state illustration, loaded on demand: a page pays only for the scenes
// it shows.
import type { Composition } from "@lictory/ui/illustrations/lottie";

export const illustrationScenes = {
  proposal: () => import("@lictory/ui/illustrations/scenes/proposal"),
  inbox: () => import("@lictory/ui/illustrations/scenes/inbox"),
  planning: () => import("@lictory/ui/illustrations/scenes/planning"),
  search: () => import("@lictory/ui/illustrations/scenes/search"),
  recovery: () => import("@lictory/ui/illustrations/scenes/recovery"),
  knowledge: () => import("@lictory/ui/illustrations/scenes/knowledge"),
  personalReview: () =>
    import("@lictory/ui/illustrations/scenes/personal-review"),
  teamReview: () => import("@lictory/ui/illustrations/scenes/team-review"),
  blocked: () => import("@lictory/ui/illustrations/scenes/blocked"),
  ready: () => import("@lictory/ui/illustrations/scenes/ready"),
  drafts: () => import("@lictory/ui/illustrations/scenes/drafts"),
  updated: () => import("@lictory/ui/illustrations/scenes/updated"),
} satisfies Record<string, () => Promise<{ scene: Composition }>>;

export type IllustrationKind = keyof typeof illustrationScenes;
