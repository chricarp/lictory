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
    let unwatch: (() => void) | undefined;
    const setState = (state: string) => {
      element.dataset.state = state;
    };
    setState("loading");
    // A previous kind may have failed to load and closed the space.
    element.style.display = "";
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
        // Read live: the preference can change while the page stays open.
        const query =
          typeof matchMedia === "function"
            ? matchMedia("(prefers-reduced-motion: reduce)")
            : undefined;
        const settle = () => {
          animation.goToAndStop(rest, true);
          setState("rest");
        };
        animation.addEventListener("complete", () => setState("rest"));
        if (query?.matches) settle();
        else {
          setState("intro");
          animation.playSegments([0, rest], true);
        }
        // Turning reduced motion on stops what is playing at the resting
        // frame; turning it off allows reactions again.
        const onPreference = () => {
          if (query?.matches) settle();
        };
        query?.addEventListener("change", onPreference);
        unwatch = () => query?.removeEventListener("change", onPreference);
        player.current = {
          react() {
            if (query?.matches || element.dataset.state !== "rest") return;
            setState("react");
            animation.playSegments([rest, rest + scene.react], true);
          },
        };
      })
      // Artwork is decorative: when a chunk cannot load (offline, a deploy
      // replaced it), the space closes and the text and actions remain. An
      // inline style closes it even where the page sets its own `display`
      // and no shared stylesheet applies (the last-resort error pages).
      .catch(() => {
        if (disposed) return;
        setState("unavailable");
        element.style.display = "none";
      });
    return () => {
      disposed = true;
      player.current = null;
      unwatch?.();
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
