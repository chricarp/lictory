import { describe, expect, it } from "vitest";

import { isPreviewableDocument, toDownloadUrl } from "./media";

describe("toDownloadUrl", () => {
  it("adds the download hint without dropping the signature", () => {
    const signed =
      "https://api.lictory.test/media/asset_1?u=user_1&e=1700000000&s=abc";
    const url = new URL(toDownloadUrl(signed));
    expect(url.searchParams.get("d")).toBe("1");
    expect(url.searchParams.get("s")).toBe("abc");
    expect(url.searchParams.get("u")).toBe("user_1");
  });

  it("does not duplicate the hint", () => {
    const once = toDownloadUrl("https://api.lictory.test/media/a?u=1&e=2&s=3");
    expect(toDownloadUrl(once)).toBe(once);
  });

  it("leaves composer object URLs alone", () => {
    expect(toDownloadUrl("blob:https://lictory.test/abc")).toBe(
      "blob:https://lictory.test/abc",
    );
  });
});

describe("isPreviewableDocument", () => {
  it("knows what the browser can render", () => {
    expect(isPreviewableDocument("application/pdf")).toBe(true);
    expect(isPreviewableDocument("text/markdown")).toBe(true);
    expect(
      isPreviewableDocument(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe(false);
  });
});
