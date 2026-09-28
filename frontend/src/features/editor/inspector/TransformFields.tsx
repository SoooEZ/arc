import { memo, useCallback } from "react";
import { Button, IconButton, TextField, Tooltip } from "@mui/material";
import { Plus, Trash2 } from "lucide-react";
import ExpressionField from "../../expressions/ExpressionField";
import ExpressionDialogButton from "../../expressions/ExpressionDialogButton";
import ValueBinding from "../../expressions/ValueBinding";
import { quoteText } from "../../../domain/expressions";
import { patchGraphNode } from "../../../domain/graph";
import { uniqueName } from "../../../domain/ids";
import { MAX_TRANSFORM_FIELDS } from "../../../domain/limits";
import type { VariableOption } from "../../../domain/graph";
import type { Definition, RuleNode } from "../../../types";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";
import { useRowIdentities } from "./useRowIdentities";

type Field = NonNullable<RuleNode["fields"]>[number];

/** A functional update of one node's fields, read from the current draft. */
type FieldsUpdate = (fields: Field[]) => Field[];

export default function TransformFields({
  node,
  patch,
  variables,
  scopeKnown,
  readOnly,
  onDefinitionChange,
}: NodeFieldsProps) {
  const fields = node.fields ?? [];
  const fieldMode = node.expression == null;
  // Rows keep their editors across edits, additions and removals (lesson F6).
  const rows = useRowIdentities<Field>("transform-field");
  const nodeId = node.id;
  // One stable updater for every row: a row callback reads the current fields
  // instead of closing over this render's array, so rows can be memoized.
  const updateFields = useCallback(
    (update: FieldsUpdate) =>
      onDefinitionChange((definition: Definition) => {
        const current = definition.nodes.find((n) => n.id === nodeId);
        if (!current) return definition;
        return patchGraphNode(definition, nodeId, {
          fields: update(current.fields ?? []),
        });
      }),
    [onDefinitionChange, nodeId],
  );
  const replaceField = useCallback(
    (identity: string, change: Partial<Field>) =>
      updateFields((current) =>
        current.map((field) =>
          rows.identity(field) === identity
            ? rows.carry(field, { ...field, ...change })
            : field,
        ),
      ),
    [updateFields, rows],
  );
  const removeField = useCallback(
    (identity: string) =>
      updateFields((current) =>
        current.filter((field) => rows.identity(field) !== identity),
      ),
    [updateFields, rows],
  );
  return (
    <InspectorSection
      title="Transform data"
      help="Build an object from named fields or use an expression to reshape, filter or map incoming data."
    >
      <p className="muted-copy">
        Build a new object from upstream data. Rename fields, clean text,
        convert types and map arrays without changing the inputs.
      </p>
      {fieldMode ? (
        <>
          {fields.map((field, index) => (
            <TransformFieldRow
              key={rows.identity(field)}
              identity={rows.identity(field)}
              index={index}
              field={field}
              variables={variables}
              scopeKnown={scopeKnown}
              readOnly={readOnly}
              onReplace={replaceField}
              onRemove={removeField}
            />
          ))}
          <Button
            startIcon={<Plus size={14} />}
            disabled={readOnly || fields.length >= MAX_TRANSFORM_FIELDS}
            onClick={() => {
              const name = uniqueName(
                "field_",
                fields.map((field) => field.name),
                fields.length + 1,
              );
              patch({ fields: [...fields, { name, expression: "null" }] });
            }}
          >
            Add field
          </Button>
          <p className="muted-copy">
            Fields read the same upstream scope. Use another node for
            calculations that depend on this result.
          </p>
          <div className="expression-input">
            <ExpressionDialogButton
              label="Transform entire value"
              buttonLabel="Edit as one expression"
              disabled={readOnly}
              variables={variables}
              scopeKnown={scopeKnown}
              value={`$OBJECT(${fields.map((field) => `${quoteText(field.name)}, ${field.expression || "null"}`).join(", ")})`}
              onChange={(expression) =>
                patch({
                  fields: null,
                  expression,
                })
              }
            />
          </div>
        </>
      ) : (
        <>
          <ExpressionField
            label="Transform expression"
            value={node.expression || ""}
            variables={variables}
            scopeKnown={scopeKnown}
            disabled={readOnly}
            onChange={(expression) => patch({ expression })}
            helperText="Use $OBJECT, $MERGE, $MAP, $FILTER or nested functions to return any value."
          />
          <p className="muted-copy">
            For field mapping, add a separate Transform node. This expression
            remains intact.
          </p>
        </>
      )}
    </InspectorSection>
  );
}

/** One field: renders again only when its own field, index, scope or callbacks change. */
const TransformFieldRow = memo(function TransformFieldRow({
  identity,
  index,
  field,
  variables,
  scopeKnown,
  readOnly,
  onReplace,
  onRemove,
}: {
  identity: string;
  index: number;
  field: Field;
  variables: VariableOption[];
  scopeKnown: boolean;
  readOnly: boolean;
  onReplace: (identity: string, change: Partial<Field>) => void;
  onRemove: (identity: string) => void;
}) {
  return (
    <div className="node-mapping-card">
      <div className="mapping-card-heading">
        <strong>Field {index + 1}</strong>
        <Tooltip title="Remove field">
          <span>
            <IconButton
              size="small"
              aria-label={`Remove field ${index + 1}`}
              disabled={readOnly}
              onClick={() => onRemove(identity)}
            >
              <Trash2 size={14} />
            </IconButton>
          </span>
        </Tooltip>
      </div>
      <TextField
        label={`Field ${index + 1} name`}
        value={field.name}
        disabled={readOnly}
        onChange={(e) => onReplace(identity, { name: e.target.value })}
      />
      <ValueBinding
        label={`Field ${index + 1} value`}
        type="ANY"
        optional={false}
        value={field.expression}
        variables={variables}
        scopeKnown={scopeKnown}
        disabled={readOnly}
        onChange={(value) => onReplace(identity, { expression: value ?? "" })}
      />
    </div>
  );
});
