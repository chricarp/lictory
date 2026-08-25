/**
 * Helpers for the signed capability URLs the API hands back on `note.attachments`.
 *
 * The API and the web app are different origins, so `<a download>` is ignored by
 * the browser. `GET /media/:id` therefore accepts `?d=1` and answers with a
 * `content-disposition: attachment` instead, which is the only reliable way to
 * make a click save the file under its original name.
 */
export function toDownloadUrl(url: string): string {
  // Composer drafts hold a local `blob:` URL, which already downloads natively.
  if (!url.startsWith("http")) return url;
  try {
    const parsed = new URL(url);
    parsed.searchParams.set("d", "1");
    return parsed.toString();
  } catch {
    return url;
  }
}

/** Content types the browser can render on its own inside a preview frame. */
export function isPreviewableDocument(contentType: string): boolean {
  return (
    contentType === "application/pdf" ||
    contentType.startsWith("text/") ||
    contentType === "application/json"
  );
}
