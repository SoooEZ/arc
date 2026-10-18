import { Alert, Button, IconButton, Tooltip } from "@mui/material";
import { Plus, Trash2 } from "lucide-react";
import { stringifyJson } from "../../domain/json";
import {
  isSecretAlias,
  isSecretHeaderName,
  MAX_SECRET_HEADERS,
} from "./httpSourcePolicy";
import { secretHeaderAliases } from "./sourceProviders";
import { counted } from "../../domain/text";
import RenameCell from "./RenameCell";

interface HeaderRow {
  name: string;
  alias: string;
}

function readHeaders(
  text: string,
): { rows: HeaderRow[]; error: null } | { rows: null; error: string } {
  try {
    const rows = Object.entries(secretHeaderAliases(text)).map(
      ([name, alias]) => ({ name, alias }),
    );
    return { rows, error: null };
  } catch (failure) {
    return { rows: null, error: (failure as Error).message };
  }
}

/** The aliases text a table writes, formatted like a loaded buffer. */
function writeHeaders(rows: readonly HeaderRow[]): string {
  return stringifyJson(
    Object.fromEntries(rows.map(({ name, alias }) => [name, alias])),
    2,
  );
}

/**
 * Secret headers as a table: a header name per row and the alias of the
 * server variable, ARC_SECRET_<alias>, that holds its value. Every change
 * writes the whole aliases text, as the JSON view would; the save checks what
 * the server checks (secretHeadersProblem).
 */
export default function SecretHeadersEditor({
  text,
  disabled,
  onChange,
}: {
  text: string;
  disabled: boolean;
  onChange: (text: string) => void;
}) {
  const read = readHeaders(text);
  if (!read.rows)
    return (
      <Alert severity="warning">
        The secret headers are not a table yet: {read.error} Fix them in the
        JSON view.
      </Alert>
    );
  const rows = read.rows;
  const write = (next: HeaderRow[]) => onChange(writeHeaders(next));
  const taken = new Set(rows.map((row) => row.name));
  const full = rows.length >= MAX_SECRET_HEADERS;
  const add = () => {
    let name = "Authorization";
    for (let suffix = 2; taken.has(name); suffix++) name = `X-Secret-${suffix}`;
    write([...rows, { name, alias: "" }]);
  };
  return (
    <div className="source-table secret-header-table">
      <div className="source-table-scroll">
        <table>
          <thead>
            <tr>
              <th>Header</th>
              <th>Environment alias</th>
              <th aria-label="Row actions" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={row.name}>
                <td>
                  <RenameCell
                    name={row.name}
                    label={`Header ${row.name}`}
                    className="secret-header-name"
                    problem={(text) => headerNameProblem(text, row.name, taken)}
                    disabled={disabled}
                    spellCheck={false}
                    onRename={(name) =>
                      write(
                        rows.map((old, at) =>
                          at === index ? { ...old, name } : old,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <input
                    className={`table-cell-input ${isSecretAlias(row.alias) ? "" : "table-cell-invalid"}`}
                    aria-label={`${row.name} · alias`}
                    aria-invalid={!isSecretAlias(row.alias)}
                    title={
                      isSecretAlias(row.alias)
                        ? `The server sends ARC_SECRET_${row.alias}`
                        : "Use uppercase letters, digits or _; start with a letter"
                    }
                    placeholder="CRM_TOKEN"
                    value={row.alias}
                    disabled={disabled}
                    spellCheck={false}
                    // An alias names an environment variable, which is upper case.
                    onChange={(event) =>
                      write(
                        rows.map((old, at) =>
                          at === index
                            ? {
                                ...old,
                                alias: event.target.value.toUpperCase(),
                              }
                            : old,
                        ),
                      )
                    }
                  />
                </td>
                <td>
                  <IconButton
                    size="small"
                    aria-label={`Remove header ${row.name}`}
                    disabled={disabled}
                    onClick={() => write(rows.filter((_, at) => at !== index))}
                  >
                    <Trash2 size={13} />
                  </IconButton>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <p className="source-table-empty">No secret headers are sent.</p>
        )}
      </div>
      <div className="source-table-actions">
        <Tooltip
          title={
            full
              ? `A source sends at most ${MAX_SECRET_HEADERS} secret headers`
              : ""
          }
        >
          <span>
            <Button
              size="small"
              startIcon={<Plus size={14} />}
              disabled={disabled || full}
              onClick={add}
            >
              Add header
            </Button>
          </span>
        </Tooltip>
        <span>{counted(rows.length, "header")}</span>
      </div>
    </div>
  );
}

/** A name the server refuses stays in its cell, marked with this error. */
function headerNameProblem(
  text: string,
  current: string,
  taken: ReadonlySet<string>,
): string | null {
  if (text !== current && taken.has(text)) return `Another row sends ${text}`;
  if (!isSecretHeaderName(text))
    return "Use a header name of letters, digits and hyphens; Host, Content-Length, Connection and Transfer-Encoding are not allowed";
  return null;
}
