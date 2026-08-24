export type FilePresentation = {
  extension: string;
  label: string;
  tone: "pdf" | "word" | "sheet" | "slides" | "text" | "archive" | "file";
};

const PRESENTATIONS: Record<string, Omit<FilePresentation, "extension">> = {
  pdf: { label: "PDF document", tone: "pdf" },
  doc: { label: "Word document", tone: "word" },
  docx: { label: "Word document", tone: "word" },
  odt: { label: "Text document", tone: "word" },
  xls: { label: "Excel spreadsheet", tone: "sheet" },
  xlsx: { label: "Excel spreadsheet", tone: "sheet" },
  ods: { label: "Spreadsheet", tone: "sheet" },
  csv: { label: "CSV spreadsheet", tone: "sheet" },
  ppt: { label: "PowerPoint presentation", tone: "slides" },
  pptx: { label: "PowerPoint presentation", tone: "slides" },
  odp: { label: "Presentation", tone: "slides" },
  txt: { label: "Text document", tone: "text" },
  md: { label: "Markdown document", tone: "text" },
  markdown: { label: "Markdown document", tone: "text" },
  rtf: { label: "Rich text document", tone: "text" },
  json: { label: "JSON document", tone: "text" },
  xml: { label: "XML document", tone: "text" },
  zip: { label: "ZIP archive", tone: "archive" },
  rar: { label: "RAR archive", tone: "archive" },
  "7z": { label: "7Z archive", tone: "archive" },
  tar: { label: "TAR archive", tone: "archive" },
  gz: { label: "GZIP archive", tone: "archive" },
};

const MIME_EXTENSIONS: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-excel": "xls",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "text/csv": "csv",
  "text/markdown": "md",
  "application/json": "json",
  "application/rtf": "rtf",
  "application/zip": "zip",
};

/** Gives non-previewable attachments a familiar, stable visual identity. */
export function getFilePresentation(
  fileName: string,
  contentType: string,
): FilePresentation {
  const nameExtension = fileName.match(/\.([^.]+)$/)?.[1]?.toLowerCase();
  const mimeExtension = MIME_EXTENSIONS[contentType.toLowerCase()];
  const extension = nameExtension ?? mimeExtension ?? "file";
  const presentation = PRESENTATIONS[extension];

  if (presentation) return { extension, ...presentation };
  if (contentType.startsWith("text/")) {
    return { extension, label: "Text document", tone: "text" };
  }

  return { extension, label: "File", tone: "file" };
}
