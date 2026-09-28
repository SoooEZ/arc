import { useCallback, useEffect, useRef, useState } from "react";
import { activeNavigationGuards } from "./navigationGuards";
import { leaveWarning, sameRuleDocument } from "./routing";

const currentRoute = () => window.location.hash.slice(1) || "/library";

/*
 * hashchange fires after the browser has already moved to another history
 * entry. Each entry therefore records its position in history.state, so a
 * cancelled Back, Forward or typed URL is undone with history.go(delta).
 * Rewriting the entry instead would duplicate the current route and lose the
 * other one.
 */
function recordedPosition(): number | null {
  const state: unknown = window.history.state;
  if (typeof state !== "object" || state === null || !("arcEntry" in state))
    return null;
  return typeof state.arcEntry === "number" ? state.arcEntry : null;
}

function recordPosition(position: number) {
  const state: unknown = window.history.state;
  const kept = typeof state === "object" && state !== null ? state : {};
  window.history.replaceState({ ...kept, arcEntry: position }, "");
}

export function useWorkspaceNavigation() {
  const [route, setRoute] = useState(currentRoute);
  const [ruleDirty, setRuleDirty] = useState(false);
  const dirty = useRef(ruleDirty);
  dirty.current = ruleDirty;
  // Listeners read the shown route and its history position without re-subscribing.
  const shown = useRef({ route, position: 0 });
  // navigate() has already confirmed this route; its hashchange must not ask again.
  const confirmed = useRef<string | null>(null);

  const warningFor = useCallback(
    (to: string) =>
      leaveWarning({
        from: shown.current.route,
        to,
        ruleDirty: dirty.current,
        guards: activeNavigationGuards({ from: shown.current.route, to }),
      }),
    [],
  );

  useEffect(() => {
    const position = recordedPosition();
    if (position === null) recordPosition(0);
    shown.current = { route: currentRoute(), position: position ?? 0 };
  }, []);

  useEffect(() => {
    const returnTo = (from: string, delta: number) => {
      if (delta === 0) {
        // Unreachable with recorded positions; history.go(0) would reload and drop the draft.
        window.history.replaceState(window.history.state, "", `#${from}`);
        return;
      }
      // The resulting hashchange shows the current route again, which needs no confirmation.
      window.history.go(delta);
    };
    const changed = () => {
      const next = currentRoute();
      const recorded = recordedPosition();
      // An entry without a position was just pushed after the shown one.
      const position = recorded ?? shown.current.position + 1;
      if (recorded === null) recordPosition(position);
      const from = shown.current.route;
      const alreadyConfirmed = confirmed.current === next;
      confirmed.current = null;
      if (next === from) {
        shown.current = { route: next, position };
        return;
      }
      const warning = alreadyConfirmed ? null : warningFor(next);
      if (warning && !window.confirm(warning)) {
        returnTo(from, shown.current.position - position);
        return;
      }
      if (!sameRuleDocument(from, next)) setRuleDirty(false);
      shown.current = { route: next, position };
      setRoute(next);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [warningFor]);

  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (!dirty.current && !activeNavigationGuards().length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);

  /** Asks before the browser moves, so a cancelled navigation creates no history entry. */
  const navigate = useCallback(
    (path: string) => {
      const before = currentRoute();
      if (path === before) return;
      const warning = warningFor(path);
      if (warning && !window.confirm(warning)) return;
      window.location.hash = path;
      // The hashchange reports the browser's spelling of the route, e.g. percent-encoded.
      const after = currentRoute();
      if (after !== before) confirmed.current = after;
    },
    [warningFor],
  );
  return { route, navigate, setDirty: setRuleDirty };
}
