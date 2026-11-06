# Product analytics

PostHog tracks actions across refinement and both delivery modes. Set
`POSTHOG_PROJECT_TOKEN`/`POSTHOG_HOST` in the application's environment: the API
and worker read them at runtime, and the API writes them into the platform's
SPA document (`packages/core/src/lib/public-config.ts`), so the platform build
carries no analytics settings. The prerendered website embeds its own copies,
`NEXT_PUBLIC_POSTHOG_PROJECT_TOKEN`/`NEXT_PUBLIC_POSTHOG_HOST`, at build time;
server code (server events, server log export, the relay) never reads those
copies. Use the
project's ingestion host; the example environment uses EU Cloud. Both browser and
server tracking are disabled when either variable is absent. Analytics failures
must never prevent signing in, reviewing, synchronizing or publishing.

## Consent

Without PostHog settings there is nothing to consent to: `ConsentProvider`
renders no banner, stores no choice and loads no analytics code, and "Privacy
preferences" buttons are hidden. A browser test asserts that the platform then
makes no request to PostHog or the relay.

`ANALYTICS_CONSENT` (and `NEXT_PUBLIC_ANALYTICS_CONSENT` for the website build)
chooses how analytics follow the visitor's choice
(`packages/core/src/lib/analytics/consent.ts`):

- **Default (unset):** the behavior described below. PostHog loads before a
  choice, cookieless and anonymous; server events ignore the browser choice.
- **`strict`:** PostHog loads only after Analytics consent (`loadMode:
"after-consent"`, no cookieless mode), and server events are sent only for
  requests carrying the `lictory_analytics_consent=1` cookie, a first-party
  record the browser keeps in step with the choice (granted, rejected or
  withdrawn). Zero mutations carry it too, because zero-cache forwards cookies.
  Events without a request, such as background jobs, are not sent.

The default is the maintainer's choice, kept from before strict mode existed.

In the default mode, browser analytics runs in one of two modes, chosen by the
visitor's **Analytics** (c15t `measurement`) consent. The open-source c15t consent manager runs in offline
mode: choices are stored only in the visitor's browser (cookie and localStorage),
with no consent backend, audit trail or jurisdiction detection. The banner asks
every visitor. "Privacy preferences" in the landing footer, auth pages and the
workspace account menu reopens the choice.

`ConsentProvider` (`packages/ui/src/consent/consent-provider.tsx`, used by both origins) is the only place
that loads the PostHog browser SDK, through the `@c15t/scripts/posthog` helper with
`loadMode: "always"` and `cookieless_mode: "on_reject"`:

- **Consent granted:** full tracking. PostHog uses its first-party cookie, the
  current user is identified, the organization is grouped and registered, and
  tracing headers link server events to the browser session. Granting consent
  applies this immediately, without a reload; earlier anonymous events stay
  anonymous.
- **Undecided or rejected:** minimal tracking. c15t keeps PostHog opted out, which
  switches it to cookieless capture: no identifier is stored on the device (only
  PostHog's opt-out flag) and PostHog counts visitors with a server-side hash of
  IP and user agent that rotates daily. `track`/`identifyUser` never identify,
  group or link sessions in this mode, and events additionally lose entity IDs
  (`*_id`) and workspace paths (any workspace page becomes `/app`).

Cookieless capture requires **Cookieless server hash mode** under _Project
Settings → Web analytics_ in PostHog. Without it, PostHog discards the anonymous
events and only consented visitors are counted. Cookieless mode avoids device
storage that needs consent under ePrivacy rules; the anonymous processing itself
still relies on legitimate interest and must be covered by the privacy notice.

Withdrawing consent opts PostHog out, removes its first-party cookie and storage,
and reloads the page, which starts again in cookieless mode.

### First-party relay

The browser never contacts PostHog directly. `api_host` is `/relay` on the
page's own origin, so blockers that match PostHog domains do not drop
analytics. Both relays share one implementation
(`relayToPosthog` in `packages/core/src/lib/analytics/relay.ts`):

- **Application:** the API relays for its installation, configured by
  `POSTHOG_HOST` and `POSTHOG_PROJECT_TOKEN`. The visitor's IP is the first
  `X-Forwarded-For` entry set by the installation's reverse proxy.
- **Websites (`lictory.com`, `docs.lictory.com`):** the Cloudflare Worker
  (`deploy/cloudflare/src/worker.ts`) relays straight to the `POSTHOG_HOST`
  Worker variable; no Lictory backend is involved. The visitor's IP is
  Cloudflare's `CF-Connecting-IP`; any client-sent `X-Forwarded-For` is
  ignored. The website's standalone Next.js server (development and the
  browser suite) rewrites `/relay` to the API instead.

