import { withBinding } from "../../domain/valueBinding";
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

/**
 * Sets (or with `undefined` removes) one parameter mapping. It shares the
 * Reference-binding rule, so a parameter named "__proto__" or "constructor" is
 * stored like any other name and the other mappings keep their order.
 */
export function withSourceParameterBinding(
  binding: SourceBinding,
  parameter: string,
  value: string | undefined,
): SourceBinding {
  return {
    ...binding,
    bindings: withBinding(binding.bindings, parameter, value),
  };
}
