import type { Dispatch } from "react";
import { useReactFlow } from "@xyflow/react";
import type { Definition, NodeType, RuleNode } from "../../../types";
import type { FlowNode } from "./GraphNode";
import {
  createGraphNode,
  patchGraphNode,
  removeGraphNode,
  type DefinitionChange,
} from "../../../domain/graph";
import type { DocumentAction } from "../documentState";

interface Options {
  definition: Definition;
  measurements: Record<string, { width: number; height: number }>;
  readOnly: boolean;
  busy: string;
  changeDefinition: (change: DefinitionChange) => void;
  dispatch: Dispatch<DocumentAction>;
  selectNode: (id: string) => void;
  runTask: (name: string, task: () => Promise<unknown>) => Promise<void>;
}

/** Graph mutations share the document guard; async layout carries its starting draft. */
export function useGraphCommands({
  definition,
  measurements,
  readOnly,
  busy,
  changeDefinition,
  dispatch,
  selectNode,
  runTask,
}: Options) {
  const flow = useReactFlow<FlowNode>();

  const patchNode = (id: string, patch: Partial<RuleNode>) =>
    changeDefinition((current) => patchGraphNode(current, id, patch));

  const addNode = (type: NodeType) => {
    if (readOnly || busy) return;
    const position = flow.screenToFlowPosition({
      x: window.innerWidth / 2,
      y: window.innerHeight / 2,
    });
    const id = `node-${crypto.randomUUID().slice(0, 8)}`;
    changeDefinition((current) => ({
      ...current,
      nodes: [
        ...current.nodes,
        createGraphNode(type, id, position, current.nodes.length),
      ],
    }));
    selectNode(id);
  };

  const removeNode = (id: string) => {
    const node = definition.nodes.find((candidate) => candidate.id === id);
    if (readOnly || busy || !node || node.type === "INPUT") return;
    changeDefinition((current) => removeGraphNode(current, id));
    const next =
      definition.nodes.find((node) => node.type === "INPUT") ||
      definition.nodes.find((node) => node.id !== id);
    selectNode(next?.id || "");
  };

  const arrange = () =>
    runTask("layout", async () => {
      if (readOnly) return;
      const { arrangeGraph } = await import("./graphLayout");
      const arranged = await arrangeGraph(definition, measurements);
      dispatch({
        type: "graph/arranged",
        before: definition,
        definition: arranged,
      });
      await new Promise<void>((resolve) =>
        requestAnimationFrame(() => resolve()),
      );
      // Interrupted React Flow animations may never settle their fit promise.
      // Keep viewport animation outside the document's command lock.
      await flow.fitView({ padding: 0.15, duration: 0 });
    });

  return { patchNode, addNode, removeNode, arrange };
}
