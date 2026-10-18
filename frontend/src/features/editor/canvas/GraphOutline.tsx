import { useEffect } from "react";
import { IconButton } from "@mui/material";
import { X } from "lucide-react";
import { NodeIcon } from "../../../components/Icons";
import type { RuleNode } from "../../../types";

/**
 * Every node, to select one. Escape closes the list unless a dialog or an
 * editor handled the key; it scrolls within the canvas, so a long graph's list
 * never covers the Test panel below.
 */
export default function GraphOutline({
  nodes,
  selected,
  onSelect,
  onClose,
}: {
  nodes: RuleNode[];
  selected: string;
  onSelect: (id: string) => void;
  /** Keeps its identity while the outline is open. */
  onClose: () => void;
}) {
  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      const target = event.target;
      if (target instanceof Element && target.closest('[role="dialog"]'))
        return;
      onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);
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
