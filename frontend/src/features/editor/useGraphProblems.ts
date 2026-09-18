import { useEffect, useMemo } from "react";
import { studioApi } from "../../api/studio";
import type { GraphProblem } from "../../api/errors";
import type { Rule } from "../../types";
import { semanticGraphKey } from "../../domain/graph";
import { useAsyncResource } from "../../hooks/useAsyncResource";

interface Options {
  rule: Rule;
  version: number | null;
  loading: boolean;
  invalidJson: boolean;
  runtime: GraphProblem[];
  inherited: GraphProblem[];
  nodeCode: string | null;
  codeProblems: string[];
  clearRuntime: () => void;
  onError: (error: string) => void;
}
export function useGraphProblems({
  rule,
  version,
  loading,
  invalidJson,
  runtime,
  inherited,
  nodeCode,
  codeProblems,
  clearRuntime,
  onError,
}: Options) {
  const key = semanticGraphKey(rule.draft);
  const { data: graphProblems, error } = useAsyncResource(
    key,
    (signal) => studioApi.diagnostics(rule.draft, { signal }),
    [] as GraphProblem[],
    350,
    !loading,
  );
  useEffect(() => {
    if (!loading) clearRuntime();
  }, [key, loading, clearRuntime]);
  useEffect(() => {
    if (error) onError(`Could not check graph: ${error}`);
  }, [error, onError]);
  const allProblems = [...graphProblems, ...runtime, ...inherited];
  const local = [
    ...graphProblems,
    ...runtime,
    ...inherited.map((problem) => ({
      ...problem,
      locations: problem.locations.filter(
        (location) =>
          location.ruleId === rule.id && location.version === version,
      ),
    })),
  ];
  const errors: Record<string, string[]> = {};
  for (const problem of local)
    for (const location of problem.locations) {
      if (
        location.ruleId &&
        location.ruleId !== "preview" &&
        !(location.ruleId === rule.id && location.version === version)
      )
        continue;
      (errors[location.nodeId] ||= []).push(problem.message);
    }
  const input = rule.draft.nodes.find((node) => node.type === "INPUT");
  if (invalidJson && input)
    (errors[input.id] ||= []).push("Fix the invalid JSON parameter value.");
  if (nodeCode && codeProblems.length)
    (errors[nodeCode] ||= []).push(...codeProblems);
  for (const id of Object.keys(errors)) errors[id] = [...new Set(errors[id])];
  const errorsKey = JSON.stringify(errors);
  const nodeErrors = useMemo(() => errors, [errorsKey]);
  return { allProblems, nodeErrors };
}
