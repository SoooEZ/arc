import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { kindLabel, kindDescription } from "../types";
import type { Rule } from "../types";
export default function RuleSettings({
  rule,
  readOnly,
  onApply,
  onClose,
}: {
  rule: Rule;
  readOnly: boolean;
  onApply: (patch: Pick<Rule, "name" | "description">) => void;
  onClose: () => void;
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
              onApply({ name, description });
              onClose();
            }}
          >
            Apply changes
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
}
