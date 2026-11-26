// Servers' pages are web pages: on Windows and Linux, Chromium gives them a
// browser's classic scrollbars (a wide grey gutter with arrows, the same
// grey in dark mode). In the app they take the shell's slim ones instead, in
// its colors (renderer/shell.css, --scrollbar), following the page's own
// color scheme. macOS keeps its overlay scrollbars.
//
// Standard properties only: a page's own `scrollbar-width` (none on strips
// that scroll sideways, thin on its sidebar) still wins, since an element's
// rule beats `:where(*)`; `scrollbar-color` is inherited from the root.
export const serverViewScrollbars = `
:root { scrollbar-color: light-dark(#c9ccd1, #3d4046) transparent; }
:where(*) { scrollbar-width: thin; }
`;

export const styleScrollbars = process.platform !== "darwin";
