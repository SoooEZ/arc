import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from "@mui/material";
import { Plus } from "lucide-react";
import { ruleApi } from "../api/rules";
import { errorMessage } from "../api/errors";
import type { Kind, Rule } from "../types";
import { kindDescription, kindLabel } from "../types";
export default function CreateRuleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (rule: Rule) => void;
}) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  const [kind, setKind] = useState<Kind>("DECISION_TREE");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const create = async () => {
    if (creating) return;
    setCreating(true);
    setCreateError("");
    try {
      onCreated(await ruleApi.create(id, name, description, kind));
    } catch (error) {
      setCreateError(errorMessage(error));
    } finally {
      setCreating(false);
    }
  };
  return (
    <Dialog open onClose={() => !creating && onClose()} fullWidth maxWidth="sm">
      <DialogTitle>Create a rule</DialogTitle>
      <DialogContent>
        <p className="dialog-intro">
          Start with a working template, then shape it around your logic.
        </p>
        <div className="form-stack">
          <TextField
            autoFocus
            label="Rule name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setId(
                e.target.value
                  .toLowerCase()
                  .replace(/[^a-z0-9]+/g, "-")
                  .replace(/^-|-$/g, "")
                  .slice(0, 80),
              );
            }}
          />
          <TextField
            label="Rule ID"
            value={id}
            onChange={(e) => setId(e.target.value)}
            helperText="A permanent, unique ID used in API calls."
          />
          <TextField
            select
            label="Rule type"
            helperText={kindDescription[kind]}
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {Object.entries(kindLabel).map(([value, label]) => (
              <MenuItem key={value} value={value}>
                {label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Description"
            multiline
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          {createError && <Alert severity="error">{createError}</Alert>}
          <Chip
            className="template-note"
            label="Includes a connected graph and sample inputs"
          />
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()} disabled={creating}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={create}
          disabled={creating || !name.trim() || !id}
        >
          {creating ? "Creating…" : "Create rule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
