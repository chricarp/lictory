import assert from "node:assert/strict";
import { test } from "node:test";
import {
  updateErrorMessage,
  updateSupport,
  type UpdateEnvironment,
} from "./updates";

const installed: UpdateEnvironment = {
  packaged: true,
  platform: "darwin",
  turnedOff: false,
  appStore: false,
  appImage: false,
  signed: true,
};
const reason = (env: Partial<UpdateEnvironment>) => {
  const support = updateSupport({ ...installed, ...env });
  return support.supported ? null : support.reason;
};

void test("each install says truthfully whether it updates itself", () => {
  // Signed macOS and Windows builds and every AppImage update themselves.
  assert.equal(reason({}), null);
  assert.equal(reason({ platform: "win32" }), null);
  assert.equal(reason({ platform: "linux", appImage: true }), null);

  // A .deb never does: no apt repository serves Lictory, so the package
  // manager is not said to update it.
  const deb = reason({ platform: "linux" });
  assert.match(deb ?? "", /\.deb does not update itself/);
  assert.match(deb ?? "", /download the newest \.deb/);
  assert.doesNotMatch(deb ?? "", /package manager/);

  // Unsigned builds say why per platform and what to do instead.
  assert.match(
    reason({ signed: false }) ?? "",
    /not signed, so macOS does not let it update itself\. To update, download/,
  );
  assert.match(
    reason({ platform: "win32", signed: false }) ?? "",
    /not signed, so it cannot update itself safely/,
  );

  assert.match(reason({ packaged: false }) ?? "", /development builds/);
  assert.match(reason({ turnedOff: true }) ?? "", /LICTORY_DESKTOP_UPDATES/);
});

void test("a release without this system's update reads as that, not a failure", () => {
  assert.equal(
    updateErrorMessage({
      message: "Cannot find latest-linux.yml in the latest release artifacts",
      code: "ERR_UPDATER_CHANNEL_FILE_NOT_FOUND",
    }),
    "The newest release has no update for this system yet. Lictory checks again later.",
  );
  assert.equal(
    updateErrorMessage({ message: "net::ERR_INTERNET_DISCONNECTED\nstack" }),
    "Checking for updates failed: net::ERR_INTERNET_DISCONNECTED",
  );
});
