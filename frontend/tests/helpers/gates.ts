import type { Page } from "@playwright/test";

/**
 * A promise the test settles when it chooses: hold a routed or mocked
 * response until `release()`, to check what the page shows meanwhile and
 * what a late answer may still change (lessons F2, F3 and F5).
 */
export function deferred(): { promise: Promise<void>; release: () => void } {
  let release!: () => void;
  const promise = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { promise, release };
}

/**
 * Holds the first `method` request to a URL ending in `url` until released;
 * `state` reports whether it was held, whether the page aborted it, and
 * whether it went on to the server.
 */
export async function holdRequest(page: Page, url: string, method: string) {
  const gate = deferred();
  const state = { held: false, aborted: false, settled: false };
  page.on("requestfailed", (failed) => {
    if (failed.url().endsWith(url) && failed.method() === method)
      state.aborted = true;
  });
  await page.route(`**${url}`, async (route) => {
    if (route.request().method() !== method || state.held) {
      await route.fallback();
      return;
    }
    state.held = true;
    await gate.promise;
    // An aborted request can no longer reach the server.
    await route.continue().catch(() => {});
    state.settled = true;
  });
  return { state, release: gate.release };
}
