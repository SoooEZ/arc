import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Tooltip,
} from "@mui/material";
import { X } from "lucide-react";
import type { Rule } from "../../types";
import { patchGraphNode, type DefinitionChange } from "../../domain/graph";
import { useStagedDialogEdits } from "../../app/navigationGuards";
import NodeForm from "./inspector/NodeForm";
import NodeIdentity from "./inspector/NodeIdentity";
import { applyNodeFormDraft } from "./nodeFormDraft";
import type { ReferenceTarget } from "./types";

export default function NodeEditDialog({
  rule,
  nodeId,
  readOnly,
  onApply,
  onClose,
  onOpenReference,
}: {
  rule: Rule;
  nodeId: string;
  readOnly: boolean;
  /** Applies the change to the graph; false when the document refused it. */
  onApply: (change: DefinitionChange) => boolean;
  onClose: () => void;
  onOpenReference: (target: ReferenceTarget) => void;
}) {
  const [before] = useState(rule.draft);
  const [dialogLabel] = useState(
    `Edit node · ${rule.draft.nodes.find((node) => node.id === nodeId)!.label}`,
  );
  const [draft, setDraft] = useState(before);
  const [invalidDefaults, setInvalidDefaults] = useState<
    Record<string, boolean>
  >({});
  const [error, setError] = useState("");
  const node = draft.nodes.find((candidate) => candidate.id === nodeId)!;
  // Staged edits leave with the editor: a route change asks first (lesson F23).
  const dismiss = useStagedDialogEdits(draft !== before, onClose);
  const hasInvalidDefaults = Object.values(invalidDefaults).some(Boolean);
  const onInvalidDefault = useCallback((key: string, invalid: boolean) => {
    setInvalidDefaults((current) =>
      current[key] === invalid ? current : { ...current, [key]: invalid },
    );
  }, []);
  // Stable: the form's memoized fields receive it on every keystroke.
  const changeDraft = useCallback(
    (change: DefinitionChange) => {
      if (readOnly) return;
      setDraft(change);
      setError("");
    },
    [readOnly],
  );
  const apply = () => {
    if (readOnly || hasInvalidDefaults) return;
    if (!applyNodeFormDraft(rule.draft, before, draft, nodeId)) {
      setError(
        "This node changed while the editor was open. Cancel and reopen it to use the latest values.",
      );
      return;
    }
    const applied = onApply(
      (current) =>
        applyNodeFormDraft(current, before, draft, nodeId) ?? current,
    );
    if (applied) onClose();
  };
  return (
    <Dialog
      open
      onClose={dismiss}
      maxWidth="md"
      fullWidth
      aria-labelledby="node-edit-title"
      className="node-edit-dialog"
    >
      <DialogTitle
        id="node-edit-heading"
        component="div"
        className="node-edit-heading"
      >
        <span id="node-edit-title" className="visually-hidden">
          {dialogLabel}
        </span>
        <NodeIdentity
          node={node}
          readOnly={readOnly}
          onRename={(label) =>
            changeDraft((current) => patchGraphNode(current, nodeId, { label }))
          }
        />
        <Tooltip title="Close without applying">
          <IconButton aria-label="Close node editor" onClick={onClose}>
            <X size={20} />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent className="node-edit-content">
        <p className="node-edit-description">
          Edit this node’s settings, then apply them to the draft.
        </p>
        {error && <Alert severity="error">{error}</Alert>}
        <aside className="inspector inspector-dialog">
          <NodeForm
            rule={{ ...rule, draft }}
            node={node}
            readOnly={readOnly}
            onNodeChange={(id, patch) =>
              changeDraft((current) => patchGraphNode(current, id, patch))
            }
            onDefinitionChange={changeDraft}
            onInvalidDefault={onInvalidDefault}
            onOpenReference={onOpenReference}
          />
        </aside>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={apply}
          disabled={readOnly || hasInvalidDefaults}
        >
          Apply to graph
        </Button>
      </DialogActions>
    </Dialog>
  );
}
