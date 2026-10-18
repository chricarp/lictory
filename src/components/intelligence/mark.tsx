"use client";

import { useEffect, useId, useRef, useState, type CSSProperties } from "react";
import { cn } from "~/lib/utils";

// Lictory Intelligence's face: the Lictory block, softened, with two eyes.
// It is one inline SVG drawn in currentColor, so it scales and themes like an
// icon, and its expression is driven by props and CSS (see globals.css):
//
//   idle       blinks now and then, perks up when its control is hovered
//   working    reads along under a twinkling spark while it elaborates
//   asking     tilts its head at a question mark while it waits for you
//   listening  wide-eyed and breathing while the person talks or types
//   happy      ^ ^ after something finished well
//   concerned  > < after a failure
//   sleeping   eyes closed while Lictory Intelligence is off or unavailable
//
// Without a mood the face is still, which suits lists, avatars and menus.
// Each mood holds for a moment before the next one shows, so quick changes
// in what drives it never make the face flicker.
export type IntelligenceMood =
  | "idle"
  | "working"
  | "asking"
  | "listening"
  | "happy"
  | "concerned"
  | "sleeping";

// Where the eyes look: x and y from -1 to 1, or toward the pointer.
export type IntelligenceGaze = { x: number; y: number } | "pointer";

// A pointy-top hexagon with heavily rounded corners: the isometric silhouette
// of the Lictory logomark, soft enough to read as a character.
const BODY =
  "M7.44 2.93Q12 .3 16.56 2.93L17.57 3.52Q22.13 6.15 22.13 11.41L22.13 12.59Q22.13 17.85 17.57 20.48L16.56 21.07Q12 23.7 7.44 21.07L6.43 20.48Q1.87 17.85 1.87 12.59L1.87 11.41Q1.87 6.15 6.43 3.52Z";

export function IntelligenceMark({
  className,
  mood,
  gaze,
}: {
  className?: string;
  mood?: IntelligenceMood;
  gaze?: IntelligenceGaze;
}) {
  const ref = useRef<SVGSVGElement>(null);
  const shown = useSteady(mood);
  const reactId = useId();
  const id = `im-${reactId.replace(/[^\w-]/g, "")}`;
  usePointerGaze(ref, gaze === "pointer");
  const style = {
    // Instances blink out of step with each other.
    "--im-delay": `-${(hash(id) % 50) / 10}s`,
    ...(gaze && gaze !== "pointer"
      ? { "--im-gx": clamp(gaze.x), "--im-gy": clamp(gaze.y) }
      : {}),
  } as CSSProperties;
  return (
    <svg
      ref={ref}
      aria-hidden="true"
      focusable="false"
      viewBox="0 0 24 24"
      data-mood={shown}
      style={style}
      className={cn("intelligence-mark size-4 shrink-0", className)}
    >
      <defs>
        <mask
          id={id}
          maskUnits="userSpaceOnUse"
          x="-4"
          y="-4"
          width="32"
          height="32"
        >
          <g className="im-body">
            <path d={BODY} fill="#fff" />
            <g className="im-look">
              <g className="im-face">
                <g className="im-eyes" fill="#000">
                  <rect
                    className="im-eye"
                    x="6.4"
                    y="9.2"
                    width="2.6"
                    height="5.2"
                    rx="1.3"
                  />
                  <rect
                    className="im-eye"
                    x="15"
                    y="9.2"
                    width="2.6"
                    height="5.2"
                    rx="1.3"
                  />
                </g>
                <path
                  className="im-happy"
                  d="M5.9 12.9Q7.7 9.4 9.5 12.9M14.5 12.9Q16.3 9.4 18.1 12.9"
                  fill="none"
                  stroke="#000"
                  strokeWidth="2.2"
                  strokeLinecap="round"
                />
                <path
                  className="im-oops"
                  d="M6.6 10.3 9.2 12.1 6.6 13.9M17.4 10.3 14.8 12.1 17.4 13.9"
                  fill="none"
                  stroke="#000"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  className="im-closed"
                  d="M6 12.6Q7.7 14.4 9.4 12.6M14.6 12.6Q16.3 14.4 18 12.6"
                  fill="none"
                  stroke="#000"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </g>
            </g>
            {shown && <Props />}
          </g>
        </mask>
      </defs>
      <rect
        x="-4"
        y="-4"
        width="32"
        height="32"
        fill="currentColor"
        mask={`url(#${id})`}
      />
    </svg>
  );
}

type Part = { d: string; width?: number; fill?: boolean };

const circle = (cx: number, cy: number, r: number) =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;

