import assert from "node:assert/strict";
import { test } from "node:test";
import {
  decideNavigation,
  decideWindowOpen,
  SIGN_IN_WINDOW_MS,
} from "./navigation";
import { checkPermission, decidePermission, mediaPrompt } from "./permissions";
import {
  inAppPathOf,
  isInAppPath,
  isLoopbackHost,
  isSafeExternalUrl,
} from "./urls";

const server = "https://lictory.example.com";
const servers = [
  { id: "server-a1", origin: server },
  { id: "server-b2", origin: "https://other.example.org" },
];
const context = { serverOrigin: server, servers, signInUntil: null, now: 1000 };

void test("loopback hosts are recognised", () => {
  for (const host of ["localhost", "app.localhost", "127.0.0.1", "[::1]"])
    assert.equal(isLoopbackHost(host), true, host);
  for (const host of ["lictory.example.com", "10.0.0.1", "localhost.example"])
    assert.equal(isLoopbackHost(host), false, host);
});

void test("in-app paths cannot name another origin", () => {
  assert.equal(isInAppPath("/acme/items/PAY-1?pr=2#c"), true);
  assert.equal(isInAppPath("/"), true);
  for (const path of [
    "//evil.example.com/x",
    "/\\evil.example.com",
    "https://evil.example.com",
    "acme/items",
    "/a\nb",
    "",
    42,
    null,
    `/${"a".repeat(5000)}`,
  ])
    assert.equal(isInAppPath(path), false, String(path));
});

void test("the in-app path of a URL is read only on its own origin", () => {
  assert.equal(
    inAppPathOf(`${server}/acme/inbox?x=1#top`, server),
    "/acme/inbox?x=1#top",
  );
  assert.equal(inAppPathOf("https://other.example.org/acme", server), null);
});

void test("only web and mail links are handed to the operating system", () => {
  for (const url of [
    "https://github.com/acme/repo/pull/1",
    "http://example.com",
    "mailto:someone@example.com",
  ])
    assert.equal(isSafeExternalUrl(url), true, url);
  for (const url of [
    "file:///etc/passwd",
    "smb://share/x",
    "ms-msdt:/id",
    "javascript:alert(1)",
    "vscode://file/x",
    "https://user:secret@example.com",
    "not a url",
    `https://example.com/${"a".repeat(9000)}`,
  ])
    assert.equal(isSafeExternalUrl(url), false, url);
});

void test("the server's own pages load in its view", () => {
  const { decision } = decideNavigation(`${server}/acme/inbox`, context);
  assert.deepEqual(decision, { kind: "allow" });
});

void test("another configured server opens in its own view", () => {
  const { decision } = decideNavigation(
    "https://other.example.org/team/items/A-1",
    context,
  );
  assert.deepEqual(decision, {
    kind: "switch",
    serverId: "server-b2",
    url: "https://other.example.org/team/items/A-1",
  });
});

void test("other sites open in the browser, unsafe schemes nowhere", () => {
  assert.deepEqual(
    decideNavigation("https://docs.lictory.com/x", context).decision,
    { kind: "external", url: "https://docs.lictory.com/x" },
  );
  assert.deepEqual(decideNavigation("file:///etc/hosts", context).decision, {
    kind: "block",
  });
  assert.deepEqual(decideNavigation("::", context).decision, { kind: "block" });
});

void test("an identity provider sign-in returning to the server stays in the view", () => {
  const authorize = `https://idp.example.net/authorize?client_id=x&redirect_uri=${encodeURIComponent(`${server}/api/auth/callback/oidc`)}`;
  const start = decideNavigation(authorize, context);
  assert.deepEqual(start.decision, { kind: "allow" });
  assert.equal(start.signInUntil, 1000 + SIGN_IN_WINDOW_MS);

  // The provider's own pages (another host) are allowed during the flow.
  const mfa = decideNavigation("https://login.idp-mfa.example.net/verify", {
    ...context,
    signInUntil: start.signInUntil,
    now: 5000,
  });
  assert.deepEqual(mfa.decision, { kind: "allow" });

  // Back on the server ends the flow.
  const back = decideNavigation(`${server}/api/auth/callback/oidc?code=1`, {
    ...context,
    signInUntil: start.signInUntil,
    now: 6000,
  });
  assert.equal(back.signInUntil, null);

  // After the window, other sites open in the browser again.
  const late = decideNavigation("https://login.idp-mfa.example.net/verify", {
    ...context,
    signInUntil: start.signInUntil,
    now: 1000 + SIGN_IN_WINDOW_MS + 1,
  });
  assert.equal(late.decision.kind, "external");
});

void test("an authorization request for another site is not a sign-in to this server", () => {
  const authorize = `https://idp.example.net/authorize?redirect_uri=${encodeURIComponent("https://attacker.example/cb")}`;
  assert.equal(decideNavigation(authorize, context).decision.kind, "external");
  const plain = `http://idp.example.net/authorize?redirect_uri=${encodeURIComponent(`${server}/cb`)}`;
  assert.equal(decideNavigation(plain, context).decision.kind, "external");
});

void test("new windows never open in the app", () => {
  assert.deepEqual(decideWindowOpen(`${server}/acme`, context), {
    kind: "allow",
  });
  assert.equal(
    decideWindowOpen("https://other.example.org/x", context).kind,
    "switch",
  );
  assert.equal(
    decideWindowOpen("https://github.com", context).kind,
    "external",
  );
  assert.equal(decideWindowOpen("javascript:void(0)", context).kind, "block");
});

void test("pages get notifications and clipboard writes, media on request, nothing else", () => {
  const ask = (permission: string, origin = server, isMainFrame = true) =>
    decidePermission({
      permission,
      requestingOrigin: origin,
      serverOrigin: server,
      isMainFrame,
    });
  assert.equal(ask("notifications"), "allow");
  assert.equal(ask("clipboard-sanitized-write"), "allow");
  assert.equal(ask("media"), "ask");
  for (const permission of [
    "geolocation",
    "clipboard-read",
    "midi",
    "openExternal",
    "display-capture",
    "fullscreen",
    "unknown",
  ])
    assert.equal(ask(permission), "deny", permission);
  assert.equal(ask("notifications", "https://idp.example.net"), "deny");
  assert.equal(ask("notifications", server, false), "deny");

  const check = (permission: string, mediaAllowed: boolean) =>
    checkPermission(
      { permission, requestingOrigin: server, serverOrigin: server },
      mediaAllowed,
    );
  assert.equal(check("notifications", false), true);
  assert.equal(check("media", false), false);
  assert.equal(check("media", true), true);
  assert.equal(
    mediaPrompt("lictory.example.com", ["audio", "video"]),
    "lictory.example.com wants to use your camera and microphone.",
  );
});
