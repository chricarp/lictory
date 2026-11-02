# Private file storage

The database holds file metadata only. Object bytes live in a private R2 bucket.
The S3-compatible `ObjectStorage` boundary in `src/storage` signs PUT and GET
requests, checks object metadata, and can delete objects. R2 endpoint and
credentials are confined to its configuration function; another S3 provider
can replace them without changing file routes or editors.

Set `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, and
`R2_BUCKET_NAME` in the API's server environment. Use a bucket-scoped R2 token
with object read/write permission. If using a jurisdiction-specific R2 S3
endpoint, set `R2_S3_ENDPOINT` to the account-level S3 host (without the
bucket path). Keep the bucket private. A public/custom domain
is inappropriate for these organization-scoped files, and R2 presigned URLs
operate only on the S3 API endpoint.

Configure production bucket CORS for the supported app origins. Development and
previews use separate buckets and their own origins:

```json
[
  {
    "AllowedOrigins": ["https://app.lictory.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "If-None-Match"],
    "MaxAgeSeconds": 300
  }
]
```

A member starts an upload against an existing, unarchived work item. The server
validates the filename, extension/MIME pair and 25 MB limit, allocates a unique
opaque key, and signs a five-minute PUT bound to the declared content
length and MIME type. The conditional `If-None-Match: *` header prevents a
reused URL from overwriting an existing object. The browser sends the bytes directly to
R2. Finalization HEAD-checks size and content type before making metadata
visible. A failed or abandoned upload leaves pending metadata and possibly an
unreferenced object; run an authenticated cleanup job that checks pending metadata first. Do not
expire the shared key prefix with an R2 lifecycle rule: it also contains ready
objects. Same-name uploads receive separate IDs and keys.

Markdown stores stable `/api/files/{id}` links. Each read checks current Better
Auth organization membership and redirects to a one-minute signed GET URL.
Signed GET URLs are bearer links bound to an object key: storage cannot revoke
one, and it keeps working until it expires whatever the database says. Removing
an attachment therefore happens in two steps. The metadata is marked removed
first, so no new link is issued and `/api/files/{id}` references in revisions
and comments return not found. The object is then copied to
`organizations/{org}/removed-files/{id}`, the original key is deleted, and the
metadata records the new key, so links issued before the removal stop working
at once instead of up to a minute later. The bytes and metadata are retained
privately rather than destroyed, which keeps the removal reversible by an
operator and leaves deletion to a later reference-aware retention job. If
storage fails part-way, the removal is still recorded and the caller gets a
retryable error; repeating the removal finishes the move (and reports
`removed: false`, since the attachment was already removed).
Files are online-only and are not persisted in the workspace's offline mutation
queue; the attachment list is a membership-checked live query. Files inherit the
current organization-wide work item visibility policy. If private projects are
introduced, extend both the file API and sync ACLs together.

The accepted list follows Jira's documented image, document, media and
archive categories, with Markdown and WebP included for software teams. The 25 MB per-file cap matches Linear's
documented email intake cap; Jira's web attachment limit is larger and
configurable. This product limit should become a deliberate policy before
raising it, including upload abuse controls and R2 cost limits.
