import { Alert, Button, Chip, MenuItem, TextField } from "@mui/material";
import {
  ArrowRight,
  Braces,
  CheckCircle2,
  Copy,
  Play,
  Terminal,
} from "lucide-react";
import { stringifyJson } from "../../domain/json";
import ApiReference from "./ApiReference";
import { usePublishedExecution } from "./usePublishedExecution";
import ExecutionOptionsFields from "./ExecutionOptionsFields";
import ExecutionTiming from "./ExecutionTiming";
import TraceNotices from "./TraceNotices";
import LazyInputJsonEditor from "./LazyInputJsonEditor";
import CatalogPagination from "../../components/CatalogPagination";
import PagedVersionSelect from "../../components/PagedVersionSelect";
import { paginationProps } from "../../hooks/usePagedResource";

export default function ApiPage({
  mode,
  notify,
}: {
  mode: "docs" | "playground";
  notify: (s: string) => void;
}) {
  const request = usePublishedExecution(notify);
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
              Receive the result, executed version, timing, and an optional
              execution trace.
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
            <TextField
              size="small"
              label="Find published rules"
              value={request.search}
              onChange={(event) => request.setSearch(event.target.value)}
            />
            <CatalogPagination
              label="Published rules"
              {...paginationProps(request.catalog)}
            />
            <div className="api-select-row">
              <TextField
                select
                label="Rule"
                value={id}
                onChange={(e) => request.selectRule(e.target.value)}
                disabled={
                  running || request.catalog.loading || !published.length
                }
              >
                {published.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.name}
                  </MenuItem>
                ))}
              </TextField>
              <PagedVersionSelect
                label="Version"
                value={version}
                versions={versions}
                disabled={running || request.history.loading || !id}
                onChange={request.selectVersion}
              />
            </div>
            <CatalogPagination
              label="Published versions"
              {...paginationProps(request.history)}
              loading={request.history.loading || !id}
            />
            {!request.catalog.loading &&
              !request.catalog.error &&
              !published.length && (
                <Alert severity="info">
                  {request.search
                    ? "No published rules match your search."
                    : "Publish a rule in the library to make your first API call."}
                </Alert>
              )}
            <div className="endpoint">
              <strong>POST</strong>
              <code>{request.endpointPath}</code>
            </div>
            <label className="field-label">
              Input parameters <span>application/json</span>
            </label>
            <LazyInputJsonEditor
              key={JSON.stringify([id, version])}
              label="API input JSON"
              value={inputs}
              onChange={request.setInputs}
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
            <ExecutionOptionsFields
              value={request.options}
              onChange={request.changeOptions}
            />
            <Button
              variant="contained"
              startIcon={<Play size={14} />}
              onClick={request.run}
              disabled={running || loading || !definition || version === null}
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
            {!result && !error && !request.inputsAreObject && (
              <Alert severity="warning">
                Input parameters must be a JSON object. The cURL example sends
                empty inputs until the JSON is fixed.
              </Alert>
            )}
            {error && (
              <Alert
                severity="error"
                action={
                  request.loadError ? (
                    <Button
                      color="inherit"
                      size="small"
                      onClick={request.retry}
                    >
                      Retry loading
                    </Button>
                  ) : undefined
                }
              >
                {error}
              </Alert>
            )}
            {result && (
              <ExecutionTiming
                result={result}
                requestDurationMs={request.requestDurationMs}
              />
            )}
            {result && <TraceNotices result={result} />}
            <pre data-testid="api-response">
              {result ? stringifyJson(result, 2) : curl}
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
