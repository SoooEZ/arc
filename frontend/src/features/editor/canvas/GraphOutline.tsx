import { IconButton } from "@mui/material";
import { X } from "lucide-react";
import { NodeIcon } from "../../../components/Icons";
import type { RuleNode } from "../../../types";

export default function GraphOutline({
  nodes,
  selected,
  onSelect,
  onClose,
}: {
  nodes: RuleNode[];
  selected: string;
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="node-outline">
      <div>
        <strong>Node outline</strong>
        <IconButton size="small" aria-label="Close outline" onClick={onClose}>
          <X size={14} />
        </IconButton>
      </div>
      {nodes.map((node, index) => (
        <button
          key={node.id}
          className={selected === node.id ? "selected" : ""}
          onClick={() => onSelect(node.id)}
        >
          <small>{String(index + 1).padStart(2, "0")}</small>
          <NodeIcon type={node.type} size={14} />
          <span>{node.label}</span>
        </button>
      ))}
    </div>
  );
}
