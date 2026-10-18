import {
  createContext,
  memo,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import {
  BaseEdge,
  Position,
  type ConnectionLineComponentProps,
  type EdgeProps,
} from "@xyflow/react";
import type { LayoutDirection } from "../../../domain/nodePorts";
import {
  routeEdge,
  routeWithCache,
  type CachedRoute,
  type MovedCard,
  type PortSide,
  type RoutingNode,
} from "./edgeRouting";

export const RoutingContext = createContext<{
  nodes: RoutingNode[];
  /** The cards a drag in progress has moved, or null between drags. */
  moved: MovedCard[] | null;
  reportBlocked: (id: string, blocked: boolean) => void;
  /** Exits leave a card's bottom (right) edge and enter the next card's top (left) edge. */
  direction: LayoutDirection;
}>({ nodes: [], moved: null, reportBlocked: () => {}, direction: "vertical" });

/** The card edges a connection leaves and enters in each drawing direction. */
const connectionSides: Record<
  LayoutDirection,
  { source: PortSide; target: PortSide }
> = {
  vertical: { source: "bottom", target: "top" },
  horizontal: { source: "right", target: "left" },
};

/** The card edge of a React Flow handle position. */
const sideOf: Record<Position, PortSide> = {
  [Position.Top]: "top",
  [Position.Bottom]: "bottom",
  [Position.Left]: "left",
  [Position.Right]: "right",
};

export default memo(function RoutedEdge(props: EdgeProps) {
  const { nodes, moved, reportBlocked, direction } = useContext(RoutingContext);
  const sides = connectionSides[direction];
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
  // While a card is dragged, only the edges the moved card can affect are
  // routed again; the drag's end routes every edge once more. The entry is
  // committed with the render that used it: a render React discards (or
  // repeats in StrictMode) leaves the cache as it was.
  const cache = useRef<CachedRoute | undefined>(undefined);
  const cached = useMemo(
    () =>
      routeWithCache(
        cache.current,
        { x: sourceX, y: sourceY, nodeId: source, side: sides.source },
        { x: targetX, y: targetY, nodeId: target, side: sides.target },
        nodes,
        moved,
      ),
    [source, target, sourceX, sourceY, targetX, targetY, nodes, moved, sides],
  );
  useEffect(() => {
    cache.current = cached;
  }, [cached]);
  const route = cached.route;
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
          side: sideOf[fromPosition],
        },
        {
          x: toX,
          y: toY,
          nodeId: toNode?.id,
          side: sideOf[toPosition],
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
