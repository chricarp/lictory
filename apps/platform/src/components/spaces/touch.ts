import { useSyncExternalStore } from "react";

// Touch sizing: phones and coarse pointers (tablets, touch laptops) get
// ~44px rows and targets; a desktop mouse keeps the dense 30px rows. The
// classes and the query below describe the same condition, so windowed
// lists measure the rows they draw.

const query = "(any-pointer: coarse), (max-width: 39.99rem)";

// A row that grows to 44px.
export const touchRow = "max-sm:h-11 touch:h-11";

// A compact control: 36px tall, reaching 44px through an invisible 4px
// margin, so neighbours 8px apart never share a touch.
export const touchTarget =
  "relative max-sm:h-9 max-sm:after:absolute max-sm:after:-inset-1 touch:h-9 touch:after:absolute touch:after:-inset-1";
export const touchIcon = `${touchTarget} max-sm:w-9 touch:w-9`;

function subscribe(onChange: () => void) {
  const media = window.matchMedia(query);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useTouchSizing() {
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
