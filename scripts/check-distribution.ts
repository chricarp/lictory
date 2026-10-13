import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve, sep } from "node:path";
import ts from "typescript";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "src");
const cloud = resolve(source, "cloud");
const errors: string[] = [];
async function inspect(directory: string): Promise<void> {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = resolve(directory, entry.name);
    if (file === cloud) continue;
    if (entry.isDirectory()) {
      await inspect(file);
      continue;
    }
    if (!/\.[cm]?[jt]sx?$/.test(file)) continue;
    const ast = ts.createSourceFile(
      file,
      await readFile(file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
    );
    const check = (value: ts.Node) => {
      if (!ts.isStringLiteralLike(value)) return;
      const target = value.text.startsWith("~/")
        ? resolve(source, value.text.slice(2))
        : value.text.startsWith(".")
          ? resolve(dirname(file), value.text)
          : undefined;
      if (target && (target === cloud || target.startsWith(`${cloud}${sep}`)))
        errors.push(
          `${relative(root, file)} imports official cloud tooling: ${value.text}`,
        );
    };
    const visit = (node: ts.Node): void => {
      if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
        if (node.moduleSpecifier) check(node.moduleSpecifier);
      } else if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) &&
            node.expression.text === "require"))
      ) {
        if (node.arguments[0]) check(node.arguments[0]);
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
}
await inspect(source);
if (errors.length) {
  console.error(errors.join("\n"));
  process.exit(1);
}
console.info("Application modules are independent of official cloud tooling.");
