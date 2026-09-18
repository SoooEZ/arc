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
  const [invalidJson, setInvalidJson] = useState<Record<string, boolean>>({});
  const hasInvalidJson = Object.values(invalidJson).some(Boolean);
  const [busy, setBusy] = useState("");
  const running = useRef(false);
  const [error, setError] = useState("");
  const [versionLoading, setVersionLoading] = useState(!!requestedVersion);
  const readOnly = !!requestedVersion;
  const dirty =
    !readOnly &&
    (hasInvalidJson || sourceDirty || ruleSnapshot(rule) !== baseline);
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  const onInvalidJson = useCallback(
    (key: string, invalid: boolean) =>
      setInvalidJson((old) =>
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
    async (name: string, task: () => Promise<unknown>) => {
      if (running.current) return;
      running.current = true;
      setBusy(name);
      setError("");
      try {
        await task();
      } catch (failure) {
        fail(failure);
      } finally {
        running.current = false;
        setBusy("");
      }
    },
    [fail],
  );
  useEffect(() => {
    if (!requestedVersion) return;
    const controller = new AbortController();
    ruleApi
      .version(initial.id, requestedVersion, { signal: controller.signal })
      .then((version) => {
        if (!controller.signal.aborted)
          dispatch({ type: "version/loaded", definition: version.definition });
      })
      .catch((failure) => {
        if (!controller.signal.aborted) fail(failure);
      })
      .finally(() => {
        if (!controller.signal.aborted) setVersionLoading(false);
      });
    return () => controller.abort();
  }, [initial.id, requestedVersion, fail]);
  const changeDefinition = useCallback(
    (change: DefinitionChange) => {
      if (readOnly) return;
      dispatch({ type: "graph/change", change });
      setError("");
    },
    [readOnly],
  );
  const buildCode = useCallback(async (): Promise<Definition> => {
    if (hasInvalidJson)
      throw new Error(
        "Fix the invalid JSON default before saving or changing views",
      );
    if (!sourceDirty || source === null || readOnly) return rule.draft;
    const result = await studioApi.build(source);
    dispatch({ type: "source/diagnostics", diagnostics: result.diagnostics });
    if (!result.definition)
      throw new Error(
        result.diagnostics[0]?.message || "Code could not be built",
      );
    dispatch({
      type: "source/built",
      definition: result.definition,
      source: result.source,
    });
    return result.definition;
  }, [hasInvalidJson, sourceDirty, source, readOnly, rule.draft]);
  useEffect(() => {
    if (mode !== "code" || source !== null || versionLoading) return;
    const controller = new AbortController();
    studioApi
      .render(rule.draft, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted)
          dispatch({ type: "source/rendered", source: result.source });
      })
      .catch((failure) => {
        if (!controller.signal.aborted) fail(failure);
      });
    return () => controller.abort();
  }, [mode, source, rule.draft, versionLoading, fail]);
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
    void latest.runTask("switch", async () => {
      try {
        await latest.buildCode();
      } catch (failure) {
        latest.navigate(`/studio/${latest.ruleId}`);
        throw failure;
      }
    });
  }, [mode]);
  const switchView = () =>
    runTask("switch", async () => {
      if (hasInvalidJson)
        throw new Error("Fix the invalid JSON default before changing views");
      if (mode === "code") await buildCode();
      navigate(
        `/${mode === "code" ? "rules" : "studio"}/${rule.id}${requestedVersion ? `?version=${requestedVersion}` : ""}`,
      );
    });
  const save = async (candidate: Rule) => {
    const saved = await ruleApi.save(candidate);
    dispatch({ type: "rule/saved", rule: saved });
    onSaved(saved);
    return saved;
  };
  const action = (type: "save" | "validate" | "publish") =>
    runTask(type, async () => {
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
      dispatch({ type: "rule/saved", rule: published });
      onSaved(published);
      notify(
        `Version ${published.publishedVersion} published and ready to call`,
      );
    });
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
    hasInvalidJson,
    onInvalidJson,
    changeDefinition,
    busy,
    runTask,
    error,
    setError,
    versionLoading,
    buildCode,
    build,
    switchView,
    action,
  };
}
