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
import { ruleMetadataProblem } from "../../domain/limits";
import type { Rule } from "../../types";
import type { DeletionRefusal } from "./useRuleDocument";
export default function RuleSettings({
  rule,
  readOnly,
  onApply,
  onClose,
  onDelete,
  canDelete = false,
  deleting = false,
}: {
  rule: Rule;
  readOnly: boolean;
  /** Applies the settings to the draft; false when the document refused them. */
  onApply: (patch: Pick<Rule, "name" | "description">) => boolean;
  onClose: () => void;
  /** Offers deleting the rule; resolves to why the server kept it, or null. */
  onDelete?: () => Promise<DeletionRefusal | null>;
  /** Whether a deletion may start now, e.g. no other command is running. */
  canDelete?: boolean;
  /** A deletion is pending; the dialog stays open to show its outcome. */
  deleting?: boolean;
}) {
  const [name, setName] = useState(rule.name);
  const [description, setDescription] = useState(rule.description);
  return (
    <Dialog
      open
      onClose={deleting ? undefined : onClose}
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
          <DeleteRule
            rule={rule}
            onDelete={onDelete}
            allowed={canDelete}
            deleting={deleting}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={deleting}>
          {readOnly && !deleting ? "Close" : "Cancel"}
        </Button>
        {!readOnly && (
          <Button
            variant="contained"
            disabled={!!ruleMetadataProblem({ name, description })}
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
 * its ID, because API clients call the rule by that ID. While the deletion is
 * pending nothing closes the dialog, so its outcome is always shown here.
 */
function DeleteRule({
  rule,
  onDelete,
  allowed,
  deleting,
}: {
  rule: Rule;
  onDelete: () => Promise<DeletionRefusal | null>;
  allowed: boolean;
  deleting: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const [typedId, setTypedId] = useState("");
  const [refusal, setRefusal] = useState<DeletionRefusal | null>(null);
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
    setRefusal(null);
  };
  const confirm = async () => {
    setRefusal(null);
    // On success the editor leaves for the library and this dialog closes.
    setRefusal(await onDelete());
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
      {refusal && (
        <Alert severity="error">
          {refusal.message}
          {refusal.callers.length > 0 && (
            <ul
              className="rule-settings-callers"
              aria-label="Rules calling this rule"
            >
              {refusal.callers.map((caller) => (
                <li key={caller}>{caller}</li>
              ))}
            </ul>
          )}
        </Alert>
      )}
      <div className="rule-settings-danger-actions">
        <Button onClick={cancel} disabled={deleting}>
          Keep rule
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={
            !allowed || deleting || (!!published && typedId !== rule.id)
          }
          onClick={() => void confirm()}
        >
          {deleting ? "Deleting…" : "Delete rule"}
        </Button>
      </div>
    </section>
  );
}
