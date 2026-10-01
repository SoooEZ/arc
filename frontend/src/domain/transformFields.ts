import type { TransformField } from "../types";
import { quoteText } from "./expressions";
import { uniqueName } from "./ids";

/** A field the Transform does not have yet: a fresh name, returning null until edited. */
export function newTransformField(
  fields: readonly TransformField[],
): TransformField {
  const name = uniqueName(
    "field_",
    fields.map((field) => field.name),
    fields.length + 1,
  );
  return { name, expression: "null" };
}

/**
 * The one expression that builds what the fields build, as "Edit as one
 * expression" starts from it: `$OBJECT("name", expression, …)`, with an empty
 * field reading null.
 */
export function fieldsAsObjectExpression(
  fields: readonly TransformField[],
): string {
  const pairs = fields.map(
    (field) => `${quoteText(field.name)}, ${field.expression || "null"}`,
  );
  return `$OBJECT(${pairs.join(", ")})`;
}
