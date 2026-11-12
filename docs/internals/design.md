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

## One visual language

The application, the website and the documentation share one token set
(`packages/ui/src/styles.css`) and read as one product: a calm instrument
panel for agreeing on what to build.

- **Color.** Cool, nearly neutral grays. White surfaces on a gray shell
  (`--shell`, also the sidebar); recessed trays (`--tray`) hold raised white
  cards. Ink text, black primary actions, blue only for focus, and one orange
  accent (`--brand`) for marks and live highlights, never for body text. Dark
  mode is neutral charcoal with the same structure: trays darker than cards.
  Success, warning and destructive keep at least 4.5:1 on every surface; use
  the tokens (`text-warning`, `bg-success/8`), not palette colors.
- **Type.** Geist for the interface and reading text. Geist Mono, in small
  capitals with open tracking, labels metadata: section labels, column
  headers, stage steppers, identifiers and revisions.
- **Shape.** Pills for every action and status; concentric radii everywhere a
  card sits in a tray (outer radius = inner radius + padding). Surfaces
  separate with hairline rings; real shadows are for what floats.
- **Status grammar.** A status is a soft tint with a hairline ring of the same
  hue, an optional dot or icon, and color only when it means something:
  green for done or passing, warning for what needs attention, red for what
  blocks. Everything else is neutral.
- **Structure.** The specification is the primary surface. Workflow state is
  one statement, its evidence as pills, and one next action. Lists name
  their columns and keep them aligned. A faint diagonal hatch (`--hatch`) only
  fills the trays that frame website illustrations and the sign-in backdrop.

- **Layout.** On desktop the navigation sits on the gray shell and the work
  sits in one rounded white frame beside it, so pane dividers end at the
  frame instead of the window edge. Litto's side sheet is a second frame
  beside the first. Panes inside the frame size to the frame (a named
  container, `@container/frame`), not the window: the item list shows from
  1040px of frame, the review rail from 848px (a "Review & details" drawer
  otherwise). A specification's discussions take a column beside the rail
  while the text keeps about 420px, the rail's place when only one fits, and
  a sheet on phones. Opening Litto therefore folds only what no longer fits; a large
  display keeps everything open.
- **Resizable panes.** The item list, the review rail and Litto's sheet can be
  resized from their edge: drag it, or focus it and use the arrow keys
  (Shift for larger steps, Home and End for the limits). A drag that ends
  near the default width settles on it, double-click returns to the default,
  Esc cancels a drag, and dragging the list well past its minimum folds it
  away. A pane never grows past what keeps the document readable, and a wider
  pane gives its extra room back when the window narrows. Widths describe the
  screen, so they are kept per browser, not per organization or account.

Personal colour themes override colours only, so structure, type and radius
stay Lictory's.

## The public website

The website uses the same language: Geist headlines set tight, mono eyebrow
labels with an orange dot, black pill calls to action, and product
illustrations framed in hatched trays. It follows the visitor's light or dark
preference; one ink band marks the agent section.

Color and motion belong to the product illustrations, not the chrome. Each
contributor in the hero's branch graph keeps one color wherever it appears.

Illustrations are built with the upstream [Stageshow kit](https://github.com/benjitaylor/skills/tree/main/stageshow)
(`apps/marketing/src/vendor/stageshow`): the product's own window, in the
product's tokens, with only the words the story needs and short, quiet
supporting sentences around them (never skeleton bars, which read as
unfinished). Each tells one story from real product concepts and capability
names, plays once when it comes into view, ends on its result and offers Replay.
With reduced motion it shows that result as a still frame. A window sits in a
hatched tray, a gutter in from its edge, and fades out at its foot.

## Application illustrations

Lictory is a calm, document-first workspace for collaborative requirements review.
Its visual language is the shared one above: cool neutral surfaces, ink text,
black pill controls, Geist typography and hairline rings. Dark mode uses
neutral charcoal with the same structure. Compact controls and readable
specification content take priority over decoration.

Illustrations extend that language as isometric line drawings: hairline
outlines, light faces and quiet dashed guides on a rounded plate, drawn in the
same 2:1 projection. Each scene has one accent object, the thing the state is
about (the retry key, the lens, the next tile), in the theme's interactive
color (`--ring`); everything else stays neutral. Avoid characters, logos,
lettering, scenery and decorative color. Keep silhouettes legible at 112px.

The artwork is Lottie, drawn as SVG, so it stays sharp at any density and takes
the theme without reloading: every fill and stroke carries a paint role as its
class (face, side, line, faint, ghost, accent and a few more), and
`styles.css` colors the roles from the current tokens. Light, dark and every
personal palette therefore recolor the same animation, and an accent always
matches the theme's own interactive color.

Motion follows one rule set. A scene assembles once when it appears and comes
to rest on a still frame, so an idle state costs nothing. Hovering it, or
tapping it on a touch screen, plays a short reaction (the key is pressed, the
lens sweeps, the barrier drops and lifts) that returns to exactly the resting
frame; the scene tests check that every animated property agrees at those
frames. With reduced motion the scene shows the resting frame and never
moves. Nothing loops.

Use illustrations on spacious empty states, missing resources and recoverable
page errors. Preserve the adjacent explanation, state icon where applicable,
and useful next action. Keep compact lists, validation, loading, discussion
prompts and populated documents visually quiet. Artwork is decorative, has an
empty alternative, and never communicates readiness or approval by itself.

The shared set covers proposals, inbox, planning, search, recovery and knowledge.
Project views have dedicated artwork for personal review, team review, blockers,
ready work, drafts and recently updated items. Extra search filters use the
shared search illustration; clearing them restores the view's own artwork.

## Building and delivering the artwork

The scenes are TypeScript in `packages/ui/src/illustrations/`: a small Lottie
writer, isometric primitives (plates, cards, keys, guides) and one module per
scene that composes them and declares two segments, `intro` and `react`, as
Lottie markers. Writing the animations as code keeps them reviewable in a pull
request, lets every scene share one projection and stroke weight, and keeps
the resting-frame rule testable. The output is ordinary Lottie JSON, which any
Lottie player or editor opens; its built-in colors are the light palette, used
wherever the stylesheet is missing (the last-resort error pages).

The SVG player (`lottie-web`'s light build, under 50 kB compressed) and each
scene load on demand, the first time a page shows an illustration, then come
from the browser cache with the rest of the application's hashed chunks. If
they cannot load (offline, a newer release replaced them), the artwork's space
closes and the state keeps its explanation and actions.
