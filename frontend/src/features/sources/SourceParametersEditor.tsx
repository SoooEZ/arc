import { useMemo, useState } from "react";
import { Alert, Button, IconButton, Switch, Tooltip } from "@mui/material";
import { Plus, Trash2 } from "lucide-react";
import type { InputType, SourceConfig } from "../../types";
import {
  acceptsIdentifierEdit,
  identifierGuidance,
} from "../../domain/identifiers";
import {
  defaultText,
  parseStringDefault,
  sameStringDefault,
} from "../../domain/inputDefaults";
import { shortId } from "../../domain/ids";
import { inputTypeFacts, inputTypeOf } from "../../domain/inputTypes";
import { stringifyJson } from "../../domain/json";
import { counted } from "../../domain/text";
import {
  parseNumericDefault,
  sameNumericDefault,
} from "../../domain/numericDefaults";
import {
  useParsedTextBuffer,
  type ParsedText,
} from "../../hooks/useParsedTextBuffer";
import { useRefusedEdit } from "../../hooks/useRefusedEdit";
import { MAX_SOURCE_PARAMETERS } from "../../domain/limits";
import {
  isLookupKey,
  newParameterRow,
  parameterName,
  parameterNameProblem,
  readSourceParameters,
  sourceParameterTypes,
  withParameterType,
  writeSourceParameters,
  type ParameterRow,
} from "./sourceParameters";

const newRowId = () => shortId("param-");

/**
 * Identities for rows that are parsed from text on every render. Add and
 * Remove keep them in step with the rows, so a removed row takes its own
 * unfinished default with it instead of leaving it to the next row (lesson
 * F6). A count changed from outside, by the JSON view or another version,
 * adds or drops identities at the end.
 */
function useRowIds(count: number) {
  const [ids, setIds] = useState<string[]>(() =>
    Array.from({ length: count }, newRowId),
  );
  let current = ids;
  if (ids.length !== count) {
    current =
      ids.length > count
        ? ids.slice(0, count)
        : [...ids, ...Array.from({ length: count - ids.length }, newRowId)];
    setIds(current);
  }
  return {
    ids: current,
    add: () => setIds([...current, newRowId()]),
    remove: (index: number) => setIds(current.filter((_, at) => at !== index)),
  };
}

/**
 * A source's parameters as a table: name, type, required and default per row.
 * Every change writes the whole parameters text, as the JSON view would
 * (sourceParameters.ts). A lookup table's one parameter, `key`, keeps its name;
 * a text that is not a list of parameters yet is fixed in the JSON view.
 */
export default function SourceParametersEditor({
  kind,
  text,
  disabled,
  onChange,
  onValidity,
}: {
  kind: SourceConfig["kind"];
  text: string;
  disabled: boolean;
  onChange: (text: string) => void;
  /** A default typed as text the parameter's type refuses blocks saving until fixed. */
  onValidity: (field: string, valid: boolean) => void;
}) {
  const read = useMemo(() => readSourceParameters(text), [text]);
  const rowIds = useRowIds(read.rows?.length ?? 0);
  if (!read.rows)
    return (
      <Alert severity="warning">
        The parameters are not a list yet: {read.error}. Fix them in the JSON
        view.
      </Alert>
    );
  const rows = read.rows;
  const fixedKey = kind === "LOOKUP" && isLookupKey(rows);
  const write = (next: ParameterRow[]) => onChange(writeSourceParameters(next));
  const change = (index: number, row: ParameterRow) =>
    write(rows.map((old, at) => (at === index ? row : old)));
  const full = rows.length >= MAX_SOURCE_PARAMETERS;
  return (
    <div className="source-table parameter-table">
      <div className="source-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Required</th>
              <th>Default</th>
              {!fixedKey && <th aria-label="Row actions" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <ParameterTableRow
                // Names change while they are typed, so a row is its identity.
                key={rowIds.ids[index]}
                label={fixedKey ? "Key" : `Parameter ${index + 1}`}
                row={row}
                nameProblem={parameterNameProblem(rows, index)}
                fixedName={fixedKey}
                disabled={disabled}
                onChange={(next) => change(index, next)}
                onRemove={() => {
                  rowIds.remove(index);
                  write(rows.filter((_, at) => at !== index));
                }}
                onValidity={(valid) =>
                  onValidity(`parameter ${rowIds.ids[index]} default`, valid)
                }
              />
            ))}
          </tbody>
        </table>
      </div>
      {!fixedKey && (
        <div className="source-table-actions">
          <Tooltip
            title={
              full
                ? `A source takes at most ${MAX_SOURCE_PARAMETERS} parameters`
                : ""
            }
          >
            <span>
              <Button
                size="small"
                startIcon={<Plus size={14} />}
                disabled={disabled || full}
                onClick={() => {
                  rowIds.add();
                  write([...rows, newParameterRow(rows)]);
                }}
              >
                Add parameter
              </Button>
            </span>
          </Tooltip>
          <span>{counted(rows.length, "parameter")}</span>
        </div>
      )}
    </div>
  );
}

