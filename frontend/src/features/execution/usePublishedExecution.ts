import { useEffect, useRef, useState } from "react";
import type { RuleSummary, Version } from "../../types";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { usePagedResource } from "../../hooks/usePagedResource";
import { usePagedSearch } from "../../hooks/usePagedSearch";
import { ruleApi } from "../../api/rules";
import {
  parseExecutionInputs,
  sampleInputsJson,
  tryParseExecutionInputs,
} from "../../domain/executionInputs";
import { useExecutionOptions } from "./useExecutionOptions";
import { useExecutionRequest } from "./useExecutionRequest";
import { useInputBuffer } from "./useInputBuffer";
import { publishedCurl } from "./publishedCurl";
import {
  defaultRuleId,
  knownVersion,
  newestKnownRelease,
  noRelease,
  selectionAfterCatalogPage,
} from "./publishedSelection";

export function usePublishedExecution(notify: (message: string) => void) {
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedRule, setSelectedRule] = useState<RuleSummary | null>(null);
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);
  const { trace, setTrace, timeoutMs, setTimeoutMs } = useExecutionOptions();
  // A new search starts at the first page; Retry reloads the page that is
  // shown. The hidden library page is not an input: keying on it read the
  // catalog twice on a direct visit, once more when that page arrived.
  const catalog = usePagedSearch(
    search,
    (query, offset, limit, signal) =>
      ruleApi.catalog(
        { offset, limit, search: query, publishedOnly: true },
        { signal },
      ),
    { refresh: retry, keepPrevious: true },
  );
  // Until the typed search applies, the shown page answers an older search.
  const catalogLoading = catalog.loading || catalog.searching;
  const catalogRules = catalog.data.items;
  useEffect(() => {
    setSelectedRule((current) =>
      selectionAfterCatalogPage(current, catalogRules),
    );
  }, [catalogRules]);
  const id = selectedRule?.id ?? "";
  // History page 0 holds the newest release; the selected catalog row is the
  // other place a release is learned.
  const listedVersion = selectedRule?.publishedVersion ?? 0;
  const history = usePagedResource(
    id,
    id
      ? (offset, limit, signal) =>
          ruleApi.versionSummaries(id, { offset, limit }, { signal })
      : null,
    { refresh: JSON.stringify([listedVersion, retry]) },
  );
  const newestOnPage =
    history.offset === 0 ? (history.data.items[0]?.version ?? 0) : 0;
  // History can reveal a release the summaries do not show yet. It is kept
  // apart from the history key, so learning it does not read history again.
  const [historyNewest, setHistoryNewest] = useState(noRelease);
  useEffect(() => {
    if (newestOnPage === 0 || !selectedRule) return;
    setHistoryNewest((current) =>
      newestKnownRelease(current, selectedRule, newestOnPage),
    );
  }, [selectedRule, newestOnPage]);
  const newestVersion = Math.max(
    listedVersion,
    newestOnPage,
    knownVersion(historyNewest, selectedRule),
  );
  const version = pinnedVersion ?? (newestVersion || null);
  const detail = useAsyncResource<Version | null>(
    JSON.stringify([id, version, retry]),
    id && version !== null
      ? (signal) => ruleApi.version(id, version, { signal })
      : null,
    null,
  );
  const definition = detail.data?.definition;
  // Inputs typed for one rule version stay with it.
  const inputBuffer = useInputBuffer(
    JSON.stringify([id, version]),
    definition ? sampleInputsJson(definition) : "{}",
  );
  const inputs = inputBuffer.text;
  const execution = useExecutionRequest(
    JSON.stringify([id, version, inputs, trace, timeoutMs]),
  );
  const { result, running, requestDurationMs } = execution;
  // A version that no longer exists means the rule was deleted, or its history
  // rewritten by a re-creation: forget it and choose again from a fresh page.
  // A pin abandoned once keeps its error afterwards, so a stale library row
  // cannot make the playground abandon and reselect it without end.
  const gone = detail.status === 404 || execution.status === 404;
  const abandoned = useRef<string | null>(null);
  useEffect(() => {
    const pin = `${id}:${version}`;
    if (!gone || abandoned.current === pin) return;
    abandoned.current = pin;
    setSelectedRule(null);
    setPinnedVersion(null);
    setHistoryNewest(noRelease);
    setRetry((value) => value + 1);
  }, [gone, id, version]);
  const loadError = catalog.error || history.error || detail.error;
  const error = loadError || execution.error;
  const selectRule = (nextId: string) => {
    const next = catalogRules.find((rule) => rule.id === nextId);
    if (!next) return;
    setSelectedRule(next);
    setPinnedVersion(null);
  };
  const run = () => {
    if (!definition || version === null) return;
    return execution.run((signal) =>
      ruleApi.execute(id, parseExecutionInputs(inputs), version, {
        signal,
        trace,
        timeoutMs,
      }),
    );
  };
  // The endpoint line, the cURL example and the request name one rule: the
  // sample rule stands in until one is selected.
  const endpoint = ruleApi.executeUrl(id || defaultRuleId);
  const curl = publishedCurl(id || defaultRuleId, inputs, version, {
    trace,
    timeoutMs,
  });
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(curl);
      notify("cURL copied to clipboard");
    } catch {
      notify("Clipboard unavailable. Select and copy the example below.");
    }
  };
  const published =
    !selectedRule || catalogRules.some((rule) => rule.id === id)
      ? catalogRules
      : [selectedRule, ...catalogRules];
  return {
    search,
    setSearch,
    catalog: { ...catalog, loading: catalogLoading },
    history,
    published,
    id,
    versions: history.data.items,
    version,
    definition,
    inputs,
    // Invalid JSON stays editable; the cURL example then sends empty inputs.
    inputsAreObject: tryParseExecutionInputs(inputs) !== null,
    result,
    running,
    error,
    loadError,
    loading: detail.loading,
    requestDurationMs,
    endpointPath: new URL(endpoint).pathname,
    curl,
    copy,
    selectRule,
    selectVersion: setPinnedVersion,
    setInputs: inputBuffer.change,
    run,
    clear: execution.clear,
    trace,
    setTrace,
    timeoutMs,
    setTimeoutMs,
    retry: () => setRetry((value) => value + 1),
  };
}
