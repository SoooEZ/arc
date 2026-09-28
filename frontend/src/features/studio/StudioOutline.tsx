import type { Definition, RuleNode } from "../../types";
import { nodeKinds } from "../../domain/nodeKinds";

/** A path ends at nodes without exits; the outline marks them like a result. */
const endsPath = (node: RuleNode) => nodeKinds[node.type].exits === "none";

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
          <span className={`status-dot ${endsPath(node) ? "published" : ""}`} />
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
