import { expect, type Page } from "@playwright/test";

// Workspace commands resolve once queued locally; the server accepts them
// asynchronously. Reloading before then aborts the request and races replay of
// the queue against hydration, so the page can change under the next action.
export async function waitUntilSaved(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(
          () =>
            new Promise<number>((resolve, reject) => {
              const open = indexedDB.open("lictory-sync-v2", 1);
              let missing = false;
              // Never create the app's database; nothing is queued without it.
              open.onupgradeneeded = () => {
                missing = true;
                open.transaction?.abort();
              };
              open.onerror = () =>
                missing
                  ? resolve(0)
                  : reject(new Error("Could not open the local queue."));
              open.onsuccess = () => {
                const db = open.result;
                if (!db.objectStoreNames.contains("queue")) {
                  db.close();
                  resolve(0);
                  return;
                }
                const count = db
                  .transaction("queue", "readonly")
                  .objectStore("queue")
                  .count();
                count.onsuccess = () => {
                  db.close();
                  resolve(count.result);
                };
                count.onerror = () => {
                  db.close();
                  reject(new Error("Could not read the local queue."));
                };
              };
            }),
        ),
      { message: "Queued workspace changes were not saved.", timeout: 15_000 },
    )
    .toBe(0);
}

export async function reloadWhenSaved(page: Page) {
  await waitUntilSaved(page);
  await page.reload();
}
