// CSV for people opening exports in a spreadsheet. Cells that start with a
// formula character are prefixed so spreadsheet applications show them as
// text instead of evaluating them.
export function csvCell(value: string | number | null | undefined) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export const csvLine = (cells: (string | number | null | undefined)[]) =>
  cells.map(csvCell).join(",") + "\r\n";
