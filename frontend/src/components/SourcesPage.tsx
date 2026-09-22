import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  TextField,
} from "@mui/material";
import { Database, Globe2, Plus, Save, ArrowRight } from "lucide-react";
import { createSourceDraft } from "../features/sources/model";
import { useSourceEditor } from "../features/sources/useSourceEditor";
import SourceConfigurationFields from "../features/sources/SourceConfigurationFields";
import SourceTestPanel from "../features/sources/SourceTestPanel";

export default function SourcesPage({
  onDirty,
  notify,
}: {
  onDirty: (dirty: boolean) => void;
  notify: (message: string) => void;
}) {
  const editor = useSourceEditor({ onDirty, notify });
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
          onClick={() => editor.select(createSourceDraft())}
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
          {editor.loading && (
            <CircularProgress size={20} aria-label="Loading data sources" />
          )}
          {editor.sources.map((source) => (
            <button
              className={selected?.id === source.id ? "active" : ""}
              key={source.id}
              onClick={() => editor.select(source)}
            >
              {source.definition.kind === "HTTP" ? (
                <Globe2 size={19} />
              ) : (
                <Database size={19} />
              )}
              <span>
                {source.name}
                <small>
                  {source.id} · v{source.version}
                </small>
              </span>
            </button>
          ))}
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
                    label={
                      selected.version
                        ? `v${selected.version}${dirty ? " · edited" : ""}`
                        : "Unsaved"
                    }
                  />
                </div>
                <Button
                  variant="contained"
                  startIcon={
                    saving ? <CircularProgress size={14} /> : <Save size={15} />
                  }
                  disabled={saving || historical || !dirty}
                  onClick={() => void editor.save()}
                >
                  {selected.version ? "Save new version" : "Create source"}
                </Button>
              </div>
              <div className="source-form-grid">
                <TextField
                  label="Source ID"
                  value={selected.id}
                  disabled={!!selected.version || saving || historical}
                  placeholder="customer-profile"
                  onChange={(event) =>
                    editor.changeMetadata({ id: event.target.value })
                  }
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
                  onChange={(event) =>
                    editor.changeProvider(
                      event.target.value as "HTTP" | "LOOKUP",
                    )
                  }
                >
                  <MenuItem value="LOOKUP">Local lookup table</MenuItem>
                  <MenuItem value="HTTP">HTTP GET · JSON response</MenuItem>
                </TextField>
                {!!selected.version && (
                  <TextField
                    select
                    label="Inspect version"
                    value={document.viewedVersion}
                    disabled={saving || editor.versionsLoading}
                    onChange={(event) =>
                      editor.inspectVersion(Number(event.target.value))
                    }
                  >
                    {editor.versions.length ? (
                      editor.versions.map((version) => (
                        <MenuItem key={version.version} value={version.version}>
                          v{version.version}
                          {version.version === selected.version
                            ? " · latest"
                            : " · immutable"}
                        </MenuItem>
                      ))
                    ) : (
                      <MenuItem value={selected.version}>
                        v{selected.version}
                      </MenuItem>
                    )}
                  </TextField>
                )}
              </div>
              {historical ? (
                <>
                  <Alert severity="info">
                    Viewing an immutable configuration. Choose the latest
                    version to edit.
                  </Alert>
                  <pre className="source-json">
                    {JSON.stringify(editor.displayConfig, null, 2)}
                  </pre>
                </>
              ) : (
                <SourceConfigurationFields
                  configuration={selected.definition}
                  buffers={document.buffers}
                  disabled={saving}
                  onConfig={editor.changeConfig}
                  onBuffer={editor.changeBuffer}
                />
              )}
              <SourceTestPanel
                version={document.viewedVersion}
                input={document.testInput}
                result={document.result}
                running={document.testing !== null}
                disabled={saving || !selected.version || dirty}
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
