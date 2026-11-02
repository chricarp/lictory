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

## The public website

The website reads like the specifications it is about: paper and ink. Warm
neutral surfaces, the product's cobalt as the only accent, Geist for the
interface and a serif (Newsreader) for headlines only. It follows the visitor's
light or dark preference; one ink band marks the agent section.

Color and motion belong to the product illustrations, not the chrome. Each
contributor in the hero's branch graph keeps one color wherever it appears. The
graph's commit dot is the site's one recurring mark: section labels, the current
navigation item and the workflow steps.

Illustrations are built with the Stageshow kit (`apps/marketing/src/vendor/stageshow`,
from the skill in `.agents/skills/stageshow`): the product's own window, in the
product's tokens, with only the words the story needs and quiet placeholder
lines elsewhere. Each tells one story from real product concepts and capability
names, plays once when it comes into view, ends on its result and offers Replay.
With reduced motion it shows that result as a still frame. The page is the
ground: a window sits a gutter in from the column and fades out at its foot
rather than floating on a plate.
