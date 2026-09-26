import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { usePagedResource } from "../../hooks/usePagedResource";
import CatalogPagination from "../../components/CatalogPagination";
import { errorMessage } from "../../api/errors";
import {
  Alert,
  Button,
  CircularProgress,
  MenuItem,
  TextField,
} from "@mui/material";
import { sourceApi } from "../../api/sources";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { bindSourceVersion } from "./sourceBindings";
import ValueBinding from "../expressions/ValueBinding";
import SourceProviderSelect from "./SourceProviderSelect";
import type { VariableOption } from "../../domain/graph";
import type { Input, DataSource, SourceBinding } from "../../types";
const SourceManagerDialog = lazy(() => import("./SourceManagerDialog"));
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
  const source = input.source;
  const [managerOpen, setManagerOpen] = useState(false);
  const [catalogRevision, setCatalogRevision] = useState(0);
  const versionsResource = usePagedResource(
    JSON.stringify([source?.id, catalogRevision]),
    (offset, limit, signal) =>
      sourceApi.versionSummaries(source!.id, { offset, limit }, { signal }),
    !!source,
  );
  const detail = useAsyncResource(
    JSON.stringify([source?.id, source?.version, catalogRevision]),
    (signal) => sourceApi.source(source!.id, source!.version, { signal }),
    null as DataSource | null,
    0,
    !!source,
  );
  const lastLabel = useRef<{ id: string; name: string } | null>(null);
  useEffect(() => {
    if (detail.data)
      lastLabel.current = { id: detail.data.id, name: detail.data.name };
  }, [detail.data]);
  const sourceName =
    detail.data?.name ||
    (lastLabel.current?.id === source?.id
      ? lastLabel.current?.name
      : source?.id);
  const [selectionError, setSelectionError] = useState("");
  const pending = useRef<AbortController | null>(null);
  const latest = useRef({ source, readOnly, onChange });
  latest.current = { source, readOnly, onChange };
  useEffect(() => () => pending.current?.abort(), []);
  useEffect(() => {
    pending.current?.abort();
    setSelectionError("");
  }, [source?.id, source?.version, readOnly]);
  const chooseVersion = async (version: number) => {
    if (!source || readOnly) return;
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setSelectionError("");
    try {
      const selected = await sourceApi.source(source.id, version, {
        signal: controller.signal,
      });
      const current = latest.current;
      if (
        !controller.signal.aborted &&
        !current.readOnly &&
        current.source?.id === source.id &&
        current.source.version === source.version
      )
        current.onChange(bindSourceVersion(current.source, selected));
    } catch (failure) {
      if (!controller.signal.aborted) setSelectionError(errorMessage(failure));
    }
  };
  const versions = versionsResource.data.items;
  const error = versionsResource.error || detail.error || selectionError;
  const config = detail.data?.definition;
  return (
    <div className="source-binding">
      <SourceProviderSelect
        selected={
          source
            ? {
                id: source.id,
                version: source.version,
                name: sourceName || source.id,
                kind: detail.data?.definition.kind || "LOOKUP",
              }
            : null
        }
        revision={catalogRevision}
        readOnly={readOnly}
        onChange={(selected) => {
          if (readOnly || selected?.id === source?.id) return;
          onChange(
            selected
              ? {
                  id: selected.id,
                  version: selected.version,
                  bindings: {},
                  pointer: "",
                  onError: "FAIL",
                }
              : null,
          );
        }}
      />
      {source && (
        <>
          <p>Fetch only when the caller omits this parameter.</p>
          <TextField
            select
            label="Source version"
            value={source.version}
            disabled={readOnly || versionsResource.loading}
            onChange={(event) => void chooseVersion(Number(event.target.value))}
          >
            {!versions.some((item) => item.version === source.version) && (
              <MenuItem value={source.version}>v{source.version}</MenuItem>
            )}
            {versions.map((item) => (
              <MenuItem value={item.version} key={item.version}>
                v{item.version}
              </MenuItem>
            ))}
          </TextField>
          <CatalogPagination
            label="Source versions"
            offset={versionsResource.offset}
            limit={versionsResource.limit}
            total={versionsResource.data.total}
            loading={versionsResource.loading}
            onPage={versionsResource.setOffset}
          />
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
      <Button size="small" onClick={() => setManagerOpen(true)}>
        Manage data sources
      </Button>
      {managerOpen && (
        <Suspense
          fallback={
            <CircularProgress size={18} aria-label="Loading source manager" />
          }
        >
          <SourceManagerDialog
            onClose={() => {
              setManagerOpen(false);
              setCatalogRevision((value) => value + 1);
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
