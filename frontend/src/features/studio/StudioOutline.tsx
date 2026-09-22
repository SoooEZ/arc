import type { Definition } from "../../types";

export default function StudioOutline({
  definition,
  onSelect,
}: {
  definition: Definition;
  onSelect: (nodeId: string) => void;
}) {
  return (
    <aside className="studio-outline">
      <h4>OUTLINE</h4>
      <span>
        {definition.nodes.length} nodes · {definition.edges.length} connections
      </span>
      {definition.nodes.map((node) => (
        <button key={node.id} onClick={() => onSelect(node.id)}>
          <span
            className={`status-dot ${node.type === "OUTPUT" ? "published" : ""}`}
          />
          <span>
            {node.label}
            <small>{node.type.toLowerCase()}</small>
          </span>
        </button>
      ))}
      <p>
        Code and canvas share the same versioned graph. Build to apply code
        changes.
      </p>
    </aside>
  );
}
