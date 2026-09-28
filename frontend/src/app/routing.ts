/** Hash routing keeps static hosting simple while giving navigation one owner. */
export interface RuleRoute {
  page: "rule";
  ruleId: string;
  mode: "graph" | "code";
  version: number | null;
  node: string | null;
}

export type WorkspaceRoute =
  | RuleRoute
  | { page: "library" }
  | { page: "sources" }
  | { page: "playground" }
  | { page: "docs" };

export type WorkspacePage = WorkspaceRoute["page"];

const pagePaths = new Map<string, WorkspaceRoute>([
  ["/library", { page: "library" }],
  ["/sources", { page: "sources" }],
  ["/playground", { page: "playground" }],
  ["/docs", { page: "docs" }],
]);

/** The rule ID written in a path segment, or null when its escapes are malformed. */
function decodedRuleId(segment: string): string | null {
  try {
    return decodeURIComponent(segment);
  } catch {
    return null;
  }
}

export function parseRoute(route: string): WorkspaceRoute {
  const [path, query] = route.split("?");
  const rule = /^\/(rules|studio)\/([^/]+)$/.exec(path);
  const ruleId = rule && decodedRuleId(rule[2]);
  if (rule && ruleId !== null) {
    const parameters = new URLSearchParams(query);
    return {
      page: "rule",
      ruleId,
      mode: rule[1] === "studio" ? "code" : "graph",
      version: Number(parameters.get("version")) || null,
      node: parameters.get("node"),
    };
  }
  // Unknown paths show the library, like the empty default route.
  return pagePaths.get(path) ?? { page: "library" };
}

/**
 * The inverse of `parseRoute` for a rule: the graph or code view of a rule,
 * pinned to a published version and focused on a node when given. IDs are
 * slugs, so today's paths are written unchanged; the encoding keeps the pair a
 * round trip for any ID.
 */
export function rulePath({
  ruleId,
  mode = "graph",
  version = null,
  node = null,
}: {
  ruleId: string;
  mode?: RuleRoute["mode"];
  version?: number | null;
  node?: string | null;
}): string {
  const parameters = new URLSearchParams();
  if (version) parameters.set("version", String(version));
  if (node) parameters.set("node", node);
  const query = parameters.toString();
  const view = mode === "code" ? "studio" : "rules";
  return `/${view}/${encodeURIComponent(ruleId)}${query ? `?${query}` : ""}`;
}

/** The path of a workspace page other than a rule. */
export function pagePath(page: Exclude<WorkspacePage, "rule">): string {
  return `/${page}`;
}

export function sameRuleDocument(first: string, second: string): boolean {
  const a = parseRoute(first),
    b = parseRoute(second);
  return (
    a.page === "rule" &&
    b.page === "rule" &&
    a.ruleId === b.ruleId &&
    a.version === b.version
  );
}

/**
 * Whether a route change closes the open rule editor. The editor session (its
 * draft and pending writes) survives graph/code switches and node selection,
 * and ends when another rule or version opens or another page is shown.
 */
export function leavesRuleDocument({
  from,
  to,
}: {
  from: string;
  to: string;
}): boolean {
  return !sameRuleDocument(from, to);
}

export const unsavedRuleWarning =
  "You have unsaved changes. Leave this rule and discard them?";

/**
 * The confirmation for moving from one route to another, or null when nothing
 * would be discarded. `guards` are the registered guards that apply to this
 * change; the rule draft survives graph/code switches, so only leaving its
 * document asks for it.
 */
export function leaveWarning({
  from,
  to,
  ruleDirty,
  guards,
}: {
  from: string;
  to: string;
  ruleDirty: boolean;
  guards: string[];
}): string | null {
  const warnings = [...guards];
  if (ruleDirty && leavesRuleDocument({ from, to }))
    warnings.push(unsavedRuleWarning);
  return warnings.length ? warnings.join("\n\n") : null;
}
