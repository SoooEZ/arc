import {
  Button,
  IconButton,
  MenuItem,
  TextField,
  Tooltip,
} from "@mui/material";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { memo, useCallback } from "react";
import { shortId } from "../../../domain/ids";
import { MAX_SWITCH_CASES } from "../../../domain/limits";
import { patchGraphNode } from "../../../domain/graph";
import {
  withCaseChanged,
  withCaseMoved,
  withNewCase,
  withoutCase,
} from "../../../domain/switchBranches";
import type { VariableOption } from "../../../domain/variables";
import type { Definition, RuleNode } from "../../../types";
import ExpressionField from "../../expressions/ExpressionField";
import ValueBinding from "../../expressions/ValueBinding";
import SwitchDefaultReturn from "./SwitchDefaultReturn";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";

type Case = NonNullable<RuleNode["cases"]>[number];

export default function SwitchFields(props: NodeFieldsProps) {
  const { node, patch, variables, scopeKnown, readOnly, onDefinitionChange } =
    props;
  const cases = node.cases ?? [];
  const matchingValue = node.selector != null;
  const nodeId = node.id;
  // Stable per-row callbacks read the current cases from the draft, so a
  // keystroke in one case re-renders that row alone.
  const updateCases = useCallback(
    (update: (cases: readonly Case[]) => readonly Case[]) =>
      onDefinitionChange((definition: Definition) => {
        const current = definition.nodes.find((n) => n.id === nodeId);
        if (!current) return definition;
        const cases = current.cases ?? [];
        const next = update(cases);
        if (next === cases) return definition;
        return patchGraphNode(definition, nodeId, { cases: [...next] });
      }),
    [onDefinitionChange, nodeId],
  );
  const updateCase = useCallback(
    (id: string, change: Partial<Case>) =>
      updateCases((cases) => withCaseChanged(cases, id, change)),
    [updateCases],
  );
  const removeCase = useCallback(
    (id: string) => updateCases((cases) => withoutCase(cases, id)),
    [updateCases],
  );
  const moveCase = useCallback(
    (id: string, direction: -1 | 1) =>
      updateCases((cases) => withCaseMoved(cases, id, direction)),
    [updateCases],
  );
  return (
    <>
      <InspectorSection
        title="Switch cases"
        help="Cases are checked in order. Match a selector value or use conditions that return true or false; the first match selects the branch."
      >
        <TextField
          select
          label="Switch mode"
          value={matchingValue ? "value" : "conditions"}
          disabled={readOnly}
          onChange={(event) =>
            patch({ selector: event.target.value === "value" ? "true" : null })
          }
        >
          <MenuItem value="conditions">Conditions · first true case</MenuItem>
          <MenuItem value="value">Match a value</MenuItem>
        </TextField>
        {matchingValue && (
          <ValueBinding
            key={`${node.id}:selector`}
            label="Value to match"
            type="SCALAR"
            value={node.selector ?? ""}
            variables={variables}
            scopeKnown={scopeKnown}
            disabled={readOnly}
            optional={false}
            onChange={(selector) => patch({ selector: selector ?? "" })}
          />
        )}
        <p className="inspector-section-caption">First match wins</p>
        <p className="muted-copy">
          {matchingValue
            ? 'Match a boolean, number or string from top to bottom. Values keep their types: 1 and "1" are different.'
            : "Checked from top to bottom. The first true condition selects its branch. For ranges, try amount < 50, then amount < 100."}{" "}
          Otherwise, Default runs.
        </p>
        {cases.map((option, index) => (
          <SwitchCaseRow
            key={`${option.id}:${matchingValue}`}
            option={option}
            index={index}
            count={cases.length}
            matchingValue={matchingValue}
            variables={variables}
            scopeKnown={scopeKnown}
            readOnly={readOnly}
            onChange={updateCase}
            onRemove={removeCase}
            onMove={moveCase}
          />
        ))}
        <Button
          startIcon={<Plus size={14} />}
          disabled={readOnly || cases.length >= MAX_SWITCH_CASES}
          // Document updaters can run more than once, so the ID is chosen here.
          onClick={() => patch({ cases: withNewCase(cases, shortId("case-")) })}
        >
          Add case
        </Button>
        <p className="muted-copy">
          Connect every case and the Default handle. Reordering or renaming a
          case keeps its connections.
        </p>
      </InspectorSection>
      <SwitchDefaultReturn {...props} />
    </>
  );
}

/** One case: renders again only when its own case, position, scope or callbacks change. */
const SwitchCaseRow = memo(function SwitchCaseRow({
  option,
  index,
  count,
  matchingValue,
  variables,
  scopeKnown,
  readOnly,
  onChange,
  onRemove,
  onMove,
}: {
  option: Case;
  index: number;
  count: number;
  matchingValue: boolean;
  variables: VariableOption[];
  scopeKnown: boolean;
  readOnly: boolean;
  onChange: (id: string, change: Partial<Case>) => void;
  onRemove: (id: string) => void;
  onMove: (id: string, direction: -1 | 1) => void;
}) {
  return (
    <div className="node-mapping-card" data-testid={`switch-case-${option.id}`}>
      <div className="mapping-card-heading">
        <strong>Case {index + 1}</strong>
        <Tooltip title="Higher priority">
          <span>
            <IconButton
              size="small"
              aria-label={`Move case ${index + 1} up`}
              disabled={readOnly || index === 0}
              onClick={() => onMove(option.id, -1)}
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
              disabled={readOnly || index === count - 1}
              onClick={() => onMove(option.id, 1)}
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
              onClick={() => onRemove(option.id)}
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
        onChange={(e) => onChange(option.id, { label: e.target.value })}
      />
      {matchingValue ? (
        <ValueBinding
          label={`Case ${index + 1} value`}
          type="SCALAR"
          value={option.expression}
          variables={variables}
          scopeKnown={scopeKnown}
          disabled={readOnly}
          optional={false}
          onChange={(expression) =>
            onChange(option.id, { expression: expression ?? "" })
          }
        />
      ) : (
        <ExpressionField
          label={`Case ${index + 1} condition`}
          value={option.expression}
          variables={variables}
          scopeKnown={scopeKnown}
          disabled={readOnly}
          helperText="Must return true or false. Functions can be nested."
          onChange={(expression) => onChange(option.id, { expression })}
        />
      )}
    </div>
  );
});
