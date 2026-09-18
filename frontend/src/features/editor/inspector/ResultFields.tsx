import { TextField } from "@mui/material";
import type { NodeFieldsProps } from "./types";
export default function ResultFields({
  node,
  readOnly,
  patch,
  variables,
}: NodeFieldsProps) {
  return (
    <>
      {(node.type === "FORMULA" || node.type === "REFERENCE") && (
        <div className="inspector-section">
          <h4>Store result as</h4>
          <TextField
            label="Result variable"
            value={node.output || ""}
            onChange={(e) => patch({ output: e.target.value })}
            helperText="Use this variable in later nodes."
            disabled={readOnly}
          />
        </div>
      )}
      <div className="inspector-section">
        <h4>Available variables</h4>
        <p className="muted-copy">
          Inputs and results from preceding nodes can be used in expressions.
        </p>
        <div className="variable-list">
          {variables.map((v, i) => (
            <div key={`${v.name}-${i}`}>
              <code>{v.name}</code>
              <span>{v.type.toLowerCase()}</span>
            </div>
          ))}
        </div>
      </div>
      {(node.type === "FORMULA" || node.type === "OUTPUT") && (
        <div className="inspector-section">
          <h4>Expression toolkit</h4>
          <div className="expression-toolkit">
            {[
              "+  −  *  /  %",
              "min(a, b)",
              "max(a, b)",
              "round(value, 2)",
              "abs(value)",
              "floor(value)",
              "ceil(value)",
              "if(check, yes, no)",
            ].map((t) => (
              <code key={t}>{t}</code>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
