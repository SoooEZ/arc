import { useEffect, useImperativeHandle, useMemo, type Ref } from "react";
import MonacoEditor from "@monaco-editor/react";
import type { Definition } from "../../types";
import type { monaco } from "./arcLanguage";
import { jsonLanguage } from "./jsonLanguage";
import { definitionJson, nodeJsonOffset } from "./definitionJson";
import {
  adoptSource,
  codeStudioOptions,
  revealPosition,
  useArcEditor,
  useEditorOptions,
} from "./useArcEditor";

/** What the outline asks of the JSON view. */
export interface RuleJsonViewHandle {
  /** Shows node `nodeId`'s declaration and puts the caret on it. */
  revealNode(nodeId: string): void;
}

/**
 * The rule's JSON as stored, read-only, shown in place of the code editor. A
 * build while it shows changes the definition: the new JSON reaches the model
 * through `adoptSource`, one edit of the changed span, so the caret stays
 * where the outline put it (a controlled `value` reached a read-only editor
 * as `setValue`, which moved the caret to line 1, column 1).
 */
export default function RuleJsonView({
  ref,
  definition,
  onMount: registerCommands,
}: {
  ref: Ref<RuleJsonViewHandle>;
  definition: Definition;
  /** Registers the studio's Build and Save actions on this editor too (lesson F4). */
  onMount: (instance: monaco.editor.IStandaloneCodeEditor) => void;
}) {
  // No diagnostics: the markers belong to the code. The ref is cleared on unmount.
  const { editor, model, onMount } = useArcEditor(undefined, "rule-json");
  const options = useEditorOptions(codeStudioOptions, true, "Rule JSON");
  const json = useMemo(() => definitionJson(definition), [definition]);
  useEffect(() => {
    if (!editor.current || !model || model.isDisposed()) return;
    adoptSource(editor.current, json);
  }, [editor, model, json]);
  useImperativeHandle(
    ref,
    () => ({
      revealNode(nodeId) {
        const instance = editor.current;
        const text = instance?.getModel();
        if (!instance || !text) return;
        const offset = nodeJsonOffset(text.getValue(), nodeId);
        if (offset === null) return;
        revealPosition(instance, text.getPositionAt(offset));
      },
    }),
    [editor],
  );
  return (
    <MonacoEditor
      language={jsonLanguage}
      theme="arc-light"
      defaultValue={json}
      onMount={(instance) => {
        onMount(instance);
        registerCommands(instance);
      }}
      options={options}
    />
  );
}
