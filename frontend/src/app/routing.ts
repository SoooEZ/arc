/** Hash routing keeps static hosting simple while giving navigation one owner. */
export function parseRoute(route: string) {
  const [path, query] = route.split("?");
  const parameters = new URLSearchParams(query);
  const match = /^\/(rules|studio)\/([^/]+)$/.exec(path);
  return {
    path,
    ruleId: match?.[2] ?? null,
    mode: match?.[1] === "studio" ? ("code" as const) : ("graph" as const),
    version: Number(parameters.get("version")) || null,
    node: parameters.get("node"),
  };
}
export function sameRuleDocument(first: string, second: string): boolean {
  const a = parseRoute(first),
    b = parseRoute(second);
  return !!a.ruleId && a.ruleId === b.ruleId && a.version === b.version;
}
