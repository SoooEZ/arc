import { useEffect, useRef, type ComponentType } from "react";
import { Alert, Button, TextField } from "@mui/material";
import { Code2, Info, Trash2 } from "lucide-react";
import type { Definition, NodeType, Rule, RuleNode } from "../types";
import { nodeLabel } from "../types";
import { NodeIcon } from "./Icons";
import type { ReferenceTarget } from "./ReferenceDialog";
import { studioApi } from "../api/studio";
import { useAsyncResource } from "../hooks/useAsyncResource";
import { availableVariables, semanticGraphKey } from "../domain/graph";
import InputFields from "../features/editor/inspector/InputFields";
import ReferenceFields from "../features/editor/inspector/ReferenceFields";
import ExpressionFields from "../features/editor/inspector/ExpressionFields";
import ResultFields from "../features/editor/inspector/ResultFields";
import type { NodeFieldsProps } from "../features/editor/inspector/types";
// Exhaustive registry: every portable node kind has an editor.
const fieldsByType: Record<NodeType, ComponentType<NodeFieldsProps>> = {
  INPUT: InputFields,
  REFERENCE: ReferenceFields,
  FORMULA: ExpressionFields,
  CONDITION: ExpressionFields,
  OUTPUT: ExpressionFields,
};
interface Props {
  rule: Rule;
  node: RuleNode;
  rules: Rule[];
  readOnly: boolean;
  onNodeChange: (id: string, patch: Partial<RuleNode>) => void;
  onDelete: (id: string) => void;
  onDefinitionChange: (fn: (d: Definition) => Definition) => void;
  onInvalidJson: (key: string, invalid: boolean) => void;
  onExpression: (id: string) => void;
  onOpenReference: (target: ReferenceTarget) => void;
  errors: string[];
}
export default function Inspector({
  rule,
  node,
  rules,
  readOnly,
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
  return (
    <aside className="inspector">
      <div className="inspector-heading">
        <span>Node settings</span>
        <Button
          size="small"
          startIcon={<Code2 size={13} />}
          onClick={() => onExpression(node.id)}
        >
          Node expression
        </Button>
      </div>
      <div className="inspector-scroll" ref={scroll}>
        {errors.map((error, i) => (
          <Alert key={i} severity="error">
            {error}
          </Alert>
        ))}
        <div className="inspector-section">
          <div className="inspector-node-title">
            <span className={`node-icon ${node.type.toLowerCase()}`}>
              <NodeIcon type={node.type} size={19} />
            </span>
            <div>
              <h3>{nodeLabel[node.type]}</h3>
              <span>
                {node.type === "CONDITION"
                  ? "Split your logic into two paths"
                  : node.type === "REFERENCE"
                    ? "Connect a published rule"
                    : node.type === "FORMULA"
                      ? "Calculate a value for the next step"
                      : node.type === "OUTPUT"
                        ? "Return the final result"
                        : "Define the data your rule needs"}
              </span>
            </div>
          </div>
          <TextField
            label="Node name"
            value={node.label}
            onChange={(e) => patch({ label: e.target.value })}
            disabled={readOnly}
          />
        </div>
        <Fields key={node.id} {...fieldProps} />
        {node.type !== "INPUT" && <ResultFields {...fieldProps} />}
        {!readOnly && node.type !== "INPUT" && (
          <div className="inspector-section">
            <Button
              size="small"
              color="error"
              startIcon={<Trash2 size={14} />}
              onClick={() => onDelete(node.id)}
            >
              Delete node
            </Button>
          </div>
        )}
      </div>
      <div className="inspector-footer">
        <Info size={13} />
        {readOnly
          ? "Published versions are read-only"
          : "Changes are saved when you save the draft"}
      </div>
    </aside>
  );
}