function ParameterTableRow({
  label,
  row,
  nameProblem,
  fixedName,
  disabled,
  onChange,
  onRemove,
  onValidity,
}: {
  /** Names the row's controls, "Parameter 2" or "Key", whatever its name. */
  label: string;
  row: ParameterRow;
  nameProblem: string | null;
  fixedName: boolean;
  disabled: boolean;
  onChange: (row: ParameterRow) => void;
  onRemove: () => void;
  onValidity: (valid: boolean) => void;
}) {
  const name = parameterName(row);
  const type = typeof row.type === "string" ? inputTypeOf(row.type) : null;
  return (
    <tr>
      <td>
        {fixedName ? (
          <code className="parameter-fixed-name">{name}</code>
        ) : (
          <NameCell
            label={`${label} · name`}
            name={name}
            problem={nameProblem}
            disabled={disabled}
            onRename={(next) => onChange({ ...row, name: next })}
          />
        )}
      </td>
      <td>
        <select
          className="table-cell-input"
          aria-label={`${label} · type`}
          value={type ?? String(row.type ?? "")}
          disabled={disabled}
          onChange={(event) => {
            const chosen = inputTypeOf(event.target.value);
            if (chosen) onChange(withParameterType(row, chosen));
          }}
        >
          {sourceParameterTypes.map((one) => (
            <option key={one} value={one}>
              {inputTypeFacts[one].label}
            </option>
          ))}
          {/* A type typed in the JSON view that the table does not offer stays visible. */}
          {!sourceParameterTypes.some((one) => one === type) && (
            <option value={type ?? String(row.type ?? "")} disabled>
              {String(row.type ?? "no type")}
            </option>
          )}
        </select>
      </td>
      <td>
        <Switch
          size="small"
          checked={row.required === true}
          disabled={disabled}
          onChange={(_, required) => onChange({ ...row, required })}
          slotProps={{ input: { "aria-label": `${label} · required` } }}
        />
      </td>
      <td>
        <DefaultCell
          label={`${label} · default`}
          type={type}
          value={row.defaultValue}
          disabled={disabled}
          onValue={(defaultValue) => onChange({ ...row, defaultValue })}
          onValidity={onValidity}
        />
      </td>
      {!fixedName && (
        <td>
          <IconButton
            size="small"
            aria-label={`Remove ${label.toLowerCase()}${name ? ` (${name})` : ""}`}
            disabled={disabled}
            onClick={onRemove}
          >
            <Trash2 size={13} />
          </IconButton>
        </td>
      )}
    </tr>
  );
}

/** A name refuses the characters an identifier never has (lesson F28); the row shows why it is marked. */
function NameCell({
  label,
  name,
  problem,
  disabled,
  onRename,
}: {
  label: string;
  name: string;
  problem: string | null;
  disabled: boolean;
  onRename: (name: string) => void;
}) {
  const edit = useRefusedEdit(name);
  const shown = edit.refused ? identifierGuidance : problem;
  return (
    <input
      className={`table-cell-input parameter-name ${shown ? "table-cell-invalid" : ""}`}
      aria-label={label}
      aria-invalid={!!shown}
      title={shown ?? undefined}
      value={name}
      disabled={disabled}
      spellCheck={false}
      onChange={(event) => {
        const next = event.target.value;
        if (!acceptsIdentifierEdit(name, next)) {
          edit.refuse();
          return;
        }
        edit.clear();
        onRename(next);
      }}
      onPaste={edit.onPaste}
    />
  );
}

function DefaultCell({
  label,
  type,
  value,
  disabled,
  onValue,
  onValidity,
}: {
  label: string;
  type: InputType | null;
  value: unknown;
  disabled: boolean;
  onValue: (value: unknown) => void;
  onValidity: (valid: boolean) => void;
}) {
  if (type === "BOOLEAN")
    return (
      <select
        className="table-cell-input"
        aria-label={label}
        value={typeof value === "boolean" ? String(value) : ""}
        disabled={disabled}
        onChange={(event) =>
          onValue(
            event.target.value === "" ? null : event.target.value === "true",
          )
        }
      >
        <option value="">No default</option>
        <option value="true">true</option>
        <option value="false">false</option>
      </select>
    );
  if (type === "NUMBER")
    return (
      <TypedDefault
        key="number"
        label={label}
        value={value}
        disabled={disabled}
        parse={parseNumericDefault}
        same={sameNumericDefault}
        numeric
        onValue={onValue}
        onValidity={onValidity}
      />
    );
  if (type === "STRING")
    return (
      <TypedDefault
        key="text"
        label={label}
        value={value}
        disabled={disabled}
        parse={parseStringDefault}
        same={sameStringDefault}
        onValue={onValue}
        onValidity={onValidity}
      />
    );
  // A collection type from the JSON view: the server refuses it; its default is shown as JSON.
  return (
    <input
      className="table-cell-input"
      aria-label={label}
      value={value == null ? "" : stringifyJson(value)}
      disabled
      readOnly
    />
  );
}

function TypedDefault({
  label,
  value,
  disabled,
  parse,
  same,
  numeric = false,
  onValue,
  onValidity,
}: {
  label: string;
  value: unknown;
  disabled: boolean;
  parse: (raw: string) => ParsedText<unknown>;
  same: (left: unknown, right: unknown) => boolean;
  numeric?: boolean;
  onValue: (value: unknown) => void;
  onValidity: (valid: boolean) => void;
}) {
  const buffer = useParsedTextBuffer<unknown, unknown>({
    value,
    format: defaultText,
    parse,
    same,
    onChange: onValue,
    onValidity,
  });
  return (
    <span className="parameter-default">
      <input
        className={`table-cell-input ${buffer.error ? "table-cell-invalid" : ""}`}
        aria-label={label}
        aria-invalid={!!buffer.error}
        placeholder="No default"
        inputMode={numeric ? "decimal" : undefined}
        value={buffer.text}
        disabled={disabled}
        onChange={(event) => buffer.change(event.target.value)}
      />
      {buffer.error && <small role="status">{buffer.error}</small>}
    </span>
  );
}
