import { test, expect } from "@playwright/test";
import type { Definition, Execution, RuleNode } from "../../src/types";
import { patchGraphNode } from "../../src/domain/graph";
import {
  cardBounds,
  dragStartBounds,
  flowEdges,
  flowNodes,
  takenBranches,
  type FlowNodeInputs,
} from "../../src/features/editor/canvas/flowElements";
import { nodeKinds } from "../../src/domain/nodeKinds";
import { cardCenter } from "../../src/features/editor/canvas/graphGeometry";
import {
  routeEdge,
  routeWithCache,
  type CachedRoute,
  type Endpoint,
  type MovedCard,
  type RoutingNode,
} from "../../src/features/editor/canvas/edgeRouting";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [{ name: "amount", type: "NUMBER", required: true, defaultValue: 1 }],
  nodes: [
    { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
    {
      id: "check",
      type: "CONDITION",
      label: "Large?",
      expression: "amount > 10",
      position: { x: 0, y: 150 },
    },
    {
      id: "constructor",
      type: "OUTPUT",
      label: "Yes",
      expression: "1",
      position: { x: -150, y: 300 },
    },
    {
      id: "toString",
      type: "OUTPUT",
      label: "No",
      expression: "0",
      position: { x: 150, y: 300 },
    },
  ],
  edges: [
    { id: "a", source: "input", target: "check", sourceHandle: "next" },
    { id: "b", source: "check", target: "constructor", sourceHandle: "true" },
    { id: "c", source: "check", target: "toString", sourceHandle: "false" },
  ],
};
const onExpression = () => {};
const inputs = (overrides: Partial<FlowNodeInputs> = {}): FlowNodeInputs => ({
  selected: "check",
  visited: new Set(),
  inputCount: 1,
  errors: new Map(),
  sizes: new Map(),
  onExpression,
  canOpenCode: true,
  ...overrides,
});
const byId = <T extends { id: string }>(items: T[]) =>
  new Map(items.map((item) => [item.id, item]));

test("editing one card rebuilds only that card's React Flow node", () => {
  const first = flowNodes(definition.nodes, inputs(), new Map());
  const edited = patchGraphNode(definition, "check", { label: "Larger?" });
  const second = flowNodes(edited.nodes, inputs(), byId(first));
  expect(second.map((node, index) => node === first[index])).toEqual([
    true,
    false,
    true,
    true,
  ]);
  expect(second[1].data.model.label).toBe("Larger?");
  const selectedElsewhere = flowNodes(
    edited.nodes,
    inputs({ selected: "input" }),
    byId(second),
  );
  expect(
    selectedElsewhere.map((node, index) => node === second[index]),
  ).toEqual([false, false, true, true]);
});

test("node data follows errors, measurements and trace changes by node ID, including prototype names", () => {
  const first = flowNodes(definition.nodes, inputs(), new Map());
  expect(first[2].data.errors).toEqual([]);
  expect(first[3].measured).toBeUndefined();
  const errors = new Map([["constructor", ["Missing value"]]]);
  const sizes = new Map([["toString", { width: 230, height: 120 }]]);
  const second = flowNodes(
    definition.nodes,
    inputs({ errors, sizes, visited: new Set(["input"]) }),
    byId(first),
  );
  expect(second[0].data.visited).toBe(true);
  expect(second[1]).toBe(first[1]);
  expect(second[2].data.errors).toEqual(["Missing value"]);
  expect(second[3].measured).toEqual({ width: 230, height: 120 });
});

