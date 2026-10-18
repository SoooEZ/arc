import { useCallback, useEffect, useRef, useState } from "react";
import { studioApi } from "../../../api/studio";
import {
  parseExecutionInputs,
  sampleInputsJson,
} from "../../../domain/executionInputs";
import type { Definition } from "../../../types";
import { useExecutionOptions } from "../useExecutionOptions";
import { useExecutionRequest } from "../useExecutionRequest";
import { useInputBuffer } from "../useInputBuffer";

/** The Test panel shows the inputs as a form or JSON, or the equivalent cURL request. */
export type PreviewInputView = "form" | "json" | "curl";

/** The Test panel tries one set of inputs, or lists the rule's saved tests. */
export type TestPanelView = "try" | "saved";

/**
 * The editor's preview session. The Test panel only presents it, so its input
 * buffer, options, selected views and current result survive graph/code view
 * switches, code edits and closing the panel (which discards the result).
 *
 * - An untouched buffer always shows the current sample; once edited it is
 *   kept until the editor closes, whatever happens to the input schema.
 * - A result belongs to the semantic graph, inputs and options. Moving cards
 *   keeps it and its trace; other graph edits, input or option changes and
 *   closing the panel discard it and any pending run.
 * - A form field whose text is not a value of its type holds the run: the
 *   buffer still has the field's last valid value, which is not what it shows.
 */
export function usePreviewExecution(definition: Definition, graphKey: string) {
  const [open, setOpen] = useState(false);
  const [panelView, setPanelView] = useState<TestPanelView>("try");
  const [expanded, setExpanded] = useState(false);
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [inputView, setInputView] = useState<PreviewInputView>("form");
  // One target: once edited, the buffer stays for the whole editor session.
  const inputBuffer = useInputBuffer("preview", sampleInputsJson(definition));
  const { options, change: changeOptions } = useExecutionOptions();
  const input = inputBuffer.text;
  const execution = useExecutionRequest(
    JSON.stringify([graphKey, input, options]),
  );
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  const reportValidity = useCallback(
    (name: string, valid: boolean) =>
      setInvalid((current) =>
        !current[name] === valid ? current : { ...current, [name]: !valid },
      ),
    [],
  );
  const invalidInputs = Object.keys(invalid).filter((name) => invalid[name]);
  const run = () =>
    execution.run((signal) =>
      studioApi.preview(definition, parseExecutionInputs(input), options, {
        signal,
      }),
    );
  // A saved test opened in Try inputs runs once its inputs are the buffer:
  // the effect after that render runs what the render's buffer holds.
  const [runRequest, setRunRequest] = useState(0);
  const latestRun = useRef(run);
  latestRun.current = run;
  useEffect(() => {
    if (runRequest) latestRun.current();
  }, [runRequest]);
  const close = () => {
    execution.clear();
    setOpen(false);
  };
  return {
    open,
    // Opening waits for pending code to build (useRuleDocument.toggleTest),
    // and closing runs nothing, so the two stay separate commands.
    show: () => setOpen(true),
    close,
    panelView,
    setPanelView,
    expanded,
    toggleExpanded: () => setExpanded((value) => !value),
    /** The folded Run options are open; they stay as left while the editor is open. */
    optionsOpen,
    setOptionsOpen,
    inputView,
    setInputView,
    input,
    changeInput: inputBuffer.change,
    /** Shows `text` as the inputs in Try inputs and runs them. */
    tryInputs: (text: string) => {
      inputBuffer.change(text);
      setPanelView("try");
      setRunRequest((request) => request + 1);
    },
    options,
    changeOptions,
    /** Form fields whose text is not a value of their type, by input name. */
    invalidInputs,
    reportValidity,
    run,
    running: execution.running,
    result: execution.result,
    error: execution.error,
    problem: execution.problem,
    requestDurationMs: execution.requestDurationMs,
  };
}

export type PreviewExecution = ReturnType<typeof usePreviewExecution>;
