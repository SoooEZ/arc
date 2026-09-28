import { useCallback, useState } from "react";
import type { Definition } from "../../types";
import {
  defaultSelection,
  selectedEdgeId,
  selectedNode,
} from "./nodeSelection";

/**
 * The one owner of the editor's selection. The selected node and connection
 * are derived from the current draft, so a build, a version load or a deletion
 * that removes them falls back to the default node (`nodeSelection.ts`), the
 * same policy for every entry point. An invalid parameter default holds the
 * selection: `mayChangeSelection` refuses a command, with the message a failed
 * command would show, before it changes anything.
 */
export function useNodeSelection({
  definition,
  initial,
  blockedByInvalidDefault,
}: {
  definition: Definition;
  /** The draft the editor opened with, which chooses the first selection. */
  initial: Definition;
  /** Reports and refuses `action` while a parameter default is invalid. */
  blockedByInvalidDefault: (action: string) => boolean;
}) {
  const [requestedSelection, setRequestedSelection] = useState(
    () => defaultSelection(initial).id,
  );
  const node = selectedNode(definition, requestedSelection);
  const selected = node.id;
  const [requestedEdge, setSelectedEdge] = useState<string | null>(null);
  const selectedEdge = selectedEdgeId(definition, requestedEdge);
  const mayChangeSelection = useCallback(
    (action: string) => !blockedByInvalidDefault(action),
    [blockedByInvalidDefault],
  );
  /** Selects a node unless an invalid default must be fixed before `action`. */
  const selectNode = useCallback(
    (id: string, action = "selecting another node") => {
      if (id !== selected && blockedByInvalidDefault(action)) return false;
      setRequestedSelection(id);
      return true;
    },
    [selected, blockedByInvalidDefault],
  );
  return {
    node,
    selected,
    selectNode,
    mayChangeSelection,
    selectedEdge,
    setSelectedEdge,
  };
}
