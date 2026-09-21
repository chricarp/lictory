export default function HomePage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center px-6 py-24">
      <div className="flex max-w-md flex-col gap-4 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">Lictory</h1>
        <p className="text-lg text-zinc-600 dark:text-zinc-400">
          Collaborative engineering readiness.
        </p>
        <p className="font-mono text-sm text-zinc-500">
          Project scaffold is running.
        </p>
      </div>
    </main>
  );
}
