import { useEffect, useState } from "react";
import { Alert, Button, MenuItem, TextField } from "@mui/material";
import { api, errorMessage } from "../api";
import ValueBinding, { type VariableOption } from "./ValueBinding";
import type { Input, DataSource, SourceBinding } from "../types";
export default function SourceBindingEditor({
  input,
  onChange,
  readOnly,
  variables,
}: {
  input: Input;
  variables: VariableOption[];
  onChange: (source: SourceBinding | null) => void;
  readOnly: boolean;
}) {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [versions, setVersions] = useState<DataSource[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    api
      .sources()
      .then((s) => {
        if (active) setSources(s);
      })
      .catch((e) => {
        if (active) setError(errorMessage(e));
      });
    return () => {
      active = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setVersions([]);
    if (input.source)
      api
        .sourceVersions(input.source.id)
        .then((s) => {
          if (active) setVersions(s);
        })
        .catch((e) => {
          if (active) setError(errorMessage(e));
        });
    return () => {
      active = false;
    };
  }, [input.source?.id]);
  const source = input.source;
  const config = versions.find(
    (v) => v.version === source?.version,
  )?.definition;
  return (
    <div className="source-binding">
      <TextField
        select
        label="Value provider"
        value={source?.id || ""}
        disabled={readOnly}
        onChange={(e) => {
          const s = sources.find((x) => x.id === e.target.value);
          onChange(
            s
              ? {
                  id: s.id,
                  version: s.version,
                  bindings: {},
                  pointer: "",
                  onError: "FAIL",
                }
              : null,
          );
        }}
      >
        <MenuItem value="">Caller / default value</MenuItem>
        {sources.map((s) => (
          <MenuItem key={s.id} value={s.id}>
            {s.name}
          </MenuItem>
        ))}
      </TextField>
      {source && (
        <>
          <p>Fetch only when the caller omits this parameter.</p>
          <TextField
            select
            label="Source version"
            value={source.version}
            disabled={readOnly}
            onChange={(e) =>
              onChange({ ...source, version: Number(e.target.value) })
            }
          >
            {versions.length ? (
              versions.map((s) => (
                <MenuItem value={s.version} key={s.version}>
                  v{s.version}
                </MenuItem>
              ))
            ) : (
              <MenuItem value={source.version}>v{source.version}</MenuItem>
            )}
          </TextField>
          {config?.parameters.map((p) => (
            <ValueBinding
              key={`${source.id}:${source.version}:${p.name}`}
              label={`Source ${p.name}`}
              type={p.type}
              value={source.bindings[p.name]}
              variables={variables}
              disabled={readOnly}
              onChange={(value) => {
                const bindings = { ...source.bindings };
                if (value === undefined) delete bindings[p.name];
                else bindings[p.name] = value;
                onChange({ ...source, bindings });
              }}
            />
          ))}
          <TextField
            label="JSON pointer"
            placeholder="/data/rate"
            helperText="Blank uses the whole result"
            value={source.pointer}
            disabled={readOnly}
            onChange={(e) => onChange({ ...source, pointer: e.target.value })}
          />
          <TextField
            select
            label="On source failure"
            value={source.onError}
            disabled={readOnly}
            onChange={(e) =>
              onChange({
                ...source,
                onError: e.target.value as "FAIL" | "DEFAULT",
              })
            }
          >
            <MenuItem value="FAIL">Fail with an error</MenuItem>
            <MenuItem value="DEFAULT">Use parameter default</MenuItem>
          </TextField>
        </>
      )}
      {error && <Alert severity="error">{error}</Alert>}
      <Button size="small" href="#/sources">
        Manage data sources ↗
      </Button>
    </div>
  );
}
