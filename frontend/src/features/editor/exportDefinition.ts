import type { Definition } from "../../types";

export function exportDefinition(
  definition: Definition,
  ruleId: string,
  version: number | null,
) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(definition, null, 2)], {
      type: "application/json",
    }),
  );
  const link = document.createElement("a");
  link.href = url;
  link.download = `${ruleId}${version ? `-v${version}` : "-draft"}.json`;
  link.click();
  URL.revokeObjectURL(url);
}
