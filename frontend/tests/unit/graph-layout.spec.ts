import { expect, test } from "@playwright/test";
import ELK from "elkjs/lib/elk.bundled.js";
import {
  arrangeGraph as arrangeWith,
  type ElkLayout,
} from "../../src/features/editor/canvas/graphLayout";
import type { Definition, RuleNode } from "../../src/types";

// Node tests lay out in-thread; the browser runs ELK in a worker (graphLayoutWorker).
const elk = new ELK();
const inThread: ElkLayout = (graph) => elk.layout(graph);
const arrangeGraph = (
  definition: Parameters<typeof arrangeWith>[0],
  sizes: Parameters<typeof arrangeWith>[1] = new Map(),
) => arrangeWith(definition, sizes, inThread);

function output(id: string): RuleNode {
  return {
    id,
    type: "OUTPUT",
    label: id,
    position: { x: 0, y: 0 },
    expression: "1",
  };
}

/** Input fanning out to one Output per ID. */
function fanOut(ids: string[]): Definition {
  return {
    schemaVersion: 1,
    inputs: [],
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 0, y: 0 },
      },
      ...ids.map(output),
    ],
    edges: ids.map((id) => ({
      id: `to-${id}`,
      source: "input",
      target: id,
      sourceHandle: "next",
    })),
  };
}

async function positions(definition: Definition) {
  const arranged = await arrangeGraph(definition);
  return Object.fromEntries(arranged.nodes.map((n) => [n.id, n.position]));
}

test("Arrange gives the same layout in every browser locale and for any node order", async () => {
  const expected = await positions(
    fanOut(["aa-review", "mm-total", "zz-final"]),
  );
  const mixed = fanOut(["calc-total", "calctotal"]);
  const mixedExpected = await positions(mixed);
  const original = String.prototype.localeCompare;
  // da-DK sorts "aa" after "z"; th-TH compares "calc-total" and "calctotal" as equal, so the
  // layout followed the node array order that the ID sort exists to remove.
  for (const locale of ["da-DK", "th-TH"]) {
    const collator = new Intl.Collator(locale).compare;
    String.prototype.localeCompare = function (this: string, other: string) {
      return collator(this, other);
    } as typeof String.prototype.localeCompare;
    try {
      expect(
        await positions(fanOut(["aa-review", "mm-total", "zz-final"])),
        locale,
      ).toEqual(expected);
      expect(await positions(mixed), locale).toEqual(mixedExpected);
      expect(
        await positions({
          ...mixed,
          nodes: [...mixed.nodes].reverse(),
          edges: [...mixed.edges].reverse(),
        }),
        locale,
      ).toEqual(mixedExpected);
    } finally {
      String.prototype.localeCompare = original;
    }
  }
});
