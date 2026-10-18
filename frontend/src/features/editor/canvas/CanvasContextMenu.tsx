import { ListItemIcon, ListItemText, Menu, MenuItem } from "@mui/material";
import { Pencil, TextCursorInput, Trash2 } from "lucide-react";
import type { Definition } from "../../../types";
import { canRemoveGraphNode } from "../../../domain/graph";

/** Where a right-click opened the menu: a card or a connection, and the point. */
export interface CanvasMenuTarget {
  kind: "node" | "edge";
  id: string;
  left: number;
  top: number;
}

/**
 * The canvas's right-click menu: Rename, Edit and Delete for a card, Delete
 * for a connection. A target that left the draft shows no menu. Each action
 * closes the menu before it runs.
 */
export default function CanvasContextMenu({
  target,
  definition,
  canEdit,
  onClose,
  onRenameNode,
  onEditNode,
  onDeleteNode,
  onDeleteEdge,
}: {
  target: CanvasMenuTarget | null;
  definition: Definition;
  canEdit: boolean;
  onClose: () => void;
  onRenameNode: (id: string) => void;
  onEditNode: (id: string) => void;
  onDeleteNode: (id: string) => void;
  onDeleteEdge: (id: string) => void;
}) {
  const node =
    target?.kind === "node"
      ? definition.nodes.find((candidate) => candidate.id === target.id)
      : undefined;
  const edge =
    target?.kind === "edge"
      ? definition.edges.find((candidate) => candidate.id === target.id)
      : undefined;
  const removable = node ? canRemoveGraphNode(definition, node.id) : !!edge;
  const run = (action: () => void) => {
    onClose();
    action();
  };
  return (
    <Menu
      open={!!target && (!!node || !!edge)}
      onClose={onClose}
      anchorReference="anchorPosition"
      anchorPosition={
        target ? { left: target.left, top: target.top } : undefined
      }
      slotProps={{
        list: {
          "aria-label":
            target?.kind === "edge" ? "Connection actions" : "Node actions",
        },
      }}
    >
      {node && (
        <MenuItem
          disabled={!canEdit}
          onClick={() => run(() => onRenameNode(node.id))}
        >
          <ListItemIcon>
            <TextCursorInput size={16} />
          </ListItemIcon>
          <ListItemText>Rename</ListItemText>
        </MenuItem>
      )}
      {node && (
        <MenuItem
          disabled={!canEdit}
          onClick={() => run(() => onEditNode(node.id))}
        >
          <ListItemIcon>
            <Pencil size={16} />
          </ListItemIcon>
          <ListItemText>Edit</ListItemText>
        </MenuItem>
      )}
      <MenuItem
        disabled={!canEdit || !removable}
        onClick={() =>
          run(() => {
            if (node) onDeleteNode(node.id);
            else if (edge) onDeleteEdge(edge.id);
          })
        }
      >
        <ListItemIcon>
          <Trash2 size={16} />
        </ListItemIcon>
        <ListItemText>Delete</ListItemText>
      </MenuItem>
    </Menu>
  );
}
