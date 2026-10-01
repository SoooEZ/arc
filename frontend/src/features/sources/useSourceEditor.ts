import { useEffect, useReducer, useRef, useState } from "react";
import { sourceApi } from "../../api/sources";
import { errorMessage } from "../../api/errors";
import { useNavigationGuard } from "../../app/navigationGuards";
import { usePagedResource } from "../../hooks/usePagedResource";
import { usePagedSearch } from "../../hooks/usePagedSearch";
import { pinnedSourceVersions } from "../studio/pinnedVersions";
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
/** The one wording for discarding source edits: leaving, closing the manager, selecting another source. */
export const unsavedSourceWarning = "Discard unsaved data source changes?";
const pendingSaveWarning =
  "A data source is still being saved. Leave without waiting for the result?";

export function useSourceEditor({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [catalogRevision, setCatalogRevision] = useState(0);
  // Saves allocate increasing catalog revisions, even when several finish together.
  const lastCatalogRevision = useRef(0);
  // Retry reloads the shown page after a failed catalog read, keeping its offset.
  const [catalogAttempt, setCatalogAttempt] = useState(0);
  const catalog = usePagedSearch(
    search,
    (query, offset, limit, signal) =>
      sourceApi.catalog({ offset, limit, search: query }, { signal }),
    {
      key: String(catalogRevision),
      keepPrevious: true,
      refresh: catalogAttempt,
    },
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
  // Every save in flight, by request: two saves of one source finish one at a time.
  const [pendingSaves, setPendingSaves] = useState<
    { request: number; sourceId: string }[]
  >([]);
  const mounted = useRef(true);
  const dirty = document !== null && sourceIsDirty(document);
  const historical = document !== null && isHistoricalVersion(document);
  // A stored source is pending while any save of it runs, even one started from another
  // selection; a new draft only through its own request, so typing a pending create's ID into
  // another draft does not freeze that draft's fields.
  const saving =
    document !== null &&
    (document.source.version > 0
      ? pendingSaves.some((save) => save.sourceId === document.source.id)
      : document.saving !== null);
  const selected = document?.source;
  const versions = usePagedResource(
    JSON.stringify([selected?.id, selected?.version]),
    selected?.version
      ? (offset, limit, signal) =>
          sourceApi.versionSummaries(selected.id, { offset, limit }, { signal })
      : null,
  );
  const listed = catalogRows(catalog.data, savedSources, listedRevision);
  useNavigationGuard(dirty ? unsavedSourceWarning : null);
  useNavigationGuard(pendingSaves.length > 0 ? pendingSaveWarning : null);

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
  const select = async (source: SourceSummary | DataSource) => {
    if (dirty && !window.confirm(unsavedSourceWarning)) return;
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
    setPendingSaves((saves) => [...saves, { request, sourceId }]);
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
      // Every version of the source carries its current name: cards bound to
      // it read the renamed source again instead of the cached name. The cache
      // is page-wide, so this holds after the editor closed during the save.
      pinnedSourceVersions.forget(saved.id);
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
        setPendingSaves((saves) =>
          saves.filter((save) => save.request !== request),
        );
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
    /** The list: rows, paging and search; a failed read is retried. */
    catalog: {
      rows: listed.rows,
      total: listed.total,
      page: catalog,
      search,
      setSearch,
      loading: catalog.loading,
      error: catalog.error,
      retry: () => setCatalogAttempt((attempt) => attempt + 1),
    },
    /** The open source and what may happen to it; its failures are dismissed. */
    document: {
      open: document,
      loading: detailLoading,
      versionLoading,
      dirty,
      historical,
      saving,
      saveProblem: document && sourceSaveProblem(document),
      canRun,
      pending: pendingSaves.length > 0 || document?.testing != null,
      error: document?.error || listError,
      displayConfig: document && displayedConfiguration(document),
    },
    /** The open source's version history. */
    versions: {
      items: versions.data.items,
      page: versions,
      loading: versions.loading,
      error: versions.error,
    },
    commands: {
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
      changeTestInput: (value: string) =>
        dispatch({ type: "test/input", value }),
      dismissError: () => {
        dispatch({ type: "error/clear" });
        setListError("");
      },
    },
  };
}

export type SourceEditor = ReturnType<typeof useSourceEditor>;
