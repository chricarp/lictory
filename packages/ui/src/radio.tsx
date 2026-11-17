"use client";

import { RadioIndicator } from "@ui-sdk/react/radio";

export { Radio, RadioGroup } from "@ui-sdk/react/radio";

// The round mark of a radio that sits beside its text. Card-like radios
// style the `Radio` itself instead.
export const radioClass =
  "m-0 inline-grid size-3.5 shrink-0 cursor-pointer place-items-center rounded-full border border-input bg-card p-0 outline-none data-checked:border-primary data-disabled:cursor-default data-disabled:opacity-50";

export function RadioDot() {
  return <RadioIndicator className="block size-1.5 rounded-full bg-primary" />;
}
