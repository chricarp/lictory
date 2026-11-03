# Social link previews

Open Graph and Twitter cards are public artifacts: a recipient's chat service may
fetch and cache them without a Lictory session. They must never depend on the
sharing user's access or the receiving user's identity.

The landing page uses a fixed marketing card. Workspace routes select a card from
a closed vocabulary of page categories. Titles, identifiers, organization and
project names, custom type names, people, content, progress and approval state are
never included. Previews do not query the database or confirm that an item exists.
The legacy `stories` route shows “Story”; project-agnostic item links show “Work
item”. Custom types are not looked up to personalize public cards.

Anonymous workspace requests are internally rewritten to the public sign-in page,
which renders safe metadata and preserves the destination through `callbackUrl`.
This applies to all user agents, not just recognized crawlers. Protected layouts
and APIs still enforce authentication and membership; the rewrite grants no access.
Workspace responses are not publicly cached. Only the category images can be
publicly cached, and workspace metadata asks search engines not to index pages.

The platform serves the workspace category cards itself, as static files at
`/social/<kind>.png`, so link previews work on an installation without a
public website. `PLATFORM_URL` supplies the origin for absolute image URLs; no
request Host header is used to construct them. The images are committed in
`packages/ui/public/social` and rendered with the website's card renderer
(Next.js ImageResponse, without remote fonts, image services or AI calls) by
`bun scripts/render-social-previews.ts`; rerun it after changing the card design
or the preview vocabulary. The website serves its own marketing card at
`/og/marketing`.

Richer previews in an authenticated chat integration would need a separate,
explicit disclosure policy and recipient authorization. Never add private fields
to these public cards, including metadata text or image URLs.