test("edges keep their objects until their selection, label or traced branch changes", () => {
  const first = flowEdges(
    definition,
    { selectedEdge: null, taken: new Set() },
    new Map(),
  );
  expect(first.map((edge) => edge.label)).toEqual([undefined, "True", "False"]);
  const relabeled = patchGraphNode(definition, "constructor", {
    label: "Accepted",
  });
  const second = flowEdges(
    relabeled,
    { selectedEdge: null, taken: new Set() },
    byId(first),
  );
  expect(second.every((edge, index) => edge === first[index])).toBe(true);
  const trace: Execution = {
    ruleId: "preview",
    version: null,
    result: 1,
    durationMicros: 1,
    trace: [
      {
        ruleId: "preview",
        version: null,
        nodeId: "check",
        label: "Large?",
        type: "CONDITION",
        value: true,
        branch: "true",
        depth: 0,
      },
    ],
  };
  const traced = flowEdges(
    relabeled,
    { selectedEdge: "a", taken: takenBranches(trace) },
    byId(second),
  );
  expect(traced.map((edge, index) => edge === second[index])).toEqual([
    false,
    false,
    true,
  ]);
  expect(traced[0].selected).toBe(true);
  expect(traced[1].animated).toBe(true);
});

test("routing obstacles depend on positions and sizes only", () => {
  const sizes = new Map([["constructor", { width: 240, height: 90 }]]);
  const bounds = cardBounds(definition.nodes, sizes);
  expect(bounds[2]).toEqual({
    id: "constructor",
    x: -150,
    y: 300,
    width: 240,
    height: 90,
  });
  expect(bounds[3]).toMatchObject({ id: "toString", width: 230, height: 105 });
  const relabeled = patchGraphNode(definition, "check", { label: "Other" });
  expect(JSON.stringify(cardBounds(relabeled.nodes, sizes))).toBe(
    JSON.stringify(bounds),
  );
  const moved = patchGraphNode(definition, "check", {
    position: { x: 10, y: 150 },
  });
  expect(JSON.stringify(cardBounds(moved.nodes, sizes))).not.toBe(
    JSON.stringify(bounds),
  );
});

test("every node kind has a card summary", () => {
  const node = (patch: Partial<RuleNode>): RuleNode => ({
    id: "n",
    type: "FORMULA",
    label: "Node",
    position: { x: 0, y: 0 },
    ...patch,
  });
  // The path GraphNode takes: the descriptor's summary for the card's kind.
  const nodeSummary = (card: RuleNode, inputCount: number) =>
    nodeKinds[card.type].summary(card, inputCount);
  expect(nodeSummary(node({ type: "INPUT" }), 1)).toBe("1 input parameter");
  expect(nodeSummary(node({ type: "INPUT" }), 2)).toBe("2 input parameters");
  expect(nodeSummary(node({ type: "REFERENCE" }), 0)).toBe("Select a rule");
  expect(
    nodeSummary(node({ type: "REFERENCE", ruleId: "tax", version: 3 }), 0),
  ).toBe("tax · v3");
  const cases = [{ id: "c", label: "C", expression: "true" }];
  expect(nodeSummary(node({ type: "SWITCH", cases }), 0)).toBe(
    "1 cases · first match + default",
  );
  expect(
    nodeSummary(node({ type: "SWITCH", cases, selector: "tier" }), 0),
  ).toBe("Match tier · 1 cases + default");
  expect(
    nodeSummary(
      node({
        type: "TRANSFORM",
        fields: [{ name: "a", expression: "1" }],
        output: "row",
      }),
      0,
    ),
  ).toBe("1 fields → row");
  expect(nodeSummary(node({ type: "TRANSFORM", expression: "x" }), 0)).toBe(
    "x",
  );
  expect(nodeSummary(node({ type: "OUTPUT", outputName: "total" }), 0)).toBe(
    "total ← Choose a value",
  );
  expect(nodeSummary(node({ type: "OUTPUT", expression: "1" }), 0)).toBe("1");
  expect(nodeSummary(node({ type: "CONDITION" }), 0)).toBe("Add an expression");
  expect(nodeSummary(node({ expression: "amount * 2" }), 0)).toBe("amount * 2");
});

