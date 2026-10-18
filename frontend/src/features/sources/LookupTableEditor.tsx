import { memo, useCallback, useMemo, useRef, useState } from "react";
import { Alert, Button, IconButton, TextField, Tooltip } from "@mui/material";
import { Plus, Trash2, X } from "lucide-react";
import { sameJson } from "../../domain/definitionEchoes";
import { isJsonObject, stringifyJson } from "../../domain/json";
import {
  useParsedTextBuffer,
  type ParsedText,
} from "../../hooks/useParsedTextBuffer";
import {
  cellText,
  cellValue,
  lookupEntries,
  readLookupTable,
  type LookupRow,
} from "./lookupTable";

/**
 * Lookup entries as an editable table (lookupTable.ts): a row per key, a
 * column per record field or one value column. Every change writes the whole
 * entries text, as the JSON view would; a text that is not a JSON object yet
 * is shown with its error, to be fixed in the JSON view.
 */
export default function LookupTableEditor({
  entries,
  disabled,
  onChange,
}: {
  entries: string;
  disabled: boolean;
  onChange: (entries: string) => void;
}) {
  const read = useMemo(() => readLookupTable(entries), [entries]);
  // Fields added here before any row has a value for them.
  const [newFields, setNewFields] = useState<string[]>([]);
  const rows = read.table?.rows ?? [];
  const latest = useRef({ rows, onChange });
  latest.current = { rows, onChange };
  // Row callbacks keep their identity, so a typed cell renders its row only.
  const changeRow = useCallback((index: number, row: LookupRow) => {
    const { rows: current, onChange: write } = latest.current;
    // Two rows with one key would collapse into one entry.
    if (current.some((other, at) => at !== index && other.key === row.key))
      return;
    write(lookupEntries(current.map((old, at) => (at === index ? row : old))));
  }, []);
  const removeRow = useCallback((index: number) => {
    const { rows: current, onChange: write } = latest.current;
    write(lookupEntries(current.filter((_, at) => at !== index)));
  }, []);
  if (!read.table)
    return (
      <Alert severity="warning">
        The entries are not a table yet: {read.error}. Fix them in the JSON
        view.
      </Alert>
    );
  const { table } = read;
  const records = table.fields !== null;
  const fields = table.fields
    ? [
        ...table.fields,
        ...newFields.filter((field) => !table.fields?.includes(field)),
      ]
    : null;
  const keys = new Set(rows.map((row) => row.key));
  const addRow = () => {
    let key = "key";
    for (let suffix = 2; keys.has(key); suffix++) key = `key-${suffix}`;
    onChange(lookupEntries([...rows, { key, value: records ? {} : "" }]));
  };
  const removeField = (field: string) => {
    setNewFields((current) => current.filter((name) => name !== field));
    onChange(
      lookupEntries(
        rows.map(({ key, value }) => ({ key, value: withField(value, field) })),
      ),
    );
  };
  return (
    <div className="lookup-table">
      <div className="lookup-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Key</th>
              {fields ? (
                fields.map((field) => (
                  <th key={field}>
                    <span>{field}</span>
                    <Tooltip title={`Remove the ${field} column`}>
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Remove column ${field}`}
                          disabled={disabled}
                          onClick={() => removeField(field)}
                        >
                          <X size={12} />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </th>
                ))
              ) : (
                <th>Value</th>
              )}
              <th aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <LookupTableRow
                key={row.key}
                index={index}
                row={row}
                signature={stringifyJson(row.value)}
                fields={fields}
                fieldList={fields?.join("\n") ?? null}
                taken={keys}
                keyList={[...keys].join("\n")}
                disabled={disabled}
                onChange={changeRow}
                onRemove={removeRow}
              />
            ))}
          </tbody>
        </table>
      </div>
      <div className="lookup-table-actions">
        <Button
          size="small"
          startIcon={<Plus size={14} />}
          disabled={disabled}
          onClick={addRow}
        >
          Add row
        </Button>
        {records && (
          <AddField
            taken={new Set(fields)}
            disabled={disabled}
            onAdd={(field) => setNewFields((current) => [...current, field])}
          />
        )}
        <span>
          {rows.length} {rows.length === 1 ? "entry" : "entries"}
        </span>
      </div>
    </div>
  );
}

/** `record` with `field` set to `value`, or without it when `value` is undefined. */
function withField(record: unknown, field: string, value?: unknown): unknown {
  const fields = new Map(isJsonObject(record) ? Object.entries(record) : []);
  if (value === undefined) fields.delete(field);
  else fields.set(field, value);
  return Object.fromEntries(fields);
}

/** A record's value for `field`, which a missing field leaves undefined. */
function fieldValue(record: unknown, field: string): unknown {
  return isJsonObject(record) && Object.hasOwn(record, field)
    ? record[field]
    : undefined;
}

/**
 * One key and its cells. `signature` is the row's value as text and
 * `fieldList` the columns as text, so typing in another row, which re-reads
 * every row object, does not render this one.
 */
const LookupTableRow = memo(
  function LookupTableRow({
    index,
    row,
    fields,
    taken,
    disabled,
    onChange,
    onRemove,
  }: {
    index: number;
    row: LookupRow;
    signature: string;
    fields: string[] | null;
    fieldList: string | null;
    taken: ReadonlySet<string>;
    /** The keys as text, so a renamed row renders the others' duplicate checks. */
    keyList: string;
    disabled: boolean;
    onChange: (index: number, row: LookupRow) => void;
    onRemove: (index: number) => void;
  }) {
    return (
      <tr>
        <td>
          <KeyCell
            name={row.key}
            taken={taken}
            disabled={disabled}
            onRename={(key) => onChange(index, { ...row, key })}
          />
        </td>
        {fields ? (
          fields.map((field) => (
            <td key={field}>
              <ValueCell
                label={`${row.key} · ${field}`}
                value={fieldValue(row.value, field)}
                disabled={disabled}
                onValue={(value) =>
                  onChange(index, {
                    ...row,
                    value: withField(row.value, field, value),
                  })
                }
              />
            </td>
          ))
        ) : (
          <td>
            <ValueCell
              label={`${row.key} · Value`}
              value={row.value}
              disabled={disabled}
              onValue={(value) =>
                onChange(index, { ...row, value: value ?? "" })
              }
            />
          </td>
        )}
        <td>
          <IconButton
            size="small"
            aria-label={`Remove row ${row.key}`}
            disabled={disabled}
            onClick={() => onRemove(index)}
          >
            <Trash2 size={13} />
          </IconButton>
        </td>
      </tr>
    );
  },
  (before, after) =>
    before.index === after.index &&
    before.row.key === after.row.key &&
    before.signature === after.signature &&
    before.fieldList === after.fieldList &&
    before.disabled === after.disabled &&
    before.keyList === after.keyList &&
    before.onChange === after.onChange &&
    before.onRemove === after.onRemove,
);

// A cell takes any text: what is not JSON is a text value (cellValue), and an
// empty cell has no value, so it is never invalid.
const parseCell = (raw: string): ParsedText<unknown> => ({
  valid: true,
  value: raw === "" ? undefined : cellValue(raw),
});
const noValidity = () => {};

function ValueCell({
  label,
  value,
  disabled,
  onValue,
}: {
  label: string;
  value: unknown;
  disabled: boolean;
  onValue: (value: unknown) => void;
}) {
  const { text, change } = useParsedTextBuffer<unknown, unknown>({
    value,
    format: cellText,
    parse: parseCell,
    same: sameJson,
    onChange: onValue,
    onValidity: noValidity,
  });
  return (
    <input
      className="lookup-cell"
      aria-label={label}
      value={text}
      disabled={disabled}
      onChange={(event) => change(event.target.value)}
    />
  );
}

/** A key is renamed when its field loses focus; an empty or taken key stays here with its error. */
function KeyCell({
  name,
  taken,
  disabled,
  onRename,
}: {
  name: string;
  taken: ReadonlySet<string>;
  disabled: boolean;
  onRename: (key: string) => void;
}) {
  const [text, setText] = useState(name);
  const problem = keyProblem(text, name, taken);
  return (
    <input
      className={`lookup-cell lookup-key ${problem ? "lookup-cell-invalid" : ""}`}
      aria-label={`Key ${name}`}
      aria-invalid={!!problem}
      title={problem ?? undefined}
      value={text}
      disabled={disabled}
      onChange={(event) => setText(event.target.value)}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
      onBlur={() => {
        if (text !== name && !problem) onRename(text);
      }}
    />
  );
}

function keyProblem(
  text: string,
  current: string,
  taken: ReadonlySet<string>,
): string | null {
  if (!text) return "A key cannot be empty";
  if (text !== current && taken.has(text))
    return `Another row has the key ${text}`;
  return null;
}

/** Names a new column; it shows until a row has a value for it. */
function AddField({
  taken,
  disabled,
  onAdd,
}: {
  taken: ReadonlySet<string>;
  disabled: boolean;
  onAdd: (field: string) => void;
}) {
  const [name, setName] = useState("");
  const problem = name && taken.has(name) ? "That column exists" : "";
  const add = () => {
    if (!name || problem) return;
    onAdd(name);
    setName("");
  };
  return (
    <span className="lookup-add-field">
      <TextField
        size="small"
        label="New column"
        value={name}
        disabled={disabled}
        error={!!problem}
        helperText={problem || undefined}
        onChange={(event) => setName(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") add();
        }}
      />
      <Button
        size="small"
        disabled={disabled || !name || !!problem}
        onClick={add}
      >
        Add column
      </Button>
    </span>
  );
}
