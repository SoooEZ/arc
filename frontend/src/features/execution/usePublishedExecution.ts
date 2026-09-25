import { useEffect, useState } from "react";
import { ruleApi } from "../../api/rules";
import type { Page, RuleSummary, Version, VersionSummary } from "../../types";
import {
  curlExample,
  parseExecutionInputs,
  sampleInputs,
} from "../../domain/executionInputs";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { useExecutionRequest } from "./useExecutionRequest";

const pageSize = 20;
const emptyPage = <T>(): Page<T> => ({
  items: [],
  total: 0,
  offset: 0,
  limit: pageSize,
});

export function usePublishedExecution(
  rules: RuleSummary[],
  notify: (message: string) => void,
) {
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [selectedRule, setSelectedRule] = useState<RuleSummary | null>(null);
  const [selectedVersion, setSelectedVersion] = useState<number | "">("");
  const [versionOffset, setVersionOffset] = useState(0);
  const [trace, setTrace] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const [retry, setRetry] = useState(0);
  const refreshKey = rules.map((rule) => [
    rule.id,
    rule.revision,
    rule.publishedVersion,
  ]);
  const catalog = useAsyncResource(
    JSON.stringify([search, offset, refreshKey, retry]),
    (signal) =>
      ruleApi.catalog(
        { offset, limit: pageSize, search, publishedOnly: true },
        { signal },
      ),
    emptyPage<RuleSummary>(),
    150,
  );
  useEffect(() => {
    if (!selectedRule && catalog.data.items.length) {
      setSelectedRule(
        catalog.data.items.find((rule) => rule.id === "order-pricing") ??
          catalog.data.items[0],
      );
    }
  }, [selectedRule, catalog.data]);
  const id = selectedRule?.id ?? "";
  const latestVersion = Math.max(
    rules.find((rule) => rule.id === id)?.publishedVersion ?? 0,
    catalog.data.items.find((rule) => rule.id === id)?.publishedVersion ?? 0,
    selectedRule?.publishedVersion ?? 0,
  );
  const versionsResource = useAsyncResource(
    JSON.stringify([id, latestVersion, versionOffset, retry]),
    (signal) =>
      ruleApi.versionSummaries(
        id,
        { offset: versionOffset, limit: pageSize },
        { signal },
      ),
    emptyPage<VersionSummary>(),
    0,
    !!id,
  );
  const versions = versionsResource.data.items;
  const newestKnownVersion = Math.max(
    latestVersion,
    versionOffset === 0 ? (versions[0]?.version ?? 0) : 0,
  );
  useEffect(() => {
    // Remember an observed release when paging away from the newest history page.
    setSelectedRule((current) =>
      current?.id === id && newestKnownVersion > (current.publishedVersion ?? 0)
        ? { ...current, publishedVersion: newestKnownVersion }
        : current,
    );
  }, [id, newestKnownVersion]);
  const version = selectedVersion || newestKnownVersion || "";
  const detail = useAsyncResource(
    JSON.stringify([id, version, retry]),
    (signal) => ruleApi.version(id, Number(version), { signal }),
    null as Version | null,
    0,
    !!id && !!version,
  );
  const definition = detail.data?.definition;
  const inputKey = JSON.stringify([id, version]);
  const [inputBuffer, setInputBuffer] = useState({ key: "", text: "{}" });
  const inputs =
    inputBuffer.key === inputKey
      ? inputBuffer.text
      : definition
        ? JSON.stringify(sampleInputs(definition), null, 2)
        : "{}";
  const setInputs = (text: string) => setInputBuffer({ key: inputKey, text });
  const execution = useExecutionRequest(
    JSON.stringify([id, version, inputs, trace, timeoutMs]),
  );
  const { result, running, requestDurationMs } = execution;
  const loadError = catalog.error || versionsResource.error || detail.error;
  const error = loadError || execution.error;
  const loading = detail.loading;
  const selectRule = (nextId: string) => {
    const next = catalog.data.items.find((rule) => rule.id === nextId);
    if (!next) return;
    setSelectedRule(next);
    setSelectedVersion("");
    setVersionOffset(0);
  };
  const run = () => {
    if (!definition || !version) return;
    return execution.run((signal) =>
      ruleApi.execute(id, parseExecutionInputs(inputs), version, {
        signal,
        trace,
        timeoutMs,
      }),
    );
  };
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
    { trace, timeoutMs },
  );
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(curl);
      notify("cURL copied to clipboard");
    } catch {
      notify("Clipboard unavailable. Select and copy the example below.");
    }
  };
  const published =
    catalog.data.items.some((rule) => rule.id === id) || !selectedRule
      ? catalog.data.items
      : [selectedRule, ...catalog.data.items];
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
    loadError,
    loading,
    requestDurationMs,
    curl,
    copy,
    selectRule,
    selectVersion: setSelectedVersion,
    setInputs,
    run,
    clear: execution.clear,
    trace,
    setTrace,
    timeoutMs,
    setTimeoutMs,
    search,
    setSearch: (value: string) => {
      setSearch(value);
      setOffset(0);
    },
    catalogPage: catalog.data,
    catalogLoading: catalog.loading,
    offset,
    setOffset,
    versionPage: versionsResource.data,
    versionLoading: versionsResource.loading,
    versionOffset,
    setVersionOffset,
    retry: () => setRetry((value) => value + 1),
  };
}
