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

for (const reopen of [false, true]) {
  test(`source save acknowledgements retain edited test JSON ${reopen ? "after reopening the source" : "in the current selection"}`, () => {
    const original = source("first");
    let document = sourceDocumentReducer(openSource(original, 1), {
      type: "metadata",
      patch: { name: "Saved name" },
    })!;
    const submitted = document.source;
    document = sourceDocumentReducer(document, {
      type: "save/start",
      request: 1,
    })!;
    if (reopen)
      document = sourceDocumentReducer(document, {
        type: "select",
        source: original,
        selection: 2,
      })!;
    document = sourceDocumentReducer(document, {
      type: "test/input",
      value: '{"key":',
    })!;

    const saved = sourceDocumentReducer(document, {
      type: "save/success",
      request: 1,
      selection: 1,
      source: { ...submitted, version: 2 },
    })!;
    expect(saved.testInput).toBe('{"key":');
    expect(saved.testInputEdited).toBe(true);
    expect(saved.source.version).toBe(2);
    expect(saved.source.name).toBe("Saved name");
    expect(saved.selection).toBe(reopen ? 2 : 1);
    expect(saved.saving).toBeNull();
    expect(sourceIsDirty(saved)).toBe(false);

    const failed = sourceDocumentReducer(document, {
      type: "save/failure",
      request: 1,
      selection: 1,
      error: "Save conflict",
    })!;
    expect(failed.testInput).toBe('{"key":');
    expect(failed.testInputEdited).toBe(true);
    expect(failed.source.version).toBe(1);
    expect(failed.error).toBe(reopen ? "" : "Save conflict");
  });
}

