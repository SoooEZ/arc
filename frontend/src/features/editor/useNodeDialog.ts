import { useCallback, useEffect, useState } from "react";
import type { RuleNode } from "../../types";

/**
 * A requested node dialog. The inspector stays locked from the request until
 * the dialog closes (lesson F6), including while its module loads.
 */
export type NodeDialogRequest =
  | { kind: "edit"; nodeId: string }
  | { kind: "code"; nodeId: string; problems: string[] };

/**
 * One node dialog at a time. A request whose node has left the draft (deleted
 * while the dialog was loading, or removed by a build) is dropped: its dialog
 * could never open, so it must not keep the inspector locked or open later for
 * a new node with the same ID.
 */
export function useNodeDialog(nodes: RuleNode[]) {
  const [request, setRequest] = useState<NodeDialogRequest | null>(null);
  const node = request
    ? nodes.find((candidate) => candidate.id === request.nodeId)
    : undefined;
  const orphaned = request !== null && !node;
  useEffect(() => {
    if (orphaned) setRequest(null);
  }, [orphaned]);
  const openEdit = useCallback(
    (nodeId: string) => setRequest({ kind: "edit", nodeId }),
    [],
  );
  const openCode = useCallback(
    (nodeId: string) => setRequest({ kind: "code", nodeId, problems: [] }),
    [],
  );
  const close = useCallback(() => setRequest(null), []);
  const reportCodeProblems = useCallback(
    (problems: string[]) =>
      setRequest((current) =>
        current?.kind === "code" ? { ...current, problems } : current,
      ),
    [],
  );
  return {
    active: request && node ? { request, node } : null,
    openEdit,
    openCode,
    close,
    reportCodeProblems,
  };
}