// A prop drawn like a sticker: a cut-out outline separates it from the body
// it overlaps, so it reads in one color at any size.
function Sticker({ parts, className }: { parts: Part[]; className: string }) {
  const common = {
    strokeLinecap: "round",
    strokeLinejoin: "round",
  } as const;
  return (
    <g className={`im-prop ${className}`}>
      <g className="im-prop-motion">
        {parts.map((p, i) => (
          <path
            key={`cut${i}`}
            d={p.d}
            fill={p.fill ? "#000" : "none"}
            stroke="#000"
            strokeWidth={(p.width ?? 0) + 2.4}
            {...common}
          />
        ))}
        {parts.map((p, i) => (
          <path
            key={i}
            d={p.d}
            fill={p.fill ? "#fff" : "none"}
            stroke={p.width ? "#fff" : "none"}
            strokeWidth={p.width}
            {...common}
          />
        ))}
      </g>
    </g>
  );
}

const SPARK = (x: number, y: number, r: number) =>
  `M${x} ${y - r}Q${x + r * 0.15} ${y - r * 0.15} ${x + r} ${y}Q${x + r * 0.15} ${y + r * 0.15} ${x} ${y + r}Q${x - r * 0.15} ${y + r * 0.15} ${x - r} ${y}Q${x - r * 0.15} ${y - r * 0.15} ${x} ${y - r}Z`;

// What it holds up: a spark while it works, a question while it asks. Only
// the prop of the current mood shows; still marks render none.
function Props() {
  return (
    <>
      <Sticker
        className="im-spark"
        parts={[
          { d: SPARK(19.6, 3.6, 3.4), fill: true },
          { d: SPARK(23.4, 8.4, 1.5), fill: true },
        ]}
      />
      <Sticker
        className="im-question"
        parts={[
          {
            d: "M19.4 1.8a2.3 2.3 0 1 1 3.2 2.1c-.8.4-1.3.9-1.3 1.7",
            width: 1.7,
          },
          { d: circle(21.3, 8.2, 1), fill: true },
        ]}
      />
    </>
  );
}

// The mood to show: each one stays at least `ms` before the next replaces
// it, and the latest request wins.
function useSteady<T>(value: T, ms = 700) {
  const [shown, setShown] = useState(value);
  const since = useRef(0);
  useEffect(() => {
    if (value === shown) return;
    const wait = Math.max(0, since.current + ms - Date.now());
    const timer = setTimeout(() => {
      since.current = Date.now();
      setShown(value);
    }, wait);
    return () => clearTimeout(timer);
  }, [value, shown, ms]);
  return shown;
}

// True for a moment after `active` turns off, so a finished run can earn a
// smile before the face settles.
export function useAfterglow(active: boolean, ms = 2600) {
  const [glow, setGlow] = useState(false);
  const [seen, setSeen] = useState(active);
  if (seen !== active) {
    setSeen(active);
    setGlow(!active);
  }
  useEffect(() => {
    if (!glow) return;
    const timer = setTimeout(() => setGlow(false), ms);
    return () => clearTimeout(timer);
  }, [glow, ms]);
  return glow;
}

const clamp = (n: number) => Math.max(-1, Math.min(1, n)).toFixed(3);

function hash(text: string) {
  let h = 0;
  for (const c of text) h = (h * 31 + c.charCodeAt(0)) | 0;
  return Math.abs(h);
}

// One window listener serves every mark that follows the pointer; each reads
// its own position once per animation frame and writes CSS variables, so
// following the pointer never re-renders React.
const followers = new Set<(x: number, y: number) => void>();
let pointer: { x: number; y: number } | null = null;
let frame = 0;

function onPointerMove(event: PointerEvent) {
  pointer = { x: event.clientX, y: event.clientY };
  if (frame) return;
  frame = requestAnimationFrame(() => {
    frame = 0;
    if (pointer) for (const follow of followers) follow(pointer.x, pointer.y);
  });
}

function usePointerGaze(
  ref: React.RefObject<SVGSVGElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    const el = ref.current;
    if (!enabled || !el) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const follow = (x: number, y: number) => {
      const box = el.getBoundingClientRect();
      const dx = x - (box.left + box.width / 2);
      const dy = y - (box.top + box.height / 2);
      const distance = Math.hypot(dx, dy) || 1;
      // Eyes settle on near targets and reach their limit further away.
      const reach = Math.min(1, distance / 240);
      el.style.setProperty("--im-gx", clamp((dx / distance) * reach));
      el.style.setProperty("--im-gy", clamp((dy / distance) * reach));
    };
    if (!followers.size)
      window.addEventListener("pointermove", onPointerMove, { passive: true });
    followers.add(follow);
    if (pointer) follow(pointer.x, pointer.y);
    return () => {
      followers.delete(follow);
      if (!followers.size) {
        window.removeEventListener("pointermove", onPointerMove);
        cancelAnimationFrame(frame);
        frame = 0;
      }
      el.style.removeProperty("--im-gx");
      el.style.removeProperty("--im-gy");
    };
  }, [ref, enabled]);
}
