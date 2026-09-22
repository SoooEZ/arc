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
import { nodeLabel, type NodeType } from "../../../types";

const addableNodes: NodeType[] = [
  "FORMULA",
  "CONDITION",
  "SWITCH",
  "TRANSFORM",
  "REFERENCE",
  "OUTPUT",
];

export default function GraphToolbar({
  nodeCount,
  readOnly,
  busy,
  outline,
  onToggleOutline,
  onArrange,
  onExport,
  onValidate,
  onAddNode,
}: {
  nodeCount: number;
  readOnly: boolean;
  busy: string;
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
              disabled={readOnly || !!busy}
              onClick={onArrange}
            >
              {busy === "layout" ? (
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
          disabled={!!busy}
        >
          Validate
        </Button>
        {!readOnly && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<Plus size={15} />}
            endIcon={<ChevronDown size={13} />}
            disabled={!!busy}
            onClick={(event) => setAddAnchor(event.currentTarget)}
          >
            Add node
          </Button>
        )}
      </div>
      <Menu
        anchorEl={addAnchor}
        open={!!addAnchor}
        onClose={() => setAddAnchor(null)}
      >
        {addableNodes.map((type) => (
          <MenuItem
            key={type}
            disabled={readOnly || !!busy}
            onClick={() => {
              onAddNode(type);
              setAddAnchor(null);
            }}
          >
            <span className={`node-icon ${type.toLowerCase()}`}>
              <NodeIcon type={type} />
            </span>
            <span style={{ marginLeft: 10 }}>{nodeLabel[type]}</span>
          </MenuItem>
        ))}
      </Menu>
    </div>
  );
}
