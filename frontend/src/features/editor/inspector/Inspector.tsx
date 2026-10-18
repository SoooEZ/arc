import type { Ref } from "react";
import { IconButton, Tooltip } from "@mui/material";
import { CircleAlert, Code2, Info, Trash2 } from "lucide-react";
import { canRemoveGraphNode } from "../../../domain/graph";
import { nodeKinds } from "../../../domain/nodeKinds";
import { messageForNode } from "../../../domain/text";
import InspectorProblems from "./InspectorProblems";
import NodeIdentity from "./NodeIdentity";
import NodeForm, { type NodeFormProps } from "./NodeForm";

interface Props extends NodeFormProps {
  errors: string[];
  nameInputRef: Ref<HTMLInputElement>;
  onDelete: (id: string) => void;
  onExpression: (id: string) => void;
  /** Whether node code opens now; a running command disables it, as on the cards. */
  canOpenCode: boolean;
  /**
   * A published version is shown. `readOnly` also holds while a command runs
   * or a dialog is open, when the draft is only paused: the footer named it a
   * published version then.
   */
  published: boolean;
}

/** The editor's sidebar: the node's identity and problems, its form, and the draft's save note. */
export default function Inspector({
  errors,
  nameInputRef,
  onDelete,
  onExpression,
  canOpenCode,
  published,
  ...form
}: Props) {
  const { rule, node, readOnly, onNodeChange } = form;
  const kind = nodeKinds[node.type];
  const removable = canRemoveGraphNode(rule.draft, node.id);
  // The entry Input has no delete button; an extra Input, like other kinds, does.
  const deletable = kind.removable === true || removable;
  return (
    <aside className="inspector inspector-sidebar">
      <div className="inspector-heading">
        <NodeIdentity
          node={node}
          readOnly={readOnly}
          inputRef={nameInputRef}
          onRename={(label) => onNodeChange(node.id, { label })}
        />
        <div className="inspector-heading-actions">
          <InspectorProblems key={node.id} errors={errors} />
          <Tooltip title="Node expression">
            <IconButton
              size="small"
              aria-label="Node expression"
              disabled={!canOpenCode}
              onClick={() => onExpression(node.id)}
            >
              <Code2 size={17} />
            </IconButton>
          </Tooltip>
          {/* A node that cannot be deleted keeps an empty slot to align the header. */}
          {deletable ? (
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
      <NodeForm {...form} />
      <InspectorFooter
        problem={errors[0] && messageForNode(errors[0], node.label)}
        more={errors.length - 1}
        published={published}
      />
    </aside>
  );
}

/**
 * The inspector's last line: the node's first problem when it has one, which
 * stays in view while the form scrolls and never moves the form, otherwise
 * how the draft's changes are kept. The header lists every problem.
 */
function InspectorFooter({
  problem,
  more,
  published,
}: {
  problem: string | undefined;
  more: number;
  published: boolean;
}) {
  if (problem)
    return (
      <div className="inspector-footer inspector-footer-problem" role="status">
        <CircleAlert size={13} />
        <span>{problem}</span>
        {more > 0 && (
          <span className="inspector-footer-more">+{more} more</span>
        )}
      </div>
    );
  return (
    <div className="inspector-footer">
      <Info size={13} />
      {published
        ? "Published versions are read-only"
        : "Changes are saved when you save the draft"}
    </div>
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
