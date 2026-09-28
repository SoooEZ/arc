import { useEffect, useRef, type ComponentType } from "react";
import type { Definition, NodeType, Rule, RuleNode } from "../../../types";
import type { ReferenceTarget } from "../types";
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

export interface NodeFormProps {
  rule: Rule;
  node: RuleNode;
  readOnly: boolean;
  onNodeChange: (id: string, patch: Partial<RuleNode>) => void;
  onDefinitionChange: (fn: (d: Definition) => Definition) => void;
  onInvalidDefault: (key: string, invalid: boolean) => void;
  onOpenReference: (target: ReferenceTarget) => void;
}

/**
 * The node's sections: the sidebar wraps them in its heading and footer, the
 * node dialog shows them alone. The scroll position restarts for each node.
 */
export default function NodeForm({
  rule,
  node,
  readOnly,
  onNodeChange,
  onDefinitionChange,
  onInvalidDefault,
  onOpenReference,
}: NodeFormProps) {
  const scroll = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
  }, [node.id]);
  const patch = (value: Partial<RuleNode>) => onNodeChange(node.id, value);
  const scope = useNodeVariables(rule.draft, node.id);
  const Fields = fieldsByType[node.type];
  const fieldProps: NodeFieldsProps = {
    rule,
    node,
    readOnly,
    patch,
    variables: scope.variables,
    scopeKnown: scope.known,
    onDefinitionChange,
    onInvalidDefault,
    onOpenReference,
  };
  return (
    <div className="inspector-scroll" ref={scroll}>
      <UnusedProperties
        node={node}
        readOnly={readOnly}
        onRemove={() => patch(clearUnusedProperties(node))}
      />
      <Fields key={node.id} {...fieldProps} />
      {nodeKinds[node.type].storesResult && (
        <ResultFields key={`result:${node.id}`} {...fieldProps} />
      )}
    </div>
  );
}
