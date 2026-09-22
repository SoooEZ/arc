import { Alert, Button, Chip, MenuItem, TextField } from "@mui/material";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  Copy,
  Play,
  Terminal,
} from "lucide-react";
import type { Rule } from "../../types";
import ApiReference from "./ApiReference";
import { usePublishedExecution } from "./usePublishedExecution";

export default function ApiPage({
  mode,
  rules,
  notify,
}: {
  mode: "docs" | "playground";
  rules: Rule[];
  notify: (s: string) => void;
}) {
  const request = usePublishedExecution(rules, notify);
  const {
    published,
    id,
    versions,
    version,
    definition,
    inputs,
    result,
    running,
    error,
    loading,
    curl,
  } = request;
  return (
    <div className="api-page">
      <div className="page-heading">
        <div>
          <div className="eyebrow">
            <span />
            {mode === "docs" ? "BUILT TO CONNECT" : "MAKE THE CALL"}
          </div>
          <h1>
            {mode === "docs" ? "Your logic, on demand." : "API playground"}
          </h1>
          <p>
            {mode === "docs"
              ? "A simple HTTP API for every rule, formula, and decision tree."
              : "Call a published rule and inspect the complete response."}
          </p>
        </div>
        <Chip className="published-chip" label="No authentication required" />
      </div>
      {mode === "docs" && (
        <div className="api-intro-cards">
          <div>
            <span>01</span>
            <Braces size={22} />
            <h3>Build & publish</h3>
            <p>
              Define your inputs, connect the logic, and publish an immutable
              version.
            </p>
          </div>
          <div>
            <span>02</span>
            <Terminal size={22} />
            <h3>Send your inputs</h3>
            <p>
              POST a JSON object from any language, service, or command line.
            </p>
          </div>
          <div>
            <span>03</span>
            <CheckCircle2 size={22} />
            <h3>Get the whole story</h3>
            <p>
              Receive the result, executed version, timing, and a trace of every
              decision.
            </p>
          </div>
        </div>
      )}
      <section className="api-console">
        <div className="api-console-heading">
          <Terminal size={18} />
          <strong>
            {mode === "docs" ? "Try a live request" : "Request builder"}
          </strong>
          <span>Published rules only</span>
        </div>
        <div className="api-console-body">
          <div className="api-request">
            <div className="api-select-row">
              <TextField
                select
                label="Rule"
                value={id}
                onChange={(e) => request.selectRule(e.target.value)}
                disabled={running || !published.length}
              >
                {published.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Version"
                value={version}
                onChange={(e) => request.selectVersion(Number(e.target.value))}
                disabled={running || loading}
              >
                {versions.map((v) => (
                  <MenuItem key={v.version} value={v.version}>
                    v{v.version}
                  </MenuItem>
                ))}
              </TextField>
            </div>
            {!published.length && (
              <Alert severity="info">
                Publish a rule in the library to make your first API call.
              </Alert>
            )}
            <div className="endpoint">
              <strong>POST</strong>
              <code>/api/rules/{id || "{id}"}/execute</code>
            </div>
            <label className="field-label">
              Input parameters <span>application/json</span>
            </label>
            <TextField
              multiline
              rows={7}
              value={inputs}
              onChange={(e) => request.setInputs(e.target.value)}
              className="json-input"
              slotProps={{ htmlInput: { "aria-label": "API input JSON" } }}
              spellCheck={false}
            />
            {definition && (
              <div className="parameter-chips">
                {definition.inputs.map((p) => (
                  <span key={p.name}>
                    <code>{p.name}</code>
                    <small>
                      {p.type.toLowerCase()}
                      {p.required ? " · required" : ""}
                    </small>
                  </span>
                ))}
              </div>
            )}
            <Button
              variant="contained"
              startIcon={<Play size={14} />}
              onClick={request.run}
              disabled={running || loading || !definition || !version}
            >
              {running ? "Executing…" : "Execute rule"}
            </Button>
          </div>
          <div className="api-response">
            <div className="code-panel-heading">
              <span>{result ? "Response" : "cURL request"}</span>
              {result ? (
                <Chip size="small" label="200 OK" className="published-chip" />
              ) : (
                <Button
                  size="small"
                  startIcon={<Copy size={13} />}
                  onClick={request.copy}
                >
                  Copy
                </Button>
              )}
            </div>
            {error && <Alert severity="error">{error}</Alert>}
            <pre data-testid="api-response">
              {result ? JSON.stringify(result, null, 2) : curl}
            </pre>
            {result && (
              <button className="text-link" onClick={request.clear}>
                Show cURL request <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      </section>
      {mode === "docs" && <ApiReference />}
    </div>
  );
}
