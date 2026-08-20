"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

export type KeybindingKey =
  "mod" | "shift" | "alt" | "enter" | "b" | "i" | "k" | "m";

export type KeybindingDefinition = {
  keys: readonly KeybindingKey[];
};

export const KEYBINDINGS = {
  search: { keys: ["mod", "k"] },
  capture: { keys: ["mod", "shift", "enter"] },
  record: { keys: ["mod", "shift", "m"] },
  save: { keys: ["mod", "enter"] },
  bold: { keys: ["mod", "b"] },
  italic: { keys: ["mod", "i"] },
  link: { keys: ["mod", "k"] },
} as const satisfies Record<string, KeybindingDefinition>;

const subscribe = () => () => undefined;

function getIsApplePlatform() {
  if (typeof navigator === "undefined") return false;
  return (
    /Mac|iPhone|iPad|iPod/.test(navigator.platform) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  );
}

export function matchesKeybinding(
  event: KeyboardEvent | React.KeyboardEvent,
  binding: KeybindingDefinition,
) {
  const keys = binding.keys;
  const expectsMod = keys.includes("mod");
  const expectsShift = keys.includes("shift");
  const expectsAlt = keys.includes("alt");
  const expectedKey = keys.find(
    (key) => key !== "mod" && key !== "shift" && key !== "alt",
  );

  return (
    (event.metaKey || event.ctrlKey) === expectsMod &&
    event.shiftKey === expectsShift &&
    event.altKey === expectsAlt &&
    event.key.toLowerCase() === expectedKey?.toLowerCase()
  );
}

export function keybindingAria(binding: KeybindingDefinition) {
  const parts = binding.keys.map((key) => {
    if (key === "mod") return "Meta";
    if (key === "shift") return "Shift";
    if (key === "alt") return "Alt";
    if (key === "enter") return "Enter";
    return key.toUpperCase();
  });
  const apple = parts.join("+");
  const control = parts
    .map((part) => (part === "Meta" ? "Control" : part))
    .join("+");
  return apple === control ? apple : `${apple} ${control}`;
}

export function Keybinding({
  binding,
  tone = "default",
  className,
}: {
  binding: KeybindingDefinition;
  tone?: "default" | "inverse";
  className?: string;
}) {
  const isApple = React.useSyncExternalStore(
    subscribe,
    getIsApplePlatform,
    () => false,
  );

  const labels = binding.keys.map((key) => {
    if (key === "mod") return isApple ? "⌘" : "Ctrl";
    if (key === "shift") return isApple ? "⇧" : "Shift";
    if (key === "alt") return isApple ? "⌥" : "Alt";
    if (key === "enter") return isApple ? "↵" : "Enter";
    return key.toUpperCase();
  });

  return (
    <kbd
      aria-hidden="true"
      className={cn(
        "inline-flex items-center gap-1 rounded-sm border px-1.5 py-1 font-sans text-[0.6875rem] font-bold leading-none shadow-sm",
        tone === "inverse"
          ? "border-white/25 bg-white/15 text-white"
          : "border-hairline-strong bg-canvas text-subtle",
        className,
      )}
    >
      {labels.map((label, index) => (
        <span key={`${label}-${index}`}>{label}</span>
      ))}
    </kbd>
  );
}
