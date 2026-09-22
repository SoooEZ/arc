import { expect, test } from "@playwright/test";
import type { DataSource } from "../../src/types";
import {
  createSourceDraft,
  sourceCandidate,
  sourceSample,
} from "../../src/features/sources/model";
import {
  openSource,
  sourceDocumentReducer,
  sourceIsDirty,
} from "../../src/features/sources/sourceDocument";

const source = (id: string): DataSource => ({
  ...createSourceDraft(),
  id,
  name: id,
  version: 1,
});

test("a saved source does not replace another source's unsaved draft", () => {
  const first = source("first");
  let document = sourceDocumentReducer(openSource(first, 1), {
    type: "save/start",
    request: 1,
  });
  document = sourceDocumentReducer(document, {
    type: "select",
    source: source("second"),
    selection: 2,
  });
  document = sourceDocumentReducer(document, {
    type: "buffer",
    field: "entries",
    value: '{"US": 12}',
  });
  const edited = document;
  document = sourceDocumentReducer(document, {
    type: "save/success",
    request: 1,
    selection: 1,
    source: { ...first, version: 2 },
  });
  expect(document).toBe(edited);
  expect(document!.source.id).toBe("second");
  expect(sourceIsDirty(document!)).toBe(true);
  expect(
    sourceDocumentReducer(document, {
      type: "save/failure",
      request: 1,
      selection: 1,
      error: "late conflict",
    }),
  ).toBe(document);
});

test("saving advances the revision without dropping a newer edit, which can still be reverted", () => {
  const original = source("first");
  let document = sourceDocumentReducer(openSource(original, 1), {
    type: "save/start",
    request: 1,
  });
  document = sourceDocumentReducer(document, {
    type: "metadata",
    patch: { name: "newer edit" },
  });
  document = sourceDocumentReducer(document, {
    type: "save/success",
    request: 1,
    selection: 1,
    source: { ...original, version: 2 },
  });
  expect(document!.source.name).toBe("newer edit");
  expect(document!.source.version).toBe(2);
  expect(sourceIsDirty(document!)).toBe(true);
  document = sourceDocumentReducer(document, {
    type: "metadata",
    patch: { name: original.name },
  });
  expect(sourceIsDirty(document!)).toBe(false);
});

test("test responses belong to the selected source, version and input", () => {
  const first = source("first");
  const running = sourceDocumentReducer(openSource(first, 1), {
    type: "test/start",
    request: 1,
  });
  const changes = [
    { type: "select" as const, source: source("second"), selection: 2 },
    { type: "version" as const, version: 2, configuration: first.definition },
    { type: "test/input" as const, value: '{"key":"GB"}' },
    { type: "buffer" as const, field: "entries" as const, value: '{"US": 99}' },
  ];
  for (const change of changes) {
    const newer = sourceDocumentReducer(running, change);
    expect(
      sourceDocumentReducer(newer, {
        type: "test/success",
        request: 1,
        result: 7,
      }),
    ).toBe(newer);
    expect(
      sourceDocumentReducer(newer, {
        type: "test/failure",
        request: 1,
        error: "stale error",
      }),
    ).toBe(newer);
    expect(newer!.result).toBeUndefined();
  }
  let rerun = sourceDocumentReducer(running, {
    type: "test/input",
    value: '{"key":"GB"}',
  });
  rerun = sourceDocumentReducer(rerun, { type: "test/start", request: 2 });
  rerun = sourceDocumentReducer(rerun, {
    type: "test/success",
    request: 2,
    result: null,
  });
  expect(rerun!.result).toBeNull();
  expect(
    sourceDocumentReducer(rerun, {
      type: "test/success",
      request: 1,
      result: "old",
    }),
  ).toBe(rerun);
});

test("provider changes keep raw JSON editing separate from a saved configuration", () => {
  const original = source("first");
  let document = sourceDocumentReducer(openSource(original, 1), {
    type: "provider",
    kind: "HTTP",
  });
  expect(
    sourceCandidate(document!.source, document!.buffers).definition
      .parameters[0].name,
  ).toBe("customerId");
  document = sourceDocumentReducer(document, {
    type: "buffer",
    field: "parameters",
    value: "[incomplete",
  });
  expect(document!.buffers.parameters).toBe("[incomplete");
  expect(() => sourceCandidate(document!.source, document!.buffers)).toThrow();
  expect(original.definition.kind).toBe("LOOKUP");
});

test("source samples respect structured values and falsy defaults", () => {
  const config = source("first").definition;
  config.parameters = [
    { name: "items", type: "ARRAY", required: true, defaultValue: null },
    { name: "customer", type: "OBJECT", required: true, defaultValue: null },
    { name: "enabled", type: "BOOLEAN", required: true, defaultValue: false },
    { name: "amount", type: "NUMBER", required: true, defaultValue: 0 },
    { name: "name", type: "STRING", required: true, defaultValue: "" },
  ];
  expect(JSON.parse(sourceSample(config))).toEqual({
    items: [],
    customer: {},
    enabled: false,
    amount: 0,
    name: "",
  });
});

test("reopening a source during its save adopts the completed revision", () => {
  const first = source("first");
  let document = sourceDocumentReducer(openSource(first, 1), {
    type: "save/start",
    request: 1,
  });
  document = sourceDocumentReducer(document, {
    type: "select",
    source: source("second"),
    selection: 2,
  });
  document = sourceDocumentReducer(document, {
    type: "select",
    source: first,
    selection: 3,
  });
  document = sourceDocumentReducer(document, {
    type: "save/success",
    request: 1,
    selection: 1,
    source: { ...first, version: 2, name: "Saved A" },
  });
  expect(document!.source.version).toBe(2);
  expect(document!.source.name).toBe("Saved A");
  expect(document!.selection).toBe(3);
  expect(sourceIsDirty(document!)).toBe(false);
});
