import { useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
} from "@mui/material";
import { Copy } from "lucide-react";
import { ruleApi } from "../../api/rules";
import { errorMessage } from "../../api/errors";
import ResourceIdField from "../../components/ResourceIdField";
import PagedAutocomplete from "../../components/PagedAutocomplete";
import { ruleIncarnation } from "../../domain/ruleIdentity";
import { useRuleNaming } from "./useRuleNaming";
import type { Rule, RuleSummary } from "../../types";

/** The rule to copy, as a library card or the editor knows it. */
export type DuplicateSource = Pick<
  RuleSummary,
  "id" | "name" | "description" | "kind" | "publishedVersion" | "createdAt"
>;

/** What the copy starts from: the saved draft (null) or a published version. */
interface CopyFrom {
  version: number | null;
}
const savedDraft: CopyFrom = { version: null };

/**
 * Copies a rule into a new one: its saved draft or a published version, with
 * its saved tests unless unchecked. The new rule starts unpublished and the
 * original does not change.
 */
export default function DuplicateRuleDialog({
  source,
  note,
  onClose,
  onDuplicated,
}: {
  source: DuplicateSource;
  /** A sentence about what is copied, such as the editor's unsaved changes staying behind. */
  note?: string;
  onClose: () => void;
  /** The new rule and the notice that says what it was copied from. */
  onDuplicated: (rule: Rule, notice: string) => void;
}) {
  const naming = useRuleNaming({
    name: `${source.name} (copy)`,
    description: source.description,
  });
  const [copyFrom, setCopyFrom] = useState<CopyFrom>(savedDraft);
  const [includeTests, setIncludeTests] = useState(true);
  const [copying, setCopying] = useState(false);
  const [copyError, setCopyError] = useState("");
  const latest = source.publishedVersion;
  const versionLabel = ({ version }: CopyFrom) => {
    if (version === null) return "Saved draft";
    return version === latest
      ? `Version ${version} · latest`
      : `Version ${version}`;
  };
  const duplicate = async () => {
    if (copying || !naming.complete) return;
    setCopying(true);
    setCopyError("");
    try {
      const rule = await ruleApi.duplicate(source.id, {
        id: naming.id,
        name: naming.name,
        description: naming.description,
        version: copyFrom.version,
        includeTests,
      });
      const origin =
        copyFrom.version === null ? "" : ` version ${copyFrom.version}`;
      onDuplicated(rule, `Copied from ${source.name}${origin}.`);
    } catch (error) {
      setCopyError(errorMessage(error));
    } finally {
      setCopying(false);
    }
  };
  return (
    <Dialog
      open
      onClose={() => !copying && onClose()}
      fullWidth
      maxWidth="sm"
      aria-labelledby="duplicate-rule-title"
    >
      <DialogTitle id="duplicate-rule-title">Duplicate rule</DialogTitle>
      <DialogContent>
        <p className="dialog-intro">
          Copies {source.name} into a new rule. The copy starts unpublished, and{" "}
          {source.name} does not change.
        </p>
        <div className="form-stack">
          {note && <Alert severity="info">{note}</Alert>}
          <TextField
            autoFocus
            label="Rule name"
            value={naming.name}
            error={!!naming.nameProblem}
            helperText={naming.nameProblem ?? undefined}
            onChange={(event) => naming.setName(event.target.value)}
          />
          <ResourceIdField
            label="Rule ID"
            value={naming.id}
            disabled={copying}
            description="A permanent, unique ID used in API calls."
            onChange={naming.setId}
          />
          <TextField
            label="Description"
            multiline
            rows={2}
            value={naming.description}
            error={!!naming.descriptionProblem}
            helperText={naming.descriptionProblem ?? undefined}
            onChange={(event) => naming.setDescription(event.target.value)}
          />
          {latest ? (
            <PagedAutocomplete<CopyFrom>
              label="Copy from"
              // A rule created again under its ID has other versions (lesson F36).
              owner={`duplicate:${ruleIncarnation(source)}`}
              value={copyFrom}
              disabled={copying}
              fixedOptions={[savedDraft]}
              loadPage={async (search, offset, limit, signal) => {
                const page = await ruleApi.versionSummaries(
                  source.id,
                  { search, offset, limit },
                  { signal },
                );
                return {
                  ...page,
                  items: page.items.map(({ version }) => ({ version })),
                };
              }}
              itemKey={({ version }) =>
                version === null ? "draft" : `v${version}`
              }
              itemLabel={versionLabel}
              onChange={setCopyFrom}
              helperText="The saved draft, or a published version as it was published."
            />
          ) : (
            <p className="duplicate-source-note">
              Copies the saved draft: {source.name} has no published version.
            </p>
          )}
          <FormControlLabel
            control={
              <Checkbox
                checked={includeTests}
                disabled={copying}
                onChange={(event) => setIncludeTests(event.target.checked)}
              />
            }
            label="Copy saved tests"
          />
          {copyError && <Alert severity="error">{copyError}</Alert>}
        </div>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => onClose()} disabled={copying}>
          Cancel
        </Button>
        <Button
          variant="contained"
          startIcon={<Copy size={15} />}
          onClick={() => void duplicate()}
          disabled={copying || !naming.complete}
        >
          {copying ? "Duplicating…" : "Duplicate rule"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
