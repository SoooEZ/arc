import { useCallback, useState } from "react";
import { Button, TextField } from "@mui/material";
import { Play } from "lucide-react";
import type { Input } from "../../types";
import { tryParseExecutionInputs } from "../../domain/executionInputs";
import { stringifyJson } from "../../domain/json";
import InputForm from "../execution/InputForm";
import ViewToggle, { useRememberedView } from "./ViewToggle";

type TestView = "form" | "json";
const testViews: readonly { view: TestView; text: string }[] = [
  { view: "form", text: "Form" },
  { view: "json", text: "JSON" },
];
const testViewNames = testViews.map(({ view }) => view);

export default function SourceTestPanel({
  version,
  parameters,
  input,
  result,
  running,
  disabled,
  dirty,
  onInput,
  onRun,
}: {
  /** The stored version a test calls; 0 while the source is not created. */
  version: number;
  /** The parameters of that version, null while they load. */
  parameters: Input[] | null;
  input: string;
  result: unknown;
  running: boolean;
  disabled: boolean;
  dirty: boolean;
  onInput: (value: string) => void;
  onRun: () => Promise<void>;
}) {
  const [view, setView] = useRememberedView(
    "test parameters",
    testViewNames,
    "form",
  );
  // Fields whose text is not a value of their type: the buffer still holds
  // their last valid value, which is not what they show, so a fetch waits.
  const [invalid, setInvalid] = useState<ReadonlySet<string>>(new Set());
  const reportValidity = useCallback(
    (name: string, valid: boolean) =>
      setInvalid((current) => {
        if (current.has(name) !== valid) return current;
        const next = new Set(current);
        if (valid) next.delete(name);
        else next.add(name);
        return next;
      }),
    [],
  );
  // A source that is not created yet has nothing stored to call.
  if (!version)
    return (
      <div className="source-test">
        <h3>Test this source</h3>
        <p>Create the source to test it.</p>
      </div>
    );
  return (
    <div className="source-test">
      <h3>Test this source</h3>
      <p>
        {dirty
          ? "Save changes before testing the new configuration."
          : `Calls stored version ${version}. No rule execution required.`}
      </p>
      <div className="source-section">
        <div className="source-section-heading">
          <span>Test parameters</span>
          <ViewToggle
            label="Test parameters view"
            value={view}
            views={testViews}
            onChange={setView}
          />
        </div>
        {view === "form" ? (
          <TestParametersForm
            parameters={parameters}
            text={input}
            onChange={onInput}
            onValidity={reportValidity}
          />
        ) : (
          <TextField
            label="Test parameters · JSON"
            multiline
            minRows={3}
            value={input}
            onChange={(event) => onInput(event.target.value)}
            slotProps={{ input: { className: "json-input" } }}
          />
        )}
      </div>
      <Button
        variant="outlined"
        startIcon={<Play size={15} />}
        disabled={disabled || running || invalid.size > 0}
        onClick={() => void onRun()}
      >
        {running ? "Fetching…" : "Fetch sample"}
      </Button>
      {invalid.size > 0 && (
        <p role="status">
          Fix the marked test parameters before fetching a sample.
        </p>
      )}
      {result !== undefined && (
        <pre className="source-json" data-testid="source-result">
          {stringifyJson(result, 2)}
        </pre>
      )}
    </div>
  );
}

/**
 * A field per parameter of the tested version (the Test panel's InputForm),
 * editing the one test buffer the JSON view shows, and only when a field
 * changes (lesson F25).
 */
function TestParametersForm({
  parameters,
  text,
  onChange,
  onValidity,
}: {
  parameters: Input[] | null;
  text: string;
  onChange: (text: string) => void;
  onValidity: (name: string, valid: boolean) => void;
}) {
  if (!parameters)
    return (
      <p className="input-form-notice">
        The parameters show once this version loads.
      </p>
    );
  if (!parameters.length)
    return (
      <p className="input-form-notice">This source declares no parameters.</p>
    );
  if (!tryParseExecutionInputs(text))
    return (
      <p className="input-form-notice">
        The test parameters are not a JSON object yet. Fix them in the JSON view
        to use the form.
      </p>
    );
  return (
    <InputForm
      inputs={parameters}
      text={text}
      onChange={onChange}
      onValidity={onValidity}
    />
  );
}
