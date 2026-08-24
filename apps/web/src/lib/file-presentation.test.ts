import { describe, expect, it } from "vitest";

import { getFilePresentation } from "./file-presentation";

describe("getFilePresentation", () => {
  it.each([
    ["brief.pdf", "application/octet-stream", "PDF document", "pdf"],
    ["plan.DOCX", "application/octet-stream", "Word document", "word"],
    ["budget.xlsx", "application/octet-stream", "Excel spreadsheet", "sheet"],
    [
      "pitch.pptx",
      "application/octet-stream",
      "PowerPoint presentation",
      "slides",
    ],
  ] as const)("recognises %s by extension", (name, mime, label, tone) => {
    expect(getFilePresentation(name, mime)).toMatchObject({ label, tone });
  });

  it("falls back to the MIME type when the filename has no extension", () => {
    expect(getFilePresentation("report", "application/pdf")).toEqual({
      extension: "pdf",
      label: "PDF document",
      tone: "pdf",
    });
  });

  it("keeps unknown files legible", () => {
    expect(
      getFilePresentation("model.custom", "application/octet-stream"),
    ).toEqual({ extension: "custom", label: "File", tone: "file" });
  });
});
