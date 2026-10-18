import { MenuItem, TextField } from "@mui/material";
import type { Input, InputType } from "../../types";
import { sameJson } from "../../domain/definitionEchoes";
import {
  inputEntry,
  sampleValue,
  tryParseExecutionInputs,
  withInputEntry,
  type InputEntry,
} from "../../domain/executionInputs";
import {
  isDecimalNumber,
  isJsonObject,
  parseJson,
  stringifyJson,
} from "../../domain/json";
import {
  useParsedTextBuffer,
  type ParsedText,
} from "../../hooks/useParsedTextBuffer";

/**
 * The test inputs as a form: a row per declared input, with a control for its
 * type and what to send, a value, null or nothing. It edits the one input
 * buffer the JSON view shows, and only when a field changes (lesson F25).
 */
export default function InputForm({
  inputs,
  text,
  onChange,
}: {
  inputs: Input[];
  text: string;
  onChange: (text: string) => void;
}) {
  const parsed = tryParseExecutionInputs(text);
  if (!parsed)
    return (
      <p className="input-form-notice">
        The input JSON is not a JSON object yet. Fix it in the Input JSON view
        to use the form.
      </p>
    );
  if (!inputs.length)
    return <p className="input-form-notice">This rule declares no inputs.</p>;
  const declared = new Set(inputs.map((input) => input.name));
  const others = Object.keys(parsed).filter((name) => !declared.has(name));
  return (
    <div className="input-form">
      {inputs.map((input) => (
        <InputRow
          key={input.name}
          input={input}
          entry={inputEntry(parsed, input.name)}
          onEntry={(entry) => onChange(withInputEntry(text, input.name, entry))}
        />
      ))}
      {!!others.length && (
        <p className="input-form-notice">
          Also sent, not declared: {others.join(", ")}
        </p>
      )}
    </div>
  );
}

const sendingKinds = ["value", "null", "omitted"] as const;
const sendingLabels: Record<InputEntry["kind"], string> = {
  value: "Value",
  null: "null",
  omitted: "Leave out",
};

function InputRow({
  input,
  entry,
  onEntry,
}: {
  input: Input;
  entry: InputEntry;
  onEntry: (entry: InputEntry) => void;
}) {
  const choose = (kind: InputEntry["kind"]) => {
    if (kind === entry.kind) return;
    if (kind === "value") onEntry({ kind, value: sampleValue(input) });
    else onEntry({ kind });
  };
  return (
    <div className="input-form-row">
      <div className="input-form-name">
        <strong>{input.name}</strong>
        <span>{input.type.toLowerCase()}</span>
        {input.required && (
          <span className="input-form-required">required</span>
        )}
      </div>
      <div className="input-form-controls">
        <InputValue input={input} entry={entry} onEntry={onEntry} />
        <TextField
          select
          size="small"
          className="input-form-sending"
          value={entry.kind}
          onChange={(event) => {
            const kind = sendingKinds.find((one) => one === event.target.value);
            if (kind) choose(kind);
          }}
          slotProps={{ htmlInput: { "aria-label": `${input.name} · send` } }}
        >
          {sendingKinds.map((kind) => (
            <MenuItem key={kind} value={kind}>
              {sendingLabels[kind]}
            </MenuItem>
          ))}
        </TextField>
      </div>
      <small className="input-form-help">{rowHelp(input, entry)}</small>
    </div>
  );
}

/** What the row's choice means for the run. */
function rowHelp(input: Input, entry: InputEntry): string {
  if (entry.kind === "value") return "";
  if (entry.kind === "null")
    return input.required
      ? "Sends null, which a required input refuses"
      : "Sends null";
  if (input.source) return `Left out: read from source ${input.source.id}`;
  if (input.defaultValue != null)
    return `Left out: uses the default ${stringifyJson(input.defaultValue)}`;
  return input.required
    ? "Left out: this required input will fail"
    : "Left out";
}

/** Empty text leaves the input out. */
const leftOut: ParsedText<unknown> = { valid: true, value: undefined };

// Module-level, as useParsedTextBuffer requires: what text of each type
// stands for. A boolean is chosen, never typed.
const typedText: Record<InputType, (raw: string) => ParsedText<unknown>> = {
  NUMBER: (raw) => {
    if (!raw) return leftOut;
    const value = jsonValue(raw);
    return typeof value === "number" || isDecimalNumber(value)
      ? { valid: true, value }
      : { valid: false, error: "Enter a number" };
  },
  STRING: (raw) => (raw ? { valid: true, value: raw } : leftOut),
  BOOLEAN: () => leftOut,
  ARRAY: (raw) => {
    if (!raw) return leftOut;
    const value = jsonValue(raw);
    return Array.isArray(value)
      ? { valid: true, value }
      : { valid: false, error: "Enter a JSON array, such as [1, 2]" };
  },
  OBJECT: (raw) => {
    if (!raw) return leftOut;
    const value = jsonValue(raw);
    return isJsonObject(value)
      ? { valid: true, value }
      : { valid: false, error: 'Enter a JSON object, such as {"a": 1}' };
  },
};

/** The JSON value text stands for, or undefined when it is not JSON. */
function jsonValue(raw: string): unknown {
  try {
    return parseJson(raw);
  } catch {
    // The caller reports text that is not JSON as the field's error.
    return undefined;
  }
}

/** A value's text in its field; text values as typed, others as JSON. */
const valueText = (value: unknown) => {
  if (value === undefined || value === null) return "";
  return typeof value === "string" ? value : stringifyJson(value);
};

// A field's errors show in the field; nothing else waits for its validity.
const noValidity = () => {};

function InputValue({
  input,
  entry,
  onEntry,
}: {
  input: Input;
  entry: InputEntry;
  onEntry: (entry: InputEntry) => void;
}) {
  const value = entry.kind === "value" ? entry.value : undefined;
  const buffer = useParsedTextBuffer<unknown, unknown>({
    value,
    format: valueText,
    parse: typedText[input.type],
    same: sameJson,
    onChange: (typed) =>
      onEntry(
        typed === undefined
          ? { kind: "omitted" }
          : { kind: "value", value: typed },
      ),
    onValidity: noValidity,
  });
  if (input.type === "BOOLEAN")
    return (
      <TextField
        select
        size="small"
        value={typeof value === "boolean" ? String(value) : ""}
        slotProps={{ htmlInput: { "aria-label": input.name } }}
        onChange={(event) =>
          onEntry({ kind: "value", value: event.target.value === "true" })
        }
      >
        <MenuItem value="true">true</MenuItem>
        <MenuItem value="false">false</MenuItem>
      </TextField>
    );
  return (
    <TextField
      size="small"
      value={buffer.text}
      error={!!buffer.error}
      helperText={buffer.error || undefined}
      placeholder={entry.kind === "null" ? "null" : undefined}
      onChange={(event) => buffer.change(event.target.value)}
      slotProps={{
        htmlInput: {
          "aria-label": input.name,
          className: input.type === "STRING" ? undefined : "input-form-code",
          inputMode: input.type === "NUMBER" ? "decimal" : undefined,
        },
      }}
    />
  );
}
