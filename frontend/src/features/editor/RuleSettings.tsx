import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { kindLabel, kindDescription } from "../../types";
import type { Rule } from "../../types";
export default function RuleSettings({
  rule,
  readOnly,
  onApply,
  onClose,
  onDelete,
  canDelete = false,
}: {
  rule: Rule;
  readOnly: boolean;
  /** Applies the settings to the draft; false when the document refused them. */
  onApply: (patch: Pick<Rule, "name" | "description">) => boolean;
  onClose: () => void;
  /** Offers deleting the rule; resolves to why the server kept it, or null. */
  onDelete?: () => Promise<string | null>;
  /** Whether a deletion may start now, e.g. no other command is running. */
  canDelete?: boolean;
}) {
  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description);
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="rule-settings-title"
    >
      <DialogTitle id="rule-settings-title">Rule settings</DialogTitle>
      <DialogContent className="rule-settings-content">
        <TextField
          autoFocus
          label="Name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={readOnly}
          fullWidth
        />
        <TextField
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          multiline
          rows={4}
          disabled={readOnly}
          fullWidth
        />
        <div className="read-only-field">
          <span>Rule type</span>
          <strong>{kindLabel[rule.kind]}</strong>
        </div>
        <p className="muted-copy">
          {kindDescription[rule.kind]} All types support the same graph nodes
          and execution engine.
        </p>
        <div className="read-only-field">
          <span>API identifier</span>
          <code>{rule.id}</code>
        </div>
        <p className="muted-copy">
          {rule.publishedVersion
            ? `Version ${rule.publishedVersion} is available through the API. Draft changes take effect when you publish.`
            : "Publish this rule to make it available through the execution API."}
        </p>
        {!readOnly && (
          <p className="muted-copy">
            Apply changes, then Save draft to persist them.
          </p>
        )}
        {onDelete && (
          <DeleteRule rule={rule} onDelete={onDelete} allowed={canDelete} />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{readOnly ? "Close" : "Cancel"}</Button>
        {!readOnly && (
          <Button
            variant="contained"
            disabled={
              !name.trim() || name.length > 160 || description.length > 2000
            }
            onClick={() => {
              if (onApply({ name, description })) onClose();
            }}
          >
            Apply changes
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}

/** "version 1" or "versions 1–4": every published version goes with the rule. */
function publishedVersions(latest: number): string {
  return latest === 1 ? "version 1" : `versions 1–${latest}`;
}

/**
 * Deleting cannot be undone, so it asks first. A published rule also asks for
 * its ID, because API clients call the rule by that ID.
 */
function DeleteRule({
  rule,
  onDelete,
  allowed,
}: {
  rule: Rule;
  onDelete: () => Promise<string | null>;
  allowed: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typedId, setTypedId] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [refusal, setRefusal] = useState("");
  const published = rule.publishedVersion;
  if (!confirming)
    return (
      <section className="rule-settings-danger">
        <Button
          color="error"
          variant="outlined"
          disabled={!allowed}
          onClick={() => setConfirming(true)}
        >
          Delete rule…
        </Button>
      </section>
    );
  const cancel = () => {
    setConfirming(false);
    setTypedId("");
    setRefusal("");
  };
  const confirm = async () => {
    setDeleting(true);
    setRefusal("");
    // On success the editor leaves for the library and this dialog closes.
    const reason = await onDelete();
    setDeleting(false);
    if (reason) setRefusal(reason);
  };
  return (
    <section className="rule-settings-danger" aria-label="Delete rule">
      <Alert severity="warning">
        {published
          ? `Deleting removes the draft and ${publishedVersions(published)}. API calls to ${rule.id} will fail. This cannot be undone.`
          : "Deleting removes this draft. This cannot be undone."}
      </Alert>
      {published && (
        <TextField
          label={`Type ${rule.id} to confirm`}
          value={typedId}
          onChange={(event) => setTypedId(event.target.value)}
          disabled={deleting}
          fullWidth
        />
      )}
      {refusal && <Alert severity="error">{refusal}</Alert>}
      <div className="rule-settings-danger-actions">
        <Button onClick={cancel} disabled={deleting}>
          Keep rule
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={!allowed || (!!published && typedId !== rule.id)}
          onClick={() => void confirm()}
        >
          {deleting ? "Deleting…" : "Delete rule"}
        </Button>
      </div>
    </section>
  );
}