The relay derives the regional ingestion and asset hosts from the configured
host, accepts only plain relative paths and `GET`/`HEAD`/`POST`, forwards only
content headers plus the visitor's IP (required for the cookieless hash), and
never forwards Lictory cookies or authorization headers or returns PostHog
cookies. Without configuration it answers 404 and sends nothing.
`skipTrailingSlashRedirect` is enabled because the SDK posts to paths such as
`/relay/e/`. The server SDK keeps sending to `POSTHOG_HOST` directly.

Server-side events (`posthog-node`) and OpenTelemetry logs are not governed by this
browser choice. They are keyed by authenticated user ID; whether they need consent
or a different legal basis is a separate product and legal decision.

## Event semantics

Successful workspace events come from the authenticated server after the domain,
projections and mutation receipt commit together. Receipt replays emit no event;
PostHog also receives a deterministic event UUID and `$insert_id` for retryable operations. A
browser queuing an offline edit is not a successful domain action. Its event occurs
when the server accepts the edit after reconnection. Failed actions produce
`action_failed` with an operation and error category, never a success event.

Tracking is best effort, not an audit log: a process crash between commit and
analytics delivery can lose an event. We deliberately avoid analytics writes or
network calls inside domain transactions. Server events are captured
fire-and-forget after commit by the long-lived API and worker processes, which
flush them on shutdown, so tracking never delays a response.

`packages/core/src/lib/analytics/events.ts` is the exhaustive workspace event catalog. A new
command must select an event; its payload must pass the explicit property
allowlist. Events use past-tense `snake_case` names and carry `analytics_version: 1`
and `source: client | server`. Custom events use authenticated user IDs as PostHog
person IDs. Organization events include `organization_id` and an `organization`
group. Item events include project, team, type, status, revision, blockers and
readiness counts. Where available, `work_item_type`, `has_specification`,
`status_category` and `delivery_mode` make dashboard breakdowns understandable.

Browser identity is linked after successful email authentication and when an
authenticated workspace opens, including social sign-in. It resets after successful
sign-out, rather than on React effect cleanup. Organization context clears when
leaving or switching workspaces. Browser tracing headers link server events to the
browser session; the server always uses Better Auth's user ID, never a client-supplied
distinct ID, for person attribution.

## Coverage and useful dashboard questions

