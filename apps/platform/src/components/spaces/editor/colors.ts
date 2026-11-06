// Each person keeps one color wherever their caret appears. Dark enough
// that white label text stays above 4.5:1 in both themes.
const palette = [
  "#1d4ed8",
  "#b42318",
  "#047857",
  "#7c3aed",
  "#b45309",
  "#0e7490",
  "#be185d",
  "#4d7c0f",
];

export function personColor(userId: string) {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1)
    hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return palette[Math.abs(hash) % palette.length]!;
}
