# Organization branding

An organization's administrators can make Lictory look like their company's
own tool for everyone working in that organization. Branding is optional and
every part falls back to Lictory's on its own, so a new organization needs no
configuration.

## What an organization brands

- **Logomark** (`mark`): a square symbol, shown in the collapsed sidebar and
  the organization list. Without one, the organization's initial.
- **Full logo** (`full`): a wide logo that includes the name and replaces the
  name in the sidebar.
- **Browser icon** (`icon`): the browser tab's icon while someone works in
  the organization. Without one the logomark is used, then Lictory's icon.
- **Brand color**: one color that tints primary actions and accents, and the
  button and links of the organization's email.

Images are PNG, JPEG or WebP up to 512 KB, recognized by their bytes. SVG is
refused: it can carry script, and these images are served from the
application origin.

Organization administrators change branding
(`setOrganizationLogo`, `removeOrganizationLogo`,
`setOrganizationBrandColor`); every member sees it. Logos live in
`organization_logo`, the color in `organization_branding`, and both reach
browsers through the `organizationProfile` projection, so a change appears
for everyone without a reload.

## One color, derived tones

Administrators choose a single color, not a palette. `brandPalette`
(`packages/core/src/branding/color.ts`) derives what the interface uses: the
color as chosen where it already reads at 4.5:1, otherwise darkened for light
surfaces or lightened for dark ones just far enough to reach it, with a fixed
foreground for each. A pale yellow therefore becomes a darker shade on light
surfaces instead of an unreadable button. The settings page previews both
tones before saving. Do not let branding set individual tokens; every extra
knob is a way to make the product unreadable.

The stylesheet applies the tones only to the default theme. A person who
chose a personal color theme keeps it: that choice is theirs, and its palette
was balanced as a whole.

## Email

Email sent on an organization's behalf (invitations, notifications) carries
that organization's full logo, or its logomark beside its name, and uses the
light tone of its brand color for the button and links. Account email
(verification, password reset) belongs to no organization and always looks
like Lictory.

Mail clients cannot sign in, so email does not use the member-only logo
address. It uses a public one that contains the SHA-256 of the image:
`/api/organizations/:id/logo/:kind/:sha256`. The address is unguessable to
anyone who was not sent the image, answers only while that exact image is the
current logo, and is immutable, so it can be cached forever. Replacing or
removing a logo retires the addresses already sent; old email then shows the
image's alternative text. Display sizes are read from the image header when
the email is built, because some mail clients ignore CSS sizes.

## What is not branded

- The sign-in pages, account email and the product name: they belong to the
  installation, not to one of its organizations, and people may belong to
  several organizations.
- The public website and the documentation.

Branding an entire installation (sign-in page, account email) would be an
instance setting under [instance administration](./instance-administration.md),
not an organization one.
