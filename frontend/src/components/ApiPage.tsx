import { useEffect, useState } from "react";
import { Alert, Button, Chip, MenuItem, TextField } from "@mui/material";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  Copy,
  Play,
  Terminal,
} from "lucide-react";
import { api, errorMessage } from "../api";
import type { Rule, Version } from "../types";
import {
  curlExample,
  parseExecutionInputs,
  sampleInputs,
} from "../domain/executionInputs";
import { useExecutionRequest } from "../features/execution/useExecutionRequest";

export default function ApiPage({
  mode,
  rules,
  notify,
}: {
  mode: "docs" | "playground";
  rules: Rule[];
  notify: (s: string) => void;
}) {
  const published = rules.filter((r) => r.publishedVersion);
  const [id, setId] = useState(
    published.find((r) => r.id === "order-pricing")?.id ||
      published[0]?.id ||
      "",
  );
  const [versions, setVersions] = useState<Version[]>([]);
  const [version, setVersion] = useState<number | "">("");
  const definition = versions.find(
    (candidate) => candidate.version === version,
  )?.definition;
  const [inputs, setInputs] = useState("{}");
  const [loadError, setLoadError] = useState("");
  const execution = useExecutionRequest(JSON.stringify([id, version, inputs]));
  const { result, running } = execution;
  const error = loadError || execution.error;
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!id) return;
    let active = true;
    setLoading(true);
    setLoadError("");
    setVersions([]);
    setVersion("");
    api
      .versions(id)
      .then((v) => {
        if (active) {
          setVersions(v);
          setVersion(v[0]?.version || "");
        }
      })
      .catch((e) => {
        if (active) setLoadError(errorMessage(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [id]);
  useEffect(() => {
    if (definition)
      setInputs(JSON.stringify(sampleInputs(definition), null, 2));
  }, [definition]);
  const run = () =>
    execution.run((signal) =>
      api.execute(id, parseExecutionInputs(inputs), version || undefined, {
        signal,
      }),
    );
  let values = {};
  try {
    values = JSON.parse(inputs);
  } catch {
    /* Code sample stays available while editing. */
  }
  const curl = curlExample(
    window.location.origin,
    id || "order-pricing",
    values,
    version || undefined,
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(curl);
      notify("cURL copied to clipboard");
    } catch {
      notify("Clipboard unavailable. Select and copy the example below.");
    }
  };
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
                onChange={(e) => setId(e.target.value)}
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
                onChange={(e) => setVersion(Number(e.target.value))}
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
              onChange={(e) => setInputs(e.target.value)}
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
              onClick={run}
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
                  onClick={copy}
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
              <button className="text-link" onClick={execution.clear}>
                Show cURL request <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      </section>
      {mode === "docs" && (
        <>
          <div className="api-reference-heading">
            <h2>One API. A few clear endpoints.</h2>
            <p>
              Base URL: <code>{window.location.origin}/api</code>
            </p>
          </div>
          <div className="endpoint-table">
            {[
              ["GET", "/rules", "List all rules and their current drafts"],
              [
                "POST",
                "/rules",
                "Create a rule from a template or a graph definition",
              ],
              ["GET", "/rules/{id}", "Read a rule and its revision"],
              [
                "PUT",
                "/rules/{id}",
                "Save a draft with optimistic concurrency protection",
              ],
              [
                "POST",
                "/rules/{id}/publish",
                "Validate and publish an immutable version",
              ],
              [
                "POST",
                "/rules/{id}/execute",
                "Execute a published rule with typed inputs",
              ],
              ["GET", "/rules/{id}/versions", "Read all published versions"],
              [
                "GET",
                "/rules/{id}/versions/{version}",
                "Read one immutable version",
              ],
              [
                "POST",
                "/preview",
                "Test a graph without saving or publishing it",
              ],
              [
                "POST",
                "/validate",
                "Check graph structure, expressions, and references",
              ],
            ].map(([method, path, desc]) => (
              <div key={method + path}>
                <span className={`method method-${method.toLowerCase()}`}>
                  {method}
                </span>
                <code>{path}</code>
                <span>{desc}</span>
              </div>
            ))}
          </div>
          <div className="api-notes">
            <div>
              <h3>Predictable versioning</h3>
              <p>
                Pass <code>version</code> alongside <code>inputs</code> to pin a
                release. Omit it to run the latest published version. Every
                response tells you which version ran.
              </p>
            </div>
            <div>
              <h3>Clear failures</h3>
              <p>
                Invalid inputs and graphs return <code>422</code>. Missing
                resources return <code>404</code>. Stale revisions or
                unpublished rules return <code>409</code>, with a readable error
                message.
              </p>
            </div>
            <div>
              <h3>Open during development</h3>
              <p>
                All API endpoints are currently callable without a token, and
                CORS allows any origin. JWT authentication is planned for a
                later release.
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
