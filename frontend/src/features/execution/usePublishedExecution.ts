import { useEffect, useState } from "react";
import { ruleApi } from "../../api/rules";
import type { Rule, Version } from "../../types";
import {
  curlExample,
  parseExecutionInputs,
  sampleInputs,
} from "../../domain/executionInputs";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { useExecutionRequest } from "./useExecutionRequest";

export function usePublishedExecution(
  rules: Rule[],
  notify: (message: string) => void,
) {
  const published = rules.filter((rule) => rule.publishedVersion);
  const [id, setId] = useState(
    published.find((r) => r.id === "order-pricing")?.id ||
      published[0]?.id ||
      "",
  );
  const [selectedVersion, setSelectedVersion] = useState<number | "">("");
  const versionsResource = useAsyncResource(
    id,
    (signal) => ruleApi.versions(id, { signal }),
    [] as Version[],
    0,
    !!id,
  );
  const versions = versionsResource.data;
  const version = selectedVersion || versions[0]?.version || "";
  const definition = versions.find(
    (candidate) => candidate.version === version,
  )?.definition;
  const [inputs, setInputs] = useState("{}");
  const execution = useExecutionRequest(JSON.stringify([id, version, inputs]));
  const { result, running } = execution;
  const error = versionsResource.error || execution.error;
  const loading = versionsResource.loading;
  const selectRule = (nextId: string) => {
    setId(nextId);
    setSelectedVersion("");
  };
  useEffect(() => {
    if (definition)
      setInputs(JSON.stringify(sampleInputs(definition), null, 2));
  }, [definition]);
  const run = () =>
    execution.run((signal) =>
      ruleApi.execute(id, parseExecutionInputs(inputs), version || undefined, {
        signal,
      }),
    );
  let values = {};
  try {
    values = JSON.parse(inputs);
  } catch {
    /* Code sample stays available while editing. */
  }
  const curl = curlExample(
    window.location.origin,
    id || "order-pricing",
    values,
    version || undefined,
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(curl);
      notify("cURL copied to clipboard");
    } catch {
      notify("Clipboard unavailable. Select and copy the example below.");
    }
  };
  return {
    published,
    id,
    versions,
    version,
    definition,
    inputs,
    result,
    running,
    error,
    loading,
    curl,
    copy,
    selectRule,
    selectVersion: setSelectedVersion,
    setInputs,
    run,
    clear: execution.clear,
  };
}
