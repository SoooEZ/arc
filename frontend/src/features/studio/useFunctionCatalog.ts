import { studioApi } from "../../api/studio";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import type { FunctionEntry } from "../../types";

const noFunctions: FunctionEntry[] = [];
let catalog: Promise<FunctionEntry[]> | null = null;

/**
 * GET /api/functions once per page load for every editor. The catalog is fixed
 * for a server build. A failed read is forgotten, so the next editor to mount
 * retries it.
 */
export function loadFunctionCatalog(): Promise<FunctionEntry[]> {
  if (!catalog) {
    const request = studioApi.functions();
    catalog = request;
    request.catch(() => {
      if (catalog === request) catalog = null;
    });
  }
  return catalog;
}

/**
 * The shared function catalog; `enabled` defers the first read (inline editors
 * wait for focus). Other editors may still await the shared request, so an
 * unmounting editor does not abort it; useAsyncResource ignores its late result.
 */
export function useFunctionCatalog(enabled = true) {
  return useAsyncResource(
    "functions",
    enabled ? loadFunctionCatalog : null,
    noFunctions,
  );
}
