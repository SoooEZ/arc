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

/** Records the entry's position, and rewrites its route when `url` is given. */
function recordPosition(position: number, url?: string) {
  const state: unknown = window.history.state;
  const kept = typeof state === "object" && state !== null ? state : {};
  window.history.replaceState({ ...kept, arcEntry: position }, "", url);
}

export function useWorkspaceNavigation() {
  const [route, setRoute] = useState(currentRoute);
  const [ruleDirty, setRuleDirty] = useState(false);
  const dirty = useRef(ruleDirty);
  dirty.current = ruleDirty;
  // Listeners read the shown route and its history position without re-subscribing.
  // `pushed` tells a fresh entry (link, typed URL) from one reached by Back or Forward.
  const shown = useRef({ route, position: 0, pushed: false });
  // navigate() has already confirmed this route; its hashchange must not ask again.
  const confirmed = useRef<string | null>(null);
  // redirect() has stepped back and awaits the hashchange: the refusing
  // document renders again in between, and a second step would leave the rule.
  const correcting = useRef(false);

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
    shown.current = {
      route: currentRoute(),
      position: position ?? 0,
      pushed: false,
    };
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
      correcting.current = false;
      const next = currentRoute();
      const recorded = recordedPosition();
      // An entry without a position was just pushed after the shown one.
      const position = recorded ?? shown.current.position + 1;
      if (recorded === null) recordPosition(position);
      const from = shown.current.route;
      const alreadyConfirmed = confirmed.current === next;
      confirmed.current = null;
      if (next === from) {
        shown.current = { route: next, position, pushed: recorded === null };
        return;
      }
      const warning = alreadyConfirmed ? null : warningFor(next);
      if (warning && !window.confirm(warning)) {
        returnTo(from, shown.current.position - position);
        return;
      }
      if (!sameRuleDocument(from, next)) setRuleDirty(false);
      shown.current = { route: next, position, pushed: recorded === null };
      setRoute(next);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [warningFor]);

  useEffect(() => {
    // A traversal between two entries of the shown route fires no hashchange:
    // a refused arrival rewrote one of them in place (lesson F24). A Back or
    // Forward press would show nothing, so the position is re-read and the
    // traversal goes on in its direction to the next entry that differs. A
    // jump from the history menu to an entry several steps away chose that
    // entry, which shows this route: going on overshot it.
    const traversed = () => {
      const recorded = recordedPosition();
      if (recorded === null || currentRoute() !== shown.current.route) return;
      const previous = shown.current.position;
      if (recorded === previous) return;
      shown.current = { ...shown.current, position: recorded };
      if (Math.abs(recorded - previous) === 1)
        window.history.go(Math.sign(recorded - previous));
    };
    window.addEventListener("popstate", traversed);
    return () => window.removeEventListener("popstate", traversed);
  }, []);

  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (!dirty.current && !activeNavigationGuards().length) return;
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, []);

  /**
   * Also updates what navigate() reads at once, so a document that reports
   * itself clean, e.g. after deleting its rule, can leave in the same call.
   */
  const setDirty = useCallback((value: boolean) => {
    dirty.current = value;
    setRuleDirty(value);
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
  /**
   * Corrects an arrival the shown document refuses (unbuilt code at the graph
   * route, an invalid default at the code route): never asks and never adds an
   * entry. A just-pushed entry is undone with history.go(-1), as a cancelled
   * traversal is (lesson F24); the previous entry is the document's other view,
   * because the refusing state only exists inside that document's session. An
   * entry reached by Back or Forward is rewritten to `path` in place, so the
   * next Back continues past the rule instead of returning to the refused view.
   * While the step back is pending, a repeated call changes nothing.
   */
  const redirect = useCallback((path: string) => {
    const { route, position, pushed } = shown.current;
    if (route === path || correcting.current) return;
    if (pushed && position > 0) {
      correcting.current = true;
      confirmed.current = path;
      window.history.go(-1);
      return;
    }
    recordPosition(position, `#${path}`);
    shown.current = { route: path, position, pushed };
    setRoute(path);
  }, []);
  return { route, navigate, redirect, setDirty };
}
