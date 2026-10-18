import { Menu, MenuItem } from "@mui/material";
import type { NodeType } from "../../../types";
import { NodeIcon } from "../../../components/Icons";
import { addableNodeTypes, nodeKinds } from "../../../domain/nodeKinds";

/**
 * The kinds a user adds, in the Add node menu's order: the toolbar adds one on
 * the canvas, a card's exit adds one connected after that exit.
 */
export default function NodeKindMenu({
  anchor,
  label,
  disabled,
  onChoose,
  onClose,
}: {
  anchor: HTMLElement | null;
  /** Names the list, e.g. "Add after Check · True". */
  label: string;
  disabled: boolean;
  onChoose: (type: NodeType) => void;
  onClose: () => void;
}) {
  return (
    <Menu
      anchorEl={anchor}
      open={!!anchor}
      onClose={onClose}
      slotProps={{ list: { "aria-label": label } }}
    >
      {addableNodeTypes.map((type) => (
        <MenuItem
          key={type}
          disabled={disabled}
          onClick={() => {
            onClose();
            onChoose(type);
          }}
        >
          <span className={`node-icon ${nodeKinds[type].className}`}>
            <NodeIcon type={type} />
          </span>
          <span className="node-kind-option">{nodeKinds[type].label}</span>
        </MenuItem>
      ))}
    </Menu>
  );
}
