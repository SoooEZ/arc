import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { ruleApi } from "../../api/rules";
import { studioApi } from "../../api/studio";
import { ApiError, errorMessage, type GraphProblem } from "../../api/errors";
import type { Definition, Rule } from "../../types";
import { ruleSnapshot, type DefinitionChange } from "../../domain/graph";
import { documentReducer, initialDocument } from "./documentState";

interface Options {
  initial: Rule;
  mode: "code" | "graph";
  requestedVersion: number | null;
  onSaved: (rule: Rule) => void;
  onDirty: (dirty: boolean) => void;
  navigate: (path: string) => void;
  notify: (message: string) => void;
  reportRuntimeError: (problem: GraphProblem | null) => void;
}
type VersionLoad =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "failed"; message: string };

export function useRuleDocument({
  initial,
  mode,
  requestedVersion,
  onSaved,
  onDirty,
  navigate,
  notify,
  reportRuntimeError,
}: Options) {
  const [state, dispatch] = useReducer(
    documentReducer,
    initial,
    initialDocument,
  );
  const { rule, source, sourceDirty, baseline } = state;
  const latestState = useRef(state);
  latestState.current = state;
  const session = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    session.current = controller;
    return () => controller.abort();
  }, []);
  const [invalidDefaults, setInvalidDefaults] = useState<
    Record<string, boolean>
  >({});
  const hasInvalidDefaults = Object.values(invalidDefaults).some(Boolean);
  const [busy, setBusy] = useState("");
  const running = useRef(false);
  const [error, setError] = useState("");
  const [versionLoad, setVersionLoad] = useState<VersionLoad>({
    status: requestedVersion ? "loading" : "ready",
  });
  const [versionAttempt, setVersionAttempt] = useState(0);
  const versionLoading = versionLoad.status === "loading";
  const versionError =
    versionLoad.status === "failed" ? versionLoad.message : "";
  const versionUnavailable = versionLoad.status !== "ready";
  const readOnly = !!requestedVersion;
  const dirty =
    !readOnly &&
    (hasInvalidDefaults || sourceDirty || ruleSnapshot(rule) !== baseline);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const onInvalidDefault = useCallback(
    (key: string, invalid: boolean) =>
      setInvalidDefaults((old) =>
        old[key] === invalid ? old : { ...old, [key]: invalid },
      ),
    [],
  );
  const fail = useCallback(
    (failure: unknown) => {
      setError(errorMessage(failure));
      if (failure instanceof ApiError)
        reportRuntimeError({
          message: failure.message,
          locations: failure.locations,
        });
    },
    [reportRuntimeError],
  );
  const runTask = useCallback(
    async (name: string, task: (signal: AbortSignal) => Promise<unknown>) => {
      const signal = session.current?.signal;
      if (!signal || signal.aborted || running.current || versionUnavailable)
        return;
      running.current = true;
      setBusy(name);
      setError("");
      try {
        await task(signal);
      } catch (failure) {
        if (!signal.aborted) fail(failure);
      } finally {
        running.current = false;
        if (!signal.aborted) setBusy("");
      }
    },
    [fail, versionUnavailable],
  );
  useEffect(() => {
    if (!requestedVersion) return;
    const controller = new AbortController();
    ruleApi
      .version(initial.id, requestedVersion, { signal: controller.signal })
      .then((version) => {
        if (controller.signal.aborted) return;
        dispatch({ type: "version/loaded", definition: version.definition });
        setVersionLoad({ status: "ready" });
      })
      .catch((failure) => {
        if (!controller.signal.aborted)
          setVersionLoad({ status: "failed", message: errorMessage(failure) });
      });
    return () => controller.abort();
  }, [initial.id, requestedVersion, versionAttempt]);
  const retryVersion = () => {
    setVersionLoad({ status: "loading" });
    setVersionAttempt((attempt) => attempt + 1);
  };
  const changeDefinition = useCallback(
    (change: DefinitionChange) => {
      if (readOnly || running.current) return;
      dispatch({ type: "graph/change", change });
      setError("");
    },
    [readOnly],
  );
  const buildCode = useCallback(async (): Promise<Definition> => {
    const signal = session.current?.signal;
    if (!signal || signal.aborted)
      throw new DOMException("The editor session has closed", "AbortError");
    if (hasInvalidDefaults)
      throw new Error(
        "Fix the invalid parameter default before saving or changing views",
      );
    if (!sourceDirty || source === null || readOnly) return rule.draft;
    const result = await studioApi.build(source, { signal });
    signal.throwIfAborted();
    if (latestState.current.source !== source)
      throw new Error(
        "The code changed while building. Build the current buffer again.",
      );
    dispatch({
      type: "source/diagnostics",
      before: source,
      diagnostics: result.diagnostics,
    });
    if (!result.definition)
      throw new Error(
        result.diagnostics[0]?.message || "Code could not be built",
      );
    dispatch({
      type: "source/built",
      before: source,
      definition: result.definition,
      source: result.source,
    });
    return result.definition;
  }, [hasInvalidDefaults, sourceDirty, source, readOnly, rule.draft]);
  useEffect(() => {
    if (mode !== "code" || !hasInvalidDefaults) return;
    setError("Fix the invalid parameter default before changing views");
    navigate(`/rules/${rule.id}`);
  }, [mode, hasInvalidDefaults, navigate, rule.id]);
  useEffect(() => {
    if (
      mode !== "code" ||
      source !== null ||
      versionUnavailable ||
      hasInvalidDefaults
    )
      return;
    const controller = new AbortController();
    studioApi
      .render(rule.draft, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted)
          dispatch({
            type: "source/rendered",
            before: rule.draft,
            source: result.source,
          });
      })
      .catch((failure) => {
        if (!controller.signal.aborted) fail(failure);
      });
    return () => controller.abort();
  }, [mode, source, rule.draft, versionUnavailable, hasInvalidDefaults, fail]);
  const current = useRef({
    sourceDirty,
    buildCode,
    ruleId: rule.id,
    navigate,
    runTask,
  });
  current.current = {
    sourceDirty,
    buildCode,
    ruleId: rule.id,
    navigate,
    runTask,
  };
  useEffect(() => {
    if (mode !== "graph" || !current.current.sourceDirty) return;
    // A sidebar navigation must compile the code buffer before exposing the graph.
    const latest = current.current;
    void latest.runTask("switch", async (signal) => {
      try {
        await latest.buildCode();
      } catch (failure) {
        if (!signal.aborted) latest.navigate(`/studio/${latest.ruleId}`);
        throw failure;
      }
    });
  }, [mode]);
  const switchView = () =>
    runTask("switch", async (signal) => {
      if (hasInvalidDefaults)
        throw new Error(
          "Fix the invalid parameter default before changing views",
        );
      if (mode === "code") await buildCode();
      signal.throwIfAborted();
      navigate(
        `/${mode === "code" ? "rules" : "studio"}/${rule.id}${requestedVersion ? `?version=${requestedVersion}` : ""}`,
      );
    });
  const save = async (candidate: Rule) => {
    const saved = await ruleApi.save(candidate);
    dispatch({ type: "rule/saved", submitted: candidate, rule: saved });
    onSaved(saved);
    return saved;
  };
  const action = (type: "save" | "validate" | "publish") => {
    // Commands are also called by keyboard actions, outside the hidden toolbar.
    if (readOnly && type !== "validate") return Promise.resolve();
    return runTask(type, async () => {
      const candidate = { ...rule, draft: await buildCode() };
      if (type === "save") {
        await save(candidate);
        notify("Draft saved");
        return;
      }
      await studioApi.validate(candidate.draft);
      if (type === "validate") {
        notify("Graph is valid. All paths lead to a result.");
        return;
      }
      const saved =
        ruleSnapshot(candidate) !== baseline
          ? await save(candidate)
          : candidate;
      const published = await ruleApi.publish(saved.id, saved.revision);
      dispatch({ type: "rule/saved", submitted: saved, rule: published });
      onSaved(published);
      notify(
        `Version ${published.publishedVersion} published and ready to call`,
      );
    });
  };
  const build = () =>
    runTask("build", async () => {
      await studioApi.validate(await buildCode());
      notify("Code built. Graph is valid.");
    });
  return {
    ...state,
    dispatch,
    readOnly,
    dirty,
    hasInvalidDefaults,
    onInvalidDefault,
    changeDefinition,
    busy,
    runTask,
    error,
    setError,
    versionLoading,
    versionError,
    versionUnavailable,
    retryVersion,
    buildCode,
    build,
    switchView,
    action,
  };
}
