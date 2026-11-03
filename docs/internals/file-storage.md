# Private file storage

The database holds file metadata only. Object bytes live in a private bucket on
any S3-compatible service: Cloudflare R2 (lictory.com), AWS S3, MinIO, Garage,
Ceph, Hetzner Object Storage, GCS interoperability and similar. The
`ObjectStorage` boundary in `packages/core/src/storage` signs PUT and GET
requests, checks object metadata, copies and deletes objects. Endpoint and
credentials are confined to its configuration; file routes and editors do not
know which provider is behind it.

## Configuration

Storage is optional. Configure exactly one of the two sets below in the API's
server environment (empty values count as unset):

| Variable               | Generic S3 (`S3_*`)                                                                                                |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `S3_ENDPOINT`          | Service URL, `http(s)://host[:port]`, without the bucket. Leave empty for AWS S3.                                  |
| `S3_REGION`            | Signing region. Required when `S3_ENDPOINT` is empty (the bucket's AWS region); defaults to `us-east-1` otherwise. |
| `S3_BUCKET`            | Bucket name. Required.                                                                                             |
| `S3_ACCESS_KEY_ID`     | Access key with object read/write on the bucket. Required.                                                         |
| `S3_SECRET_ACCESS_KEY` | Its secret. Required.                                                                                              |
| `S3_FORCE_PATH_STYLE`  | `true` puts the bucket in the path (`host/bucket/key`). Defaults to `true` with an endpoint and `false` for AWS.   |

| Variable               | Cloudflare R2 preset (`R2_*`)                                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| `R2_ACCOUNT_ID`        | 32-character account ID. Required.                                                                |
| `R2_ACCESS_KEY_ID`     | Bucket-scoped R2 API token with object read/write. Required.                                      |
| `R2_SECRET_ACCESS_KEY` | Its secret. Required.                                                                             |
| `R2_BUCKET_NAME`       | Bucket name. Required.                                                                            |
| `R2_S3_ENDPOINT`       | Optional jurisdiction endpoint, `https://<account>.eu.r2.cloudflarestorage.com` (no bucket path). |

The R2 preset is equivalent to `S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com`,
`S3_REGION=auto` and path-style addressing; existing R2 deployments keep their
variables. Resolution:

- No `S3_*` and no `R2_*` value: attachments are disabled. The API and worker
  start and log `attachments: disabled`; `/api/session` reports
  `attachments: false`, so the editor offers no upload and the attachment
  panel says that attachments are unavailable; upload and download requests
  fail with `503` and that explanation, whatever client sends them.
- Any `S3_*` value together with any `R2_*` value: rejected, because neither
  can silently win.
- A partial set (for example a bucket without credentials), an endpoint that
  is not an absolute `http(s)` URL or carries credentials, a malformed R2
  account ID or endpoint, or an `S3_FORCE_PATH_STYLE` other than true/false:
  the API refuses to start and names the variables to fix.

Presigned URLs carry the configured endpoint host, so `S3_ENDPOINT` must be
reachable both from the API (finalization and removal call it) and from users'
browsers (they upload and download directly). An internal-only hostname such
as `http://minio:9000` therefore does not work for browsers; publish the
service on a name both can resolve. Requests are signed without the SDK's
optional CRC32 checksums, which several S3-compatible services reject.

Keep the bucket private. A public bucket or custom public domain is
inappropriate for these organization-scoped files, and presigned URLs operate
only on the S3 API endpoint. Use credentials scoped to this one bucket.

## Bucket CORS

Browsers send the bytes straight to the bucket, so the bucket must allow a
cross-origin `PUT` from every origin the app is served on (`PLATFORM_URL`;
add preview or staging origins only to their own buckets). Downloads are plain
redirects and need no CORS rule. For R2, AWS S3 and other services that
support the S3 `PutBucketCors` API (or the R2 dashboard):

```json
[
  {
    "AllowedOrigins": ["https://app.example.com"],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type", "Content-Length", "If-None-Match"],
    "MaxAgeSeconds": 300
  }
]
```

With the AWS CLI against any such endpoint, wrap that list as
`{"CORSRules": [...]}` and run
`aws s3api put-bucket-cors --bucket <bucket> --cors-configuration file://cors.json --endpoint-url <endpoint>`.
Wrangler offers `wrangler r2 bucket cors set <bucket> --file cors.json` for R2.

MinIO does not implement per-bucket CORS: it answers preflights for every
origin unless the server-wide `MINIO_API_CORS_ALLOW_ORIGIN` setting (default
`*`) narrows them. In production set it to the app origins, for example
`MINIO_API_CORS_ALLOW_ORIGIN=https://app.example.com`, or
`mc admin config set <alias> api cors_allow_origin=https://app.example.com`.
The development `compose.yaml` keeps the default, so `http://localhost:3000`
works without setup. Check other services' documentation for the equivalent.

## Development

`docker compose up -d` starts MinIO on `http://127.0.0.1:9000` (console on
port 9001) and creates the `lictory-files` bucket; `.env.example` points the
`S3_*` settings at it. `packages/core/src/storage/minio.test.ts` exercises the
real protocol against it (CORS preflight, create-only signed upload, length
binding, download headers, copy and delete) and is skipped when no MinIO
answers.

## Lifecycle

A member starts an upload against an existing, unarchived work item. The server
validates the filename, extension/MIME pair and 25 MB limit, allocates a unique
opaque key, and signs a five-minute PUT bound to the declared content
length. The conditional `If-None-Match: *` header prevents a
reused URL from overwriting an existing object. The browser sends the bytes directly to
the bucket with the declared MIME type. The signature does not cover the
content type, so finalization HEAD-checks both size and content type before
making metadata visible. A failed or abandoned upload leaves pending metadata and possibly an
unreferenced object; run an authenticated cleanup job that checks pending metadata first. Do not
expire the shared key prefix with a bucket lifecycle rule: it also contains ready
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
raising it, including upload abuse controls and storage cost limits.
