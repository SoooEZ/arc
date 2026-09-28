import { Alert, Button } from "@mui/material";
import type { RuleNode } from "../../../types";
import {
  nodeKinds,
  propertyNames,
  unusedProperties,
} from "../../../domain/nodeKinds";
import { listed } from "../../../domain/text";

/**
 * Names the properties a node sets although its kind does not use them. The
 * server rejects the graph until they are gone, so an editable draft offers to
 * remove them; a published version keeps them and points to the draft.
 */
export default function UnusedProperties({
  node,
  readOnly,
  onRemove,
}: {
  node: RuleNode;
  readOnly: boolean;
  onRemove: () => void;
}) {
  const unused = unusedProperties(node);
  if (!unused.length) return null;
  const kind = nodeKinds[node.type].label;
  const names = listed(unused.map((property) => propertyNames[property]));
  return (
    <Alert
      severity="error"
      className="inspector-unused-properties"
      action={
        readOnly ? undefined : (
          <Button color="inherit" size="small" onClick={onRemove}>
            Remove
          </Button>
        )
      }
    >
      This {kind} node also sets {names}, which {kind} nodes do not use. Saving,
      publishing and running reject it until they are removed from the draft.
    </Alert>
  );
}
