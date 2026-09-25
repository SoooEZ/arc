import { useEffect, useState } from "react";
import { Alert, Button, CircularProgress, Dialog } from "@mui/material";
import { ArrowLeft, X } from "lucide-react";
import { ruleApi } from "../../api/rules";
import type { GraphProblem } from "../../api/errors";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import type { RuleSummary } from "../../types";
import Editor from "./Editor";

import type { ReferenceTarget } from "./types";
export default function ReferenceDialog({
  target,
  rules,
  problems,
  onClose,
}: {
  target: ReferenceTarget;
  rules: RuleSummary[];
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
              {rules.find((r) => r.id === s.ruleId)?.name || s.ruleId}{" "}
              <small>v{s.version}</small>
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
            rules={rules}
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
              const [route, query] = path.split("?");
              const params = new URLSearchParams(query);
              setStack((s) =>
                s.map((entry, i) =>
                  i === s.length - 1
                    ? {
                        ...entry,
                        mode: route.startsWith("/studio/") ? "code" : "graph",
                        version: Number(params.get("version")) || entry.version,
                      }
                    : entry,
                ),
              );
            }}
          />
        )
      )}
    </Dialog>
  );
}
