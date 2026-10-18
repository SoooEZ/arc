import { useRef, useState, type ChangeEvent } from "react";
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
  ToggleButton,
  ToggleButtonGroup,
} from "@mui/material";
import { FileUp, Plus } from "lucide-react";
import { ruleApi } from "../../api/rules";
import { errorMessage } from "../../api/errors";
import ResourceIdField from "../../components/ResourceIdField";
import type { Kind, Rule } from "../../types";
import { kinds, ruleKinds } from "../../domain/ruleKinds";
import {
  maxGraphFileBytes,
  readGraphFile,
  suggestedImportName,
  type GraphFile,
} from "./graphImport";
import { useRuleNaming } from "./useRuleNaming";

type StartFrom = "template" | "file";

/** A chosen file and what it holds. */
interface ChosenFile {
  name: string;
  graph: GraphFile;
}

const intros: Record<StartFrom, string> = {
  template: "Start with a working template, then shape it around your logic.",
  file: "Create the rule with a graph exported from ARC, then test and publish it here.",
};

export default function CreateRuleDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  /** The created rule and the notice that says how it was made. */
  onCreated: (rule: Rule, notice: string) => void;
}) {
  const naming = useRuleNaming({ name: "", description: "" });
  const [kind, setKind] = useState<Kind>("DECISION_TREE");
  const [startFrom, setStartFrom] = useState<StartFrom>("template");
  const [file, setFile] = useState<ChosenFile | null>(null);
  // The file being read: a later choice wins over an earlier read that finishes after it.
  const reading = useRef<File | null>(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState("");
  const graph =
    startFrom === "file" && file?.graph.kind === "graph"
      ? file.graph.definition
      : null;
  const ready = naming.complete && (startFrom === "template" || !!graph);
  const chooseFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const chosen = event.target.files?.[0];
    // The same file chosen again after a fix on disk must be read again.
    event.target.value = "";
    if (!chosen) return;
    reading.current = chosen;
    setCreateError("");
    const read: GraphFile =
      chosen.size > maxGraphFileBytes
        ? {
            kind: "invalid",
            problem:
              "This file is larger than 5 MB, too large for an ARC graph.",
          }
        : readGraphFile(await chosen.text());
    if (reading.current !== chosen) return;
    setFile({ name: chosen.name, graph: read });
    if (read.kind === "graph" && !naming.name.trim())
      naming.setName(suggestedImportName(chosen.name));
  };
  const create = async () => {
    if (creating || !ready) return;
    setCreating(true);
    setCreateError("");
    try {
      const rule = await ruleApi.create(
        naming.id,
        naming.name,
        naming.description,
        kind,
        graph ?? undefined,
      );
      onCreated(
        rule,
        graph && file
          ? `Rule imported from ${file.name}.`
          : "Rule created. Make it yours.",
      );
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
        <p className="dialog-intro">{intros[startFrom]}</p>
        <div className="form-stack">
          <ToggleButtonGroup
            exclusive
            size="small"
            className="create-start-from"
            aria-label="Start from"
            value={startFrom}
            disabled={creating}
            onChange={(_, next: StartFrom | null) => {
              if (next) setStartFrom(next);
            }}
          >
            <ToggleButton value="template">Template</ToggleButton>
            <ToggleButton value="file">Graph file</ToggleButton>
          </ToggleButtonGroup>
          {startFrom === "file" && (
            <GraphFileField
              file={file}
              disabled={creating}
              onChoose={(event) => void chooseFile(event)}
            />
          )}
          <TextField
            autoFocus
            label="Rule name"
            value={naming.name}
            error={!!naming.name && !!naming.nameProblem}
            helperText={naming.name ? naming.nameProblem : undefined}
            onChange={(event) => naming.setName(event.target.value)}
          />
          <ResourceIdField
            label="Rule ID"
            value={naming.id}
            disabled={creating}
            description="A permanent, unique ID used in API calls."
            onChange={naming.setId}
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
            value={naming.description}
            error={!!naming.descriptionProblem}
            helperText={naming.descriptionProblem ?? undefined}
            onChange={(e) => naming.setDescription(e.target.value)}
          />
          {createError && <Alert severity="error">{createError}</Alert>}
          {startFrom === "template" && (
            <Chip
              className="template-note"
              label="Includes a connected graph and sample inputs"
            />
          )}
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
          disabled={creating || !ready}
        >
          {creating ? "Creating…" : "Create rule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

/** Chooses the exported graph file and says what it holds, or why it cannot be used. */
function GraphFileField({
  file,
  disabled,
  onChoose,
}: {
  file: ChosenFile | null;
  disabled: boolean;
  onChoose: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="graph-file">
      <div className="graph-file-row">
        <Button
          component="label"
          variant="outlined"
          size="small"
          startIcon={<FileUp size={15} />}
          disabled={disabled}
        >
          {file ? "Choose another file" : "Choose file"}
          <input
            hidden
            type="file"
            accept=".json,application/json"
            aria-label="Graph file"
            onChange={onChoose}
          />
        </Button>
        <span className="graph-file-name">
          {file
            ? file.name
            : "A .json file saved with Export definition in the editor"}
        </span>
      </div>
      {file?.graph.kind === "graph" && (
        <p className="graph-file-summary">{file.graph.summary}</p>
      )}
      {file?.graph.kind === "invalid" && (
        <Alert severity="error">{file.graph.problem}</Alert>
      )}
    </div>
  );
}
