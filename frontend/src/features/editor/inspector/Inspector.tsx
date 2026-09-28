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
import { canRemoveGraphNode } from "../../../domain/graph";
import { clearUnusedProperties, nodeKinds } from "../../../domain/nodeKinds";
import InputFields from "./InputFields";
import ReferenceFields from "./ReferenceFields";
import FormulaFields from "./FormulaFields";
import ConditionFields from "./ConditionFields";
import ResultFields from "./ResultFields";
import OutputFields from "./OutputFields";
import SwitchFields from "./SwitchFields";
import TransformFields from "./TransformFields";
import type { NodeFieldsProps } from "./types";
import InspectorProblems from "./InspectorProblems";
import NodeIdentity from "./NodeIdentity";
import UnusedProperties from "./UnusedProperties";
import { useNodeVariables } from "./useNodeVariables";
// Exhaustive registry: every portable node kind has an editor. Other per-kind
// facts, such as which kinds store a result or can be deleted, are in
// domain/nodeKinds.
const fieldsByType: Record<NodeType, ComponentType<NodeFieldsProps>> = {
  INPUT: InputFields,
  REFERENCE: ReferenceFields,
  FORMULA: FormulaFields,
  CONDITION: ConditionFields,
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
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [node.id]);
  const patch = (value: Partial<RuleNode>) => onNodeChange(node.id, value);
  const scope = useNodeVariables(rule.draft, node.id);
  const kind = nodeKinds[node.type];
  const removable = canRemoveGraphNode(rule.draft, node.id);
  // The entry Input has no delete button; an extra Input, like other kinds, does.
  const deletable = kind.removable === true || removable;
  const Fields = fieldsByType[node.type];
  const fieldProps: NodeFieldsProps = {
    rule,
    node,
    rules,
    readOnly,
    patch,
    variables: scope.variables,
    scopeKnown: scope.known,
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
            {/* A node that cannot be deleted keeps an empty slot to align the header. */}
            {onDelete && deletable ? (
              <DeleteNodeButton
                removable={removable}
                readOnly={readOnly}
                onDelete={() => onDelete(node.id)}
              />
            ) : (
              <span className="inspector-delete-slot" />
            )}
          </div>
        </div>
      )}
      <div className="inspector-scroll" ref={scroll}>
        <UnusedProperties
          node={node}
          readOnly={readOnly}
          onRemove={() => patch(clearUnusedProperties(node))}
        />
        <Fields key={node.id} {...fieldProps} />
        {kind.storesResult && (
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

function DeleteNodeButton({
  removable,
  readOnly,
  onDelete,
}: {
  removable: boolean;
  readOnly: boolean;
  onDelete: () => void;
}) {
  return (
    <Tooltip
      title={removable ? "Delete node" : "Keep at least one node in the draft"}
    >
      <span className="inspector-delete-slot">
        <IconButton
          size="small"
          color="error"
          aria-label="Delete node"
          disabled={readOnly || !removable}
          onClick={() => {
            if (!readOnly && removable) onDelete();
          }}
        >
          <Trash2 size={16} />
        </IconButton>
      </span>
    </Tooltip>
  );
}
