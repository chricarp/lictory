"use client";

import { useEffect, useRef } from "react";
import { cn } from "@lictory/core/lib/utils";
import {
  illustrationScenes,
  type IllustrationKind,
} from "@lictory/ui/illustrations/catalog";

export type { IllustrationKind };

type Player = { react(): void };

/**
 * Decorative, theme-aware Lottie artwork for empty states and recoverable
 * errors; the adjacent heading and recovery action carry the meaning.
 *
 * The player and the scene load on demand. The scene assembles once, then
 * rests on a still frame (no work while idle) and reacts when hovered or
 * tapped. With reduced motion it shows the resting frame only. Paths carry
 * paint roles as classes that `styles.css` colors from the theme tokens, so
 * the artwork follows light, dark and every palette without reloading.
 * `data-state` reports loading, intro, rest, react or unavailable.
 */
export function StateIllustration({
  kind,
  className,
}: {
  kind: IllustrationKind;
  className?: string;
}) {
  const host = useRef<HTMLSpanElement>(null);
  const player = useRef<Player | null>(null);

  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let disposed = false;
    let destroy: (() => void) | undefined;
    const setState = (state: string) => {
      element.dataset.state = state;
    };
    setState("loading");
    Promise.all([
      import("lottie-web/build/player/lottie_light"),
      import("@lictory/ui/illustrations/lottie"),
      illustrationScenes[kind](),
    ])
      .then(([{ default: lottie }, { compose }, { scene }]) => {
        if (disposed) return;
        const animation = lottie.loadAnimation({
          container: element,
          renderer: "svg",
          loop: false,
          autoplay: false,
          // The player completes the data in place: each mount gets its own.
          animationData: compose(scene),
          rendererSettings: { preserveAspectRatio: "xMidYMid meet" },
        });
        destroy = () => animation.destroy();
        const rest = scene.intro;
        const still =
          typeof matchMedia === "function" &&
          matchMedia("(prefers-reduced-motion: reduce)").matches;
        animation.addEventListener("complete", () => setState("rest"));
        if (still) {
          animation.goToAndStop(rest, true);
          setState("rest");
        } else {
          setState("intro");
          animation.playSegments([0, rest], true);
        }
        player.current = {
          react() {
            if (still || element.dataset.state !== "rest") return;
            setState("react");
            animation.playSegments([rest, rest + scene.react], true);
          },
        };
      })
      // Artwork is decorative: when a chunk cannot load (offline, a deploy
      // replaced it), the space closes and the text and actions remain.
      .catch(() => {
        if (disposed) return;
        setState("unavailable");
        element.hidden = true;
      });
    return () => {
      disposed = true;
      player.current = null;
      destroy?.();
    };
  }, [kind]);

  // Hover (mouse, pen) or a tap or click replays the reaction.
  const react = () => player.current?.react();

  return (
    <span
      ref={host}
      aria-hidden="true"
      data-illustration={kind}
      onPointerEnter={react}
      onPointerDown={react}
      className={cn(
        "state-illustration mx-auto mb-5 block size-40 shrink-0",
        className,
      )}
    />
  );
}
