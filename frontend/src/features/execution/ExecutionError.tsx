import { Alert, Button } from "@mui/material";
import type { GraphProblem } from "../../api/errors";
import type { ReferenceTarget } from "../editor/types";

export default function ExecutionError({
  error,
  problem,
  ruleId,
  publishedVersion,
  onNode,
  onOpenReference,
  onEditInputs,
}: {
  error: string;
  problem: GraphProblem | null;
  ruleId: string;
  publishedVersion: number | null;
  onNode: (id: string) => void;
  onOpenReference: (target: ReferenceTarget) => void;
  onEditInputs: () => void;
}) {
  const locations = problem?.locations ?? [];
  return (
    <Alert severity="error">
      {error}
      <div className="error-actions">
        {locations
          .filter(
            (l) =>
              !l.ruleId ||
              l.ruleId === "preview" ||
              (l.ruleId === ruleId && l.version === publishedVersion),
          )
          .slice(-1)
          .map((l) => (
            <Button
              key={l.nodeId}
              size="small"
              color="inherit"
              onClick={() => onNode(l.nodeId)}
            >
              Show problem · {l.label}
            </Button>
          ))}
        {locations
          .filter(
            (l) =>
              l.ruleId &&
              l.ruleId !== "preview" &&
              !(l.ruleId === ruleId && l.version === publishedVersion),
          )
          .map((l, i) => (
            <Button
              key={i}
              size="small"
              color="inherit"
              onClick={() =>
                onOpenReference({
                  ruleId: l.ruleId!,
                  version: l.version!,
                  nodeId: l.nodeId,
                })
              }
            >
              Open problem · {l.label}
            </Button>
          ))}
        {!locations.length && (
          <Button size="small" color="inherit" onClick={onEditInputs}>
            Edit test inputs
          </Button>
        )}
      </div>
    </Alert>
  );
}
