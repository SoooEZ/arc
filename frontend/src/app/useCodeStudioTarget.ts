import { useEffect, useRef, useState } from "react";
import { ruleApi } from "../api/rules";
import { errorMessage } from "../api/errors";
import { rulePath } from "./routing";

/**
 * Opens Code studio for the rule in view, else the last rule opened in this
 * session, else the most recently updated rule. The library's search, kind
 * filter and page never choose the target; an empty workspace creates a rule.
 */
export function useCodeStudioTarget({
  route,
  routeRuleId,
  openedRuleId,
  navigate,
  createRule,
  notify,
}: {
  /** The current route; a lookup started on another route is abandoned. */
  route: string;
  routeRuleId: string | null;
  /** A rule whose detail has loaded, so it is known to exist. */
  openedRuleId: string | null;
  navigate: (path: string) => void;
  createRule: () => void;
  notify: (message: string) => void;
}) {
  const [lastOpened, setLastOpened] = useState<string | null>(null);
  if (openedRuleId && openedRuleId !== lastOpened) setLastOpened(openedRuleId);
  const lookup = useRef<AbortController | null>(null);
  useEffect(() => () => lookup.current?.abort(), [route]);

  /** A deleted rule is no longer a target. */
  const forget = (ruleId: string) =>
    setLastOpened((last) => (last === ruleId ? null : last));

  const open = async () => {
    const known = routeRuleId ?? lastOpened;
    if (known) {
      navigate(rulePath({ ruleId: known, mode: "code" }));
      return;
    }
    if (lookup.current && !lookup.current.signal.aborted) return;
    const controller = new AbortController();
    lookup.current = controller;
    try {
      const latest = await ruleApi.catalog(
        { offset: 0, limit: 1 },
        { signal: controller.signal },
      );
      if (controller.signal.aborted) return;
      const [newest] = latest.items;
      if (newest) navigate(rulePath({ ruleId: newest.id, mode: "code" }));
      else createRule();
    } catch (failure) {
      if (!controller.signal.aborted)
        notify(`Could not open Code studio: ${errorMessage(failure)}`);
    } finally {
      if (lookup.current === controller) lookup.current = null;
    }
  };
  return { open, forget };
}
