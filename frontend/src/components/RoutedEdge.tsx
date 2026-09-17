import { createContext, memo, useContext, useEffect, useMemo } from "react";
import {
  BaseEdge,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from "@xyflow/react";
import { routeEdge, type RoutingNode } from "../edgeRouting";

export const RoutingContext = createContext<{
  nodes: RoutingNode[];
  reportBlocked: (id: string, blocked: boolean) => void;
}>({ nodes: [], reportBlocked: () => {} });

export default memo(function RoutedEdge(props: EdgeProps) {
  const { nodes, reportBlocked } = useContext(RoutingContext);
  const {
    id,
    source,
    target,
    sourceX,
    sourceY,
    targetX,
    targetY,
    style,
    markerStart,
    markerEnd,
    interactionWidth,
    label,
    labelStyle,
    labelShowBg,
    labelBgStyle,
    labelBgPadding,
    labelBgBorderRadius,
  } = props;
  const route = useMemo(
    () =>
      routeEdge(
        { x: sourceX, y: sourceY, nodeId: source, side: "bottom" },
        { x: targetX, y: targetY, nodeId: target, side: "top" },
        nodes,
      ),
    [source, target, sourceX, sourceY, targetX, targetY, nodes],
  );
  const blocked = !route;
  useEffect(() => {
    reportBlocked(id, blocked);
    return () => reportBlocked(id, false);
  }, [id, blocked, reportBlocked]);
  if (!route) return null;
  return (
    <BaseEdge
      id={id}
      path={route.path}
      style={{ ...style, strokeLinejoin: "round" }}
      markerStart={markerStart}
      markerEnd={markerEnd}
      interactionWidth={interactionWidth}
      label={label}
      labelX={route.label.x}
      labelY={route.label.y}
      labelStyle={labelStyle}
      labelShowBg={labelShowBg}
      labelBgStyle={labelBgStyle}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
  );
});

export function RoutedConnectionLine({
  fromX,
  fromY,
  toX,
  toY,
  fromNode,
  toNode,
  fromPosition,
  toPosition,
  connectionLineStyle,
}: ConnectionLineComponentProps) {
  const { nodes } = useContext(RoutingContext);
  const route = useMemo(
    () =>
      routeEdge(
        {
          x: fromX,
          y: fromY,
          nodeId: fromNode.id,
          side: fromPosition === "top" ? "top" : "bottom",
        },
        {
          x: toX,
          y: toY,
          nodeId: toNode?.id,
          side: toPosition === "bottom" ? "bottom" : "top",
        },
        nodes,
      ),
    [
      fromX,
      fromY,
      toX,
      toY,
      fromNode.id,
      toNode?.id,
      fromPosition,
      toPosition,
      nodes,
    ],
  );
  return route ? (
    <path
      className="react-flow__connection-path"
      d={route.path}
      style={{ stroke: "#569e74", strokeWidth: 1.6, ...connectionLineStyle }}
      fill="none"
    />
  ) : (
    <g className="connection-blocked" transform={`translate(${toX}, ${toY})`}>
      <title>Connection blocked by a node. Move to a free handle.</title>
      <circle r={9} fill="#fff" stroke="#b75d40" />
      <text textAnchor="middle" dy="4" fontSize="12" fill="#b75d40">
        !
      </text>
    </g>
  );
}
