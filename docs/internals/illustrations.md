# State illustrations

## Design brief

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

## Generation prompts

The initial set was generated with the built-in image generation model. Each
subject used this shared prompt followed by its subject below:

> Use case: stylized-concept. Asset: small empty-state illustration for Lictory,
> a calm software requirements collaboration platform. Airbnb-inspired premium
> tactile 3D miniature editorial object, original design, no logos. Matte porcelain
> and soft clay, rounded bevels, subtle real material texture, soft studio light
> from upper left, orthographic three-quarter camera. Palette: cobalt blue
> #3569eb accents, off-white porcelain, pale lavender #deddf4, charcoal tiny
> details; restrained saturation. One compact centered object composition, fills
> 75% of square canvas, crisp readable silhouette at 160px. Genuine transparent
> background and transparent corners, no floor, no scenery, no cast shadow beyond
> a very subtle contact shadow attached to object. No letters, numbers, labels,
> watermark, people, gradients in background.

| Subject   | Prompt continuation                                                                                                                                                                                                      |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Proposal  | Two layered off-white specification sheets with small raised cobalt horizontal bars, a short lavender pencil leaning diagonally beside them. Blank abstract document, inviting starting point.                           |
| Inbox     | An open rounded lavender inbox tray holding a single porcelain envelope, a small cobalt rounded checkmark resting against the tray. Calm all-caught-up mood.                                                             |
| Planning  | A small standing porcelain planning board with three cobalt/lavender rounded card tiles, and one small lavender calendar tile leaning beside it. No dates or grid numbers.                                               |
| Search    | A chunky cobalt-rimmed magnifying glass leaning over a single folded porcelain document with tiny lavender abstract bars. Exploration, no results, missing page.                                                         |
| Recovery  | Two rounded porcelain puzzle pieces slightly separated, with cobalt and lavender edges, an elegant small cobalt curved retry arrow hovering closely above their gap. Calm recoverable interruption, no warning triangle. |
| Knowledge | A pair of small closed porcelain and lavender reference books, one standing and one laid flat, with a cobalt bookmark tab. Knowledge awaiting contributions.                                                             |

## Dedicated view illustrations

The six project views have individual empty-state artwork. Additional search
filters temporarily replace it with the shared search illustration; clearing
those filters restores the view's own artwork. A decorative illustration never
asserts that an item passed checks or received approval.

These subjects use the same shared generation prompt above:

| View                  | Prompt continuation                                                                                                                                                                                                                                                                    |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Needs my review       | A single upright porcelain review clipboard with two small cobalt abstract content bars, a lavender bookmark tab, and a chunky cobalt-rimmed small reading lens leaning beside it. Personal review awaiting attention. No ticks or approval stamps.                                    |
| Needs review          | Two chunky rounded speech bubbles, one porcelain and one pale lavender, overlapping closely above a small cobalt-edged specification card. Friendly asynchronous discussion and collaborative review. Bubbles have no faces or text, card only two abstract bars.                      |
| Blocked               | A miniature porcelain road barrier with a single rounded cobalt horizontal arm across two short lavender supports, and one small porcelain document standing behind it. Calm paused progress awaiting a blocking discussion to be resolved. No danger stripes, warning symbols or red. |
| Ready for development | A tiny open porcelain handoff toolbox with a lavender interior, a rounded cobalt wrench and a neatly folded off-white specification card tucked inside. Ready to build, a prepared handoff kit, calm and compact. No checkmarks, stamps, labels or UI.                                 |
| Drafts                | A small open lavender notebook with blank thick porcelain pages and a cobalt fountain pen resting diagonally across one page. Work in progress and room for ideas. No content bars, text, scribbles or checkmarks.                                                                     |
| Recently updated      | A chunky pale lavender circular clock with a porcelain face and cobalt hands, leaning against a short stack of two off-white revision cards with a single raised lavender abstract bar. Recent changes and revision history. No numbers, tick marks, arrows, letters or date labels.   |

## Asset delivery

Ship only the final alpha-preserving 384 × 384 WebP files in
`public/illustrations/`. They support the 160px display size at more than 2× pixel
density. Encode with WebP quality 80, alpha quality 100 and effort 6. Keep original
high-resolution generated files outside the repository.

Filenames include the first 12 hexadecimal characters of the file's SHA-256 hash.
When replacing artwork, generate a new hash and update the asset mapping. These
URLs receive a one-year immutable cache header; never overwrite different bytes
at an existing URL. The shared component serves the files as they are (no runtime image
optimization), uses intrinsic dimensions to reserve space, and loads lazily.
This avoids transformation work and variants while retaining CDN/browser caching.
Static delivery still uses bandwidth; these assets do not imply free hosting.
