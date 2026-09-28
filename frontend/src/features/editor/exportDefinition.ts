import type { Definition } from "../../types";
import { stringifyJson } from "../../domain/json";

/**
 * Some engines (notably Safari) start the download after the click returns,
 * so revoking the object URL right away can cancel it. There is no event for a
 * started download; the URL is released after a generous delay instead.
 */
const downloadUrlLifetimeMs = 40_000;

export function exportDefinition(
  definition: Definition,
  ruleId: string,
  version: number | null,
) {
  const url = URL.createObjectURL(
    new Blob([stringifyJson(definition, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${ruleId}${version ? `-v${version}` : "-draft"}.json`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), downloadUrlLifetimeMs);
}
