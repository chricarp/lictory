import {
  formatFromPath,
  initSync,
  toMarkdownBytes,
} from "@firecrawl/anydoc-wasm";
import anydocWasm from "@firecrawl/anydoc-wasm/anydoc_wasm_bg.wasm";

let initialized = false;

function initializeAnydoc() {
  if (initialized) return;
  initSync({ module: anydocWasm });
  initialized = true;
}

/**
 * Converts an uploaded document inside the Worker. AnyDoc detects container
 * formats from their bytes; the filename only supplies the format for
 * signature-less inputs such as CSV.
 */
export function convertDocumentToMarkdown(
  fileName: string,
  bytes: ArrayBuffer,
): string {
  initializeAnydoc();
  const input = new Uint8Array(bytes);
  const format = formatFromPath(fileName);
  const markdown = toMarkdownBytes(input, format);
  return markdown.trim();
}
