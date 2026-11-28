import assert from "node:assert/strict";
import { test } from "node:test";
import { describeNetworkError, networkErrorCode } from "./net-errors";

void test("network errors read as plain words with the next step", () => {
  // As did-fail-load reports them (name or number) and as fetch throws them.
  assert.equal(
    networkErrorCode("ERR_CONNECTION_REFUSED"),
    "ERR_CONNECTION_REFUSED",
  );
  assert.equal(networkErrorCode(-106), "ERR_INTERNET_DISCONNECTED");
  assert.equal(networkErrorCode("net::ERR_UNSAFE_PORT"), "ERR_UNSAFE_PORT");
  assert.equal(networkErrorCode("socket hang up"), null);

  const refused = describeNetworkError(
    "ERR_CONNECTION_REFUSED",
    "lictory.example.com",
  );
  assert.equal(refused.summary, "lictory.example.com refused the connection.");
  assert.match(refused.next, /down or restarting/);
  assert.equal(refused.code, "ERR_CONNECTION_REFUSED");

  const offline = describeNetworkError(-106, "lictory.example.com");
  assert.equal(offline.summary, "This computer is offline.");

  const certificate = describeNetworkError(
    "net::ERR_CERT_AUTHORITY_INVALID",
    "lictory.example.com",
  );
  assert.match(certificate.summary, /certificate .* not trusted/);
  assert.match(certificate.next, /administrator/);

  // Nothing known: still a sentence, never the raw code as the message.
  const unknown = describeNetworkError("ERR_SOMETHING_NEW", "x.example");
  assert.equal(unknown.summary, "x.example could not be loaded.");
  assert.equal(unknown.code, "ERR_SOMETHING_NEW");
  for (const problem of [refused, offline, certificate, unknown]) {
    assert.doesNotMatch(problem.summary, /ERR_/);
    assert.doesNotMatch(problem.next, /ERR_/);
  }
});
