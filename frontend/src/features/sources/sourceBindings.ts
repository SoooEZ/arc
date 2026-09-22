import type { DataSource, SourceBinding } from "../../types";

/** A version change cannot retain mappings that the new pinned contract no longer accepts. */
export function bindSourceVersion(
  binding: SourceBinding,
  version: DataSource,
): SourceBinding {
  const parameterNames = new Set(
    version.definition.parameters.map((parameter) => parameter.name),
  );
  return {
    ...binding,
    version: version.version,
    bindings: Object.fromEntries(
      Object.entries(binding.bindings).filter(([name]) =>
        parameterNames.has(name),
      ),
    ),
  };
}
