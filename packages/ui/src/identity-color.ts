// A person's or an agent's color: the same everywhere, on every device, for
// as long as the id lives. Picked from a small palette whose every color keeps
// white initials at 4.5:1 or more, in light and dark themes alike.

export const identityPalette = [
  "#3b5bdb", // blue
  "#0b7285", // teal
  "#087f5b", // green
  "#c2255c", // pink
  "#7048e8", // violet
  "#c2410c", // orange
  "#862e9c", // grape
  "#5f6b7a", // slate
] as const;

// FNV-1a: tiny, stable across platforms and releases, and well spread over
// short ids, so neighbouring ids rarely share a color.
function hash(key: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function identityColor(key: string): string {
  return identityPalette[hash(key) % identityPalette.length]!;
}

// An agent's color: the palette without its slate. A tile tinted with slate
// reads as the neutral tile of an automated act (a policy) or of the
// interface itself, so an agent drawn in it looked like "the system" rather
// than a member of the room.
const agentPalette = identityPalette.filter((color) => color !== "#5f6b7a");

export function agentColor(agentId: string): string {
  return agentPalette[hash(`agent:${agentId}`) % agentPalette.length]!;
}
