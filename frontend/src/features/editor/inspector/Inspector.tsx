import { useEffect, useRef, type ComponentType, type Ref } from "react";
import { IconButton, Tooltip } from "@mui/material";
import { Code2, Info, Trash2 } from "lucide-react";
import type {
  Definition,
  NodeType,
  RuleSummary,
  Rule,
  RuleNode,
} from "../../../types";
import type { ReferenceTarget } from "../types";
import { studioApi } from "../../../api/studio";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import { availableVariables, semanticGraphKey } from "../../../domain/graph";
import InputFields from "./InputFields";
import ReferenceFields from "./ReferenceFields";
import ExpressionFields from "./ExpressionFields";
import ResultFields from "./ResultFields";
import OutputFields from "./OutputFields";
import SwitchFields from "./SwitchFields";
import TransformFields from "./TransformFields";
import type { NodeFieldsProps } from "./types";
import InspectorProblems from "./InspectorProblems";
import NodeIdentity from "./NodeIdentity";
// Exhaustive registry: every portable node kind has an editor.
const fieldsByType: Record<NodeType, ComponentType<NodeFieldsProps>> = {
  INPUT: InputFields,
  REFERENCE: ReferenceFields,
  FORMULA: ExpressionFields,
  CONDITION: ExpressionFields,
  SWITCH: SwitchFields,
  TRANSFORM: TransformFields,
  OUTPUT: OutputFields,
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
  onInvalidDefault: (key: string, invalid: boolean) => void;
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
  onInvalidDefault,
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
    onInvalidDefault,
    onOpenReference,
  };
  return (
    <aside className={`inspector inspector-${presentation}`}>
      {presentation === "sidebar" && (
        <div className="inspector-heading">
          <NodeIdentity
            node={node}
            readOnly={readOnly}
            inputRef={nameInputRef}
            onRename={(label) => patch({ label })}
          />
          <div className="inspector-heading-actions">
            <InspectorProblems key={node.id} errors={errors} />
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
              title={
                onDelete && node.type !== "INPUT"
                  ? rule.draft.nodes.length <= 1
                    ? "Keep at least one node in the draft"
                    : "Delete node"
                  : ""
              }
            >
              <span className="inspector-delete-slot">
                {onDelete && node.type !== "INPUT" && (
                  <IconButton
                    size="small"
                    color="error"
                    aria-label="Delete node"
                    disabled={readOnly || rule.draft.nodes.length <= 1}
                    onClick={() => {
                      if (!readOnly && rule.draft.nodes.length > 1)
                        onDelete(node.id);
                    }}
                  >
                    <Trash2 size={16} />
                  </IconButton>
                )}
              </span>
            </Tooltip>
          </div>
        </div>
      )}
      <div className="inspector-scroll" ref={scroll}>
        <Fields key={node.id} {...fieldProps} />
        {node.type !== "INPUT" && (
          <ResultFields key={`result:${node.id}`} {...fieldProps} />
        )}
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
