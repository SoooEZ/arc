import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  TextField,
  Tooltip,
} from "@mui/material";
import { Save } from "lucide-react";
import { stringifyJson } from "../../domain/json";
import { displayNameProblem } from "../../domain/limits";
import { sourceVersionLabel } from "./sourceDocument";
import { isSourceKind, sourceKinds, sourceProviders } from "./sourceProviders";
import type { SourceEditor } from "./useSourceEditor";
import CatalogPagination from "../../components/CatalogPagination";
import PagedVersionSelect from "../../components/PagedVersionSelect";
import ResourceIdField from "../../components/ResourceIdField";
import { paginationProps } from "../../hooks/usePagedResource";
import SourceConfigurationFields from "./SourceConfigurationFields";
import SourceTestPanel from "./SourceTestPanel";
import { useFieldFeedback } from "./useFieldFeedback";

/** The open source: its identity, version, configuration form and sample test. */
export default function SourceDetail({
  document,
  versions,
  commands,
}: {
  document: SourceEditor["document"];
  versions: SourceEditor["versions"];
  commands: SourceEditor["commands"];
}) {
  const { open, saving, historical, dirty } = document;
  const selected = open?.source;
  const feedback = useFieldFeedback(open?.selection ?? 0);
  // The server's own rule, shown under the field it refuses (lesson F28) once
  // the field was edited or left: a new source opens with an empty name.
  const nameProblem =
    selected && !historical && feedback.touched("name")
      ? displayNameProblem("Source", selected.name)
      : null;
  // Why Save is unavailable for a new source or one with edits, as the
  // button's tooltip.
  const blocked = feedback.hasInvalidCells
    ? "Fix the marked default values first."
    : document.saveProblem;
  const explained = !saving && !historical && (dirty || !selected?.version);
  return (
    <section className="source-detail">
      {document.error && (
        <Alert severity="error" onClose={commands.dismissError}>
          {document.error}
        </Alert>
      )}
      {versions.error && (
        <Alert severity="error">
          Could not load source versions: {versions.error}
        </Alert>
      )}
      {document.loading && (
        <CircularProgress size={20} aria-label="Loading source" />
      )}
      {!open || !selected ? (
        <p>Select or create a data source.</p>
      ) : (
        <>
          <div className="source-detail-heading">
            <div>
              <h2>{selected.version ? selected.name : "New data source"}</h2>
              <Chip
                size="small"
                label={sourceVersionLabel(selected.version, dirty)}
              />
            </div>
            <Tooltip title={explained ? (blocked ?? "") : ""} describeChild>
              <span className="source-save">
                <Button
                  variant="contained"
                  startIcon={
                    saving ? <CircularProgress size={14} /> : <Save size={15} />
                  }
                  disabled={saving || historical || !dirty || !!blocked}
                  onClick={() => void commands.save()}
                >
                  {selected.version ? "Save new version" : "Create source"}
                </Button>
              </span>
            </Tooltip>
          </div>
          <div className="source-form-grid">
            <ResourceIdField
              label="Source ID"
              value={selected.id}
              disabled={!!selected.version || saving || historical}
              placeholder="customer-profile"
              description="A permanent ID that rules pin."
              onChange={(id) => commands.changeMetadata({ id })}
            />
            <TextField
              label="Name"
              value={selected.name}
              disabled={saving || historical}
              error={!!nameProblem}
              helperText={nameProblem}
              onChange={(event) => {
                feedback.touch("name");
                commands.changeMetadata({ name: event.target.value });
              }}
              onBlur={() => feedback.touch("name")}
            />
            <TextField
              select
              label="Provider"
              value={selected.definition.kind}
              disabled={saving || historical}
              onChange={(event) => {
                if (isSourceKind(event.target.value))
                  commands.changeProvider(event.target.value);
              }}
            >
              {sourceKinds.map((kind) => (
                <MenuItem key={kind} value={kind}>
                  {sourceProviders[kind].label}
                </MenuItem>
              ))}
            </TextField>
            {!!selected.version && (
              <PagedVersionSelect
                label="Inspect version"
                value={open.viewedVersion}
                versions={versions.items}
                disabled={saving || versions.loading}
                optionLabel={(version) =>
                  version === selected.version
                    ? `v${version} · latest`
                    : `v${version} · immutable`
                }
                onChange={(version) => void commands.inspectVersion(version)}
              />
            )}
          </div>
          {!!selected.version && (
            <CatalogPagination
              label="Source history"
              {...paginationProps(versions.page)}
            />
          )}
          {document.versionLoading && (
            <CircularProgress size={20} aria-label="Loading source version" />
          )}
          {historical ? (
            <>
              <Alert severity="info">
                Viewing an immutable configuration. Choose the latest version to
                edit.
              </Alert>
              {document.displayConfig && (
                <pre className="source-json">
                  {stringifyJson(document.displayConfig, 2)}
                </pre>
              )}
            </>
          ) : (
            <SourceConfigurationFields
              configuration={selected.definition}
              buffers={open.buffers}
              timeout={open.timeout}
              disabled={saving}
              touched={feedback.touched}
              onTouch={feedback.touch}
              onCellValidity={feedback.cellValidity}
              onConfig={commands.changeConfig}
              onBuffer={commands.changeBuffer}
              onTimeout={commands.changeTimeout}
            />
          )}
          <SourceTestPanel
            version={open.viewedVersion}
            parameters={document.displayConfig?.parameters ?? null}
            input={open.testInput}
            result={open.result}
            running={open.testing !== null}
            disabled={!document.canRun}
            dirty={dirty}
            onInput={commands.changeTestInput}
            onRun={commands.run}
          />
          <Alert severity="info">
            To use this source, select an Input node in the graph and choose its
            value provider. Or insert an External parameter module in Code
            studio.
          </Alert>
        </>
      )}
    </section>
  );
}
