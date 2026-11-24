// A small DOM builder for the shell page: elements are created with text
// nodes, never from HTML strings, so nothing a server reports (its host, a
// page title) can become markup.

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & {
  class?: string;
  on?: Partial<{
    [K in keyof HTMLElementEventMap]: (event: HTMLElementEventMap[K]) => void;
  }>;
};

const text = (value: unknown) =>
  typeof value === "string" || typeof value === "number" ? String(value) : "";

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Props = {},
  ...children: (Child | Child[])[]
): HTMLElementTagNameMap[K] {
  const element = document.createElement(tag);
  const { on, ...attributes } = props;
  for (const [name, listener] of Object.entries(on ?? {}))
    element.addEventListener(name, listener as EventListener);
  for (const [key, value] of Object.entries(attributes)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === "class") element.className = text(value);
    else if (
      key in element &&
      !key.startsWith("aria-") &&
      !key.startsWith("data-")
    )
      (element as unknown as Record<string, unknown>)[key] = value;
    else element.setAttribute(key, value === true ? "" : text(value));
  }
  for (const child of children.flat()) {
    if (child === null || child === undefined || child === false) continue;
    element.append(child);
  }
  return element;
}

const SVG = "http://www.w3.org/2000/svg";

// Icons are fixed paths (Lucide shapes) drawn as SVG elements.
export function icon(paths: string[], size = 16) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  for (const d of paths) {
    const path = document.createElementNS(SVG, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}

export const icons = {
  back: ["m15 18-6-6 6-6"],
  forward: ["m9 18 6-6-6-6"],
  plus: ["M5 12h14", "M12 5v14"],
  settings: [
    "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z",
    "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z",
  ],
  alert: [
    "M12 9v4",
    "M12 17h.01",
    "M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z",
  ],
  close: ["M18 6 6 18", "m6 6 12 12"],
};

// The Lictory mark (packages/ui/public/brand/lictory-logomark.svg).
export function logo(size = 40) {
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "0 0 188 201");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(Math.round((size * 201) / 188)));
  svg.setAttribute("aria-hidden", "true");
  const path = document.createElementNS(SVG, "path");
  path.setAttribute("fill", "currentColor");
  path.setAttribute("fill-rule", "evenodd");
  path.setAttribute(
    "d",
    "M 36.00 171.80 L 34.00 171.50 L 32.00 170.43 L 4.00 154.60 L 1.69 153.00 L -0.28 150.00 L -0.56 147.00 L -0.36 41.00 L 1.45 38.00 L 4.00 35.95 L 60.00 3.67 L 66.00 0.48 L 68.00 -0.21 L 70.00 -0.13 L 72.00 0.52 L 73.61 2.00 L 74.74 4.00 L 74.89 5.00 L 74.91 48.00 L 74.46 51.00 L 73.41 53.00 L 71.00 55.17 L 41.38 72.00 L 38.68 75.00 L 36.89 80.00 L 36.81 170.00 L 36.72 171.00 L 36.00 171.80 Z M 59.00 140.28 L 57.00 140.83 L 55.00 140.50 L 53.53 139.00 L 52.64 137.00 L 52.61 88.00 L 53.71 84.00 L 57.00 80.70 L 83.00 66.35 L 114.00 48.53 L 117.00 47.53 L 120.00 48.18 L 121.12 49.00 L 122.50 51.00 L 123.03 55.00 L 122.94 99.00 L 122.35 102.00 L 121.11 104.00 L 118.00 106.48 L 59.00 140.28 Z M 92.00 200.27 L 88.00 200.31 L 85.00 199.38 L 65.00 188.22 L 55.00 182.00 L 53.58 180.00 L 52.59 176.00 L 52.67 165.00 L 54.00 162.01 L 55.00 160.77 L 58.00 158.63 L 118.00 124.63 L 136.00 114.60 L 139.00 113.54 L 144.00 113.61 L 147.00 114.65 L 184.00 135.56 L 186.38 138.00 L 187.38 141.00 L 187.35 143.00 L 186.36 146.00 L 184.00 148.54 L 109.00 191.31 L 95.00 199.15 L 92.00 200.27 Z",
  );
  svg.append(path);
  return svg;
}
