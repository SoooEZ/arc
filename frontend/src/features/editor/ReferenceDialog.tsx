import { useEffect, useState } from "react";
import { Alert, Button, CircularProgress, Dialog } from "@mui/material";
import { ArrowLeft, X } from "lucide-react";
import { ruleApi } from "../../api/rules";
import type { GraphProblem } from "../../api/errors";
import { parseRoute, type RuleRoute } from "../../app/routing";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import Editor from "./Editor";

import type { ReferenceTarget } from "./types";

/**
 * The entry after the embedded editor navigated within its rule: the view it
 * asked for, and the version it asked for or the viewer's pinned one.
 */
function withRoute(entry: ReferenceTarget, route: RuleRoute): ReferenceTarget {
  return {
    ...entry,
    mode: route.mode,
    version: route.version ?? entry.version,
  };
}

export default function ReferenceDialog({
  target,
  problems,
  onClose,
}: {
  target: ReferenceTarget;
  problems: GraphProblem[];
  onClose: () => void;
}) {
  const [stack, setStack] = useState<ReferenceTarget[]>([target]);
  const current = stack[stack.length - 1];
  const { data: loaded, error } = useAsyncResource(
    `${current.ruleId}:${current.version}`,
    (signal) => ruleApi.get(current.ruleId, { signal }),
    null,
  );
  // The names the viewer has read; an entry shows its ID until its rule loads.
  const [names, setNames] = useState<ReadonlyMap<string, string>>(
    () => new Map(),
  );
  useEffect(() => {
    if (!loaded) return;
    setNames((known) =>
      known.get(loaded.id) === loaded.name
        ? known
        : new Map(known).set(loaded.id, loaded.name),
    );
  }, [loaded]);
  const [notice, setNotice] = useState("");
  useEffect(() => setNotice(""), [current.ruleId, current.version]);
  return (
    <Dialog
      open
      maxWidth={false}
      fullWidth
      onClose={onClose}
      className="reference-dialog"
      aria-labelledby="reference-viewer-title"
    >
      <span id="reference-viewer-title" className="visually-hidden">
        Referenced rule viewer
      </span>
      <div className="reference-navigation">
        <Button
          startIcon={<ArrowLeft size={16} />}
          disabled={stack.length === 1}
          onClick={() => setStack((s) => s.slice(0, -1))}
        >
          Back
        </Button>
        <div
          className="reference-breadcrumb"
          title={stack.map((s) => `${s.ruleId} v${s.version}`).join(" → ")}
        >
          {stack.map((s, i) => (
            <span key={i}>
              {i > 0 && " / "}
              {names.get(s.ruleId) || s.ruleId} <small>v{s.version}</small>
            </span>
          ))}
        </div>
        <Button startIcon={<X size={16} />} onClick={onClose}>
          Close all
        </Button>
      </div>
      {error && <Alert severity="error">{error}</Alert>}
      {notice && <Alert onClose={() => setNotice("")}>{notice}</Alert>}
      {!error && (!loaded || loaded.id !== current.ruleId) ? (
        <div className="center-state">
          <CircularProgress size={24} />
        </div>
      ) : (
        loaded &&
        !error && (
          <Editor
            key={`${stack.length}:${current.ruleId}:${current.version}`}
            mode={current.mode || "graph"}
            rule={loaded}
            requestedVersion={current.version}
            requestedNode={current.nodeId}
            embedded
            initialProblems={current.problems || problems}
            onSaved={() => {}}
            onDirty={() => {}}
            notify={setNotice}
            onOpenReference={(next, fromNode) =>
              setStack((s) => [
                ...s.slice(0, -1),
                {
                  ...s[s.length - 1],
                  nodeId: fromNode,
                  problems: next.problems,
                },
                next,
              ])
            }
            navigate={(path) => {
              const route = parseRoute(path);
              if (route.page !== "rule") return;
              setStack((s) => [
                ...s.slice(0, -1),
                withRoute(s[s.length - 1], route),
              ]);
            }}
          />
        )
      )}
    </Dialog>
  );
}
