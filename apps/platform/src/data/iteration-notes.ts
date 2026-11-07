// The first version of an iteration's notes page: its goal, its scope as
// live item references (each reference shows the item's current status
// wherever the page is read), risks and a retrospective. Canonical page
// JSON (block ids are assigned when the page is proposed). Pure, so the
// template is tested without a browser.

type Node = Record<string, unknown>;

const text = (value: string): Node => ({ type: "text", text: value });
const heading = (level: 2 | 3, value: string): Node => ({
  type: "heading",
  attrs: { level },
  content: [text(value)],
});
const paragraph = (...content: Node[]): Node =>
  content.length ? { type: "paragraph", content } : { type: "paragraph" };
const bullets = (items: Node[][]): Node => ({
  type: "bulletList",
  content: items.map((content) => ({
    type: "listItem",
    content: [paragraph(...content)],
  })),
});

export type NotesItem = { id: string; key: string; title: string };

export function iterationNotesDocument(input: {
  label: string;
  goal: string | null;
  items: readonly NotesItem[];
}): Node {
  const goal = input.goal?.trim();
  return {
    type: "doc",
    content: [
      heading(2, "Goal"),
      goal ? paragraph(text(goal)) : paragraph(),
      heading(2, "Scope"),
      input.items.length
        ? bullets(
            input.items.map((item) => [
              {
                type: "workItemRef",
                attrs: { workItemId: item.id, key: item.key },
              },
              text(` ${item.title}`),
            ]),
          )
        : paragraph(text(`Nothing is planned in ${input.label} yet.`)),
      heading(2, "Risks"),
      bullets([[]]),
      heading(2, "Retrospective"),
      heading(3, "What went well"),
      bullets([[]]),
      heading(3, "What to change"),
      bullets([[]]),
    ],
  };
}
