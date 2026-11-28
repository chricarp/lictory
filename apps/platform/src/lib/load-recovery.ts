// A page whose application code fails to load would otherwise stay blank or
// broken: the browser runs nothing when one module of the entry's static
// graph fails, and a lazy chunk that fails ends a navigation in an error
// (a network change aborting every request in flight, a dropped connection,
// or a deployment that replaced the assets mid-load). The document runs
// recoverFailedLoad inline, before any module. When the entry script or a
// lazy chunk (Vite's vite:preloadError) fails to load, it reloads the page,
// up to three times in a row, a little later each time (network changes
// come in bursts). Past that, a failed entry says the page didn't load and
// offers a reload (which starts the count again); a failed chunk leaves the
// app's own error page. The count is not reset when the app starts, so a
// chunk that keeps failing cannot reload the page forever.

export const loadRecoveryKey = "lictory-load-retry";

// Runs as an inline script: self-contained, no imports, no closures over
// module scope (vite.config.ts inlines its source).
export function recoverFailedLoad(key: string) {
  const delays = [1000, 2000, 3000];
  const windowMs = 30_000;

  function attemptsSoFar() {
    try {
      const [count = 0, at = 0] = (sessionStorage.getItem(key) ?? "")
        .split(":")
        .map(Number);
      const recent = Date.now() - at < windowMs;
      return recent && Number.isInteger(count) ? count : 0;
    } catch {
      return delays.length;
    }
  }

  function showFailure() {
    const main = document.createElement("main");
    main.style.cssText =
      "max-width:28rem;margin:20vh auto 0;padding:0 16px;font:15px/1.5 system-ui,sans-serif";
    const heading = document.createElement("h1");
    heading.style.cssText = "font-size:20px;margin:0 0 8px";
    heading.textContent = "Lictory didn’t load";
    const text = document.createElement("p");
    text.style.cssText = "margin:0 0 16px";
    text.textContent = "Check your connection, then reload the page.";
    const button = document.createElement("button");
    button.type = "button";
    button.style.cssText = "font:inherit;padding:6px 14px";
    button.textContent = "Reload";
    button.addEventListener("click", () => {
      try {
        sessionStorage.removeItem(key);
      } catch {
        // Without storage the reload simply has no automatic retries.
      }
      location.reload();
    });
    main.append(heading, text, button);
    (document.getElementById("root") ?? document.body).replaceChildren(main);
  }

  // Schedules one reload while attempts remain; false once they are used up.
  let scheduled = false;
  function reloadLater() {
    if (scheduled) return true;
    const attempts = attemptsSoFar();
    if (attempts >= delays.length) return false;
    try {
      sessionStorage.setItem(key, `${attempts + 1}:${Date.now()}`);
    } catch {
      return false;
    }
    scheduled = true;
    setTimeout(() => location.reload(), delays[attempts]);
    return true;
  }

  function onError(event: Event) {
    const script = event.target;
    if (
      !(script instanceof HTMLScriptElement) ||
      script.type !== "module" ||
      !script.src ||
      new URL(script.src).origin !== location.origin
    )
      return;
    removeEventListener("error", onError, true);
    if (!reloadLater()) showFailure();
  }

  addEventListener("error", onError, true);
  addEventListener("vite:preloadError", () => reloadLater());
}

export const loadRecoveryScript = `(${recoverFailedLoad.toString()})(${JSON.stringify(loadRecoveryKey)});`;
