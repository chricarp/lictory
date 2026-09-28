import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { objectKey, validateFile, MAX_FILE_SIZE } from "./policy";

void describe("file uploads", () => {
  void it("permits supported images and documents up to the limit", () => {
    assert.doesNotThrow(() =>
      validateFile("diagram.png", "image/png", MAX_FILE_SIZE),
    );
    assert.doesNotThrow(() => validateFile("notes.pdf", "application/pdf", 1));
  });
  void it("rejects paths, unsupported or mismatched types, and excess size", () => {
    assert.throws(() => validateFile("../diagram.png", "image/png", 1));
    assert.throws(() => validateFile("script.svg", "image/svg+xml", 1));
    assert.throws(() => validateFile("diagram.png", "text/html", 1));
    assert.throws(() =>
      validateFile("diagram.png", "image/png", MAX_FILE_SIZE + 1),
    );
  });
  void it("separate upload identities keep same-name files distinct", () => {
    const a = objectKey("org-1", "af3a6b13-3f90-40ac-b762-6f092b8ee921");
    const b = objectKey("org-1", "af3a6b13-3f90-40ac-b762-6f092b8ee922");
    assert.notEqual(a, b);
    assert.throws(() =>
      objectKey("../org", "af3a6b13-3f90-40ac-b762-6f092b8ee921"),
    );
  });
});
