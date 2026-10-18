import { Alert, CircularProgress } from "@mui/material";
import type { Rule, RuleCaller } from "../../../types";
import { ruleApi } from "../../../api/rules";
import { rulePath } from "../../../app/routing";
import { listed } from "../../../domain/text";
import {
  paginationProps,
  usePagedResource,
} from "../../../hooks/usePagedResource";
import CatalogPagination from "../../../components/CatalogPagination";

/** "Draft uses v1", or that it calls the rule without a version picked yet. */
function usesText(subject: string, pins: readonly number[]): string {
  if (!pins.length) return `${subject} calls it without a chosen version`;
  return `${subject} uses ${listed(pins.map((version) => `v${version}`))}`;
}

/**
 * What a caller runs of this rule: the versions its draft and its latest
 * published version pin, and the earlier versions that call it too. A draft
 * whose pins are all older than the latest says so.
 */
function callerUses(caller: RuleCaller, latest: number | null): string[] {
  const lines: string[] = [];
  const draft = caller.draftPins;
  if (draft) {
    const behind =
      latest !== null && draft.length > 0 && draft.every((pin) => pin < latest);
    lines.push(
      usesText("Draft", draft) + (behind ? ` (v${latest} is the latest)` : ""),
    );
  }
  if (caller.published)
    lines.push(
      usesText(`Published v${caller.published.version}`, caller.published.pins),
    );
  if (caller.earlierVersions)
    lines.push(
      caller.earlierVersions === 1
        ? "1 earlier version calls it too"
        : `${caller.earlierVersions} earlier versions call it too`,
    );
  return lines;
}

/**
 * The other rules that call this one (`GET /rules/{id}/callers`), each with
 * the versions it runs and a link to open it. A pinned call keeps running its
 * version, so these are the rules to update after publishing a new one.
 */
export default function RuleCallers({
  rule,
  navigate,
}: {
  rule: Pick<Rule, "id" | "createdAt" | "publishedVersion">;
  navigate: (path: string) => void;
}) {
  const page = usePagedResource(
    `${rule.id}@${rule.createdAt}`,
    (offset, limit, signal) =>
      ruleApi.callers(rule.id, { offset, limit }, { signal }),
  );
  const {
    data: { items, total },
    error,
    loading,
  } = page;
  return (
    <section
      className="rule-settings-section rule-callers"
      aria-label="Used by"
    >
      <h3 className="rule-settings-heading">Used by</h3>
      {loading && (
        <span className="inline-status">
          <CircularProgress size={13} /> Finding the rules that call it…
        </span>
      )}
      {error && (
        <Alert severity="error">
          Could not read the rules that call this rule: {error}
        </Alert>
      )}
      {!loading && !error && !total && (
        <span className="inline-status">No other rule calls this rule.</span>
      )}
      {items.length > 0 && (
        <ul>
          {items.map((caller) => (
            <li key={caller.ruleId}>
              <button
                type="button"
                className="rule-callers-link"
                onClick={() => navigate(rulePath({ ruleId: caller.ruleId }))}
              >
                {caller.name}
              </button>
              {callerUses(caller, rule.publishedVersion).map((line) => (
                <small key={line}>{line}</small>
              ))}
            </li>
          ))}
        </ul>
      )}
      {total > page.limit && (
        <CatalogPagination
          label="Rules calling this rule"
          {...paginationProps(page)}
        />
      )}
    </section>
  );
}
