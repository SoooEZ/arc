import { ruleApi } from "../../api/rules";
import { sourceApi } from "../../api/sources";
import type { DataSource, Version } from "../../types";
import { PinnedReads } from "./pinnedReads";

/**
 * Pinned rule versions read by Reference cards and Formula metadata. A rule
 * can be deleted and created again under its ID, so App forgets it here.
 */
export const pinnedRuleVersions = new PinnedReads<Version>();

/** Pinned source versions read by every value-provider card; sources are never deleted. */
export const pinnedSourceVersions = new PinnedReads<DataSource>();

export function readRuleVersion(
  id: string,
  version: number,
  signal?: AbortSignal,
) {
  return pinnedRuleVersions.load(
    `${id}:${version}`,
    (shared) => ruleApi.version(id, version, { signal: shared }),
    signal,
  );
}

export function readSourceVersion(
  id: string,
  version: number,
  signal?: AbortSignal,
) {
  return pinnedSourceVersions.load(
    `${id}:${version}`,
    (shared) => sourceApi.source(id, version, { signal: shared }),
    signal,
  );
}
