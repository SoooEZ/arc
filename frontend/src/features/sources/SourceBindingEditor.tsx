import { Alert, Button, MenuItem, TextField } from "@mui/material";
import { sourceApi } from "../../api/sources";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { bindSourceVersion } from "./sourceBindings";
import ValueBinding from "../expressions/ValueBinding";
import type { VariableOption } from "../../domain/graph";
import type { Input, DataSource, SourceBinding } from "../../types";
export default function SourceBindingEditor({
  input,
  onChange,
  readOnly,
  variables,
  sources,
  sourceError,
}: {
  input: Input;
  variables: VariableOption[];
  sources: DataSource[];
  sourceError: string;
  onChange: (source: SourceBinding | null) => void;
  readOnly: boolean;
}) {
  const versionsResource = useAsyncResource(
    input.source?.id || "",
    (signal) => sourceApi.sourceVersions(input.source!.id, { signal }),
    [] as DataSource[],
    0,
    !!input.source,
  );
  const versions = versionsResource.data;
  const error = sourceError || versionsResource.error;
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
            disabled={readOnly || versionsResource.loading}
            onChange={(event) => {
              const selected = versions.find(
                (candidate) => candidate.version === Number(event.target.value),
              );
              if (selected) onChange(bindSourceVersion(source, selected));
            }}
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
