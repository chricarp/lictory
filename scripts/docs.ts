import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import { fromMarkdown } from "mdast-util-from-markdown";
import { gfm } from "micromark-extension-gfm";
import { gfmFromMarkdown } from "mdast-util-gfm";
import type { RootContent } from "mdast";
import { z } from "zod";

const root = resolve(import.meta.dirname, "..");
const docs = resolve(root, "docs");
const navigation = z
  .object({
    version: z.literal(1),
    title: z.string().min(1),
    sections: z
      .array(
        z.object({
          id: z.string().regex(/^[a-z][a-z-]*$/),
          title: z.string().min(1),
          pages: z
            .array(
              z.object({
                path: z.string().endsWith(".md"),
                title: z.string().min(1),
              }),
            )
            .min(1),
        }),
      )
      .min(1),
  })
  .parse(JSON.parse(await readFile(resolve(docs, "navigation.json"), "utf8")));

async function markdownFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await markdownFiles(path)));
    else if (entry.name.endsWith(".md")) files.push(path);
  }
  return files;
}
function nodes(content: RootContent[]): RootContent[] {
  return content.flatMap((node) => [
    node,
    ...("children" in node ? nodes(node.children as RootContent[]) : []),
  ]);
}
const pages = navigation.sections.flatMap((section) =>
  section.pages.map((page) => ({ ...page, section: section.id })),
);
const seen = new Set<string>();
const errors: string[] = [];
const exported: {
  path: string;
  route: string;
  title: string;
  section: string;
  markdown: string;
}[] = [];
for (const page of pages) {
  const path = resolve(docs, page.path);
  if (!path.startsWith(`${docs}${sep}`) || seen.has(path)) {
    errors.push(`Invalid or duplicate navigation path: ${page.path}`);
    continue;
  }
  seen.add(path);
  try {
    const markdown = await readFile(path, "utf8");
    exported.push({
      ...page,
      route: `/${page.path.replace(/\.md$/, "")}`,
      markdown,
    });
  } catch {
    errors.push(`Missing navigation page: ${page.path}`);
  }
}
const files = await markdownFiles(docs);
for (const path of files) {
  if (path !== resolve(docs, "README.md") && !seen.has(path))
    errors.push(`Unlisted documentation page: ${relative(docs, path)}`);
}
// Validate local links in published docs and contributor entry points without
// contacting external sites or requiring a particular website generator.
for (const name of [
  "README.md",
  "CONTRIBUTING.md",
  "GOVERNANCE.md",
  "CODE_OF_CONDUCT.md",
  "SECURITY.md",
  "src/cloud/README.md",
])
  files.push(resolve(root, name));
for (const path of files) {
  const tree = fromMarkdown(await readFile(path, "utf8"), {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  });
  for (const node of nodes(tree.children)) {
    if (
      node.type !== "link" &&
      node.type !== "image" &&
      node.type !== "definition"
    )
      continue;
    const url = node.url;
    if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(url)) continue;
    const target = resolve(
      dirname(path),
      decodeURIComponent(url.split(/[?#]/)[0]!),
    );
    if (!target.startsWith(`${root}${sep}`)) {
      errors.push(`${relative(root, path)}: link escapes repository: ${url}`);
      continue;
    }
    try {
      await stat(target);
    } catch {
      errors.push(`${relative(root, path)}: missing local link: ${url}`);
    }
  }
}
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
const command = process.argv[2] ?? "check";
if (command === "export") {
  const output = resolve(root, ".docs-build/content.json");
  await mkdir(dirname(output), { recursive: true });
  await writeFile(
    output,
    `${JSON.stringify({ version: 1, navigation, pages: exported }, null, 2)}\n`,
  );
  console.info(
    `Exported ${exported.length} pages to ${relative(root, output)}.`,
  );
} else if (command !== "check") {
  throw new Error("Usage: bun scripts/docs.ts check|export");
}
console.info(
  `Documentation navigation and local file links verified (${exported.length} pages).`,
);
