import {
  useCallback,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from "react";
import { ruleApi } from "../../api/rules";
import { studioApi } from "../../api/studio";
import {
  ApiError,
  errorDetails,
  errorMessage,
  type GraphProblem,
} from "../../api/errors";
import { useNavigationGuard } from "../../app/navigationGuards";
import { leavesRuleDocument } from "../../app/routing";
import type { Definition, Rule } from "../../types";
import { ruleSnapshot, type DefinitionChange } from "../../domain/graph";
import { documentReducer, initialDocument } from "./documentState";
import {
  acceptsEdits,
  commandsIdle,
  editorCapabilities,
  invalidDefaultMessage,
  pendingWriteWarning,
  shownView,
  type EditorTask,
  type EditorView,
} from "./editorCapabilities";

interface Options {
  initial: Rule;
  /** The view the route requests; `view` is the one the editor shows. */
  mode: EditorView;
  requestedVersion: number | null;
  onSaved: (rule: Rule) => void;
  onDirty: (dirty: boolean) => void;
  /** Told once the rule is deleted, before the editor leaves for the library. */
  onDeleted?: (id: string) => void;
  navigate: (path: string) => void;
  notify: (message: string) => void;
  /** Receives located failures of save, validate, publish and build commands. */
  reportCommandProblem: (problem: GraphProblem | null) => void;
}
type VersionLoad =
  | { status: "loading" }
  | { status: "ready" }
  | { status: "failed"; message: string };

/** Computes positions for the draft it receives, e.g. with the ELK layout. */
export type DraftLayout = (draft: Definition) => Promise<Definition>;

/** Why the server kept a rule: its message and, for a refused deletion, every caller. */
export interface DeletionRefusal {
  message: string;
  callers: string[];
}

/**
 * The open rule document and its command gate. Controls read `capabilities`;
 * every edit and command re-checks the same rules at its entry point, because
 * keyboard shortcuts and late callbacks do not pass through disabled controls.
 */
export function useRuleDocument({
  initial,
  mode,
  requestedVersion,
  onSaved,
  onDirty,
  onDeleted,
  navigate,
  notify,
  reportCommandProblem,
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
  const [busy, setBusy] = useState<EditorTask | "">("");
  // The command holding the lock now; `busy` shows it from the next render.
  const runningTask = useRef<EditorTask | "">("");
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
  const snapshot = useMemo(() => ruleSnapshot(rule), [rule]);
  const dirty =
    !readOnly && (hasInvalidDefaults || sourceDirty || snapshot !== baseline);
  const capabilities = editorCapabilities({
    readOnly,
    task: busy,
    versionReady: !versionUnavailable,
    dirty,
  });
  const view = shownView(mode, {
    sourceDirty,
    invalidDefaults: hasInvalidDefaults,
  });
  useEffect(() => {
    onDirty(dirty);
  }, [dirty, onDirty]);
  // Graph/code switches keep this editor, and its writes, alive.
  useNavigationGuard(pendingWriteWarning(busy), leavesRuleDocument);
  const onInvalidDefault = useCallback(
    (key: string, invalid: boolean) =>
      setInvalidDefaults((old) =>
        old[key] === invalid ? old : { ...old, [key]: invalid },
      ),
    [],
  );
  /**
   * Whether an invalid parameter default blocks `action`, e.g. "opening node
   * code". A blocked action reports what to fix, like a failed command.
   */
  const blockedByInvalidDefault = useCallback(
    (action: string): boolean => {
      if (!hasInvalidDefaults) return false;
      setError(invalidDefaultMessage(action));
      return true;
    },
    [hasInvalidDefaults],
  );
  const fail = useCallback(
    (failure: unknown) => {
      setError(errorMessage(failure));
      if (failure instanceof ApiError)
        reportCommandProblem({
          message: failure.message,
          locations: failure.locations,
        });
    },
    [reportCommandProblem],
  );
  const runTask = useCallback(
    async (
      name: EditorTask,
      task: (signal: AbortSignal) => Promise<unknown>,
    ) => {
      const signal = session.current?.signal;
      const idle = commandsIdle({
        task: runningTask.current,
        versionReady: !versionUnavailable,
      });
      if (!signal || signal.aborted || !idle) return;
      runningTask.current = name;
      setBusy(name);
      setError("");
      try {
        await task(signal);
      } catch (failure) {
        if (!signal.aborted) fail(failure);
      } finally {
        runningTask.current = "";
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
  /** The edit rule of `capabilities`, checked against the command running now. */
  const acceptsEditsNow = useCallback(
    () =>
      acceptsEdits({
        readOnly,
        task: runningTask.current,
        versionReady: !versionUnavailable,
      }),
    [readOnly, versionUnavailable],
  );
  /** Applies a graph edit unless the document refuses edits now; reports whether it did. */
  const edit = useCallback(
    (change: DefinitionChange): boolean => {
      if (!acceptsEditsNow()) return false;
      dispatch({ type: "graph/change", change });
      setError("");
      return true;
    },
    [acceptsEditsNow],
  );
  /** Applies rule settings to the draft (Save draft persists them); reports whether it did. */
  const editMetadata = (patch: Pick<Rule, "name" | "description">) => {
    if (!acceptsEditsNow()) return false;
    dispatch({ type: "rule/metadata", patch });
    return true;
  };
  /**
   * Records the code buffer. Monaco has already applied the keystroke, so only
   * a published version refuses it: text typed as a command starts is kept, and
   * that command's build then reports that the code changed.
   */
  const editSource = (text: string): boolean => {
    if (readOnly) return false;
    dispatch({ type: "source/changed", source: text });
    return true;
  };
  const buildCode = useCallback(async (): Promise<Definition> => {
    const signal = session.current?.signal;
    if (!signal || signal.aborted)
      throw new DOMException("The editor session has closed", "AbortError");
    if (hasInvalidDefaults)
      throw new Error(invalidDefaultMessage("saving or changing views"));
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
  // Graph/code switches. The header button switches through switchView, which
  // checks first. The sidebar and browser history change the route before the
  // editor sees it, so arriving in a view applies the same rules afterwards,
  // and `view` never shows code that is not allowed yet.
  useEffect(() => {
    // Code cannot open while a default is invalid: return to the graph.
    if (mode !== "code" || !hasInvalidDefaults) return;
    setError(invalidDefaultMessage("changing views"));
    navigate(`/rules/${rule.id}`);
  }, [mode, hasInvalidDefaults, navigate, rule.id]);
  // The code view shows the draft rendered as ARC Script.
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
    // Unbuilt code builds before the graph shows; a failure returns to the code.
    if (mode !== "graph" || !current.current.sourceDirty) return;
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
        throw new Error(invalidDefaultMessage("changing views"));
      if (mode === "code") await buildCode();
      signal.throwIfAborted();
      navigate(
        `/${mode === "code" ? "rules" : "studio"}/${rule.id}${requestedVersion ? `?version=${requestedVersion}` : ""}`,
      );
    });
  const acknowledge = (submitted: Rule, response: Rule) => {
    dispatch({ type: "rule/saved", submitted, rule: response });
    onSaved(response);
  };
  // Every step checks the editor session: after the user leaves (and confirms
  // discarding the draft), no further write may start and nothing is reported.
  const action = (type: "save" | "validate" | "publish") => {
    // Commands are also called by keyboard actions, outside the hidden toolbar.
    if (readOnly && type !== "validate") return Promise.resolve();
    return runTask(type, async (signal) => {
      const candidate = { ...rule, draft: await buildCode() };
      signal.throwIfAborted();
      if (type === "save") {
        const saved = await ruleApi.save(candidate, { signal });
        signal.throwIfAborted();
        acknowledge(candidate, saved);
        notify("Draft saved");
        return;
      }
      await studioApi.validate(candidate.draft, { signal });
      signal.throwIfAborted();
      if (type === "validate") {
        notify("Graph is valid. All paths lead to a result.");
        return;
      }
      let submitted = candidate;
      if (ruleSnapshot(candidate) !== baseline) {
        const saved = await ruleApi.save(candidate, { signal });
        signal.throwIfAborted();
        acknowledge(candidate, saved);
        submitted = { ...saved, draft: candidate.draft };
      }
      const published = await ruleApi.publish(
        submitted.id,
        submitted.revision,
        { signal },
      );
      signal.throwIfAborted();
      acknowledge(submitted, published);
      notify(
        `Version ${published.publishedVersion} published and ready to call`,
      );
    });
  };
  const build = () =>
    runTask("build", async (signal) => {
      const draft = await buildCode();
      signal.throwIfAborted();
      await studioApi.validate(draft, { signal });
      signal.throwIfAborted();
      notify("Code built. Graph is valid.");
    });
  /**
   * Arrange holds the lock only until the layout is applied, and applies it
   * only to the draft it started from. `onArranged` may then request a
   * viewport fit, which nothing waits for (lesson F8).
   */
  const arrange = (layout: DraftLayout, onArranged: () => void) =>
    runTask("layout", async (signal) => {
      if (readOnly) return;
      const before = rule.draft;
      const definition = await layout(before);
      signal.throwIfAborted();
      dispatch({ type: "graph/arranged", before, definition });
      onArranged();
    });
  /** Opens or closes the Test panel once pending code is built, since preview runs the graph. */
  const toggleTest = (toggle: () => void) =>
    runTask("test", async () => {
      await buildCode();
      toggle();
    });
  /**
   * Deletes the rule and leaves for the library. Unsaved changes go with the
   * rule, so leaving does not ask about them. Resolves to why the server kept
   * the rule, or null. A deletion cannot be recalled once sent, so it outlives
   * the editor session: the request carries no session signal, and its outcome
   * is reported through the workspace even after the user has left.
   */
  const deleteRule = async (): Promise<DeletionRefusal | null> => {
    let refusal: DeletionRefusal | null = null;
    await runTask("delete", async (signal) => {
      try {
        await ruleApi.delete(rule.id, rule.revision);
      } catch (failure) {
        refusal = {
          message: errorMessage(failure),
          callers: errorDetails(failure),
        };
        if (signal.aborted)
          notify(`Rule ${rule.id} was not deleted: ${refusal.message}`);
        return;
      }
      onDeleted?.(rule.id);
      notify(`Rule ${rule.id} deleted`);
      if (signal.aborted) return;
      onDirty(false);
      navigate("/library");
    });
    return refusal;
  };
  return {
    rule,
    source,
    sourceDirty,
    diagnostics: state.diagnostics,
    readOnly,
    dirty,
    busy,
    capabilities,
    view,
    hasInvalidDefaults,
    onInvalidDefault,
    blockedByInvalidDefault,
    error,
    setError,
    versionLoading,
    versionError,
    versionUnavailable,
    retryVersion,
    edit,
    editMetadata,
    editSource,
    action,
    build,
    switchView,
    arrange,
    toggleTest,
    deleteRule,
  };
}
