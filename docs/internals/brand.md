# Lictory identity

The definitive artwork is the standalone logomark in
`public/brand/lictory-logomark.svg` and the combined mark and wordmark in
`public/brand/lictory-logo.svg`. Use the supplied wordmark rather than recreating
it with application text. Preserve the artwork's proportions and leave clear
space around it.

Use the identity in one color with strong contrast. UI components render the
SVGs as masks so they inherit the foreground color in light and dark themes.
Social previews render the combined SVG in white on a dark background.

The browser icon places the logomark on an ink (`#171C19`) tile. The Apple touch
icon is a 180px raster export of that icon. Email headers use a dark (`#18181B`)
PNG export of the combined logo because email clients do not consistently support
SVGs or CSS masks. Regenerate these derived assets when replacing the definitive
artwork.
