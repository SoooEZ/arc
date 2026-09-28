import { Alert, Button } from "@mui/material";
import type { ErrorLocation, GraphProblem } from "../../api/errors";
import { isCurrentGraphLocation } from "../../domain/graph";
import type { ReferenceTarget } from "../editor/types";

type ReferencedLocation = ErrorLocation & { ruleId: string; version: number };

/**
 * Whether editing the test inputs is a way out of the failure: nothing was
 * located, or it surfaced at this graph's Input node, where caller inputs are
 * checked (source reads and mappings land there too, so the node action stays).
 */
export function offersInputEditing(
  local: { nodeId: string }[],
  locatedAnywhere: boolean,
  inputNodeId: string | null,
): boolean {
  if (!locatedAnywhere) return true;
  return local.some((location) => location.nodeId === inputNodeId);
}

export default function ExecutionError({
  error,
  problem,
  shown,
  inputNodeId,
  onNode,
  onOpenReference,
  onEditInputs,
}: {
  error: string;
  problem: GraphProblem | null;
  /** The rule version the editor shows; null version for the draft. */
  shown: { ruleId: string; version: number | null };
  /** The shown graph's Input node, or null when the draft has none. */
  inputNodeId: string | null;
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
        {offersInputEditing(local, locations.length > 0, inputNodeId) && (
          <Button size="small" color="inherit" onClick={onEditInputs}>
            Edit test inputs
          </Button>
        )}
      </div>
    </Alert>
  );
}
