import { useCallback, useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import type { Rule, RuleSummary } from "../../types";
import { patchGraphNode, type DefinitionChange } from "../../domain/graph";
import Inspector from "./inspector/Inspector";
import { applyNodeFormDraft } from "./nodeFormDraft";
import type { ReferenceTarget } from "./types";

export default function NodeEditDialog({
  rule,
  nodeId,
  rules,
  readOnly,
  onApply,
  onClose,
  onOpenReference,
}: {
  rule: Rule;
  nodeId: string;
  rules: RuleSummary[];
  readOnly: boolean;
  onApply: (change: DefinitionChange) => void;
  onClose: () => void;
  onOpenReference: (target: ReferenceTarget) => void;
}) {
  const [before] = useState(rule.draft);
  const [draft, setDraft] = useState(before);
  const [invalidJson, setInvalidJson] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const node = draft.nodes.find((candidate) => candidate.id === nodeId)!;
  const hasInvalidJson = Object.values(invalidJson).some(Boolean);
  const onInvalidJson = useCallback((key: string, invalid: boolean) => {
    setInvalidJson((current) =>
      current[key] === invalid ? current : { ...current, [key]: invalid },
    );
  }, []);
  const changeDraft = (change: DefinitionChange) => {
    if (readOnly) return;
    setDraft(change);
    setError("");
  };
  const apply = () => {
    if (readOnly || hasInvalidJson) return;
    if (!applyNodeFormDraft(rule.draft, before, draft, nodeId)) {
      setError(
        "This node changed while the editor was open. Cancel and reopen it to use the latest values.",
      );
      return;
    }
    onApply(
      (current) =>
        applyNodeFormDraft(current, before, draft, nodeId) ?? current,
    );
    onClose();
  };
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="md"
      fullWidth
      aria-labelledby="node-edit-title"
      className="node-edit-dialog"
    >
      <DialogTitle id="node-edit-title">Edit node · {node.label}</DialogTitle>
      <DialogContent className="node-edit-content">
        <p className="node-edit-description">
          Edit this node’s settings, then apply them to the draft.
        </p>
        {error && <Alert severity="error">{error}</Alert>}
        <Inspector
          rule={{ ...rule, draft }}
          node={node}
          rules={rules}
          readOnly={readOnly}
          presentation="dialog"
          onNodeChange={(id, patch) =>
            changeDraft((current) => patchGraphNode(current, id, patch))
          }
          onDefinitionChange={changeDraft}
          onInvalidJson={onInvalidJson}
          onOpenReference={onOpenReference}
          errors={[]}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          onClick={apply}
          disabled={readOnly || hasInvalidJson}
        >
          Apply to graph
        </Button>
      </DialogActions>
    </Dialog>
  );
}
