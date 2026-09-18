import { Autocomplete, MenuItem, TextField } from "@mui/material";
import { ChevronRight } from "lucide-react";
import ValueBinding from "../../../components/ValueBinding";
import ExpressionField from "../../../components/ExpressionField";
import { literalText, simpleComparison } from "../../../domain/expressions";
import { useState } from "react";
import type { NodeFieldsProps } from "./types";
export default function ExpressionFields({
  rule,
  node,
  readOnly,
  patch,
  variables,
}: NodeFieldsProps) {
  const [expressionMode, setExpressionMode] = useState(false);
  const condition = simpleComparison(node.expression || "");
  const simpleCondition =
    node.type === "CONDITION" && !!condition && !expressionMode;
  const updateCondition = (index: number, value: string) => {
    const parts = condition
      ? [condition[1].trim(), condition[2], condition[3].trim()]
      : ["amount", ">=", "100"];
    parts[index] = value;
    patch({ expression: parts.join(" ") });
  };
  return (
    <div className="inspector-section">
      <div className="section-title">
        <h4>
          {node.type === "CONDITION"
            ? "Condition"
            : node.type === "OUTPUT"
              ? "Return value"
              : "Expression"}
        </h4>
        {node.type === "CONDITION" && condition && (
          <button onClick={() => setExpressionMode((m) => !m)}>
            {expressionMode ? "Builder" : "Expression"}
          </button>
        )}
      </div>
      {node.type === "OUTPUT" ? (
        <>
          <ValueBinding
            key={node.id}
            label="Return value"
            type="ANY"
            value={node.expression ?? undefined}
            variables={variables}
            disabled={readOnly}
            optional={false}
            onChange={(value) => patch({ expression: value ?? "" })}
          />
          <div className="expression-preview">
            <code>{node.expression || "Choose a return value"}</code>
          </div>
        </>
      ) : simpleCondition ? (
        <div className="condition-builder">
          <Autocomplete
            freeSolo
            options={variables.map((v) => v.name)}
            value={condition[1].trim()}
            disabled={readOnly}
            onInputChange={(_, value, reason) => {
              if (reason === "input" || reason === "clear")
                updateCondition(0, value);
            }}
            onChange={(_, value) => updateCondition(0, value || "")}
            renderInput={(params) => <TextField {...params} label="When" />}
          />
          <TextField
            select
            label="Operator"
            value={condition[2]}
            onChange={(e) => updateCondition(1, e.target.value)}
            disabled={readOnly}
          >
            {[
              ["==", "Equals"],
              ["!=", "Does not equal"],
              [">", "Greater than"],
              [">=", "Greater than or equal"],
              ["<", "Less than"],
              ["<=", "Less than or equal"],
            ].map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <ValueBinding
            key={`${node.id}:${condition[1].trim()}`}
            label="Comparison value"
            type={
              rule.draft.inputs.find((v) => v.name === condition[1].trim())
                ?.type ||
              (literalText(condition[3].trim()) !== null ? "STRING" : "NUMBER")
            }
            value={condition[3].trim()}
            variables={variables}
            disabled={readOnly}
            optional={false}
            onChange={(value) => updateCondition(2, value ?? "")}
          />
          <div className="expression-preview">
            <code>{node.expression}</code>
          </div>
          <ExpressionField
            label="Condition"
            value={node.expression || ""}
            variables={variables}
            disabled={readOnly}
            hideInput
            onChange={(expression) => patch({ expression })}
          />
        </div>
      ) : (
        <ExpressionField
          label="Expression"
          value={node.expression || ""}
          onChange={(expression) => patch({ expression })}
          variables={variables}
          disabled={readOnly}
          helperText={
            node.type === "CONDITION"
              ? "Combine checks with &&, ||, and parentheses."
              : "Nested functions, arrays, object fields and arithmetic are supported."
          }
        />
      )}
      {node.type === "CONDITION" && (
        <div className="branch-explainer">
          <div>
            <span className="status-dot published" />
            <strong>True</strong>
            <span>Condition is met</span>
            <ChevronRight size={12} />
          </div>
          <div>
            <span className="status-dot amber" />
            <strong>False</strong>
            <span>Condition is not met</span>
            <ChevronRight size={12} />
          </div>
        </div>
      )}
    </div>
  );
}
