import { useCallback, useEffect, useState } from "react";
import { sameRuleDocument } from "./routing";
const currentRoute = () => window.location.hash.slice(1) || "/library";
export function useWorkspaceNavigation() {
  const [route, setRoute] = useState(currentRoute);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    const changed = () => {
      const next = currentRoute();
      if (next === route) return;
      const same = sameRuleDocument(route, next);
      if (
        dirty &&
        !same &&
        !window.confirm(
          "You have unsaved changes. Leave this rule and discard them?",
        )
      ) {
        window.history.replaceState(null, "", `#${route}`);
        return;
      }
      if (!same) setDirty(false);
      setRoute(next);
    };
    window.addEventListener("hashchange", changed);
    return () => window.removeEventListener("hashchange", changed);
  }, [dirty, route]);
  useEffect(() => {
    const leave = (event: BeforeUnloadEvent) => {
      if (dirty) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", leave);
    return () => window.removeEventListener("beforeunload", leave);
  }, [dirty]);
  const navigate = useCallback((path: string) => {
    window.location.hash = path;
  }, []);
  return { route, navigate, setDirty };
}
