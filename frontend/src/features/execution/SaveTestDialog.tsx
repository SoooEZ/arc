import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Radio,
  RadioGroup,
  TextField,
} from "@mui/material";
import { errorMessage } from "../../api/errors";
import type { TestCaseWrite } from "../../types";
import {
  displayNameProblem,
  MAX_EXPECTED_ERROR_CHARACTERS,
} from "../../domain/limits";
import { isJsonObject, parseJson, stringifyJson } from "../../domain/json";
import { inputsText } from "../../domain/testCases";

type Expectation = "result" | "error";

function parsed(text: string): { value: unknown } | null {
  try {
    return { value: parseJson(text) };
  } catch {
    // The field reports text that is not JSON.
    return null;
  }
}

function expectedErrorProblem(text: string): string | null {
  if (!text.trim()) return "Enter the text the error message contains";
  if (text.length > MAX_EXPECTED_ERROR_CHARACTERS)
    return `At most ${MAX_EXPECTED_ERROR_CHARACTERS.toLocaleString("en-US")} characters`;
  return null;
}

/**
 * Saves a test: a new one from a Test panel run, whose inputs are fixed and
 * whose outcome becomes the expectation, or a saved one edited, inputs
 * included. `onSave` resolves once stored or rejects with the server's reason.
 */
export default function SaveTestDialog({
  title,
  initial,
  editInputs,
  onSave,
  onClose,
}: {
  title: string;
  initial: TestCaseWrite;
  /** The inputs are editable JSON; a run's inputs are shown as they ran. */
  editInputs: boolean;
  onSave: (write: TestCaseWrite) => Promise<unknown>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [inputs, setInputs] = useState(() => stringifyJson(initial.inputs, 2));
  const [expect, setExpect] = useState<Expectation>(
    initial.expectedError !== null ? "error" : "result",
  );
  const [result, setResult] = useState(() =>
    initial.expectedError !== null
      ? "null"
      : stringifyJson(initial.expectedResult ?? null, 2),
  );
  const [error, setError] = useState(initial.expectedError ?? "");
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState("");

  const nameProblem = displayNameProblem("Test case", name);
  const inputValue = parsed(inputs);
  const inputsProblem =
    inputValue && isJsonObject(inputValue.value)
      ? null
      : 'Enter the inputs as a JSON object, such as {"amount": 100}';
  const resultValue = parsed(result);
  const resultProblem =
    expect === "result" && !resultValue ? "Enter the result as JSON" : null;
  const errorProblem = expect === "error" ? expectedErrorProblem(error) : null;
  const invalid =
    !!nameProblem || !!inputsProblem || !!resultProblem || !!errorProblem;

  const save = async () => {
    if (invalid || !inputValue || !isJsonObject(inputValue.value)) return;
    setSaving(true);
    setFailure("");
    try {
      await onSave({
        name: name.trim(),
        inputs: inputValue.value,
        expectedResult:
          expect === "result" ? (resultValue?.value ?? null) : null,
        expectedError: expect === "error" ? error : null,
      });
      onClose();
    } catch (reason) {
      setFailure(errorMessage(reason));
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={saving ? undefined : onClose}
      fullWidth
      maxWidth="sm"
      aria-labelledby="save-test-title"
    >
      <DialogTitle id="save-test-title">{title}</DialogTitle>
      <DialogContent className="save-test-dialog">
        {failure && <Alert severity="error">{failure}</Alert>}
        <TextField
          autoFocus
          label="Test name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          error={!!nameProblem}
          helperText={nameProblem ?? " "}
        />
        {editInputs ? (
          <TextField
            label="Inputs · JSON object"
            multiline
            minRows={3}
            value={inputs}
            onChange={(event) => setInputs(event.target.value)}
            error={!!inputsProblem}
            helperText={inputsProblem ?? " "}
            slotProps={{ htmlInput: { className: "json-input" } }}
          />
        ) : (
          <div className="save-test-inputs">
            <span>Inputs</span>
            <code>{inputsText(initial.inputs)}</code>
          </div>
        )}
        <RadioGroup
          aria-label="Expectation"
          value={expect}
          onChange={(event) =>
            setExpect(event.target.value === "error" ? "error" : "result")
          }
        >
          <FormControlLabel
            value="result"
            control={<Radio size="small" />}
            label="Returns this result"
          />
          {expect === "result" && (
            <TextField
              label="Expected result · JSON"
              multiline
              minRows={2}
              value={result}
              onChange={(event) => setResult(event.target.value)}
              error={!!resultProblem}
              helperText={
                resultProblem ??
                "Numbers match by value: 120 and 120.00 are the same."
              }
              slotProps={{ htmlInput: { className: "json-input" } }}
            />
          )}
          <FormControlLabel
            value="error"
            control={<Radio size="small" />}
            label="Fails with an error"
          />
          {expect === "error" && (
            <TextField
              label="The error message contains"
              multiline
              value={error}
              onChange={(event) => setError(event.target.value)}
              error={!!errorProblem}
              helperText={errorProblem ?? " "}
            />
          )}
        </RadioGroup>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button
          variant="contained"
          disabled={invalid || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Save test"}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
