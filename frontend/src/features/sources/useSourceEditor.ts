import { useEffect, useReducer, useRef, useState } from "react";
import { sourceApi } from "../../api/sources";
import { errorMessage } from "../../api/errors";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import type { DataSource, SourceConfig } from "../../types";
import { mergeSourceLists, sourceCandidate, type SourceBuffers } from "./model";
import { sourceDocumentReducer, sourceIsDirty } from "./sourceDocument";

export function useSourceEditor({
  onDirty,
  notify,
}: {
  onDirty: (dirty: boolean) => void;
  notify: (message: string) => void;
}) {
  const [sources, setSources] = useState<DataSource[]>([]);
  const [document, dispatch] = useReducer(sourceDocumentReducer, null);
  const [listError, setListError] = useState("");
  const [loading, setLoading] = useState(true);
  const selection = useRef(0);
  const requestSequence = useRef(0);
  const [savingIds, setSavingIds] = useState<string[]>([]);
  const mounted = useRef(true);
  const dirty = document !== null && sourceIsDirty(document);
  const historical =
    document !== null && document.viewedVersion !== document.source.version;
  const saving = document !== null && savingIds.includes(document.source.id);
  const selected = document?.source;
  const versions = useAsyncResource(
    JSON.stringify([selected?.id, selected?.version]),
    (signal) => sourceApi.sourceVersions(selected!.id, { signal }),
    [] as DataSource[],
    0,
    !!selected?.version,
  );

  useEffect(() => {
    mounted.current = true;
    const controller = new AbortController();
    sourceApi
      .sources({ signal: controller.signal })
      .then((rows) => {
        if (controller.signal.aborted) return;
        setSources((current) => mergeSourceLists(current, rows));
        // A new source can be started before the initial list arrives.
        if (selection.current === 0 && rows.length) {
          dispatch({
            type: "select",
            source: rows[0],
            selection: ++selection.current,
          });
        }
      })
      .catch((error) => {
        if (!controller.signal.aborted) setListError(errorMessage(error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      mounted.current = false;
      controller.abort();
    };
  }, []);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);

  const select = (source: DataSource) => {
    if (dirty && !window.confirm("Discard unsaved source changes?")) return;
    dispatch({ type: "select", source, selection: ++selection.current });
  };
  const inspectVersion = (version: number) => {
    const source = versions.data.find(
      (candidate) => candidate.version === version,
    );
    if (source)
      dispatch({ type: "version", version, configuration: source.definition });
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
      setSources((rows) => mergeSourceLists([saved], rows));
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
    ? versions.data.find((source) => source.version === document?.viewedVersion)
        ?.definition
    : document?.source.definition;

  return {
    sources,
    document,
    loading,
    dirty,
    historical,
    saving,
    versions: versions.data,
    versionsLoading: versions.loading,
    error: document?.error || listError,
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
