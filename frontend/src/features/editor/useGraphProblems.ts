import { useEffect, useMemo } from "react";
import { studioApi } from "../../api/studio";
import type { GraphProblem } from "../../api/errors";
import type { Definition, Rule } from "../../types";
import { isCurrentGraphLocation } from "../../domain/graph";
import { useAsyncResource } from "../../hooks/useAsyncResource";

/** Messages per node ID. A Map, because node IDs such as "constructor" are legal. */
export type NodeErrors = ReadonlyMap<string, string[]>;

const noProblems: GraphProblem[] = [];

interface NodeErrorSources {
  /** The rule version the editor shows; null version for the draft. */
  shown: { ruleId: string; version: number | null };
  definition: Definition;
  /** Diagnostics, preview failures and command failures for this graph. */
  problems: GraphProblem[];
  /** Problems carried into a referenced-rule viewer from its caller. */
  inherited: GraphProblem[];
  invalidDefaults: boolean;
  nodeCode: { nodeId: string; problems: string[] } | null;
}

/** Distinct messages for each node of the shown graph, in the order reported. */
export function nodeErrorsOf({
  shown,
  definition,
  problems,
  inherited,
  invalidDefaults,
  nodeCode,
}: NodeErrorSources): Map<string, string[]> {
  const errors = new Map<string, string[]>();
  const add = (nodeId: string, message: string) => {
    const messages = errors.get(nodeId);
    if (!messages) errors.set(nodeId, [message]);
    else if (!messages.includes(message)) messages.push(message);
  };
  for (const problem of problems)
    for (const location of problem.locations)
      if (isCurrentGraphLocation(location, shown))
        add(location.nodeId, problem.message);
  // Inherited problems mark only locations that explicitly name this version.
  for (const problem of inherited)
    for (const location of problem.locations)
      if (
        location.ruleId === shown.ruleId &&
        location.version === shown.version
      )
        add(location.nodeId, problem.message);
  const input = definition.nodes.find((node) => node.type === "INPUT");
  if (invalidDefaults && input)
    add(input.id, "Fix the invalid parameter default.");
  if (nodeCode)
    for (const message of nodeCode.problems) add(nodeCode.nodeId, message);
  return errors;
}

interface Options {
  rule: Rule;
  /** semanticGraphKey of the draft: moving cards does not re-check the graph. */
  graphKey: string;
  version: number | null;
  loading: boolean;
  invalidDefaults: boolean;
  /** Current preview and command failures. */
  runtime: GraphProblem[];
  inherited: GraphProblem[];
  nodeCode: { nodeId: string; problems: string[] } | null;
  /** Command failures describe the graph they ran on; semantic edits clear them. */
  clearCommandProblem: () => void;
  onError: (error: string) => void;
}
export function useGraphProblems({
  rule,
  graphKey,
  version,
  loading,
  invalidDefaults,
  runtime,
  inherited,
  nodeCode,
  clearCommandProblem,
  onError,
}: Options) {
  const { data: graphProblems, error } = useAsyncResource(
    graphKey,
    (signal) => studioApi.diagnostics(rule.draft, { signal }),
    noProblems,
    350,
    !loading,
  );
  useEffect(() => {
    if (!loading) clearCommandProblem();
  }, [graphKey, loading, clearCommandProblem]);
  useEffect(() => {
    if (error) onError(`Could not check graph: ${error}`);
  }, [error, onError]);
  const allProblems = [...graphProblems, ...runtime, ...inherited];
  const errors = nodeErrorsOf({
    shown: { ruleId: rule.id, version },
    definition: rule.draft,
    problems: [...graphProblems, ...runtime],
    inherited,
    invalidDefaults,
    nodeCode,
  });
  // Keep one Map while its content is unchanged, so memoized canvas nodes and
  // the inspector keep their error lists.
  const errorsKey = JSON.stringify([...errors]);
  const nodeErrors: NodeErrors = useMemo(() => errors, [errorsKey]);
  return { allProblems, nodeErrors };
}
