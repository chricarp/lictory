// Servers' pages are web pages: on Windows and Linux, Chromium gives them a
// browser's classic scrollbars (a wide grey gutter with arrows, the same
// grey in dark mode). In the app they take the shell's slim ones instead, in
// its colors (renderer/shell.css, --scrollbar), following the page's own
// color scheme. macOS keeps its overlay scrollbars.
//
// Like a desktop app's overlay scrollbars, a thumb shows only on the
// scroller under the pointer or holding the focus, so a long sidebar or
// settings page does not carry a permanent bar at its edge.
//
// Standard properties only: a page's own `scrollbar-width` (none on strips
// that scroll sideways, thin on its sidebar) still wins, since an element's
// rule beats `:where(*)`. The color is set on every element rather than
// inherited from the root, which is always hovered while the pointer is in
// the window.
export const serverViewScrollbars = `
:where(*) { scrollbar-width: thin; scrollbar-color: transparent transparent; }
:where(*:hover, *:focus-within) { scrollbar-color: light-dark(#c9ccd1, #3d4046) transparent; }
`;

export const styleScrollbars = process.platform !== "darwin";