| Journey                     | Events                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              | Suggested analysis                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Acquisition and activation  | `sign_up_submitted`, `sign_up_failed`, `signed_up`, `email_verified`, `sign_in_submitted`, `sign_in_failed`, `social_sign_in_started`, `signed_in`, `onboarding_handle_completed`, `organization_created`, `project_created`, `workspace_opened`, `signed_out`                                                                                                                                                                                                                                                                                                                                                                                                                                                      | Signup → organization → project → first item funnel; weekly returning users                      |
| Team collaboration          | `invitation_created`, `invitation_accepted`, `invitation_cancelled`, `organization_updated`, `organization_member_removed`, `organization_left`, `application_role_changed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Invitation acceptance; organization activation                                                   |
| Authoring                   | `work_item_create_opened`, `work_item_created`, `work_item_opened`, `work_item_updated`, `specification_mode_selected`, `specification_revised`, `work_item_archive_changed`, `proposals_drafted`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Create intent → committed item; revision frequency; use `is_decomposition` for child creation    |
| Review                      | `review_requested`, `review_decided`, `review_cancelled`, `specification_ready`, `specification_readiness_lost`, `approvals_invalidated`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | Request → approval (`decision = approve`) → readiness; revision rework and approval invalidation |
| Discussions and suggestions | `thread_created`, `thread_replied`, `thread_state_changed`, `suggestion_created`, `suggestion_updated`, `suggestion_state_changed`, `suggestion_reviewer_changed`, `suggestion_decided`, `suggestion_merged`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | Blocking discussion resolution (`resolved = true`); suggestion → merged conversion               |
| Discovery                   | `$pageview`, `command_palette_opened`, `command_palette_result_selected`, `work_item_list_configured`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Active surfaces; search adoption; filter, sort and grouping adoption                             |
| Native delivery             | `work_item_ranked`, `work_item_reordered`, `relation_added`, `relation_removed`, `iteration_created`, `iteration_updated`, `iteration_started`, `iteration_completed`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               | Board/backlog adoption; status-category progression; iteration adoption                          |
| External delivery           | `delivery_connection_created`, `delivery_connection_removed`, `delivery_target_configured`, `delivery_target_removed`, `delivery_publish_previewed`, `delivery_publish_requested`, `delivery_publish_completed`, `delivery_item_linked`, `delivery_item_unlinked`                                                                                                                                                                                                                                                                                                                                                                                                                                                   | Preview → publish; completion rate; partial failure/conflict counts                              |
| Configuration               | Team, membership, enabled type, workflow status, work item type, label, milestone and role events from the catalog                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  | Which configuration teams actually use; native versus external adoption                          |
| Supporting flows            | `attachment_uploaded`, `attachment_removed`, `work_item_watch_changed`, `notification_read_changed`, `notification_archive_changed`, `notification_preferences_updated`, `notification_preferences_reset`, `appearance_changed`, `account_profile_updated`, `account_email_change_requested`, `account_password_changed`, `two_factor_disabled`, `two_factor_backup_codes_regenerated`, `passkey_added`, `passkey_removed`, `two_factor_requirement_changed`, `member_two_factor_reset`, `account_sessions_revoked`, `account_session_revoked`, `account_deleted`, `social_account_unlinked`, `password_reset_requested`, `password_reset_completed`, `verification_email_requested`, `action_failed`, `$exception` | Attachments and notification adoption; friction and render failures                              |

For funnels, select the named custom events and filter successful decisions by
`decision`. Hold `work_item_id` constant when measuring the review journey of the
same specification across steps. Use unique users for person activation and `organization_id` for
workspace breakdowns (organization group analytics can also be used when available
on the PostHog plan). Break item activity down by `delivery_mode`,
`work_item_type` or `status_category`; distinguish lifecycle direction with
`archived`, `resolved`, `blocking`, `status` and `decision`.

`delivery_publish_requested` records the successful publish request's returned
state, which can still be `running`. `delivery_publish_completed` records durable
settlement, including scheduled recovery, exactly once per publication transition.
Both carry `publication_id`, `publication_status`, `item_count` and per-outcome
counts (`created_count`, `failed_count`, `conflict_count`, etc.). Do not treat a
partial publication as an all-or-nothing success. Background recovery retains the
requesting user's identity without assigning it to an unrelated browser session.

The documentation site (`apps/docs`) adds a small funnel, all with
`site: "docs"`: `docs_search_opened`, `docs_search_result_selected` (`path` of
the chosen page, never the query), `code_copied` (`surface: cli | mdx`, a
stable `command` id for CLI blocks, never the copied text) and `cta_clicked`
(`cta: github | website`, `placement: nav`, `href`). The website and the
documentation register `site` as a super property in `ConsentProvider`.

## Data boundaries

Explicit analytics excludes document titles/text, discussion bodies/quotes,
suggestion rationales/replacements, search terms, filenames, Jira diagnostics,
external credentials, email addresses and display names. IDs, controlled domain
values, counts, presence flags and changed field **names** are sufficient to
understand behavior. Product activity and server payloads are never spread into
PostHog properties.

Automatic pageviews observe client-side navigation. URLs and referrers lose their
query strings and fragments before capture, including initial person properties;
this protects verification/reset/invitation tokens, email query parameters and list
searches. Document titles and search-engine keywords are removed. Autocapture and
session recording, dead-click capture and heatmaps are disabled so requirement
content and DOM text are not sent.
The global render boundaries send a generic exception without page content;
server failures send categories instead of raw SQL/exception messages.

Keep analytics changes compatible with these boundaries. If product decisions
later require session replay or content collection, make that a deliberate policy
change rather than enabling it as a side effect of an SDK upgrade.
