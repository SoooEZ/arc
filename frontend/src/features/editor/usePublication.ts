import { useEffect, useMemo, useState } from "react";
import type { Definition, Rule } from "../../types";
import { readRuleVersion } from "../../app/pinnedVersions";
import { editableDraft, sameDefinition } from "../../domain/definitionEchoes";

/**
 * How the draft relates to the rule's latest published version: never
 * published; the same, positions included, as the library's "Unpublished
 * changes" counts them; changed since; or unknown while that version loads or
 * after its read failed.
 */
export type Publication =
  | { state: "unpublished" }
  | { state: "current" | "changed" | "unknown"; version: number };

/** The header's publication status of the editor's draft; `enabled` is false for a shown version. */
export function usePublication(rule: Rule, enabled: boolean): Publication {
  const { id, createdAt, publishedVersion: version } = rule;
  const key = `${id}@${createdAt}:${version}`;
  const [latest, setLatest] = useState<{
    key: string;
    definition: Definition;
  } | null>(null);
  useEffect(() => {
    if (!enabled || version === null) return;
    const controller = new AbortController();
    readRuleVersion({ id, createdAt }, version, controller.signal).then(
      (read) =>
        setLatest({
          key: `${id}@${createdAt}:${version}`,
          definition: editableDraft(read.definition),
        }),
      // A failed read leaves the status unknown: the header names the version alone.
      () => undefined,
    );
    return () => controller.abort();
  }, [enabled, id, createdAt, version]);
  const definition = latest?.key === key ? latest.definition : null;
  const same = useMemo(
    () => (definition ? sameDefinition(definition, rule.draft) : null),
    [definition, rule.draft],
  );
  if (version === null) return { state: "unpublished" };
  if (same === null) return { state: "unknown", version };
  return { state: same ? "current" : "changed", version };
}
