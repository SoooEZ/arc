import { useEffect, useState } from "react";
import type { Definition, RuleSummary, Version } from "../../types";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { usePagedResource } from "../../hooks/usePagedResource";
import {
  searchDelayMs,
  useDebouncedValue,
} from "../../hooks/useDebouncedValue";
import { ruleApi } from "../../api/rules";
import {
  curlExample,
  parseExecutionInputs,
  sampleInputsJson,
  tryParseExecutionInputs,
} from "../../domain/executionInputs";
import { useExecutionRequest } from "./useExecutionRequest";
import { useInputBuffer } from "./useInputBuffer";

/** The sample rule the playground opens with when it is published. */
const defaultRuleId = "order-pricing";

function sampleText(definition: Definition | undefined): string {
  return definition ? sampleInputsJson(definition) : "{}";
}

/**
 * The selection after a catalog page arrives: with nothing selected, the sample
 * rule or else the first published rule; otherwise the page's summary of the
 * selected rule when it shows a newer release.
 */
function selectionAfterCatalogPage(
  current: RuleSummary | null,
  page: RuleSummary[],
): RuleSummary | null {
  if (!current)
    return page.find((rule) => rule.id === defaultRuleId) ?? page[0] ?? null;
  const listed = page.find((rule) => rule.id === current.id);
  const newer =
    (listed?.publishedVersion ?? 0) > (current.publishedVersion ?? 0);
  return listed && newer ? listed : current;
}

export function usePublishedExecution(
  rules: RuleSummary[],
  notify: (message: string) => void,
) {
  const [search, setSearch] = useState("");
  const [retry, setRetry] = useState(0);
  const [selectedRule, setSelectedRule] = useState<RuleSummary | null>(null);
  const [pinnedVersion, setPinnedVersion] = useState<number | null>(null);
  const [trace, setTrace] = useState(true);
  const [timeoutMs, setTimeoutMs] = useState(30000);
  const query = useDebouncedValue(search, searchDelayMs);
  const libraryReleases = rules.map((rule) => [
    rule.id,
    rule.revision,
    rule.publishedVersion,
  ]);
  // A new search starts at the first page; a library change or Retry reloads
  // the page that is shown.
  const catalog = usePagedResource(
    query,
    (offset, limit, signal) =>
      ruleApi.catalog(
        { offset, limit, search: query, publishedOnly: true },
        { signal },
      ),
    true,
    { refresh: JSON.stringify([libraryReleases, retry]), keepPrevious: true },
  );
  // Until the typed search applies, the shown page answers an older search.
  const catalogLoading = catalog.loading || query !== search;
  const catalogRules = catalog.data.items;
  useEffect(() => {
    setSelectedRule((current) =>
      selectionAfterCatalogPage(current, catalogRules),
    );
  }, [catalogRules]);
  const id = selectedRule?.id ?? "";
  // The library list can lag behind the catalog, and the reverse.
  const listedVersion = Math.max(
    rules.find((rule) => rule.id === id)?.publishedVersion ?? 0,
    selectedRule?.publishedVersion ?? 0,
  );
  const history = usePagedResource(
    id,
    (offset, limit, signal) =>
      ruleApi.versionSummaries(id, { offset, limit }, { signal }),
    !!id,
    { refresh: JSON.stringify([listedVersion, retry]) },
  );
  const newestOnPage =
    history.offset === 0 ? (history.data.items[0]?.version ?? 0) : 0;
  // History can reveal a release the summaries do not show yet. It is kept
  // apart from the history key, so learning it does not read history again.
  const [historyNewest, setHistoryNewest] = useState({ id: "", version: 0 });
  useEffect(() => {
    if (newestOnPage === 0) return;
    setHistoryNewest((current) =>
      current.id === id && current.version >= newestOnPage
        ? current
        : { id, version: newestOnPage },
    );
  }, [id, newestOnPage]);
  const newestVersion = Math.max(
    listedVersion,
    newestOnPage,
    historyNewest.id === id ? historyNewest.version : 0,
  );
  const version = pinnedVersion ?? (newestVersion || null);
  const loadVersion = (signal: AbortSignal) =>
    version === null
      ? Promise.resolve(null)
      : ruleApi.version(id, version, { signal });
  const detail = useAsyncResource<Version | null>(
    JSON.stringify([id, version, retry]),
    loadVersion,
    null,
    0,
    !!id && version !== null,
  );
  const definition = detail.data?.definition;
  // Inputs typed for one rule version stay with it.
  const inputBuffer = useInputBuffer(
    JSON.stringify([id, version]),
    sampleText(definition),
  );
  const inputs = inputBuffer.text;
  const execution = useExecutionRequest(
    JSON.stringify([id, version, inputs, trace, timeoutMs]),
  );
  const { result, running, requestDurationMs } = execution;
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
  // Invalid JSON stays editable; the cURL example then sends empty inputs.
  const curlInputs = tryParseExecutionInputs(inputs);
  const curl = curlExample(
    ruleApi.executeUrl(id || defaultRuleId),
    curlInputs,
    version,
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
    inputsAreObject: curlInputs !== null,
    result,
    running,
    error,
    loadError,
    loading: detail.loading,
    requestDurationMs,
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
