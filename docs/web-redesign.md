# Web redesign: Index

## Direction

**Index** treats Lictory as a personal reference desk, not an AI dashboard. The
interface is built from ink, paper, rules, and compact labels. Notes are the
primary material; AI is visible through state and provenance instead of glow,
gradient, or decorative “magic.”

The product promise is: **Remember the context, not just the note.**

## Comparative study

The redesign studied four adjacent products through their current product and
documentation sites:

- [mymind](https://mymind.com/what) makes mixed-media capture and retrieval feel
  effortless. Its strongest lesson for Lictory is that users should not need to
  decide where something belongs while capturing it. Lictory keeps that
  frictionless entry, but makes its inferred structure inspectable rather than
  hiding all organisation.
- [Capacities](https://capacities.io/product) makes people, places, dates, and
  other objects tangible. Its object model validates Lictory's entity graph.
  Lictory differentiates by extracting those records from a complete,
  mixed-media note and preserving human review as part of the interface.
- [Reflect](https://reflect.app/) keeps networked notes calm, fast, and
  writing-first. Lictory adopts that restraint and keeps connections secondary
  to the captured thought.
- [Fabric](https://fabric.so/for-your/notes) treats notes, PDFs, images, and
  voice memos as one searchable workspace. Lictory goes further by reading all
  attachments on a note together and normalising the result into correctable
  records.

The whitespace is deliberate: none of these products combines Lictory's
one-note/many-media model, typed context graph, legible processing, and durable
human correction. The new design makes those differences visible.

## Design principles

1. **The note is the specimen.** Capture and reading dominate the page. Metrics
   and graph navigation support them instead of competing with them.
2. **Structure looks structured.** Entity lists, processing stages, and note
   metadata use rules, columns, and compact index labels.
3. **Colour means something.** Vermilion marks product action and active
   understanding. Each entity type has one restrained hue. Everything else is
   neutral.
4. **AI is a state, not a style.** Processing uses a slim accent rule, progress,
   and plain-language stages. Suggestions retain confidence and review controls.
5. **Geometry stays quiet.** The base radius is 6px. Pills are reserved for
   genuinely compact tokens such as entity chips and status dots.
6. **Motion explains change.** Entry and processing motion remain short and
   subtle. There is no ambient animation or continuously moving background.

## Visual system

### Palette

| Role            | Dark      | Light     |
| --------------- | --------- | --------- |
| Canvas          | `#121210` | `#f2efe7` |
| Raised canvas   | `#191916` | `#faf8f2` |
| Primary ink     | `#f2efe7` | `#1c1c18` |
| Secondary ink   | `#aaa79e` | `#5b5952` |
| Identity/action | `#e16841` | `#e16841` |

Entity colours are muted ochre for people, sage for places, lavender for
moments, blue for topics, and dusty rose for organisations. They do not appear
as page decoration.

### Type

- Inter is the working face, using tighter display tracking and a compact,
  readable body rhythm.
- JetBrains Mono is reserved for indexes, counts, stage labels, provenance, and
  other system metadata.
- Large headlines use weight and composition instead of gradient fills.

### Layout

- Desktop uses a fixed 256px context index and a full-width working canvas.
- Page headings combine an index kicker, a decisive title, and a short utility
  description.
- Notes use ledger-like horizontal rows on dense surfaces. The capture composer
  is the single prominent bordered object.
- Mobile retains the same hierarchy with a drawer and touch-safe actions; no
  horizontal control is allowed to determine the page width.

## Surface decisions

- **Landing:** editorial split hero with a real context specimen, followed by
  capture modes and the four-step method.
- **Capture:** a focused desk with one mixed-media composer, context totals as a
  ruled strip, and recent notes as a chronological ledger.
- **Library:** search and state filters stay compact; results are one readable
  stream instead of a dashboard card grid.
- **Context:** people, places, and moments share one directory grammar. Topics
  use a ranked directory that makes recurrence comparable through note counts
  and restrained usage bars, with entity colour limited to identifying marks.
- **Details:** note content leads; understanding, provenance, connections, and
  processing remain visible but subordinate.
- **Authentication and overlays:** solid raised surfaces, restrained shadow,
  modest corners, and no glass effects.

## Acceptance criteria

- No ambient aurora, gradient headline, gradient button, or conic AI border.
- A shared palette and 6px base radius drive every primitive.
- Processing remains visible stage by stage and honours reduced motion.
- AI suggestions remain distinguishable and correctable.
- Mixed-media capture remains one note with any number of attachments.
- The shell, capture, notes, context directories, details, empty/loading/error
  states, authentication, overlays, and landing page use the same system.
