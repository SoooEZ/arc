import { useEffect, useRef, type ComponentType, type Ref } from "react";
import { IconButton, TextField, Tooltip } from "@mui/material";
import { Code2, Info, Trash2 } from "lucide-react";
import type {
  Definition,
  NodeType,
  RuleSummary,
  Rule,
  RuleNode,
} from "../../../types";
import { nodeLabel } from "../../../types";
import { NodeIcon } from "../../../components/Icons";
import type { ReferenceTarget } from "../types";
import { studioApi } from "../../../api/studio";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import { availableVariables, semanticGraphKey } from "../../../domain/graph";
import InputFields from "./InputFields";
import ReferenceFields from "./ReferenceFields";
import ExpressionFields from "./ExpressionFields";
import ResultFields from "./ResultFields";
import SwitchFields from "./SwitchFields";
import TransformFields from "./TransformFields";
import type { NodeFieldsProps } from "./types";
import InspectorProblems from "./InspectorProblems";
const nodeDescriptions: Record<NodeType, string> = {
  INPUT: "Define the data your rule needs",
  FORMULA: "Calculate a value for the next step",
  CONDITION: "Split your logic into two paths",
  SWITCH: "Choose the first matching branch",
  TRANSFORM: "Shape, clean and map data",
  REFERENCE: "Connect a published rule",
  OUTPUT: "Return the final result",
};
// Exhaustive registry: every portable node kind has an editor.
const fieldsByType: Record<NodeType, ComponentType<NodeFieldsProps>> = {
  INPUT: InputFields,
  REFERENCE: ReferenceFields,
  FORMULA: ExpressionFields,
  CONDITION: ExpressionFields,
  SWITCH: SwitchFields,
  TRANSFORM: TransformFields,
  OUTPUT: ExpressionFields,
};
interface Props {
  rule: Rule;
  node: RuleNode;
  rules: RuleSummary[];
  readOnly: boolean;
  presentation?: "sidebar" | "dialog";
  nameInputRef?: Ref<HTMLInputElement>;
  onNodeChange: (id: string, patch: Partial<RuleNode>) => void;
  onDelete?: (id: string) => void;
  onDefinitionChange: (fn: (d: Definition) => Definition) => void;
  onInvalidJson: (key: string, invalid: boolean) => void;
  onExpression?: (id: string) => void;
  onOpenReference: (target: ReferenceTarget) => void;
  errors: string[];
}
export default function Inspector({
  rule,
  node,
  rules,
  readOnly,
  presentation = "sidebar",
  nameInputRef,
  onNodeChange,
  onDelete,
  onDefinitionChange,
  onInvalidJson,
  onExpression,
  onOpenReference,
  errors,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const key = semanticGraphKey(rule.draft);
  const { data: available } = useAsyncResource(
    key,
    (signal) => studioApi.variables(rule.draft, { signal }),
    {} as Record<string, string[]>,
    150,
  );
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [node.id]);
  const patch = (value: Partial<RuleNode>) => onNodeChange(node.id, value);
  const variables = availableVariables(rule.draft, node.id, available[node.id]);
  const Fields = fieldsByType[node.type];
  const fieldProps: NodeFieldsProps = {
    rule,
    node,
    rules,
    readOnly,
    patch,
    variables,
    onDefinitionChange,
    onInvalidJson,
    onOpenReference,
  };
  const nameField = (
    <TextField
      className="inspector-node-name"
      label="Node name"
      size="small"
      value={node.label}
      title={node.label}
      inputRef={nameInputRef}
      onChange={(event) => patch({ label: event.target.value })}
      disabled={readOnly}
    />
  );
  return (
    <aside className={`inspector inspector-${presentation}`}>
      {presentation === "sidebar" && (
        <div className="inspector-heading">
          <div className="inspector-node-kind">
            <span className={`node-icon ${node.type.toLowerCase()}`}>
              <NodeIcon type={node.type} size={19} />
            </span>
            <span>{nodeLabel[node.type]}</span>
          </div>
          {nameField}
          {onExpression && (
            <Tooltip title="Node expression">
              <IconButton
                size="small"
                aria-label="Node expression"
                onClick={() => onExpression(node.id)}
              >
                <Code2 size={17} />
              </IconButton>
            </Tooltip>
          )}
          <Tooltip
            title={onDelete && node.type !== "INPUT" ? "Delete node" : ""}
          >
            <span className="inspector-delete-slot">
              {onDelete && node.type !== "INPUT" && (
                <IconButton
                  size="small"
                  color="error"
                  aria-label="Delete node"
                  disabled={readOnly}
                  onClick={() => {
                    if (!readOnly) onDelete(node.id);
                  }}
                >
                  <Trash2 size={16} />
                </IconButton>
              )}
            </span>
          </Tooltip>
          <InspectorProblems key={node.id} errors={errors} />
        </div>
      )}
      <div className="inspector-scroll" ref={scroll}>
        {presentation === "dialog" && (
          <div className="inspector-section">
            <div className="inspector-node-title">
              <span className={`node-icon ${node.type.toLowerCase()}`}>
                <NodeIcon type={node.type} size={19} />
              </span>
              <div>
                <h3>{nodeLabel[node.type]}</h3>
                <span>{nodeDescriptions[node.type]}</span>
              </div>
              <InspectorProblems key={node.id} errors={errors} />
            </div>
            {nameField}
          </div>
        )}
        <Fields key={node.id} {...fieldProps} />
        {node.type !== "INPUT" && <ResultFields {...fieldProps} />}
      </div>
      {presentation === "sidebar" && (
        <div className="inspector-footer">
          <Info size={13} />
          {readOnly
            ? "Published versions are read-only"
            : "Changes are saved when you save the draft"}
        </div>
      )}
    </aside>
  );
}
