"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";

import "./lictory-look.css";

// The site follows the visitor's light or dark preference by toggling `.dark`
// on <html> (see the appearance boot script). Scenes follow it too, so the
// product inside them matches the page around them.
function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

export function useSiteTheme(): "light" | "dark" {
  return useSyncExternalStore(
    subscribe,
    () =>
      document.documentElement.classList.contains("dark") ? "dark" : "light",
    () => "light",
  );
}

/**
 * The host for one illustrated scene: a figure the screen reader reads as one
 * image with its description, and a Replay button that remounts the scene at
 * its story boundary. Scenes are illustrations: nothing in them is a live
 * workspace, and they never call a service.
 */
export function SceneFrame({
  label,
  className,
  replay = true,
  children,
}: {
  /** What the scene shows, read as the image's description. */
  label: string;
  className?: string;
  replay?: boolean;
  children: (run: number) => ReactNode;
}) {
  const [run, setRun] = useState(0);
  return (
    <figure className={`scene${className ? ` ${className}` : ""}`}>
      <div role="img" aria-label={label} className="scene-stage">
        {children(run)}
      </div>
      {replay ? (
        <button
          type="button"
          className="scene-replay"
          onClick={() => setRun((value) => value + 1)}
        >
          <RotateCcw aria-hidden /> Replay
        </button>
      ) : null}
    </figure>
  );
}
