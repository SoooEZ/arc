import { useId } from "react";
import type { Rule } from "../../types";
import { nodeLabel } from "../../types";
import {
  rulePreview,
  previewNodeHeight,
  previewNodeWidth,
} from "../../domain/rulePreview";

export default function RulePreview({ rule }: { rule: Rule }) {
  const graph = rulePreview(rule.draft);
  const markerId = useId().replaceAll(":", "");
  // At the smallest card width, text must still render at roughly 10px.
  const readable = graph.width <= 380 && graph.height <= 280;
  return (
    <div className="rule-preview">
      <div className="mini-graph">
        {graph.nodes.length ? (
          <svg
            className="rule-preview-svg"
            viewBox={`0 0 ${graph.width} ${graph.height}`}
            style={{
              maxWidth: Math.max(graph.width, 240),
              maxHeight: Math.max(graph.height, 130),
            }}
            role="img"
            aria-label={`${rule.name}: complete graph overview, ${graph.nodes.length} ${graph.nodes.length === 1 ? "node" : "nodes"}, ${graph.connections.length} ${graph.connections.length === 1 ? "connection" : "connections"}`}
            data-detail={readable ? "labels" : "overview"}
          >
            <defs>
              <marker
                id={markerId}
                viewBox="0 0 8 8"
                refX="7"
                refY="4"
                markerWidth="5"
                markerHeight="5"
                orient="auto-start-reverse"
              >
                <path d="M 0 0 L 8 4 L 0 8 z" fill="#879e93" />
              </marker>
            </defs>
            {graph.connections.map(({ edge, path, label, sx, sy }) => (
              <g key={edge.id} data-preview-edge={edge.id}>
                <title>{`${edge.source} → ${edge.target} (${label})`}</title>
                <path
                  d={path}
                  className="preview-connection"
                  markerEnd={`url(#${markerId})`}
                />
                {readable && label && label !== "next" && (
                  <text x={sx + 4} y={sy + 13} className="preview-branch-label">
                    {label}
                  </text>
                )}
              </g>
            ))}
            {graph.nodes.map(({ node, x, y }) => (
              <g
                key={node.id}
                transform={`translate(${x} ${y})`}
                data-preview-node={node.id}
                className={`preview-node preview-node-${node.type.toLowerCase()}`}
              >
                <title>{`${node.label} · ${nodeLabel[node.type]}`}</title>
                <rect
                  width={previewNodeWidth}
                  height={previewNodeHeight}
                  rx="7"
                />
                {readable ? (
                  <>
                    <circle cx="12" cy="20" r="3" />
                    <foreignObject x="22" y="10" width="100" height="20">
                      <div className="preview-node-label">{node.label}</div>
                    </foreignObject>
                  </>
                ) : (
                  <rect
                    className="preview-node-kind"
                    x="10"
                    y="10"
                    width="8"
                    height="20"
                    rx="3"
                  />
                )}
              </g>
            ))}
          </svg>
        ) : (
          <span>No nodes yet</span>
        )}
      </div>
      <div className="rule-preview-caption">
        <span>
          {readable
            ? "Complete draft graph"
            : "Draft overview · open to explore"}
        </span>
        {graph.missingConnections > 0 && (
          <span className="preview-warning">
            {graph.missingConnections} invalid{" "}
            {graph.missingConnections === 1 ? "connection" : "connections"}
          </span>
        )}
      </div>
    </div>
  );
}
