# Profile photos

A social provider supplies the initial photo when creating an account. Subsequent
sign-ins and account linking preserve the person's profile: a custom photo or an
explicit removal must never be undone by authentication. Provider URLs are
displayed directly by the browser with no referrer; the server does not fetch
them. Only HTTPS URLs are rendered. Unavailable photos fall back to initials.
Providers returning embedded raster bytes (such as Microsoft) have their initial
photo normalized into private storage after account creation; invalid photos
fall back to initials without blocking signup.

Every person can upload, replace or remove their own photo in Account settings,
including before joining an organization. The server identifies the owner from
the session and requires same-origin writes. Generic authentication profile
updates cannot set image URLs.

Uploads accept JPEG, PNG and WebP, up to 4 MB and 25 megapixels. The server decodes
and normalizes pixels to a static, centered 256×256 WebP, honors orientation and
strips metadata. Small normalized bytes live in a separate PostgreSQL row, like
organization branding, rather than in session data or object storage. Replacement
updates the photo and user image URL in one transaction under a user row lock;
removal clears both. Deleting the account cascades to its photo.

The stable image URL carries a content hash to refresh avatars after replacement.
Reads require authentication and either ownership or current membership in an
organization shared with the owner. Responses use private revalidation so that
membership is checked before responding, including to conditional requests.
The directory includes image URLs, never bytes. Photo changes signal existing
workspace synchronization so online collaborators refresh their avatars.
