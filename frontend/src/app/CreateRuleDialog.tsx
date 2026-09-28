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
import { ruleMetadataProblem } from "../domain/limits";
import { isResourceId, suggestedRuleId } from "../domain/resourceIds";
import ResourceIdField from "../components/ResourceIdField";
import type { Kind, Rule } from "../types";
import { kinds, ruleKinds } from "../domain/ruleKinds";
export default function CreateRuleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (rule: Rule) => void;
}) {
  const [name, setName] = useState("");
  const [id, setId] = useState("");
  // The ID follows the name until the user types their own; clearing it resumes suggestions.
  const [idChosen, setIdChosen] = useState(false);
  const [kind, setKind] = useState<Kind>("DECISION_TREE");
  const [description, setDescription] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  // The server's own rule, so a long name is refused here, not by a 422.
  const metadataProblem = ruleMetadataProblem({ name, description });
  const nameProblem =
    metadataProblem?.field === "name" ? metadataProblem.message : null;
  const descriptionProblem =
    metadataProblem?.field === "description" ? metadataProblem.message : null;
  const create = async () => {
    if (creating || metadataProblem || !isResourceId(id)) return;
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
            error={!!name && !!nameProblem}
            helperText={name ? nameProblem : undefined}
            onChange={(event) => {
              setName(event.target.value);
              if (!idChosen) setId(suggestedRuleId(event.target.value));
            }}
          />
          <ResourceIdField
            label="Rule ID"
            value={id}
            disabled={creating}
            description="A permanent, unique ID used in API calls."
            onChange={(next) => {
              setId(next);
              setIdChosen(next !== "");
            }}
          />
          <TextField
            select
            label="Rule type"
            helperText={ruleKinds[kind].description}
            value={kind}
            onChange={(e) => setKind(e.target.value as Kind)}
          >
            {kinds.map((value) => (
              <MenuItem key={value} value={value}>
                {ruleKinds[value].label}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            label="Description"
            multiline
            rows={2}
            value={description}
            error={!!descriptionProblem}
            helperText={descriptionProblem ?? undefined}
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
          disabled={creating || !!metadataProblem || !isResourceId(id)}
        >
          {creating ? "Creating…" : "Create rule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
