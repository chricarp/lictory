// An organization data export as administrators see it. Shared by the server
// and the browser.
export type ExportSummaryView = {
  id: string;
  status: "queued" | "running" | "ready" | "failed" | "expired";
  requestedBy: { id: string; name: string | null };
  createdAt: string;
  completedAt: string | null;
  expiresAt: string | null;
  size: number | null;
  sha256: string | null;
  formatVersion: number;
  error: string | null;
  summary: Record<string, unknown> | null;
};
