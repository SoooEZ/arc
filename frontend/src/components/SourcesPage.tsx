import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  TextField,
} from "@mui/material";
import { Database, Globe2, Plus, Play, Save, ArrowRight } from "lucide-react";
import { fresh } from "../features/sources/model";
import { useSourceEditor } from "../features/sources/useSourceEditor";
export default function SourcesPage({
  onDirty,
  notify,
}: {
  onDirty: (dirty: boolean) => void;
  notify: (s: string) => void;
}) {
  const {
    sources,
    selected,
    params,
    entries,
    headers,
    test,
    result,
    error,
    busy,
    versions,
    viewVersion,
    dirty,
    historical,
    select,
    configPatch,
    save,
    run,
    displayConfig,
    setSelected,
    setParams,
    setEntries,
    setHeaders,
    setTest,
    setViewVersion,
    setError,
  } = useSourceEditor({ onDirty, notify });
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
          onClick={() => select(fresh())}
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
          {sources.map((s) => (
            <button
              className={selected?.id === s.id ? "active" : ""}
              key={s.id}
              onClick={() => select(s)}
            >
              {s.definition.kind === "HTTP" ? (
                <Globe2 size={19} />
              ) : (
                <Database size={19} />
              )}
              <span>
                {s.name}
                <small>
                  {s.id} · v{s.version}
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
          {error && (
            <Alert severity="error" onClose={() => setError("")}>
              {error}
            </Alert>
          )}
          {!selected ? (
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
                    busy ? <CircularProgress size={14} /> : <Save size={15} />
                  }
                  disabled={busy || historical || !dirty}
                  onClick={() => void save()}
                >
                  {selected.version ? "Save new version" : "Create source"}
                </Button>
              </div>
              <div className="source-form-grid">
                <TextField
                  label="Source ID"
                  value={selected.id}
                  disabled={!!selected.version || busy || historical}
                  placeholder="customer-profile"
                  onChange={(e) =>
                    setSelected({ ...selected, id: e.target.value })
                  }
                />
                <TextField
                  label="Name"
                  value={selected.name}
                  disabled={busy || historical}
                  onChange={(e) =>
                    setSelected({ ...selected, name: e.target.value })
                  }
                />
                <TextField
                  select
                  label="Provider"
                  value={selected.definition.kind}
                  disabled={busy || historical}
                  onChange={(e) => {
                    configPatch({ kind: e.target.value as "HTTP" | "LOOKUP" });
                    setParams(
                      e.target.value === "LOOKUP"
                        ? '[{"name":"key","type":"STRING","required":true}]'
                        : '[{"name":"customerId","type":"STRING","required":true}]',
                    );
                  }}
                >
                  <MenuItem value="LOOKUP">Local lookup table</MenuItem>
                  <MenuItem value="HTTP">HTTP GET · JSON response</MenuItem>
                </TextField>
                {!!selected.version && (
                  <TextField
                    select
                    label="Inspect version"
                    value={viewVersion}
                    onChange={(e) => setViewVersion(Number(e.target.value))}
                  >
                    {versions.length ? (
                      versions.map((v) => (
                        <MenuItem key={v.version} value={v.version}>
                          v{v.version}
                          {v.version === selected.version
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
                    {JSON.stringify(displayConfig, null, 2)}
                  </pre>
                </>
              ) : (
                <>
                  {selected.definition.kind === "HTTP" && (
                    <>
                      <TextField
                        label="HTTP URL"
                        placeholder="https://api.example.com/customer"
                        value={selected.definition.url || ""}
                        disabled={busy}
                        onChange={(e) => configPatch({ url: e.target.value })}
                        helperText="Mapped parameters become URL-encoded query parameters. The response must be JSON."
                      />
                      <TextField
                        label="Timeout (ms)"
                        type="number"
                        value={selected.definition.timeoutMs}
                        disabled={busy}
                        onChange={(e) =>
                          configPatch({ timeoutMs: Number(e.target.value) })
                        }
                      />
                    </>
                  )}
                  <TextField
                    label="Source parameters · JSON"
                    multiline
                    minRows={3}
                    value={params}
                    disabled={busy}
                    onChange={(e) => setParams(e.target.value)}
                    helperText={
                      selected.definition.kind === "LOOKUP"
                        ? 'Lookup tables require a parameter named "key".'
                        : "Declare name, type (STRING / NUMBER / BOOLEAN), required, and optional defaultValue."
                    }
                    slotProps={{ input: { className: "json-input" } }}
                  />
                  {selected.definition.kind === "LOOKUP" ? (
                    <TextField
                      label="Lookup entries · JSON object"
                      multiline
                      minRows={8}
                      maxRows={20}
                      value={entries}
                      disabled={busy}
                      onChange={(e) => setEntries(e.target.value)}
                      helperText='Map keys to values or records. Example: {"US":{"rate":0.07}}'
                      slotProps={{ input: { className: "json-input" } }}
                    />
                  ) : (
                    <>
                      <TextField
                        label="Secret header aliases · JSON"
                        multiline
                        minRows={2}
                        value={headers}
                        disabled={busy}
                        onChange={(e) => setHeaders(e.target.value)}
                        helperText='Example: {"Authorization":"CRM_TOKEN"}. Server reads ARC_SECRET_CRM_TOKEN; enter the full header value only in server configuration.'
                        slotProps={{ input: { className: "json-input" } }}
                      />
                      <p className="studio-hint">
                        HTTP destinations are public by default. Server
                        operators can allow specific internal hosts. Sending
                        secrets requires an explicit host allowlist. Redirects
                        are disabled.
                      </p>
                    </>
                  )}
                </>
              )}
              <div className="source-test">
                <h3>Test this source</h3>
                <p>
                  {dirty
                    ? "Save changes before testing the new configuration."
                    : `Calls stored version ${viewVersion}. No rule execution required.`}
                </p>
                <TextField
                  label="Test parameters · JSON"
                  multiline
                  minRows={3}
                  value={test}
                  onChange={(e) => setTest(e.target.value)}
                  slotProps={{ input: { className: "json-input" } }}
                />
                <Button
                  variant="outlined"
                  startIcon={<Play size={15} />}
                  disabled={busy || !selected.version || dirty}
                  onClick={() => void run()}
                >
                  Fetch sample
                </Button>
                {result !== undefined && (
                  <pre className="source-json" data-testid="source-result">
                    {JSON.stringify(result, null, 2)}
                  </pre>
                )}
              </div>
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
