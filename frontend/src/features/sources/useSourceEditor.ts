import { useEffect, useReducer, useRef, useState } from "react";
import { sourceApi } from "../../api/sources";
import { errorMessage } from "../../api/errors";
import { usePagedResource } from "../../hooks/usePagedResource";
import type { DataSource, SourceConfig, SourceSummary } from "../../types";
import { sourceCandidate, type SourceBuffers } from "./model";
import { sourceDocumentReducer, sourceIsDirty } from "./sourceDocument";

export function useSourceEditor({
  onDirty,
  notify,
}: {
  onDirty: (dirty: boolean) => void;
  notify: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  const catalog = usePagedResource(
    JSON.stringify([search, catalogRevision]),
    (offset, limit, signal) =>
      sourceApi.catalog({ offset, limit, search }, { signal }),
  );
  const [overrides, setOverrides] = useState<SourceSummary[]>([]);
  const [document, dispatch] = useReducer(sourceDocumentReducer, null);
  const [listError, setListError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [versionLoading, setVersionLoading] = useState(false);
  const [inspectedConfig, setInspectedConfig] = useState<
    SourceConfig | undefined
  >();
  const selection = useRef(0);
  const loadingSourceId = useRef<string | null>(null);
  const savedDuringSelection = useRef<DataSource | null>(null);
  // Save acknowledgements can arrive while the selected detail request is awaiting IO.
  const completedSelectionSave = (): DataSource | null =>
    savedDuringSelection.current;
  const selectionRequest = useRef<AbortController | null>(null);
  const versionRequest = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const mounted = useRef(true);
  const latest = useRef(document);
  latest.current = document;
  const dirty = document !== null && sourceIsDirty(document);
  const historical =
    document !== null && document.viewedVersion !== document.source.version;
  const saving = document !== null && savingIds.includes(document.source.id);
  const selected = document?.source;
  const versions = usePagedResource(
    JSON.stringify([selected?.id, selected?.version]),
    (offset, limit, signal) =>
      sourceApi.versionSummaries(selected!.id, { offset, limit }, { signal }),
    !!selected?.version,
  );
  const matchingOverrides = overrides.filter((item) =>
    `${item.id} ${item.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const sources = catalog.data.items.map((item) => {
    const saved = overrides.find((candidate) => candidate.id === item.id);
    return saved && saved.version > item.version ? saved : item;
  });
  if (catalog.offset === 0) {
    for (const item of matchingOverrides.slice().reverse())
      if (!sources.some((row) => row.id === item.id)) sources.unshift(item);
  }
  const boundedSources = sources.slice(0, catalog.limit);

  useEffect(() => {
    if (catalog.loading || catalog.error) return;
    setOverrides((current) => {
      const remaining = current.filter(
        (saved) =>
          !catalog.data.items.some(
            (item) => item.id === saved.id && item.version >= saved.version,
          ),
      );
      return remaining.length === current.length ? current : remaining;
    });
  }, [catalog.data, catalog.loading, catalog.error]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionRequest.current?.abort();
      versionRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  const select = async (source: SourceSummary | DataSource) => {
    if (dirty && !window.confirm("Discard unsaved source changes?")) return;
    const currentSelection = ++selection.current;
    selectionRequest.current?.abort();
    versionRequest.current?.abort();
    setVersionLoading(false);
    setListError("");
    setInspectedConfig(undefined);
    loadingSourceId.current = null;
    savedDuringSelection.current = null;
    if ("definition" in source) {
      setDetailLoading(false);
      dispatch({ type: "select", source, selection: currentSelection });
      return;
    }
    dispatch({ type: "close" });
    setDetailLoading(true);
    loadingSourceId.current = source.id;
    const controller = new AbortController();
    selectionRequest.current = controller;
    try {
      const loaded = await sourceApi.source(source.id, source.version, {
        signal: controller.signal,
      });
      if (
        !controller.signal.aborted &&
        currentSelection === selection.current
      ) {
        const saved = completedSelectionSave();
        dispatch({
          type: "select",
          source:
            saved?.id === source.id && saved.version > loaded.version
              ? saved
              : loaded,
          selection: currentSelection,
        });
      }
    } catch (failure) {
      if (!controller.signal.aborted) setListError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) {
        setDetailLoading(false);
        loadingSourceId.current = null;
        savedDuringSelection.current = null;
      }
    }
  };
  useEffect(() => {
    if (selection.current === 0 && catalog.data.items.length)
      void select(catalog.data.items[0]);
    // Initial selection is one-time; page/search changes must not replace the open document.
  }, [catalog.data]);

  const inspectVersion = async (version: number) => {
    if (!document) return;
    versionRequest.current?.abort();
    const controller = new AbortController();
    versionRequest.current = controller;
    const currentSelection = document.selection;
    dispatch({
      type: "version",
      version,
      configuration: document.source.definition,
    });
    setInspectedConfig(undefined);
    setListError("");
    if (version === document.source.version) {
      setVersionLoading(false);
      return;
    }
    setVersionLoading(true);
    try {
      const loaded = await sourceApi.source(document.source.id, version, {
        signal: controller.signal,
      });
      if (
        !controller.signal.aborted &&
        latest.current?.selection === currentSelection
      ) {
        setInspectedConfig(loaded.definition);
        dispatch({
          type: "version",
          version,
          configuration: loaded.definition,
        });
      }
    } catch (failure) {
      if (!controller.signal.aborted) setListError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) setVersionLoading(false);
    }
  };
  const save = async () => {
    if (!document || historical || saving) return;
    const sourceId = document.source.id;
    const request = ++requestSequence.current;
    setSavingIds((ids) => [...ids, sourceId]);
    dispatch({ type: "save/start", request });
    try {
      const candidate = sourceCandidate(document.source, document.buffers);
      const saved = candidate.version
        ? await sourceApi.saveSource(candidate)
        : await sourceApi.createSource(
            candidate.id,
            candidate.name,
            candidate.definition,
          );
      if (!mounted.current) return;
      // Refresh the library even when another source is being edited.
      if (loadingSourceId.current === saved.id)
        savedDuringSelection.current = saved;
      const summary = {
        id: saved.id,
        name: saved.name,
        version: saved.version,
        kind: saved.definition.kind,
      };
      setOverrides((rows) =>
        [summary, ...rows.filter((item) => item.id !== saved.id)].slice(
          0,
          catalog.limit,
        ),
      );
      setCatalogRevision((value) => value + 1);
      dispatch({
        type: "save/success",
        request,
        selection: document.selection,
        source: saved,
      });
      notify(
        `Data source ${saved.name} v${saved.version} saved. Existing rules keep their pinned version.`,
      );
    } catch (error) {
      if (mounted.current)
        dispatch({
          type: "save/failure",
          request,
          selection: document.selection,
          error: errorMessage(error),
        });
    } finally {
      if (mounted.current)
        setSavingIds((ids) => ids.filter((id) => id !== sourceId));
    }
  };
  const run = async () => {
    if (
      !document ||
      !document.source.version ||
      versionLoading ||
      (historical && !inspectedConfig) ||
      dirty ||
      saving ||
      document.testing !== null
    )
      return;
    const request = ++requestSequence.current;
    dispatch({ type: "test/start", request });
    try {
      const inputs: unknown = JSON.parse(document.testInput);
      if (
        inputs === null ||
        typeof inputs !== "object" ||
        Array.isArray(inputs)
      )
        throw new Error("Test parameters must be a JSON object.");
      const response = await sourceApi.testSource(
        document.source.id,
        document.viewedVersion,
        inputs as Record<string, unknown>,
      );
      if (mounted.current)
        dispatch({ type: "test/success", request, result: response.result });
    } catch (error) {
      if (mounted.current)
        dispatch({ type: "test/failure", request, error: errorMessage(error) });
    }
  };
  const displayConfig = historical
    ? inspectedConfig
    : document?.source.definition;

  return {
    sources: boundedSources,
    catalog,
    search,
    setSearch,
    detailLoading,
    versionLoading,
    document,
    loading: catalog.loading,
    dirty,
    historical,
    saving,
    versions: versions.data.items,
    versionsPage: versions,
    versionsLoading: versions.loading,
    error: document?.error || listError || catalog.error,
    versionsError: versions.error,
    displayConfig,
    select,
    inspectVersion,
    save,
    run,
    changeMetadata: (patch: Pick<Partial<DataSource>, "id" | "name">) =>
      dispatch({ type: "metadata", patch }),
    changeConfig: (patch: Partial<SourceConfig>) =>
      dispatch({ type: "configuration", patch }),
    changeBuffer: (field: keyof SourceBuffers, value: string) =>
      dispatch({ type: "buffer", field, value }),
    changeProvider: (kind: SourceConfig["kind"]) =>
      dispatch({ type: "provider", kind }),
    changeTestInput: (value: string) => dispatch({ type: "test/input", value }),
    dismissError: () => {
      dispatch({ type: "error/clear" });
      setListError("");
    },
  };
}
