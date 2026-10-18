import { useMemo, useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  TextField,
} from "@mui/material";
import { ArrowRight } from "lucide-react";
import type { Definition, Rule } from "../../types";
import { ruleApi } from "../../api/rules";
import { readRuleVersion } from "../../app/pinnedVersions";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import {
  paginationProps,
  usePagedResource,
} from "../../hooks/usePagedResource";
import CatalogPagination from "../../components/CatalogPagination";
import { editableDraft } from "../../domain/definitionEchoes";
import {
  versionChanges,
  type VersionChanges,
} from "../../domain/versionChanges";
import VersionChangeList from "./VersionChangeList";

/** One side of a comparison: a published version, or the draft. */
export type ComparedState = number | "draft";

function stateName(state: ComparedState): string {
  return state === "draft" ? "the draft" : `v${state}`;
}

/**
 * The graph of one side: the draft as given, or a published version read
 * through the page-wide cache of immutable versions.
 */
function useComparedDefinition(
  rule: Pick<Rule, "id" | "createdAt">,
  draft: Definition,
  state: ComparedState,
) {
  const version = state === "draft" ? null : state;
  const read = useAsyncResource<Definition | null>(
    `${rule.id}@${rule.createdAt}:${version ?? "draft"}`,
    version === null
      ? null
      : async (signal) =>
          editableDraft(
            (await readRuleVersion(rule, version, signal)).definition,
          ),
    null,
  );
  if (version === null) return { definition: draft, error: "" };
  return { definition: read.loading ? null : read.data, error: read.error };
}

function StateSelect({
  label,
  value,
  versions,
  onChange,
}: {
  label: string;
  value: ComparedState;
  versions: readonly number[];
  onChange: (state: ComparedState) => void;
}) {
  // A chosen version that the shown page does not list stays selectable.
  const listed = value === "draft" || versions.includes(value);
  return (
    <TextField
      select
      label={label}
      value={String(value)}
      onChange={(event) =>
        onChange(
          event.target.value === "draft" ? "draft" : Number(event.target.value),
        )
      }
    >
      <MenuItem value="draft">Draft</MenuItem>
      {!listed && <MenuItem value={String(value)}>v{value}</MenuItem>}
      {versions.map((version) => (
        <MenuItem key={version} value={String(version)}>
          v{version}
        </MenuItem>
      ))}
    </TextField>
  );
}

/**
 * Two states of a rule, each a published version or the draft, compared as
 * the publish review lists changes: what changed from the first to the second.
 */
export default function CompareVersions({
  rule,
  draft,
  initial,
  onClose,
}: {
  rule: Pick<Rule, "id" | "createdAt" | "publishedVersion">;
  /** The draft as the editor holds it, unsaved changes included. */
  draft: Definition;
  initial: { from: ComparedState; to: ComparedState };
  onClose: () => void;
}) {
  const [from, setFrom] = useState(initial.from);
  const [to, setTo] = useState(initial.to);
  const page = usePagedResource(
    `${rule.id}@${rule.createdAt}:${rule.publishedVersion}`,
    (offset, limit, signal) =>
      ruleApi.versionSummaries(rule.id, { offset, limit }, { signal }),
  );
  const versions = page.data.items.map((item) => item.version);
  // Both sides are read as the server stores them, as the publish review reads them.
  const storedDraft = useMemo(() => editableDraft(draft), [draft]);
  const before = useComparedDefinition(rule, storedDraft, from);
  const after = useComparedDefinition(rule, storedDraft, to);
  const changes = useMemo(
    () =>
      before.definition && after.definition
        ? versionChanges(before.definition, after.definition)
        : null,
    [before.definition, after.definition],
  );
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="compare-versions-title"
    >
      <DialogTitle id="compare-versions-title">Compare versions</DialogTitle>
      <DialogContent className="compare-versions">
        <div className="compare-sides">
          <StateSelect
            label="From"
            value={from}
            versions={versions}
            onChange={setFrom}
          />
          <ArrowRight size={16} aria-hidden />
          <StateSelect
            label="To"
            value={to}
            versions={versions}
            onChange={setTo}
          />
        </div>
        {page.data.total > page.limit && (
          <CatalogPagination
            label="Versions to compare"
            {...paginationProps(page)}
          />
        )}
        <Comparison
          from={from}
          to={to}
          error={before.error || after.error}
          changes={changes}
        />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}

function Comparison({
  from,
  to,
  error,
  changes,
}: {
  from: ComparedState;
  to: ComparedState;
  error: string;
  changes: VersionChanges | null;
}) {
  if (from === to)
    return (
      <p className="muted-copy">Choose two different versions to compare.</p>
    );
  if (error)
    return <Alert severity="error">Could not read a version: {error}</Alert>;
  if (!changes)
    return (
      <div className="compare-loading">
        <CircularProgress size={14} /> Reading the versions…
      </div>
    );
  if (changes.identical)
    return (
      <Alert severity="info">
        Nothing changed from {stateName(from)} to {stateName(to)}.
      </Alert>
    );
  return (
    <div className="version-changes">
      <strong>
        Changes from {stateName(from)} to {stateName(to)}
      </strong>
      <VersionChangeList changes={changes} />
    </div>
  );
}
