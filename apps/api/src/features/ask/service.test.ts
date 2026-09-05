import { describe, expect, it } from "vitest";

import {
  fallbackConversationTitle,
  questionTerms,
  rankNoteCorpus,
} from "./service";

const base = {
  id: "note-1",
  title: "Project ideas",
  body_markdown: "Met Sam at the library.",
  ai_summary: null,
  ai_analysis: null,
  audio_text: "",
  image_text: "",
  document_text: "",
  entity_text: "person: Sam place: Central Library",
  created_at: "2026-08-28T10:00:00.000Z",
};

describe("Ask retrieval", () => {
  it("drops conversational filler while retaining useful terms", () => {
    expect(questionTerms("What do my notes say about Sam?")).toEqual(["sam"]);
  });

  it("finds attachment context and reports its original modality", () => {
    const ranked = rankNoteCorpus(
      [
        base,
        {
          ...base,
          id: "note-2",
          title: "Voice memo",
          body_markdown: "",
          audio_text: "The launch budget is twelve thousand euros.",
          entity_text: "topic: launch planning",
        },
      ],
      "What was the launch budget?",
    );

    expect(ranked[0]?.row.id).toBe("note-2");
    expect(ranked[0]?.sourceKinds).toContain("audio");
    expect(ranked[0]?.excerpt).toContain("twelve thousand euros");
  });

  it("does not return unrelated recent notes as evidence", () => {
    expect(rankNoteCorpus([base], "Where did I leave my passport?")).toEqual(
      [],
    );
  });

  it("does not confuse a query token with a substring inside another word", () => {
    expect(
      rankNoteCorpus(
        [{ ...base, ai_analysis: "A present for someone." }],
        "Who sent the forms?",
      ),
    ).toEqual([]);
  });

  it("returns newest readable notes for a broad recency question", () => {
    const ranked = rankNoteCorpus(
      [
        base,
        {
          ...base,
          id: "note-older",
          created_at: "2026-08-27T10:00:00.000Z",
        },
      ],
      "What have I written about recently?",
    );

    expect(ranked.map((result) => result.row.id)).toEqual([
      "note-1",
      "note-older",
    ]);
  });
});

describe("Ask conversation titles", () => {
  it("uses a compact deterministic title without an AI configuration", () => {
    expect(
      fallbackConversationTitle([
        "What decisions are still waiting on me from the launch meeting?",
      ]),
    ).toBe("What decisions are still waiting on me…");
  });

  it("has a useful title for an empty historical conversation", () => {
    expect(fallbackConversationTitle([])).toBe("New conversation");
  });
});
