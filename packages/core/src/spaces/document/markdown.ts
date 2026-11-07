import { formatReference } from "@lictory/core/contracts/references";
import { canonicalizeDocument, type PageNode } from "./canonical";
function escape(text: string) {
  return text.replace(/([\\`*_{}\[\]<>|])/g, "\\$1");
}
/** Deterministic GFM projection, never the source of truth. */
export function documentToMarkdown(json: unknown): string {
  return render(canonicalizeDocument(json));
}
export function fragmentMarkdown(nodes: PageNode[]): string {
  return nodes.map((n) => render(n)).join("\n\n");
}
function render(n: PageNode): string {
  const children = n.content ?? [];
  const inline = () => children.map(render).join("");
  const blocks = () => children.map(render).join("\n\n");
  const a = n.attrs ?? {};
  switch (n.type) {
    case "text": {
      let text = escape(n.text ?? "");
      for (const m of n.marks ?? []) {
        if (m.type === "bold") text = `**${text}**`;
        if (m.type === "italic") text = `*${text}*`;
        if (m.type === "strike") text = `~~${text}~~`;
        if (m.type === "code") {
          const raw = n.text ?? "";
          const fence = "`".repeat(
            Math.max(0, ...(raw.match(/`+/g) ?? []).map((s) => s.length)) + 1,
          );
          text = `${fence} ${raw} ${fence}`;
        }
        if (m.type === "link")
          text = `[${text}](<${String(m.attrs?.href).replace(/>/g, "%3E")}>)`;
      }
      return text;
    }
    case "doc":
      return blocks();
    case "paragraph":
      return inline();
    case "heading":
      return `${"#".repeat(Number(a.level))} ${inline()}`;
    case "hardBreak":
      return "  \n";
    case "horizontalRule":
      return "---";
    case "blockquote":
      return blocks()
        .split("\n")
        .map((l) => `> ${l}`)
        .join("\n");
    case "codeBlock": {
      const raw = children.map((c) => c.text ?? "").join("");
      const fence = "`".repeat(
        Math.max(2, ...(raw.match(/`+/g) ?? []).map((s) => s.length)) + 1,
      );
      return `${fence}${typeof a.language === "string" ? a.language : ""}\n${raw}\n${fence}`;
    }
    case "bulletList":
    case "orderedList":
    case "taskList":
      return children
        .map((c, i) => {
          const prefix =
            n.type === "orderedList"
              ? `${Number(a.start) + i}. `
              : n.type === "taskList"
                ? `- [${c.attrs?.checked ? "x" : " "}] `
                : "- ";
          return render(c)
            .split("\n")
            .map((l, j) => (j === 0 ? prefix : " ".repeat(prefix.length)) + l)
            .join("\n");
        })
        .join("\n");
    case "listItem":
    case "taskItem":
    case "tableCell":
    case "tableHeader":
      return blocks();
    case "table": {
      const rows = children.map((r) =>
        (r.content ?? []).map((c) => render(c).replace(/\n/g, "<br>")),
      );
      const width = Math.max(0, ...rows.map((r) => r.length));
      const row = (r: string[]) =>
        `| ${Array.from({ length: width }, (_, i) => r[i] ?? "").join(" | ")} |`;
      return rows.length
        ? [
            row(rows[0]!),
            row(Array<string>(width).fill("---")),
            ...rows.slice(1).map(row),
          ].join("\n")
        : "";
    }
    case "image":
      return `![${escape(typeof a.alt === "string" ? a.alt : "")}](<${String(a.src).replace(/>/g, "%3E")}>)`;
    case "workItemRef":
      return String(a.key);
    case "pageRef":
      return typeof a.commitId === "string"
        ? formatReference(
            { kind: "page", id: String(a.pageId), commitId: a.commitId },
            "page",
          )
        : `[[page:${String(a.pageId)}]]`;
    case "decisionRef":
      return formatReference(
        { kind: "decision", id: String(a.decisionId) },
        typeof a.label === "string" ? a.label : "decision",
      );
    default:
      return blocks();
  }
}
