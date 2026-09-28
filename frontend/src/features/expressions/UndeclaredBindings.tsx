import { Alert, Button } from "@mui/material";
import { listed } from "../../domain/text";

/**
 * Names the parameter mappings a binding keeps for parameters its pinned
 * version does not declare (a mapping saved before the pin changed, or an API
 * client's). Validation and publishing reject the draft until they are gone,
 * so an editable draft offers to remove them; a read-only view only names them.
 */
export default function UndeclaredBindings({
  names,
  target,
  readOnly,
  onRemove,
}: {
  names: string[];
  /** What declares the parameters, e.g. "v2 of customer-profile". */
  target: string;
  readOnly: boolean;
  onRemove: () => void;
}) {
  if (!names.length) return null;
  const plural = names.length > 1;
  return (
    <Alert
      severity="error"
      className="undeclared-bindings"
      action={
        readOnly ? undefined : (
          <Button color="inherit" size="small" onClick={onRemove}>
            Remove
          </Button>
        )
      }
    >
      Also maps {listed(names)}, which {target} does not declare. Validation and
      publishing reject {plural ? "them" : "it"} until{" "}
      {plural ? "they are" : "it is"} removed.
    </Alert>
  );
}
