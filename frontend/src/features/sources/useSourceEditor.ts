import { useEffect, useReducer, useRef, useState } from "react";
import { sourceApi } from "../../api/sources";
import { errorMessage } from "../../api/errors";
import { useNavigationGuard } from "../../app/navigationGuards";
import {
  searchDelayMs,
  useDebouncedValue,
} from "../../hooks/useDebouncedValue";
import { usePagedResource } from "../../hooks/usePagedResource";
import type { DataSource, SourceConfig, SourceSummary } from "../../types";
import {
  parseSourceTestInputs,
  sourceCandidate,
  type SourceBuffers,
} from "./model";
import {
  canRunSourceTest,
  displayedConfiguration,
  isHistoricalVersion,
  sourceDocumentReducer,
  sourceIsDirty,
  sourceSaveProblem,
} from "./sourceDocument";
import {
  catalogRows,
  rememberSavedSource,
  type SavedSource,
} from "./sourceCatalog";

// Leaving unmounts the editor: unsaved edits are lost and a pending save's result is never shown.
const unsavedSourceWarning = "Discard unsaved data source changes?";
const pendingSaveWarning =
  "A data source is still being saved. Leave without waiting for the result?";

export function useSourceEditor({
  onDirty,
  notify,
}: {
  onDirty?: (dirty: boolean) => void;
  notify: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const query = useDebouncedValue(search, searchDelayMs);
  const [catalogRevision, setCatalogRevision] = useState(0);
  // Saves allocate increasing catalog revisions, even when several finish together.
  const lastCatalogRevision = useRef(0);
  const catalog = usePagedResource(
    JSON.stringify([query, catalogRevision]),
    (offset, limit, signal) =>
      sourceApi.catalog({ offset, limit, search: query }, { signal }),
    true,
    { keepPrevious: true },
  );
  const [savedSources, setSavedSources] = useState<SavedSource[]>([]);
  // The catalog revision of the last successful read; later saves still await listing.
  const [listedRevision, setListedRevision] = useState(0);
  const [document, dispatch] = useReducer(sourceDocumentReducer, null);
  const [listError, setListError] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [versionLoading, setVersionLoading] = useState(false);
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
  const dirty = document !== null && sourceIsDirty(document);
  const historical = document !== null && isHistoricalVersion(document);
  // A stored source is pending while any save of it runs, even one started from another
  // selection; a new draft only through its own request, so typing a pending create's ID into
  // another draft does not freeze that draft's fields.
  const saving =
    document !== null &&
    (document.source.version > 0
      ? savingIds.includes(document.source.id)
      : document.saving !== null);
  const selected = document?.source;
  const versions = usePagedResource(
    JSON.stringify([selected?.id, selected?.version]),
    (offset, limit, signal) =>
      sourceApi.versionSummaries(selected!.id, { offset, limit }, { signal }),
    !!selected?.version,
  );
  const listed = catalogRows(catalog.data, savedSources, listedRevision);
  useNavigationGuard(dirty ? unsavedSourceWarning : null);
  useNavigationGuard(savingIds.length > 0 ? pendingSaveWarning : null);

  useEffect(() => {
    if (catalog.loading || catalog.error) return;
    setListedRevision(catalogRevision);
  }, [catalog.loading, catalog.error, catalogRevision]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      selectionRequest.current?.abort();
      versionRequest.current?.abort();
    };
  }, []);
  useEffect(() => {
    onDirty?.(dirty);
  }, [dirty, onDirty]);

  const select = async (source: SourceSummary | DataSource) => {
    if (dirty && !window.confirm("Discard unsaved source changes?")) return;
    const currentSelection = ++selection.current;
    selectionRequest.current?.abort();
    versionRequest.current?.abort();
    setVersionLoading(false);
    setListError("");
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
      // The reducer ignores a version that is no longer viewed in this selection.
      if (!controller.signal.aborted)
        dispatch({
          type: "version/loaded",
          selection: currentSelection,
          version,
          configuration: loaded.definition,
        });
    } catch (failure) {
      if (!controller.signal.aborted) setListError(errorMessage(failure));
    } finally {
      if (!controller.signal.aborted) setVersionLoading(false);
    }
  };
  const save = async () => {
    if (!document || historical || saving) return;
    const problem = sourceSaveProblem(document);
    if (problem) {
      setListError(problem);
      return;
    }
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
      const revision = ++lastCatalogRevision.current;
      const summary = {
        id: saved.id,
        name: saved.name,
        version: saved.version,
        kind: saved.definition.kind,
      };
      setSavedSources((rows) =>
        rememberSavedSource(rows, { summary, revision }, catalog.limit),
      );
      setCatalogRevision(revision);
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
  const canRun = canRunSourceTest(document, saving);
  const run = async () => {
    if (!document || !canRun) return;
    const request = ++requestSequence.current;
    dispatch({ type: "test/start", request });
    try {
      const response = await sourceApi.testSource(
        document.source.id,
        document.viewedVersion,
        parseSourceTestInputs(document.testInput),
      );
      if (mounted.current)
        dispatch({ type: "test/success", request, result: response.result });
    } catch (error) {
      if (mounted.current)
        dispatch({ type: "test/failure", request, error: errorMessage(error) });
    }
  };

  return {
    sources: listed.rows,
    sourcesTotal: listed.total,
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
    saveProblem: document && sourceSaveProblem(document),
    canRun,
    pending: savingIds.length > 0 || document?.testing != null,
    versions: versions.data.items,
    versionsPage: versions,
    versionsLoading: versions.loading,
    error: document?.error || listError || catalog.error,
    versionsError: versions.error,
    displayConfig: document && displayedConfiguration(document),
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
    changeTimeout: (value: string) => dispatch({ type: "timeout", value }),
    changeProvider: (kind: SourceConfig["kind"]) =>
      dispatch({ type: "provider", kind }),
    changeTestInput: (value: string) => dispatch({ type: "test/input", value }),
    dismissError: () => {
      dispatch({ type: "error/clear" });
      setListError("");
    },
  };
}
