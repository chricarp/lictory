# Identity and illustrations

The definitive artwork is the standalone logomark in
`packages/ui/public/brand/lictory-logomark.svg` and the combined mark and wordmark in
`packages/ui/public/brand/lictory-logo.svg`. Use the supplied wordmark rather than recreating
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

## Application illustrations

Lictory is a calm, document-first workspace for collaborative requirements review.
Its visual language uses near-white cool surfaces, charcoal text, cobalt primary
controls, pale lavender secondary surfaces, Geist typography and restrained
borders. Dark mode uses ink surfaces with the same cobalt accents. Compact
controls and readable specification content take priority over decoration.

Illustrations extend that language with small, tactile 3D objects inspired by
Airbnb's friendly editorial approach. Use matte porcelain and soft clay, rounded
bevels, subtle material texture, an orthographic three-quarter view and soft light
from the upper left. Keep silhouettes legible at 160px. Use off-white, pale
lavender (`#deddf4`) and cobalt (`#3569eb`), with tiny charcoal details. Avoid
characters, logos, lettering, dramatic lighting, scenery and background plates.
The same artwork must work on light and dark surfaces without recoloring.

Use illustrations on spacious empty states, missing resources and recoverable
page errors. Preserve the adjacent explanation, state icon where applicable,
and useful next action. Keep compact lists, validation, loading, discussion
prompts and populated documents visually quiet. Artwork is decorative, has an
empty alternative, and never communicates readiness or approval by itself.

The shared set covers proposals, inbox, planning, search, recovery and knowledge.
Project views have dedicated artwork for personal review, team review, blockers,
ready work, drafts and recently updated items. Extra search filters use the
shared search illustration; clearing them restores the view's own artwork.

## Asset delivery

Ship only the final alpha-preserving 384 × 384 WebP files in
`packages/ui/public/illustrations/`. They support the 160px display size at more than 2× pixel
density. Encode with WebP quality 80, alpha quality 100 and effort 6. Keep original
high-resolution generated files outside the repository.

Filenames include the first 12 hexadecimal characters of the file's SHA-256 hash.
When replacing artwork, generate a new hash and update the asset mapping. These
URLs receive a one-year immutable cache header; never overwrite different bytes
at an existing URL. The shared component serves the files as they are (no runtime image
optimization), uses intrinsic dimensions to reserve space, and loads lazily.
This avoids transformation work and variants while retaining CDN/browser caching.
Static delivery still uses bandwidth; these assets do not imply free hosting.
