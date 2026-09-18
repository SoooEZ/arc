import {
  Button,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
} from "@mui/material";
import { Braces, Plus, Trash2 } from "lucide-react";
import type { InputType } from "../../../types";
import SourceBindingEditor from "../../../components/SourceBindingEditor";
import JsonField from "../../../components/JsonField";
import { inputVariables } from "../../../domain/graph";
import type { NodeFieldsProps } from "./types";
export default function InputFields({
  rule,
  readOnly,
  onDefinitionChange,
  onInvalidJson,
}: NodeFieldsProps) {
  const allVariables = inputVariables(rule.draft);
  const addInput = () =>
    onDefinitionChange((d) => {
      let count = d.inputs.length + 1;
      while (d.inputs.some((i) => i.name === `input${count}`)) count++;
      return {
        ...d,
        inputs: [
          ...d.inputs,
          {
            name: `input${count}`,
            type: "NUMBER",
            required: true,
            defaultValue: null,
          },
        ],
      };
    });
  return (
    <div className="inspector-section">
      <div className="section-title">
        <h4>Input parameters</h4>
        <span>{rule.draft.inputs.length}</span>
      </div>
      {rule.draft.inputs.map((input, i) => (
        <div className="input-schema-card" key={i}>
          <div className="input-card-title">
            <Braces size={14} />
            <span>Parameter {i + 1}</span>
            <Tooltip title="Remove parameter">
              <span>
                <IconButton
                  size="small"
                  aria-label={`Remove ${input.name}`}
                  disabled={readOnly}
                  onClick={() =>
                    onDefinitionChange((d) => ({
                      ...d,
                      inputs: d.inputs.filter((_, j) => i !== j),
                    }))
                  }
                >
                  <Trash2 size={13} />
                </IconButton>
              </span>
            </Tooltip>
          </div>
          <TextField
            label="Parameter name"
            value={input.name}
            onChange={(e) =>
              onDefinitionChange((d) => ({
                ...d,
                inputs: d.inputs.map((p, j) =>
                  i === j ? { ...p, name: e.target.value } : p,
                ),
              }))
            }
            disabled={readOnly}
          />
          <TextField
            select
            label="Type"
            value={input.type}
            onChange={(e) =>
              onDefinitionChange((d) => ({
                ...d,
                inputs: d.inputs.map((p, j) =>
                  i === j
                    ? {
                        ...p,
                        type: e.target.value as InputType,
                        defaultValue: null,
                      }
                    : p,
                ),
              }))
            }
            disabled={readOnly}
          >
            {["NUMBER", "STRING", "BOOLEAN", "ARRAY", "OBJECT"].map((type) => (
              <MenuItem key={type} value={type}>
                {type.toLowerCase()}
              </MenuItem>
            ))}
          </TextField>
          {input.type === "ARRAY" || input.type === "OBJECT" ? (
            <JsonField
              label="Default JSON (optional)"
              onValidity={(valid) => onInvalidJson(String(i), !valid)}
              rows={2}
              value={input.defaultValue}
              disabled={readOnly}
              onChange={(value) =>
                onDefinitionChange((d) => ({
                  ...d,
                  inputs: d.inputs.map((p, j) =>
                    i === j ? { ...p, defaultValue: value } : p,
                  ),
                }))
              }
            />
          ) : input.type === "BOOLEAN" ? (
            <TextField
              label="Default value"
              select
              value={
                input.defaultValue == null ? "" : String(input.defaultValue)
              }
              onChange={(e) =>
                onDefinitionChange((d) => ({
                  ...d,
                  inputs: d.inputs.map((p, j) =>
                    i === j
                      ? {
                          ...p,
                          defaultValue:
                            e.target.value === ""
                              ? null
                              : e.target.value === "true",
                        }
                      : p,
                  ),
                }))
              }
              disabled={readOnly}
            >
              <MenuItem value="">No default</MenuItem>
              <MenuItem value="true">true</MenuItem>
              <MenuItem value="false">false</MenuItem>
            </TextField>
          ) : (
            <TextField
              label="Default value (optional)"
              type={input.type === "NUMBER" ? "number" : "text"}
              value={input.defaultValue ?? ""}
              onChange={(e) =>
                onDefinitionChange((d) => ({
                  ...d,
                  inputs: d.inputs.map((p, j) =>
                    i === j
                      ? {
                          ...p,
                          defaultValue:
                            e.target.value === ""
                              ? null
                              : p.type === "NUMBER"
                                ? Number(e.target.value)
                                : e.target.value,
                        }
                      : p,
                  ),
                }))
              }
              disabled={readOnly}
            />
          )}
          <SourceBindingEditor
            input={input}
            variables={allVariables.filter(
              (v) => v.name !== input.name && v.type !== "RESULT",
            )}
            readOnly={readOnly}
            onChange={(source) =>
              onDefinitionChange((d) => ({
                ...d,
                inputs: d.inputs.map((p, j) =>
                  i === j ? { ...p, source } : p,
                ),
              }))
            }
          />
          <FormControlLabel
            control={
              <Switch
                size="small"
                checked={input.required}
                disabled={readOnly}
                onChange={(_, checked) =>
                  onDefinitionChange((d) => ({
                    ...d,
                    inputs: d.inputs.map((p, j) =>
                      i === j ? { ...p, required: checked } : p,
                    ),
                  }))
                }
              />
            }
            label="Required"
          />
        </div>
      ))}
      {!readOnly && (
        <Button
          size="small"
          fullWidth
          variant="outlined"
          startIcon={<Plus size={14} />}
          onClick={addInput}
        >
          Add parameter
        </Button>
      )}
    </div>
  );
}
