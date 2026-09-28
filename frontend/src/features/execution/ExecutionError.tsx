import { Alert, Button } from "@mui/material";
import type { ErrorLocation, GraphProblem } from "../../api/errors";
import { isCurrentGraphLocation } from "../../domain/graph";
import type { ReferenceTarget } from "../editor/types";

type ReferencedLocation = ErrorLocation & { ruleId: string; version: number };

export default function ExecutionError({
  error,
  problem,
  shown,
  onNode,
  onOpenReference,
  onEditInputs,
}: {
  error: string;
  problem: GraphProblem | null;
  /** The rule version the editor shows; null version for the draft. */
  shown: { ruleId: string; version: number | null };
  onNode: (id: string) => void;
  onOpenReference: (target: ReferenceTarget) => void;
  onEditInputs: () => void;
}) {
  const locations = problem?.locations ?? [];
  // The engine appends each caller after the location that failed, so the
  // last location in this graph is where the failure surfaced here.
  const local = locations
    .filter((location) => isCurrentGraphLocation(location, shown))
    .slice(-1);
  const referenced = locations.filter(
    (location): location is ReferencedLocation =>
      location.ruleId !== null &&
      location.version !== null &&
      !isCurrentGraphLocation(location, shown),
  );
  return (
    <Alert severity="error">
      {error}
      <div className="error-actions">
        {local.map((location) => (
          <Button
            key={location.nodeId}
            size="small"
            color="inherit"
            onClick={() => onNode(location.nodeId)}
          >
            Show problem · {location.label}
          </Button>
        ))}
        {referenced.map((location, index) => (
          <Button
            key={index}
            size="small"
            color="inherit"
            onClick={() =>
              onOpenReference({
                ruleId: location.ruleId,
                version: location.version,
                nodeId: location.nodeId,
              })
            }
          >
            Open problem · {location.label}
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
