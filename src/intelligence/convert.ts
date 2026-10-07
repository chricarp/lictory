import { createHash } from "node:crypto";
import {
  formatFromBytes,
  formatFromExtension,
  toMarkdownBytes,
  type Format,
} from "@firecrawl/anydoc";
import {
  MAX_CONTEXT_CONTENT,
  MAX_CONTEXT_DOCUMENT_SIZE,
  contextDocumentExtensions,
} from "./shared";

export class ConversionError extends Error {}

export type ConvertedDocument = {
  markdown: string;
  format: string;
  size: number;
  sha256: string;
};

const extensionOf = (filename: string) =>
  filename.includes(".") ? filename.split(".").pop()!.toLowerCase() : "";

// Converts an uploaded document to Markdown on this server. Conversion is
// local: scanned PDFs are rejected rather than sent to a hosted OCR service.
export async function convertDocument(
  filename: string,
  bytes: Uint8Array,
): Promise<ConvertedDocument> {
  if (!filename || filename.length > 255 || /[\\/\x00-\x1f\x7f]/.test(filename))
    throw new ConversionError(
      "Use a filename without paths or control characters.",
    );
  if (bytes.byteLength < 1) throw new ConversionError("The file is empty.");
  if (bytes.byteLength > MAX_CONTEXT_DOCUMENT_SIZE)
    throw new ConversionError(
      `Documents can be at most ${MAX_CONTEXT_DOCUMENT_SIZE / 1024 / 1024} MB.`,
    );
  const extension = extensionOf(filename);
  if (!(contextDocumentExtensions as readonly string[]).includes(extension))
    throw new ConversionError(
      "This file type is not supported. Upload PDF, Word, PowerPoint, Excel, OpenDocument, RTF, EPUB, CSV, Markdown or text.",
    );
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  let markdown: string;
  let format: string;
  if (["md", "markdown", "txt"].includes(extension)) {
    markdown = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
    if (markdown.includes("\u0000"))
      throw new ConversionError("The file is not readable text.");
    format = extension === "txt" ? "text" : "markdown";
  } else {
    // Content decides the format; the extension only names signature-less
    // formats such as CSV.
    const detected: Format | null =
      formatFromBytes(bytes) ?? formatFromExtension(extension);
    if (!detected)
      throw new ConversionError("The file content is not a supported format.");
    format = detected;
    try {
      markdown = await toMarkdownBytes(bytes, detected, { ocr: "reject" });
    } catch (error) {
      throw new ConversionError(describe(error));
    }
  }
  markdown = markdown.replace(/\r\n?/g, "\n").trim();
  if (!markdown)
    throw new ConversionError("No text could be extracted from this document.");
  if (markdown.length > MAX_CONTEXT_CONTENT)
    throw new ConversionError(
      `The converted document has ${markdown.length.toLocaleString("en-US")} characters; the limit is ${MAX_CONTEXT_CONTENT.toLocaleString("en-US")}. Upload the relevant part only.`,
    );
  return { markdown, format, size: bytes.byteLength, sha256 };
}

function describe(error: unknown) {
  const code = (error as { code?: string } | null)?.code;
  switch (code) {
    case "needsOcr":
      return "This PDF contains scanned pages without text. Upload a text-based version.";
    case "encrypted":
      return "This document is password-protected. Upload an unprotected copy.";
    case "unsupported":
      return "This file type is not supported.";
    case "malformed":
    case "missingPart":
      return "This document is damaged or incomplete and could not be read.";
    case "resourceLimit":
      return "This document is too complex to convert. Split it into smaller documents.";
    default:
      return "This document could not be converted.";
  }
}
