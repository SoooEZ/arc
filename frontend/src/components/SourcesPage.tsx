import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  MenuItem,
  TextField,
} from "@mui/material";
import { Database, Globe2, Plus, Play, Save, ArrowRight } from "lucide-react";
import { api, errorMessage } from "../api";
import type { DataSource, SourceConfig } from "../types";
const fresh = (): DataSource => ({
  id: "",
  name: "",
  version: 0,
  definition: {
    kind: "LOOKUP",
    parameters: [
      { name: "key", type: "STRING", required: true, defaultValue: null },
    ],
    entries: { US: { rate: 0.07 }, GB: { rate: 0.2 } },
    timeoutMs: 3000,
  },
});
export default function SourcesPage({
  onDirty,
  notify,
}: {
  onDirty: (dirty: boolean) => void;
  notify: (s: string) => void;
}) {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [selected, setSelected] = useState<DataSource | null>(null);
  const [baseline, setBaseline] = useState("");
  const [params, setParams] = useState("");
  const [entries, setEntries] = useState("");
  const [headers, setHeaders] = useState("{}");
  const [test, setTest] = useState('{"key":"US"}');
  const [result, setResult] = useState<unknown>(undefined);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [versions, setVersions] = useState<DataSource[]>([]);
  const [viewVersion, setViewVersion] = useState(0);
  const snapshot = JSON.stringify([selected, params, entries, headers]);
  const dirty = !!selected && snapshot !== baseline;
  const historical = !!selected && viewVersion !== selected.version;
  const choose = (s: DataSource) => {
    const p = JSON.stringify(s.definition.parameters, null, 2),
      e = JSON.stringify(s.definition.entries ?? {}, null, 2),
      h = JSON.stringify(s.definition.secretHeaders ?? {}, null, 2);
    setSelected(s);
    setViewVersion(s.version);
    setParams(p);
    setEntries(e);
    setHeaders(h);
    setBaseline(JSON.stringify([s, p, e, h]));
    setResult(undefined);
    setError("");
    setTest(
      JSON.stringify(
        Object.fromEntries(
          s.definition.parameters.map((p) => [
            p.name,
            p.defaultValue ??
              (p.type === "NUMBER"
                ? 1
                : p.type === "BOOLEAN"
                  ? true
                  : p.name === "key"
                    ? "US"
                    : "example"),
          ]),
        ),
        null,
        2,
      ),
    );
  };
  const load = async () => {
    try {
      const rows = await api.sources();
      setSources(rows);
      if (!selected && rows.length) choose(rows[0]);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    void load();
  }, []);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  useEffect(() => {
    let live = true;
    if (selected?.version)
      api
        .sourceVersions(selected.id)
        .then((rows) => {
          if (live) setVersions(rows);
        })
        .catch((e) => {
          if (live) setError(errorMessage(e));
        });
    else setVersions([]);
    return () => {
      live = false;
    };
  }, [selected?.id, selected?.version]);
  const select = (s: DataSource) => {
    if (dirty && !window.confirm("Discard unsaved source changes?")) return;
    choose(s);
  };
  const configPatch = (patch: Partial<SourceConfig>) => {
    if (selected)
      setSelected({
        ...selected,
        definition: { ...selected.definition, ...patch },
      });
  };
  const save = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      const c = {
        ...selected.definition,
        parameters: JSON.parse(params),
        entries: JSON.parse(entries),
        secretHeaders: JSON.parse(headers),
      };
      const saved = selected.version
        ? await api.saveSource({ ...selected, definition: c })
        : await api.createSource(selected.id, selected.name, c);
      setSources((rows) => [saved, ...rows.filter((r) => r.id !== saved.id)]);
      choose(saved);
      notify(
        `Data source v${saved.version} saved. Existing rules keep their pinned version.`,
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const run = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    setResult(undefined);
    try {
      const response = await api.testSource(
        selected.id,
        viewVersion,
        JSON.parse(test),
      );
      setResult(response.result);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  const displayConfig = historical
    ? versions.find((v) => v.version === viewVersion)?.definition
    : selected?.definition;
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
