import { useState } from "react";
import {
  Alert,
  Button,
  Chip,
  MenuItem,
  Tab,
  Tabs,
  TextField,
} from "@mui/material";
import { ArrowRight, Copy, Play, Terminal } from "lucide-react";
import type { TestCase } from "../../types";
import { stringifyJson } from "../../domain/json";
import { ruleIncarnation } from "../../domain/ruleIdentity";
import type { TestRun } from "../../domain/testCases";
import { SavedTestComparison, SavedTestMenu } from "./PlaygroundSavedTests";
import { usePublishedExecution } from "./usePublishedExecution";
import ExecutionOptionsFields from "../execution/ExecutionOptionsFields";
import ExecutionTiming from "../execution/ExecutionTiming";
import TraceNotices from "../execution/TraceNotices";
import LazyInputJsonEditor from "../execution/LazyInputJsonEditor";
import InputForm from "../../components/InputForm";
import CatalogPagination from "../../components/CatalogPagination";
import PagedVersionSelect from "../../components/PagedVersionSelect";
import { paginationProps } from "../../hooks/usePagedResource";

/** A saved test whose inputs were loaded, as the text they were loaded as. */
interface LoadedTest {
  identity: string;
  text: string;
  test: TestCase;
}

/**
 * What the shown response is for the loaded test: compared only while the
 * inputs are still the test's own, for the rule it belongs to.
 */
function loadedRun(
  loaded: LoadedTest | null,
  current: { identity: string; inputs: string },
  response: { result: unknown } | null,
  executionError: string,
): TestRun | null {
  if (!loaded || loaded.identity !== current.identity) return null;
  if (loaded.text !== current.inputs) return null;
  if (response) return { result: response.result };
  return executionError ? { error: executionError } : null;
}

/**
 * The playground's request builder: a published rule and version, its inputs
 * and options, and the response or the matching cURL command.
 */
export default function PlaygroundConsole({
  notify,
}: {
  notify: (s: string) => void;
}) {
  const request = usePublishedExecution(notify);
  const [inputView, setInputView] = useState<"json" | "form">("json");
  const [loaded, setLoaded] = useState<LoadedTest | null>(null);
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
  const rule = published.find((candidate) => candidate.id === id) ?? null;
  const identity = rule ? ruleIncarnation(rule) : "";
  const testRun = loadedRun(
    loaded,
    { identity, inputs },
    result,
    request.loadError ? "" : error,
  );
  return (
    <section className="api-console">
      <div className="api-console-heading">
        <Terminal size={18} />
        <strong>Request builder</strong>
        <span>Published rules only</span>
        <Button
          variant="contained"
          startIcon={<Play size={14} />}
          onClick={request.run}
          disabled={running || loading || !definition || version === null}
        >
          {running ? "Executing…" : "Execute rule"}
        </Button>
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
              disabled={running || request.catalog.loading || !published.length}
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
          <div className="api-input-heading">
            <label className="field-label">
              Input parameters <span>application/json</span>
            </label>
            <SavedTestMenu
              rule={rule}
              disabled={running || !definition}
              onChoose={(test) => {
                const text = stringifyJson(test.inputs, 2);
                request.setInputs(text);
                setLoaded({ identity, text, test });
              }}
            />
            <Tabs
              value={inputView}
              onChange={(_, view: "json" | "form") => setInputView(view)}
              aria-label="Input parameters view"
            >
              <Tab value="json" label="JSON" />
              <Tab value="form" label="Form" disabled={!definition} />
            </Tabs>
          </div>
          {inputView === "form" && definition ? (
            <InputForm
              inputs={definition.inputs}
              text={inputs}
              onChange={request.setInputs}
            />
          ) : (
            <LazyInputJsonEditor
              key={JSON.stringify([id, version])}
              label="API input JSON"
              value={inputs}
              onChange={request.setInputs}
            />
          )}
          {definition && inputView === "json" && (
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
                  <Button color="inherit" size="small" onClick={request.retry}>
                    Retry loading
                  </Button>
                ) : undefined
              }
            >
              {error}
            </Alert>
          )}
          {loaded && testRun && (
            <SavedTestComparison test={loaded.test} run={testRun} />
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
  );
}
