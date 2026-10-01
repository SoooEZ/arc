import { lazy, useEffect, useRef, useState } from "react";
import {
  paginationProps,
  usePagedResource,
} from "../../hooks/usePagedResource";
import CatalogPagination from "../../components/CatalogPagination";
import PagedVersionSelect from "../../components/PagedVersionSelect";
import { LazyBoundary } from "../../components/LazyBoundary";
import { errorMessage } from "../../api/errors";
import { ownValue } from "../../domain/records";
import {
  Alert,
  Button,
  CircularProgress,
  MenuItem,
  TextField,
} from "@mui/material";
import { sourceApi } from "../../api/sources";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import {
  bindSourceVersion,
  undeclaredSourceBindings,
  withSourceParameterBinding,
  withoutSourceParameterBindings,
} from "./sourceBindings";
import ValueBinding from "../expressions/ValueBinding";
import {
  pinnedSourceVersions,
  readSourceVersion,
} from "../../app/pinnedVersions";
import UndeclaredBindings from "../expressions/UndeclaredBindings";
import SourceProviderSelect from "./SourceProviderSelect";
import type { VariableOption } from "../../domain/variables";
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
  // The mutable version list loads once the Source version control opens, as
  // the picker's pages do: N cards bound to one source read no lists on mount.
  const [versionsRequested, setVersionsRequested] = useState(false);
  const versionsResource = usePagedResource(
    JSON.stringify([source?.id, catalogRevision]),
    source && versionsRequested
      ? (offset, limit, signal) =>
          sourceApi.versionSummaries(source.id, { offset, limit }, { signal })
      : null,
  );
  // The pinned version is immutable: the page-wide cache serves every card.
  const detail = useAsyncResource<DataSource | null>(
    JSON.stringify([source?.id, source?.version, catalogRevision]),
    source
      ? (signal) => readSourceVersion(source.id, source.version, signal)
      : null,
    null,
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
      const selected = await readSourceVersion(
        source.id,
        version,
        controller.signal,
      );
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
  const closeManager = () => {
    setManagerOpen(false);
    // Managed sources may have new versions or names: the bound source's cached
    // versions are read again, so a rename shows here.
    if (source) pinnedSourceVersions.forget(source.id);
    setCatalogRevision((value) => value + 1);
  };
  const versions = versionsResource.data.items;
  const error = versionsResource.error || detail.error || selectionError;
  const config = detail.data?.definition;
  // Known once the pinned version has loaded; the server rejects them at validation.
  const undeclared =
    source && config
      ? undeclaredSourceBindings(
          source,
          config.parameters.map((parameter) => parameter.name),
        )
      : [];
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
          <PagedVersionSelect
            label="Source version"
            value={source.version}
            versions={versions}
            disabled={readOnly}
            onOpen={() => setVersionsRequested(true)}
            onChange={(version) => void chooseVersion(version)}
          />
          {/* Versions are read when the select first opens; before that the
              pager said "0 results" for a source that has versions. */}
          {versionsRequested && (
            <CatalogPagination
              label="Source versions"
              {...paginationProps(versionsResource)}
            />
          )}
          {config?.parameters.map((p) => (
            <ValueBinding
              key={`${source.id}:${source.version}:${p.name}`}
              label={`Source ${p.name}`}
              type={p.type}
              value={ownValue(source.bindings, p.name)}
              variables={variables}
              disabled={readOnly}
              onChange={(value) =>
                onChange(withSourceParameterBinding(source, p.name, value))
              }
            />
          ))}
          <UndeclaredBindings
            names={undeclared}
            target={`v${source.version} of ${sourceName || source.id}`}
            readOnly={readOnly}
            onRemove={() =>
              onChange(withoutSourceParameterBindings(source, undeclared))
            }
          />
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
        <LazyBoundary
          label="data source manager"
          fallback={
            <CircularProgress size={18} aria-label="Loading source manager" />
          }
          onDismiss={closeManager}
        >
          <SourceManagerDialog onClose={closeManager} />
        </LazyBoundary>
      )}
    </div>
  );
}