test("saving configuration updates an untouched source test sample", () => {
  const original = source("first");
  const document = sourceDocumentReducer(openSource(original, 1), {
    type: "save/start",
    request: 1,
  });
  const saved = sourceDocumentReducer(document, {
    type: "save/success",
    request: 1,
    selection: 1,
    source: {
      ...original,
      version: 2,
      definition: {
        ...original.definition,
        parameters: original.definition.parameters.map((parameter) => ({
          ...parameter,
          defaultValue: "GB",
        })),
      },
    },
  })!;
  expect(JSON.parse(saved.testInput)).toEqual({ key: "GB" });
  expect(saved.testInputEdited).toBe(false);
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

test("historical source metadata initializes only the untouched test buffer of its selection", () => {
  const current = source("first");
  current.version = 3;
  const historical = {
    ...current.definition,
    parameters: current.definition.parameters.map((parameter) => ({
      ...parameter,
      defaultValue: "GB",
    })),
  };
  const inspecting = sourceDocumentReducer(openSource(current, 1), {
    type: "version",
    version: 2,
    configuration: current.definition,
  });
  const loaded = {
    type: "version/loaded" as const,
    selection: 1,
    version: 2,
    configuration: historical,
  };
  expect(
    JSON.parse(sourceDocumentReducer(inspecting, loaded)!.testInput),
  ).toEqual({ key: "GB" });

  const edited = sourceDocumentReducer(inspecting, {
    type: "test/input",
    value: '{"key":',
  });
  const editedAfterLoad = sourceDocumentReducer(edited, loaded)!;
  expect(editedAfterLoad.testInput).toBe('{"key":');
  expect(editedAfterLoad.testInputEdited).toBe(true);
  expect(editedAfterLoad.viewedConfiguration).toBe(historical);

  const anotherVersion = sourceDocumentReducer(inspecting, {
    type: "version",
    version: 3,
    configuration: current.definition,
  });
  expect(sourceDocumentReducer(anotherVersion, loaded)).toBe(anotherVersion);
  const reopened = sourceDocumentReducer(inspecting, {
    type: "select",
    source: { ...current, version: 2 },
    selection: 2,
  });
  expect(sourceDocumentReducer(reopened, loaded)).toBe(reopened);
});

test("source candidates serialize only the active provider without consuming inactive JSON buffers", () => {
  const original = source("first");
  original.definition.url = "https://example.com/source";
  original.definition.secretHeaders = { Authorization: "CRM_TOKEN" };
  let document = sourceDocumentReducer(openSource(original, 1), {
    type: "buffer",
    field: "entries",
    value: "{unfinished lookup",
  });
  document = sourceDocumentReducer(document, {
    type: "provider",
    kind: "HTTP",
  });
  const http = sourceCandidate(document!.source, document!.buffers);
  expect(http.definition).toMatchObject({
    kind: "HTTP",
    url: original.definition.url,
    secretHeaders: original.definition.secretHeaders,
  });
  expect(http.definition).not.toHaveProperty("entries");
  expect(document!.buffers.entries).toBe("{unfinished lookup");

  document = sourceDocumentReducer(document, {
    type: "buffer",
    field: "secretHeaders",
    value: "{unfinished headers",
  });
  document = sourceDocumentReducer(document, {
    type: "provider",
    kind: "LOOKUP",
  });
  expect(document!.buffers.entries).toBe("{unfinished lookup");
  expect(() => sourceCandidate(document!.source, document!.buffers)).toThrow();
  document = sourceDocumentReducer(document, {
    type: "buffer",
    field: "entries",
    value: '{"US": false}',
  });
  const lookup = sourceCandidate(document!.source, document!.buffers);
  expect(lookup.definition).toMatchObject({
    kind: "LOOKUP",
    entries: { US: false },
  });
  expect(lookup.definition).not.toHaveProperty("url");
  expect(lookup.definition).not.toHaveProperty("secretHeaders");
  expect(document!.buffers.secretHeaders).toBe("{unfinished headers");
});

test("source samples respect falsy defaults and share rule input placeholders", () => {
  const config = source("first").definition;
  // Source parameters are scalar: the server rejects ARRAY and OBJECT parameters.
  config.parameters = [
    { name: "enabled", type: "BOOLEAN", required: true, defaultValue: false },
    { name: "amount", type: "NUMBER", required: true, defaultValue: 0 },
    { name: "name", type: "STRING", required: true, defaultValue: "" },
    { name: "key", type: "STRING", required: true, defaultValue: null },
    { name: "count", type: "NUMBER", required: false, defaultValue: null },
  ];
  expect(JSON.parse(sourceSample(config))).toEqual({
    enabled: false,
    amount: 0,
    name: "",
    key: "US",
    count: 150,
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

test("a new draft that takes a pending create's ID never adopts the created source", () => {
  // Create "first" is pending; New source, unrelated content, and the same ID typed in.
  const draft = { ...createSourceDraft(), id: "first", name: "Other table" };
  const before = sourceDocumentReducer(openSource(draft, 2), {
    type: "buffer",
    field: "entries",
    value: '{"FR":1}',
  });
  const document = sourceDocumentReducer(before, {
    type: "save/success",
    request: 1,
    selection: 1,
    source: source("first"),
  });
  // Before, this draft became "v1 · edited" and its Save published it as first v2.
  expect(document).toBe(before);
  expect(document!.source.version).toBe(0);
  expect(sourceIsDirty(document!)).toBe(true);
});

test("a stored copy reopened during its save adopts the revision and keeps its edits", () => {
  const first = source("first");
  let document = sourceDocumentReducer(openSource(first, 1), {
    type: "save/start",
    request: 1,
  });
  document = sourceDocumentReducer(document, {
    type: "select",
    source: first,
    selection: 2,
  });
  document = sourceDocumentReducer(document, {
    type: "metadata",
    patch: { name: "Edited again" },
  });
  document = sourceDocumentReducer(document, {
    type: "save/success",
    request: 1,
    selection: 1,
    source: { ...first, version: 2, name: "Saved A" },
  });
  expect(document!.source.version).toBe(2);
  expect(document!.viewedVersion).toBe(2);
  expect(document!.source.name).toBe("Edited again");
  expect(sourceIsDirty(document!)).toBe(true);
});
