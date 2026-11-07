// Preloaded by scripts/test-e2e.ts into the API and worker it starts
// (`node --import`), never by a production process: production images do not
// contain scripts/, and nothing else names this file.
//
// It routes requests for the fake Jira Cloud site to the browser suite's
// local stand-in (scripts/e2e-fakes/jira.ts), the way /etc/hosts would. The
// Jira adapter keeps every production check: the site still has to be an
// https Atlassian host, so the site allowlist that blocks server-side request
// forgery is exercised, not relaxed. Only the transport is swapped, for
// exactly the origins in E2E_FAKE_ROUTES ({"https://site": "http://127.0.0.1:port"}).
const routes = new Map(
  Object.entries(
    JSON.parse(process.env.E2E_FAKE_ROUTES ?? "{}") as Record<string, string>,
  ),
);
const realFetch = globalThis.fetch;

globalThis.fetch = (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const target = routes.get(url.origin);
  if (!target) return realFetch(input, init);
  const routed = `${target}${url.pathname}${url.search}`;
  return input instanceof Request
    ? realFetch(new Request(routed, input), init)
    : realFetch(routed, init);
};
