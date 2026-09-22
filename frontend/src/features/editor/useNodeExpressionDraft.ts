import { useEffect, useRef, useState } from "react";
import { studioApi } from "../../api/studio";
import { errorMessage } from "../../api/errors";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import type { Definition, Diagnostic } from "../../types";

interface Options {
  definition: Definition;
  nodeId: string;
  readOnly: boolean;
  onProblems: (messages: string[]) => void;
  onApply: (definition: Definition) => void;
  onClose: () => void;
}

/** Owns one local node-code buffer; checking never changes the parent graph. */
export function useNodeExpressionDraft({
  definition,
  nodeId,
  readOnly,
  onProblems,
  onApply,
  onClose,
}: Options) {
  const [source, setSource] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [applyError, setApplyError] = useState("");
  const [applyDiagnostics, setApplyDiagnostics] = useState<Diagnostic[]>([]);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => active.current?.abort(), []);
  const rendered = useAsyncResource(
    JSON.stringify([definition, nodeId]),
    (signal) => studioApi.renderNode(definition, nodeId, { signal }),
    null,
  );
  useEffect(() => {
    const renderedSource = rendered.data?.source;
    if (renderedSource !== undefined)
      setSource((current) => current ?? renderedSource);
  }, [rendered.data]);
  const checked = useAsyncResource(
    JSON.stringify([definition, nodeId, source]),
    async (signal) => {
      const built = await studioApi.buildNode(definition, nodeId, source!, {
        signal,
      });
      const issues = built.definition
        ? await studioApi.diagnostics(built.definition, { signal })
        : [];
      const messages = issues
        .filter((problem) =>
          problem.locations.some(
            (location) => !location.ruleId && location.nodeId === nodeId,
          ),
        )
        .map((problem) => problem.message);
      return { diagnostics: built.diagnostics, messages };
    },
    null,
    350,
    source !== null && !readOnly,
  );
  const diagnostics = applyDiagnostics.length
    ? applyDiagnostics
    : (checked.data?.diagnostics ?? []);
  const messages = checked.data?.messages ?? [];
  const problemKey = JSON.stringify([
    ...diagnostics.map((diagnostic) => diagnostic.message),
    ...messages,
  ]);
  useEffect(() => {
    onProblems(JSON.parse(problemKey) as string[]);
  }, [problemKey, onProblems]);
  const changeSource = (value: string) => {
    setSource(value);
    setApplyError("");
    setApplyDiagnostics([]);
  };
  const apply = async () => {
    if (readOnly || source === null || active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setApplyError("");
    try {
      const built = await studioApi.buildNode(definition, nodeId, source, {
        signal: controller.signal,
      });
      if (controller.signal.aborted) return;
      setApplyDiagnostics(built.diagnostics);
      if (built.definition) {
        onApply(built.definition);
        onClose();
      }
    } catch (failure) {
      if (!controller.signal.aborted) setApplyError(errorMessage(failure));
    } finally {
      active.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  };
  return {
    source,
    changeSource,
    diagnostics,
    busy,
    apply,
    error: applyError || rendered.error || checked.error || messages.join("\n"),
  };
}
