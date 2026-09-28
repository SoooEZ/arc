/** Commands that hold the document lock; `busy` names the running one. */
export type EditorTask =
  | "save"
  | "validate"
  | "publish"
  | "build"
  | "switch"
  | "test"
  | "layout"
  | "delete";

/** The document facts that decide what the editor allows. */
export interface EditorStatus {
  /** A published version is shown; it never changes. */
  readOnly: boolean;
  /** The command holding the document lock, or "" when none runs. */
  task: EditorTask | "";
  /** The shown version has loaded (always true for the draft). */
  versionReady: boolean;
  /** The draft has changes that are not saved. */
  dirty: boolean;
}

/**
 * What the editor allows. Controls read these from the rendered state; edits
 * and commands check the same rules against the command running right now.
 */
export interface EditorCapabilities {
  /** Change the draft: canvas, inspector, node dialogs, code and rule settings. */
  edit: boolean;
  /** Arrange the graph, which rewrites node positions. */
  arrange: boolean;
  /** Save draft: an editable draft with unsaved changes. */
  save: boolean;
  /** Publish the draft as a new version. */
  publish: boolean;
  /** Validate the shown graph; published versions too. */
  validate: boolean;
  /** Open or close the Test panel, building pending code first. */
  test: boolean;
  /** Switch between the graph and code views. */
  switchView: boolean;
  /** Open rule settings, read-only unless the draft is editable. */
  openSettings: boolean;
  /** Delete the rule from its settings, which show the editable draft. */
  delete: boolean;
}

/** Commands take turns, and none starts before the shown version has loaded. */
export function commandsIdle({
  task,
  versionReady,
}: Pick<EditorStatus, "task" | "versionReady">): boolean {
  return task === "" && versionReady;
}

/** A published version never changes; the draft changes only between commands. */
export function acceptsEdits(
  status: Pick<EditorStatus, "readOnly" | "task" | "versionReady">,
): boolean {
  return commandsIdle(status) && !status.readOnly;
}

export function editorCapabilities(status: EditorStatus): EditorCapabilities {
  const idle = commandsIdle(status);
  const edit = acceptsEdits(status);
  return {
    edit,
    arrange: edit,
    save: edit && status.dirty,
    publish: edit,
    validate: idle,
    test: idle,
    switchView: idle,
    openSettings: idle,
    delete: edit,
  };
}

/**
 * Leaving aborts a pending write, but the server may already have applied it,
 * so leaving during one asks first. A deletion does not ask: it leaves for the
 * library itself once it finishes.
 */
export function pendingWriteWarning(task: EditorTask | ""): string | null {
  if (task === "save")
    return "The draft is still being saved. Leave anyway? The save may not finish.";
  if (task === "publish")
    return "A version is still being published. Leave anyway? Publishing may not finish.";
  return null;
}

/**
 * An invalid parameter default exists only in its mounted Input form, so it
 * must be fixed before anything leaves that form or submits the draft.
 */
export function invalidDefaultMessage(action: string): string {
  return `Fix the invalid parameter default before ${action}`;
}

export type EditorView = "graph" | "code";

/**
 * The view the editor shows for the requested one. Code with unbuilt edits
 * stays shown while a switch to the graph builds it; an invalid parameter
 * default keeps the graph and its Input form.
 */
export function shownView(
  requested: EditorView,
  {
    sourceDirty,
    invalidDefaults,
  }: { sourceDirty: boolean; invalidDefaults: boolean },
): EditorView {
  if (sourceDirty) return "code";
  if (requested === "code" && !invalidDefaults) return "code";
  return "graph";
}
