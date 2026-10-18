import { useState } from "react";
import {
  Button,
  CircularProgress,
  IconButton,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
} from "@mui/material";
import {
  ArrowDown,
  ArrowRight,
  CheckCheck,
  ChevronDown,
  Download,
  GitBranch,
  LayoutGrid,
  ListTree,
  Plus,
  Redo2,
  Undo2,
} from "lucide-react";
import type { NodeType } from "../../../types";
import { MAX_NODES } from "../../../domain/limits";
import type { LayoutDirection } from "../../../domain/nodePorts";
import type { EditorCapabilities } from "../editorCapabilities";
import NodeKindMenu from "./NodeKindMenu";

/** The drawing directions in toolbar order, with their names and icons. */
const directions = [
  { value: "vertical", label: "Top to bottom", Icon: ArrowDown },
  { value: "horizontal", label: "Left to right", Icon: ArrowRight },
] as const;

export default function GraphToolbar({
  nodeCount,
  canAddNode,
  readOnly,
  capabilities: can,
  arranging,
  direction,
  onDirectionChange,
  outline,
  onToggleOutline,
  onArrange,
  onExport,
  onValidate,
  onAddNode,
  undoable,
  redoable,
  onUndo,
  onRedo,
}: {
  nodeCount: number;
  /** False once the draft holds the maximum number of nodes. */
  canAddNode: boolean;
  /** A published version: no editing controls are offered. */
  readOnly: boolean;
  capabilities: EditorCapabilities;
  arranging: boolean;
  direction: LayoutDirection;
  onDirectionChange: (direction: LayoutDirection) => void;
  outline: boolean;
  onToggleOutline: () => void;
  onArrange: () => Promise<void>;
  onExport: () => void;
  onValidate: () => Promise<void>;
  onAddNode: (type: NodeType) => void;
  /** Undo or Redo has a step to take now. */
  undoable: boolean;
  redoable: boolean;
  onUndo: () => void;
  onRedo: () => void;
}) {
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="graph-toolbar">
      <div className="graph-view-label">
        <GitBranch size={16} />
        <strong>Decision canvas</strong>
        <span>
          {nodeCount} {nodeCount === 1 ? "node" : "nodes"}
        </span>
      </div>
      <div className="graph-tools">
        {!readOnly && (
          <>
            <Tooltip title="Undo · ⌘/Ctrl Z">
              <span>
                <IconButton
                  aria-label="Undo"
                  disabled={!undoable}
                  onClick={onUndo}
                >
                  <Undo2 size={16} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Redo · ⌘/Ctrl Shift Z">
              <span>
                <IconButton
                  aria-label="Redo"
                  disabled={!redoable}
                  onClick={onRedo}
                >
                  <Redo2 size={16} />
                </IconButton>
              </span>
            </Tooltip>
            <span className="tool-divider" />
          </>
        )}
        <Tooltip title="Node outline">
          <IconButton
            aria-label="Node outline"
            onClick={onToggleOutline}
            color={outline ? "primary" : "default"}
          >
            <ListTree size={17} />
          </IconButton>
        </Tooltip>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={direction}
          aria-label="Graph direction"
          className="graph-direction"
          onChange={(_, value) => {
            const chosen = directions.find((option) => option.value === value);
            if (chosen) onDirectionChange(chosen.value);
          }}
        >
          {directions.map(({ value, label, Icon }) => (
            <ToggleButton key={value} value={value} aria-label={label}>
              <Tooltip title={label}>
                <Icon size={15} />
              </Tooltip>
            </ToggleButton>
          ))}
        </ToggleButtonGroup>
        <Tooltip
          title={
            direction === "vertical"
              ? "Arrange graph · reduce crossings using branch exit positions"
              : "Left to right arranges itself; Arrange graph works top to bottom"
          }
        >
          <span>
            <IconButton
              aria-label="Arrange graph"
              disabled={!can.arrange || direction !== "vertical"}
              onClick={onArrange}
            >
              {arranging ? (
                <CircularProgress size={16} />
              ) : (
                <LayoutGrid size={16} />
              )}
            </IconButton>
          </span>
        </Tooltip>
        <Tooltip title="Export definition">
          <IconButton aria-label="Export definition" onClick={onExport}>
            <Download size={16} />
          </IconButton>
        </Tooltip>
        <Button
          size="small"
          startIcon={<CheckCheck size={15} />}
          onClick={onValidate}
          disabled={!can.validate}
        >
          Validate
        </Button>
        {!readOnly && (
          <Tooltip
            title={canAddNode ? "" : `A draft holds at most ${MAX_NODES} nodes`}
          >
            <span>
              <Button
                size="small"
                variant="outlined"
                startIcon={<Plus size={15} />}
                endIcon={<ChevronDown size={13} />}
                disabled={!can.edit || !canAddNode}
                onClick={(event) => setAddAnchor(event.currentTarget)}
              >
                Add node
              </Button>
            </span>
          </Tooltip>
        )}
      </div>
      <NodeKindMenu
        anchor={addAnchor}
        label="Node kinds"
        disabled={!can.edit}
        onChoose={onAddNode}
        onClose={() => setAddAnchor(null)}
      />
    </div>
  );
}
