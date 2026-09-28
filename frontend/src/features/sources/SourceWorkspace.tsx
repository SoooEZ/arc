import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  TextField,
} from "@mui/material";
import {
  Database,
  Globe2,
  Plus,
  Save,
  ArrowRight,
  type LucideIcon,
} from "lucide-react";
import { stringifyJson } from "../../domain/json";
import { createSourceDraft } from "./model";
import { sourceVersionLabel } from "./sourceDocument";
import {
  isSourceKind,
  sourceKinds,
  sourceProviders,
  type SourceKind,
} from "./sourceProviders";
import type { SourceEditor } from "./useSourceEditor";
import CatalogPagination from "../../components/CatalogPagination";
import PagedVersionSelect from "../../components/PagedVersionSelect";
import ResourceIdField from "../../components/ResourceIdField";
import { paginationProps } from "../../hooks/usePagedResource";
import SourceConfigurationFields from "./SourceConfigurationFields";
import SourceTestPanel from "./SourceTestPanel";

/**
 * The source editor's surface. Its host owns the controller (`useSourceEditor`):
 * the workspace page and the embedded source manager both render this and
 * read the editor's `dirty` and `pending` directly.
 */
// Exhaustive: a new provider fails to compile until it has a list icon.
const providerIcons: Record<SourceKind, LucideIcon> = {
  LOOKUP: Database,
  HTTP: Globe2,
};

export default function SourceWorkspace({ editor }: { editor: SourceEditor }) {
  const { document, saving, historical, dirty } = editor;
  const selected = document?.source;
  return (
    <div className="sources-page">
      <div className="page-eyebrow">CONNECTED INPUTS</div>
      <div className="sources-heading">
        <div>
          <h1>
            Data sources<span className="heading-dot">.</span>
          </h1>
          <p>Give your rules the context they need, when they need it.</p>
        </div>
        <Button
          variant="contained"
          startIcon={<Plus size={16} />}
          onClick={() => void editor.select(createSourceDraft())}
        >
          New source
        </Button>
      </div>
      <div className="source-explainer">
        <span>Caller input</span>
        <ArrowRight size={15} />
        <span>Missing? Read pinned source</span>
        <ArrowRight size={15} />
        <span>Extract field & check type</span>
        <ArrowRight size={15} />
        <span>Calculate</span>
      </div>
      <div className="sources-layout">
        <aside className="source-list">
          <TextField
            label="Search data sources"
            value={editor.search}
            onChange={(event) => editor.setSearch(event.target.value)}
          />
          {editor.loading && (
            <CircularProgress size={20} aria-label="Loading data sources" />
          )}
          {editor.catalogError && (
            <Alert
              severity="error"
              action={
                <Button
                  color="inherit"
                  size="small"
                  onClick={editor.retryCatalog}
                >
                  Retry
                </Button>
              }
            >
              Could not load data sources: {editor.catalogError}
            </Alert>
          )}
          {editor.sources.map((source) => (
            <button
              className={selected?.id === source.id ? "active" : ""}
              key={source.id}
              onClick={() => void editor.select(source)}
            >
              <ProviderIcon kind={source.kind} />
              <span>
                {source.name}
                <small>
                  {source.id} · v{source.version}
                </small>
              </span>
            </button>
          ))}
          <CatalogPagination
            label="Data sources"
            offset={editor.catalog.offset}
            limit={editor.catalog.limit}
            total={editor.sourcesTotal}
            loading={editor.loading}
            onPage={editor.catalog.setOffset}
          />
          <p>
            Lookup tables work offline. HTTP sources read JSON APIs. Both use
            immutable configuration versions.
          </p>
        </aside>
        <section className="source-detail">
          {editor.error && (
            <Alert severity="error" onClose={editor.dismissError}>
              {editor.error}
            </Alert>
          )}
          {editor.versionsError && (
            <Alert severity="error">
              Could not load source versions: {editor.versionsError}
            </Alert>
          )}
          {editor.detailLoading && (
            <CircularProgress size={20} aria-label="Loading source" />
          )}
          {!document || !selected ? (
            <p>Select or create a data source.</p>
          ) : (
            <>
              <div className="source-detail-heading">
                <div>
                  <h2>
                    {selected.version ? selected.name : "New data source"}
                  </h2>
                  <Chip
                    size="small"
                    label={sourceVersionLabel(selected.version, dirty)}
                  />
                </div>
                <Button
                  variant="contained"
                  startIcon={
                    saving ? <CircularProgress size={14} /> : <Save size={15} />
                  }
                  disabled={
                    saving || historical || !dirty || !!editor.saveProblem
                  }
                  onClick={() => void editor.save()}
                >
                  {selected.version ? "Save new version" : "Create source"}
                </Button>
              </div>
              <div className="source-form-grid">
                <ResourceIdField
                  label="Source ID"
                  value={selected.id}
                  disabled={!!selected.version || saving || historical}
                  placeholder="customer-profile"
                  description="A permanent ID that rules pin."
                  onChange={(id) => editor.changeMetadata({ id })}
                />
                <TextField
                  label="Name"
                  value={selected.name}
                  disabled={saving || historical}
                  onChange={(event) =>
                    editor.changeMetadata({ name: event.target.value })
                  }
                />
                <TextField
                  select
                  label="Provider"
                  value={selected.definition.kind}
                  disabled={saving || historical}
                  onChange={(event) => {
                    if (isSourceKind(event.target.value))
                      editor.changeProvider(event.target.value);
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
                    value={document.viewedVersion}
                    versions={editor.versions}
                    disabled={saving || editor.versionsLoading}
                    optionLabel={(version) =>
                      version === selected.version
                        ? `v${version} · latest`
                        : `v${version} · immutable`
                    }
                    onChange={(version) => void editor.inspectVersion(version)}
                  />
                )}
              </div>
              {!!selected.version && (
                <CatalogPagination
                  label="Source history"
                  {...paginationProps(editor.versionsPage)}
                />
              )}
              {editor.versionLoading && (
                <CircularProgress
                  size={20}
                  aria-label="Loading source version"
                />
              )}
              {historical ? (
                <>
                  <Alert severity="info">
                    Viewing an immutable configuration. Choose the latest
                    version to edit.
                  </Alert>
                  {editor.displayConfig && (
                    <pre className="source-json">
                      {stringifyJson(editor.displayConfig, 2)}
                    </pre>
                  )}
                </>
              ) : (
                <SourceConfigurationFields
                  configuration={selected.definition}
                  buffers={document.buffers}
                  timeout={document.timeout}
                  disabled={saving}
                  onConfig={editor.changeConfig}
                  onBuffer={editor.changeBuffer}
                  onTimeout={editor.changeTimeout}
                />
              )}
              <SourceTestPanel
                version={document.viewedVersion}
                input={document.testInput}
                result={document.result}
                running={document.testing !== null}
                disabled={!editor.canRun}
                dirty={dirty}
                onInput={editor.changeTestInput}
                onRun={editor.run}
              />
              <Alert severity="info">
                To use this source, select an Input node in the graph and choose
                its value provider. Or insert an External parameter module in
                Code studio.
              </Alert>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function ProviderIcon({ kind }: { kind: SourceKind }) {
  const Icon = providerIcons[kind];
  return <Icon size={19} />;
}
