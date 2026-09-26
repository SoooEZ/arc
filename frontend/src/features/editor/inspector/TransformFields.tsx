import { Button, IconButton, TextField, Tooltip } from "@mui/material";
import { Plus, Trash2 } from "lucide-react";
import ExpressionField from "../../expressions/ExpressionField";
import ValueBinding from "../../expressions/ValueBinding";
import { quoteText } from "../../../domain/expressions";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";

export default function TransformFields({
  node,
  patch,
  variables,
  readOnly,
}: NodeFieldsProps) {
  const fields = node.fields ?? [];
  const fieldMode = node.expression == null;
  return (
    <InspectorSection title="Transform data" variables={variables}>
      <p className="muted-copy">
        Build a new object from upstream data. Rename fields, clean text,
        convert types and map arrays without changing the inputs.
      </p>
      {fieldMode ? (
        <>
          {fields.map((field, index) => (
            <div key={index} className="node-mapping-card">
              <div className="mapping-card-heading">
                <strong>Field {index + 1}</strong>
                <Tooltip title="Remove field">
                  <span>
                    <IconButton
                      size="small"
                      aria-label={`Remove field ${index + 1}`}
                      disabled={readOnly}
                      onClick={() =>
                        patch({ fields: fields.filter((_, i) => i !== index) })
                      }
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
                onChange={(e) =>
                  patch({
                    fields: fields.map((f, i) =>
                      i === index ? { ...f, name: e.target.value } : f,
                    ),
                  })
                }
              />
              <ValueBinding
                key={`${index}:${fields.length}`}
                label={`Field ${index + 1} value`}
                type="ANY"
                optional={false}
                value={field.expression}
                variables={variables}
                disabled={readOnly}
                onChange={(value) =>
                  patch({
                    fields: fields.map((f, i) =>
                      i === index ? { ...f, expression: value ?? "" } : f,
                    ),
                  })
                }
              />
            </div>
          ))}
          <Button
            startIcon={<Plus size={14} />}
            disabled={readOnly || fields.length >= 50}
            onClick={() => {
              let suffix = fields.length + 1;
              while (fields.some((field) => field.name === `field_${suffix}`))
                suffix++;
              patch({
                fields: [
                  ...fields,
                  { name: `field_${suffix}`, expression: "null" },
                ],
              });
            }}
          >
            Add field
          </Button>
          <p className="muted-copy">
            Fields read the same upstream scope. Use another node for
            calculations that depend on this result.
          </p>
          <ExpressionField
            label="Transform entire value"
            hideInput
            buttonLabel="Edit as one expression"
            disabled={readOnly}
            variables={variables}
            value={`$OBJECT(${fields.map((field) => `${quoteText(field.name)}, ${field.expression || "null"}`).join(", ")})`}
            onChange={(expression) =>
              patch({
                fields: null,
                expression,
              })
            }
          />
        </>
      ) : (
        <>
          <ExpressionField
            label="Transform expression"
            value={node.expression || ""}
            variables={variables}
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
