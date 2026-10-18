import { Autocomplete, Button, MenuItem, TextField } from "@mui/material";
import { ChevronRight, Plus } from "lucide-react";
import ValueBinding from "../../expressions/ValueBinding";
import ExpressionField from "../../expressions/ExpressionField";
import ExpressionDialogButton from "../../expressions/ExpressionDialogButton";
import { useEditingPin } from "../../expressions/useEditingPin";
import { comparisonText, simpleComparison } from "../../../domain/expressions";
import { updateGraphNode } from "../../../domain/graph";
import { shortId } from "../../../domain/ids";
import { withBranchMode, withNewCase } from "../../../domain/switchBranches";
import { comparisonBindingType } from "../../../domain/valueBinding";
import type { NodeFieldsProps } from "./types";
import BranchModeField from "./BranchModeField";
import InspectorSection from "./InspectorSection";

const operators = [
  ["==", "Equals"],
  ["!=", "Does not equal"],
  [">", "Greater than"],
  [">=", "Greater than or equal"],
  ["<", "Less than"],
  ["<=", "Less than or equal"],
] as const;

/** The builder's operands keep the text being typed, e.g. "or" on the way to "order_total". */
interface Comparison {
  left: string;
  operator: string;
  right: string;
}

type ConditionEditor =
  { kind: "builder"; comparison: Comparison } | { kind: "expression" };

function parseComparison(expression: string): Comparison | null {
  const parts = simpleComparison(expression);
  if (!parts) return null;
  const [, left, operator, right] = parts;
  return { left, operator, right };
}

/**
 * A single comparison opens in the builder, anything else in the expression
 * editor. Editing keeps the chosen editor even when the text passes through
 * another shape ("or >= 100" while typing order_total); only the toggle or a
 * change made elsewhere chooses again.
 */
export default function ConditionFields({
  rule,
  node,
  readOnly,
  patch,
  variables,
  scopeKnown,
  onDefinitionChange,
}: NodeFieldsProps) {
  const expression = node.expression ?? "";
  const [editing, keepEditor] = useEditingPin<ConditionEditor>(expression);
  const parsed = parseComparison(expression);
  const editor: ConditionEditor =
    editing ??
    (parsed ? { kind: "builder", comparison: parsed } : { kind: "expression" });
  const editExpression = (next: string) => {
    keepEditor({ kind: "expression" }, next);
    patch({ expression: next });
  };
  const canToggle = editor.kind === "builder" || parsed !== null;
  const toggle = () => {
    if (editor.kind === "builder")
      keepEditor({ kind: "expression" }, expression);
    else if (parsed)
      keepEditor({ kind: "builder", comparison: parsed }, expression);
  };
  // The condition becomes Case 1, False becomes Default, and a second case follows.
  const addCase = () => {
    // Document updaters can run more than once, so the IDs are chosen here.
    const first = shortId("case-");
    const second = shortId("case-");
    onDefinitionChange((definition) =>
      updateGraphNode(
        withBranchMode(definition, node.id, "conditions", first),
        node.id,
        (current) =>
          current.type === "SWITCH"
            ? { cases: withNewCase(current.cases ?? [], second) }
            : {},
      ),
    );
  };
  return (
    <InspectorSection
      title="Condition"
      help="Choose a comparison or write an expression that returns true or false to select the next branch."
      actions={
        canToggle && (
          <Button
            size="small"
            className="inspector-mode-button"
            onClick={toggle}
          >
            {editor.kind === "builder" ? "Expression" : "Builder"}
          </Button>
        )
      }
    >
      <BranchModeField
        node={node}
        readOnly={readOnly}
        onDefinitionChange={onDefinitionChange}
      />
      {editor.kind === "builder" ? (
        <ComparisonBuilder
          rule={rule}
          comparison={editor.comparison}
          expression={expression}
          variables={variables}
          scopeKnown={scopeKnown}
          readOnly={readOnly}
          onEdit={(comparison) => {
            // The builder keeps the operands as typed; the stored text parenthesizes them.
            const next = comparisonText(
              comparison.left,
              comparison.operator,
              comparison.right,
            );
            keepEditor({ kind: "builder", comparison }, next);
            patch({ expression: next });
          }}
          // An expression applied from the dialog is shown in the editor that fits it.
          onReplace={(next) => patch({ expression: next })}
        />
      ) : (
        <ExpressionField
          label="Expression"
          value={expression}
          onChange={editExpression}
          variables={variables}
          scopeKnown={scopeKnown}
          disabled={readOnly}
          helperText="Combine checks with &&, ||, and parentheses."
        />
      )}
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
      <Button
        startIcon={<Plus size={14} />}
        disabled={readOnly}
        onClick={addCase}
      >
        Add case
      </Button>
      <p className="muted-copy">
        More cases branch more than two ways: this condition becomes Case 1 and
        False becomes Default, with their connections.
      </p>
    </InspectorSection>
  );
}

function ComparisonBuilder({
  rule,
  comparison,
  expression,
  variables,
  scopeKnown,
  readOnly,
  onEdit,
  onReplace,
}: Pick<NodeFieldsProps, "rule" | "variables" | "scopeKnown" | "readOnly"> & {
  comparison: Comparison;
  expression: string;
  onEdit: (comparison: Comparison) => void;
  onReplace: (expression: string) => void;
}) {
  const edit = (change: Partial<Comparison>) =>
    onEdit({ ...comparison, ...change });
  const declaredType = rule.draft.inputs.find(
    (input) => input.name === comparison.left.trim(),
  )?.type;
  return (
    <div className="condition-builder">
      <Autocomplete
        freeSolo
        options={variables.map((v) => v.name)}
        value={comparison.left}
        disabled={readOnly}
        onInputChange={(_, value, reason) => {
          if (reason === "input" || reason === "clear") edit({ left: value });
        }}
        onChange={(_, value) => edit({ left: value ?? "" })}
        renderInput={(params) => <TextField {...params} label="When" />}
      />
      <TextField
        select
        label="Operator"
        value={comparison.operator}
        onChange={(e) => edit({ operator: e.target.value })}
        disabled={readOnly}
      >
        {operators.map(([value, label]) => (
          <MenuItem key={value} value={value}>
            {label}
          </MenuItem>
        ))}
      </TextField>
      <ValueBinding
        // A declared input type changes which controls fit the value.
        key={declaredType ?? ""}
        label="Comparison value"
        type={comparisonBindingType(comparison.right.trim(), declaredType)}
        value={comparison.right}
        variables={variables}
        scopeKnown={scopeKnown}
        disabled={readOnly}
        optional={false}
        onChange={(value) => edit({ right: value ?? "" })}
      />
      <div className="expression-preview">
        <code>{expression}</code>
      </div>
      <div className="expression-input">
        <ExpressionDialogButton
          label="Condition"
          value={expression}
          variables={variables}
          scopeKnown={scopeKnown}
          disabled={readOnly}
          onChange={onReplace}
        />
      </div>
    </div>
  );
}
