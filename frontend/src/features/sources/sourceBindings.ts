import {
  undeclaredBindings,
  withBinding,
  withoutBindings,
} from "../../domain/valueBinding";
import type { DataSource, SourceBinding } from "../../types";

/** A version change cannot retain mappings that the new pinned contract no longer accepts. */
export function bindSourceVersion(
  binding: SourceBinding,
  version: DataSource,
): SourceBinding {
  const declared = version.definition.parameters.map(
    (parameter) => parameter.name,
  );
  return {
    ...binding,
    version: version.version,
    bindings: withoutBindings(
      binding.bindings,
      undeclaredBindings(binding.bindings, declared),
    ),
  };
}

/** The mappings of parameters `declared` does not list, as the pinned version declares them. */
export function undeclaredSourceBindings(
  binding: SourceBinding,
  declared: Iterable<string>,
): string[] {
  return undeclaredBindings(binding.bindings, declared);
}

/** The binding without the mappings `names`, keeping the other mappings, pointer and onError. */
export function withoutSourceParameterBindings(
  binding: SourceBinding,
  names: Iterable<string>,
): SourceBinding {
  return { ...binding, bindings: withoutBindings(binding.bindings, names) };
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