test("a drag routes again only the edges the moved card can affect, and the settled graph routes fully", () => {
  // 100 cards in a chain plus skip-2 edges: every drag step re-routed all 199 edges.
  const cards: RoutingNode[] = Array.from({ length: 100 }, (_, index) => ({
    id: `n${index}`,
    x: (index % 10) * 300,
    y: Math.floor(index / 10) * 200,
    width: 230,
    height: 94,
  }));
  const endpoints = (from: number, to: number): [Endpoint, Endpoint] => [
    {
      x: cards[from].x + 115,
      y: cards[from].y + 94,
      nodeId: cards[from].id,
      side: "bottom",
    },
    { x: cards[to].x + 115, y: cards[to].y, nodeId: cards[to].id, side: "top" },
  ];
  const edges: [string, number, number][] = [];
  for (let index = 0; index + 1 < cards.length; index++)
    edges.push([`e${index}`, index, index + 1]);
  for (let index = 0; index + 2 < cards.length; index++)
    edges.push([`s${index}`, index, index + 2]);
  let calls = 0;
  const counting: typeof routeEdge = (source, target, nodes) => {
    calls += 1;
    return routeEdge(source, target, nodes);
  };
  const cache = new Map<string, CachedRoute>();
  const routeAll = (nodes: RoutingNode[], moved: MovedCard[] | null) => {
    for (const [id, from, to] of edges) {
      const [source, target] = endpoints(from, to);
      cache.set(
        id,
        routeWithCache(cache.get(id), source, target, nodes, moved, counting),
      );
    }
  };
  routeAll(cards, null);
  expect(calls).toBe(edges.length);
  const before = new Map([...cache].map(([id, cached]) => [id, cached.route]));
  // Card n55 moves 30px right during a drag.
  calls = 0;
  const moved: MovedCard = {
    id: "n55",
    before: cards[55],
    after: { ...cards[55], x: cards[55].x + 30 },
  };
  const draggedCards = cards.map((card) =>
    card.id === "n55" ? moved.after : card,
  );
  // Endpoints of the moved card move with it.
  cards[55] = moved.after;
  routeAll(draggedCards, [moved]);
  const affected = edges.filter(([id, from, to]) => {
    const route = before.get(id);
    const touched = from === 55 || to === 55;
    return (
      touched ||
      (route !== null && route !== undefined && cache.get(id)!.route !== route)
    );
  });
  expect(calls).toBeLessThan(edges.length / 4);
  expect(calls).toBeGreaterThanOrEqual(
    affected.filter(([, from, to]) => from === 55 || to === 55).length,
  );
  for (const [id, from, to] of edges)
    if (from !== 55 && to !== 55 && !affected.some(([other]) => other === id))
      expect(cache.get(id)!.route).toBe(before.get(id));
  // The drag ends: every edge equals a fresh routeEdge result.
  calls = 0;
  routeAll(draggedCards, null);
  expect(calls).toBe(edges.length);
  for (const [id, from, to] of edges) {
    const [source, target] = endpoints(from, to);
    expect(cache.get(id)!.route).toEqual(
      routeEdge(source, target, draggedCards),
    );
  }
});

test("a blocked edge routes again whenever a card moves, since no route says what blocks it", () => {
  const nodes: RoutingNode[] = [
    { id: "a", x: 0, y: 0, width: 230, height: 94 },
    { id: "b", x: 0, y: 300, width: 230, height: 94 },
    { id: "c", x: 600, y: 150, width: 230, height: 94 },
  ];
  const source: Endpoint = { x: 115, y: 94, nodeId: "a", side: "bottom" };
  const target: Endpoint = { x: 115, y: 300, nodeId: "b", side: "top" };
  const blocked: CachedRoute = { source, target, route: null };
  let calls = 0;
  const counting: typeof routeEdge = (from, to, obstacles) => {
    calls += 1;
    return routeEdge(from, to, obstacles);
  };
  const moved: MovedCard = {
    id: "c",
    before: nodes[2],
    after: { ...nodes[2], x: 700 },
  };
  // Card c sits far from the blocked edge: the cache used to keep the null route for the whole drag.
  routeWithCache(blocked, source, target, nodes, [moved], counting);
  expect(calls).toBe(1);
  // Nothing moved yet in this drag: the cached decision stands.
  expect(routeWithCache(blocked, source, target, nodes, [], counting)).toBe(
    blocked,
  );
  expect(calls).toBe(1);
});

