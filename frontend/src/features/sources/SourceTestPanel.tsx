import { Button, TextField } from "@mui/material";
import { Play } from "lucide-react";

export default function SourceTestPanel({
  version,
  input,
  result,
  running,
  disabled,
  dirty,
  onInput,
  onRun,
}: {
  version: number;
  input: string;
  result: unknown;
  running: boolean;
  disabled: boolean;
  dirty: boolean;
  onInput: (value: string) => void;
  onRun: () => Promise<void>;
}) {
  return (
    <div className="source-test">
      <h3>Test this source</h3>
      <p>
        {dirty
          ? "Save changes before testing the new configuration."
          : `Calls stored version ${version}. No rule execution required.`}
      </p>
      <TextField
        label="Test parameters · JSON"
        multiline
        minRows={3}
        value={input}
        onChange={(event) => onInput(event.target.value)}
        slotProps={{ input: { className: "json-input" } }}
      />
      <Button
        variant="outlined"
        startIcon={<Play size={15} />}
        disabled={disabled || running}
        onClick={() => void onRun()}
      >
        {running ? "Fetching…" : "Fetch sample"}
      </Button>
      {result !== undefined && (
        <pre className="source-json" data-testid="source-result">
          {JSON.stringify(result, null, 2)}
        </pre>
      )}
    </div>
  );
}
