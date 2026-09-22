import { Button, IconButton, TextField, Tooltip } from "@mui/material";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import ExpressionField from "../../expressions/ExpressionField";
import type { NodeFieldsProps } from "./types";

export default function SwitchFields({
  node,
  patch,
  variables,
  readOnly,
}: NodeFieldsProps) {
  const cases = node.cases ?? [];
  const move = (index: number, direction: number) => {
    const next = [...cases];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    patch({ cases: next });
  };
  return (
    <div className="inspector-section">
      <h4>Cases · first match wins</h4>
      <p className="muted-copy">
        Checked from top to bottom. The first true condition selects its branch.
        Otherwise, Default runs.
      </p>
      {cases.map((option, index) => (
        <div key={option.id} className="node-mapping-card">
          <div className="mapping-card-heading">
            <strong>Case {index + 1}</strong>
            <Tooltip title="Higher priority">
              <span>
                <IconButton
                  size="small"
                  aria-label={`Move case ${index + 1} up`}
                  disabled={readOnly || index === 0}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={14} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Lower priority">
              <span>
                <IconButton
                  size="small"
                  aria-label={`Move case ${index + 1} down`}
                  disabled={readOnly || index === cases.length - 1}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={14} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Remove case and its outgoing connections">
              <span>
                <IconButton
                  size="small"
                  aria-label={`Remove case ${index + 1}`}
                  disabled={readOnly}
                  onClick={() =>
                    patch({ cases: cases.filter((c) => c.id !== option.id) })
                  }
                >
                  <Trash2 size={14} />
                </IconButton>
              </span>
            </Tooltip>
          </div>
          <TextField
            label={`Case ${index + 1} label`}
            value={option.label}
            disabled={readOnly}
            onChange={(e) =>
              patch({
                cases: cases.map((c) =>
                  c.id === option.id ? { ...c, label: e.target.value } : c,
                ),
              })
            }
          />
          <ExpressionField
            label={`Case ${index + 1} condition`}
            value={option.expression}
            variables={variables}
            disabled={readOnly}
            helperText="Must return true or false. Functions can be nested."
            onChange={(expression) =>
              patch({
                cases: cases.map((c) =>
                  c.id === option.id ? { ...c, expression } : c,
                ),
              })
            }
          />
        </div>
      ))}
      <Button
        startIcon={<Plus size={14} />}
        disabled={readOnly || cases.length >= 20}
        onClick={() =>
          patch({
            cases: [
              ...cases,
              {
                id: `case-${crypto.randomUUID().slice(0, 8)}`,
                label: `Case ${cases.length + 1}`,
                expression: "true",
              },
            ],
          })
        }
      >
        Add case
      </Button>
      <p className="muted-copy">
        Connect every case and the Default handle. Reordering or renaming a case
        keeps its connections.
      </p>
    </div>
  );
}
