export default function WorkspaceLoading() {
  return (
    <main
      aria-label="Opening workspace"
      className="mx-auto max-w-5xl space-y-5 p-8"
    >
      <div className="h-7 w-48 animate-pulse rounded bg-muted" />
      <div className="h-64 animate-pulse rounded-xl bg-muted" />
    </main>
  );
}
