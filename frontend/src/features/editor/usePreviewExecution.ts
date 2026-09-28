import { useState } from "react";
import { studioApi } from "../../api/studio";
import {
  parseExecutionInputs,
  sampleInputsJson,
} from "../../domain/executionInputs";
import type { Definition } from "../../types";
import { useExecutionRequest } from "../execution/useExecutionRequest";
import { useInputBuffer } from "../execution/useInputBuffer";

export const defaultPreviewTimeoutMs = 30_000;
/** The Test panel shows the input buffer or the equivalent cURL request. */
export type PreviewInputView = "json" | "curl";

/**
 * The editor's preview session. The Test panel only presents it, so its input
 * buffer, options, selected input view and current result survive graph/code
 * view switches, code edits and closing the panel (which discards the result).
 *
 * - An untouched buffer always shows the current sample; once edited it is
 *   kept until the editor closes, whatever happens to the input schema.
 * - A result belongs to the semantic graph, inputs and options. Moving cards
 *   keeps it and its trace; other graph edits, input or option changes and
 *   closing the panel discard it and any pending run.
 */
export function usePreviewExecution(definition: Definition, graphKey: string) {
  const [open, setOpen] = useState(false);
  const [inputView, setInputView] = useState<PreviewInputView>("json");
  // One target: once edited, the buffer stays for the whole editor session.
  const inputBuffer = useInputBuffer("preview", sampleInputsJson(definition));
  const [trace, setTrace] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(defaultPreviewTimeoutMs);
  const input = inputBuffer.text;
  const execution = useExecutionRequest(
    JSON.stringify([graphKey, input, trace, timeoutMs]),
  );
  const run = () =>
    execution.run((signal) =>
      studioApi.preview(definition, parseExecutionInputs(input), {
        signal,
        trace,
        timeoutMs,
      }),
    );
  const close = () => {
    execution.clear();
    setOpen(false);
  };
  return {
    open,
    toggle: () => (open ? close() : setOpen(true)),
    close,
    inputView,
    setInputView,
    input,
    changeInput: inputBuffer.change,
    trace,
    setTrace,
    timeoutMs,
    setTimeoutMs,
    run,
    running: execution.running,
    result: execution.result,
    error: execution.error,
    problem: execution.problem,
    requestDurationMs: execution.requestDurationMs,
  };
}

export type PreviewExecution = ReturnType<typeof usePreviewExecution>;
