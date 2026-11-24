import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import {
  assertReachableHost,
  selfManagedOrigin,
} from "@lictory/core/code/egress";
import { CodeHostError } from "@lictory/core/code/provider";

const environment = { ...process.env };
afterEach(() => {
  process.env.NODE_ENV = environment.NODE_ENV;
  process.env.CODE_HOST_PRIVATE_HOSTS = environment.CODE_HOST_PRIVATE_HOSTS;
  if (environment.CODE_HOST_PRIVATE_HOSTS === undefined)
    delete process.env.CODE_HOST_PRIVATE_HOSTS;
});

const refused = (run: () => unknown) =>
  assert.throws(
    run,
    (e) => e instanceof CodeHostError && e.kind === "validation",
  );

void test("self-managed hosts: https origins with an optional path prefix", () => {
  assert.equal(
    selfManagedOrigin("https://gitlab.example.com/", "GitLab"),
    "https://gitlab.example.com",
  );
  assert.equal(
    selfManagedOrigin("code.example.com/gitlab", "GitLab"),
    "https://code.example.com/gitlab",
  );
  refused(() => selfManagedOrigin("http://gitlab.example.com", "GitLab"));
  refused(() =>
    selfManagedOrigin("https://user:pw@gitlab.example.com", "GitLab"),
  );
  refused(() => selfManagedOrigin("https://gitlab.example.com/?a=1", "GitLab"));
});

void test("cloud metadata and link-local addresses are always refused", () => {
  process.env.CODE_HOST_PRIVATE_HOSTS = "169.254.169.254";
  refused(() => assertReachableHost("169.254.169.254"));
  refused(() => assertReachableHost("metadata.google.internal"));
  refused(() => assertReachableHost("[fd00:ec2::254]"));
  refused(() => selfManagedOrigin("https://169.254.169.254", "GitLab"));
});

void test("private hosts need the operator's allowlist", () => {
  process.env.NODE_ENV = "production";
  delete process.env.CODE_HOST_PRIVATE_HOSTS;
  refused(() => assertReachableHost("10.0.0.5"));
  refused(() => assertReachableHost("gitlab.internal"));
  refused(() => assertReachableHost("localhost"));
  refused(() => assertReachableHost("gitlab"));
  assert.doesNotThrow(() => assertReachableHost("gitlab.com"));
  process.env.CODE_HOST_PRIVATE_HOSTS = "gitlab.internal, 10.0.0.5";
  assert.doesNotThrow(() => assertReachableHost("gitlab.internal"));
  assert.doesNotThrow(() => assertReachableHost("10.0.0.5"));
  // An allowlisted private host may use plain http.
  assert.equal(
    selfManagedOrigin("http://gitlab.internal", "GitLab"),
    "http://gitlab.internal",
  );
});

void test("loopback stand-ins are reachable outside production only", () => {
  delete process.env.CODE_HOST_PRIVATE_HOSTS;
  process.env.NODE_ENV = "development";
  assert.equal(
    selfManagedOrigin("http://127.0.0.1:9000", "GitHub"),
    "http://127.0.0.1:9000",
  );
  process.env.NODE_ENV = "production";
  refused(() => selfManagedOrigin("http://127.0.0.1:9000", "GitHub"));
});
