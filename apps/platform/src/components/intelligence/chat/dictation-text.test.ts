import assert from "node:assert/strict";
import { test } from "node:test";
import {
  applyEdit,
  begin,
  type Dictation,
  diff,
  discard,
  mapCaret,
  write,
} from "@lictory/platform/components/intelligence/chat/dictation-text";

// Simulates the composer: the person's edits and the transcript share a draft.
function session(initial: string, caret: number) {
  let value = initial;
  let d: Dictation = begin(caret);
  return {
    hear(spoken: string, final = false) {
      const r = write(value, d, spoken, final);
      if (r) {
        value = r.value;
        d = r.dictation;
      }
      return value;
    },
    type(next: string) {
      d = applyEdit(d, diff(value, next));
      value = next;
      return value;
    },
    cancel() {
      value = discard(value, d)?.value ?? value;
      return value;
    },
    get dictation() {
      return d;
    },
  };
}

void test("streams words in at the caret, not at the end", () => {
  const s = session("Create a story about  in PAY", 21);
  s.hear("refund");
  assert.equal(
    s.hear("refund retries"),
    "Create a story about refund retries in PAY",
  );
});

void test("adds a separating space after a word and before following text on final", () => {
  const s = session("Ask aboutthe board", 9);
  assert.equal(s.hear("sprint"), "Ask about sprintthe board");
  assert.equal(s.hear("sprint", true), "Ask about sprint the board");
});

void test("final transcript corrects partial words while untouched", () => {
  const s = session("", 0);
  s.hear("Their is a blok");
  assert.equal(s.hear("There is a block.", true), "There is a block.");
});

void test("typing before the dictation keeps words flowing into the original spot", () => {
  const s = session("Hello  end", 6);
  s.hear("big");
  s.type("Oh, Hello big end");
  assert.equal(s.hear("big world"), "Oh, Hello big world end");
  assert.equal(s.dictation.pristine, true);
});

void test("typing after the dictation is not overwritten", () => {
  const s = session("A ", 2);
  s.hear("one");
  s.type("A one!!");
  assert.equal(s.hear("one two"), "A one two!!");
});

void test("editing dictated words stops rewriting them; new words are appended", () => {
  const s = session("", 0);
  s.hear("the quik brown");
  s.type("the quick brown");
  assert.equal(s.dictation.pristine, false);
  assert.equal(s.hear("the quik brown fox"), "the quick brown fox");
  // The final transcript does not undo the person's fix.
  assert.equal(s.hear("The quick brown fox.", true), "the quick brown fox");
});

void test("cancel removes untouched dictation and keeps edited dictation", () => {
  const a = session("Keep  this", 5);
  a.hear("spoken");
  assert.equal(a.cancel(), "Keep  this");

  const b = session("", 0);
  b.hear("spoken words");
  b.type("spoken word");
  assert.equal(b.cancel(), "spoken word");
});

void test("the caret follows the end of growing dictation and stays put elsewhere", () => {
  const change = { at: 4, removed: 3, inserted: 8 };
  assert.equal(mapCaret(7, change), 12); // was at the end of the range
  assert.equal(mapCaret(2, change), 2); // before
  assert.equal(mapCaret(10, change), 15); // after
  assert.equal(mapCaret(4, { at: 4, removed: 0, inserted: 5 }), 9); // empty range
});