test("a drag's first change captures the bounds before it, and its end clears them", () => {
  const bounds = cardBounds(definition.nodes, new Map());
  const first = dragStartBounds(
    null,
    [
      {
        type: "position",
        id: "check",
        position: { x: 5, y: 150 },
        dragging: true,
      },
    ],
    bounds,
  );
  expect(first?.get("check")).toEqual(
    expect.objectContaining({ x: 0, y: 150 }),
  );
  // Later changes keep the captured start; the moved bounds are never captured.
  const moved = bounds.map((card) =>
    card.id === "check" ? { ...card, x: 5 } : card,
  );
  expect(
    dragStartBounds(
      first,
      [
        {
          type: "position",
          id: "check",
          position: { x: 9, y: 150 },
          dragging: true,
        },
      ],
      moved,
    ),
  ).toBe(first);
  // A change without a drag flag (a measurement) changes nothing.
  expect(
    dragStartBounds(first, [{ type: "dimensions", id: "check" }], moved),
  ).toBe(first);
  expect(
    dragStartBounds(
      first,
      [
        {
          type: "position",
          id: "check",
          position: { x: 9, y: 150 },
          dragging: false,
        },
      ],
      moved,
    ),
  ).toBeNull();
});

test("Switch Default and Condition False edges take the fallback stroke and label style", () => {
  const branching: Definition = {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      { id: "input", type: "INPUT", label: "In", position: { x: 0, y: 0 } },
      {
        id: "check",
        type: "CONDITION",
        label: "Check",
        expression: "true",
        position: { x: 0, y: 100 },
      },
      {
        id: "pick",
        type: "SWITCH",
        label: "Pick",
        cases: [{ id: "high", label: "High", expression: "true" }],
        position: { x: 0, y: 200 },
      },
      {
        id: "out",
        type: "OUTPUT",
        label: "Out",
        expression: "1",
        position: { x: 0, y: 300 },
      },
    ],
    edges: [
      { id: "t", source: "check", target: "pick", sourceHandle: "true" },
      { id: "f", source: "check", target: "out", sourceHandle: "false" },
      { id: "c", source: "pick", target: "out", sourceHandle: "case:high" },
      { id: "d", source: "pick", target: "out", sourceHandle: "default" },
    ],
  };
  const edges = flowEdges(
    branching,
    { selectedEdge: null, taken: new Set() },
    new Map(),
  );
  const byId = Object.fromEntries(edges.map((edge) => [edge.id, edge]));
  expect(byId.d.label).toBe("Default");
  expect(byId.c.label).toBe("High");
  // Fallback exits share one stroke and label style, whatever the handle is called.
  expect(byId.d.style?.stroke).toBe(byId.f.style?.stroke);
  expect(byId.d.labelStyle).toBe(byId.f.labelStyle);
  expect(byId.c.style?.stroke).toBe(byId.t.style?.stroke);
  expect(byId.c.labelStyle).toBe(byId.t.labelStyle);
  expect(byId.d.style?.stroke).not.toBe(byId.c.style?.stroke);
  expect(byId.d.labelStyle).not.toBe(byId.c.labelStyle);
});

test("a card's centre comes from its measured size, else from its exit-driven width", () => {
  const wide: RuleNode = {
    id: "pick",
    type: "SWITCH",
    label: "Pick",
    cases: Array.from({ length: 6 }, (_, index) => ({
      id: `c${index}`,
      label: `Case ${index}`,
      expression: "true",
    })),
    position: { x: 100, y: 50 },
  };
  // Seven exits at 90 px each: a 630 px card, centred 315 px from its left edge.
  expect(cardCenter(wide, new Map())).toEqual({ x: 415, y: 102.5 });
  expect(
    cardCenter(wide, new Map([["pick", { width: 700, height: 140 }]])),
  ).toEqual({ x: 450, y: 120 });
});
