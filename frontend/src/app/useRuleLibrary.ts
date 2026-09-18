import { useCallback, useEffect, useState } from "react";
import { ruleApi } from "../api/rules";
import { errorMessage } from "../api/errors";
import type { Rule } from "../types";
export function useRuleLibrary() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const load = useCallback(async () => {
    setLoadError("");
    try {
      setRules(await ruleApi.list());
    } catch (error) {
      setLoadError(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  const upsert = useCallback(
    (rule: Rule) =>
      setRules((current) => [
        rule,
        ...current.filter((item) => item.id !== rule.id),
      ]),
    [],
  );
  return { rules, loading, loadError, load, upsert };
}
