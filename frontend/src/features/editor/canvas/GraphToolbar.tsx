import { useState } from "react";
import {
  Button,
  CircularProgress,
  IconButton,
  Menu,
  MenuItem,
  Tooltip,
} from "@mui/material";
import {
  CheckCheck,
  ChevronDown,
  Download,
  GitBranch,
  LayoutGrid,
  ListTree,
  Plus,
} from "lucide-react";
import { NodeIcon } from "../../../components/Icons";
import type { NodeType } from "../../../types";
import { MAX_NODES } from "../../../domain/limits";
import { addableNodeTypes, nodeKinds } from "../../../domain/nodeKinds";
import type { EditorCapabilities } from "../editorCapabilities";

export default function GraphToolbar({
  nodeCount,
  canAddNode,
  readOnly,
  capabilities: can,
  arranging,
  outline,
  onToggleOutline,
  onArrange,
  onExport,
  onValidate,
  onAddNode,
}: {
  nodeCount: number;
  /** False once the draft holds the maximum number of nodes. */
  canAddNode: boolean;
  /** A published version: no editing controls are offered. */
  readOnly: boolean;
  capabilities: EditorCapabilities;
  arranging: boolean;
  outline: boolean;
  onToggleOutline: () => void;
  onArrange: () => Promise<void>;
  onExport: () => void;
  onValidate: () => Promise<void>;
  onAddNode: (type: NodeType) => void;
}) {
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null);
  return (
    <div className="graph-toolbar">
      <div className="graph-view-label">
        <GitBranch size={16} />
        <strong>Decision canvas</strong>
        <span>{nodeCount} nodes</span>
      </div>
      <div className="graph-tools">
        <Tooltip title="Node outline">
          <IconButton
            aria-label="Node outline"
            onClick={onToggleOutline}
            color={outline ? "primary" : "default"}
          >
            <ListTree size={17} />
          </IconButton>
        </Tooltip>
        <Tooltip title="Arrange graph · reduce crossings using branch exit positions">
          <span>
            <IconButton
              aria-label="Arrange graph"
              disabled={!can.arrange}
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
      <Menu
        anchorEl={addAnchor}
        open={!!addAnchor}
        onClose={() => setAddAnchor(null)}
      >
        {addableNodeTypes.map((type) => (
          <MenuItem
            key={type}
            disabled={!can.edit}
            onClick={() => {
              onAddNode(type);
              setAddAnchor(null);
            }}
          >
            <span className={`node-icon ${nodeKinds[type].className}`}>
              <NodeIcon type={type} />
            </span>
            <span style={{ marginLeft: 10 }}>{nodeKinds[type].label}</span>
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}
