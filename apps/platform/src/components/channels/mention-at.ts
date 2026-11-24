// Mentions are written `@[forge](agent:ID)`: the "@" is text before the
// link. This remark step moves it into the link, so a mention renders as one
// chip ("@forge") rather than an "@" beside a highlighted name.

type MdNode = {
  type: string;
  value?: string;
  url?: string;
  children?: MdNode[];
};

const mentionUrl = /^(mention|agent):/;

function join(node: MdNode) {
  const kids = node.children;
  if (!kids) return;
  for (let i = 1; i < kids.length; i++) {
    const link = kids[i]!;
    const before = kids[i - 1]!;
    if (
      link.type === "link" &&
      mentionUrl.test(link.url ?? "") &&
      before.type === "text" &&
      before.value?.endsWith("@")
    ) {
      before.value = before.value.slice(0, -1);
      link.children = [{ type: "text", value: "@" }, ...(link.children ?? [])];
    }
  }
  for (const kid of kids) join(kid);
}

export function remarkMentionAt() {
  return (tree: MdNode) => join(tree);
}
