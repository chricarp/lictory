import { expect, type Page } from "@playwright/test";

// Workspace commands resolve once applied locally; Zero sends them to the
// server in the background. Reloading before the server answered would leave
// the outcome to Zero's replay, so tests wait until the workspace reports no
// change awaiting the server and a live connection.
export async function waitUntilSaved(page: Page) {
  const status = page.locator("[data-sync-status]").first();
  // Pages outside a workspace (onboarding, account) send no workspace changes
  // that a reload could interrupt.
  if ((await status.count()) === 0) return;
  await expect(status, "Workspace changes were not saved.").toHaveAttribute(
    "data-pending",
    "0",
    { timeout: 15_000 },
  );
  await expect(status).toHaveAttribute("data-sync-status", /^(idle|busy)$/);
}

export async function reloadWhenSaved(page: Page) {
  await waitUntilSaved(page);
  await page.reload();
}

// Zero writes unsent changes to IndexedDB once the tab is idle (about a
// second after the change). Until then, leaving the page loses them; tests
// that leave the page wait until the change is stored on the device.
export async function waitUntilStoredLocally(page: Page, fragment: string) {
  await expect
    .poll(
      () =>
        page.evaluate(async (needle) => {
          const read = (name: string) =>
            new Promise<string>((resolve) => {
              const open = indexedDB.open(name);
              open.onerror = () => resolve("");
              open.onsuccess = () => {
                const db = open.result;
                const stores = [...db.objectStoreNames];
                if (!stores.length) {
                  db.close();
                  return resolve("");
                }
                const tx = db.transaction(stores, "readonly");
                const parts: unknown[] = [];
                for (const store of stores)
                  tx.objectStore(store).getAll().onsuccess = (event) =>
                    parts.push((event.target as IDBRequest).result);
                tx.oncomplete = () => {
                  db.close();
                  resolve(JSON.stringify(parts));
                };
                tx.onerror = () => resolve("");
              };
            });
          for (const database of await indexedDB.databases())
            if (database.name?.startsWith("rep:"))
              if ((await read(database.name)).includes(needle)) return true;
          return false;
        }, fragment),
      { message: `"${fragment}" was not stored on this device.` },
    )
    .toBe(true);
}
