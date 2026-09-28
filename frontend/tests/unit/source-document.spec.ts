import { expect, test } from "@playwright/test";
import type { DataSource, SourceConfig } from "../../src/types";
import { createSourceDraft } from "../../src/features/sources/model";
import {
  canRunSourceTest,
  displayedConfiguration,
  openSource,
  parseHttpTimeout,
  sourceDocumentReducer,
  sourceIsDirty,
  sourceSaveProblem,
  type SourceDocument,
  type SourceDocumentAction,
} from "../../src/features/sources/sourceDocument";

function lookupSource(version = 3): DataSource {
  return { ...createSourceDraft(), id: "rates", name: "Rates", version };
}

function httpSource(timeoutMs = 3000): DataSource {
  return {
    id: "customer",
    name: "Customer",
    version: 1,
    definition: {
      kind: "HTTP",
      url: "https://example.com/customer",
      parameters: [
        { name: "id", type: "STRING", required: true, defaultValue: null },
      ],
      secretHeaders: {},
      timeoutMs,
    },
  };
}

function apply(document: SourceDocument, ...actions: SourceDocumentAction[]) {
  let next: SourceDocument | null = document;
  for (const action of actions) next = sourceDocumentReducer(next, action);
  if (!next) throw new Error("the document closed");
  return next;
}

test("a historical configuration belongs to the document's selection and viewed version", () => {
  const current = lookupSource(3);
  const historical: SourceConfig = {
    ...current.definition,
    entries: { US: { rate: 0.05 } },
  };
  const loaded = {
    type: "version/loaded" as const,
    selection: 1,
    version: 2,
    configuration: historical,
  };
  const inspecting = apply(openSource(current, 1), {
    type: "version",
    version: 2,
    configuration: current.definition,
  });
  // Until the read completes nothing is shown, and the sample cannot be fetched.
  expect(displayedConfiguration(inspecting)).toBeNull();
  expect(canRunSourceTest(inspecting, false)).toBe(false);

  const shown = apply(inspecting, loaded);
  expect(displayedConfiguration(shown)).toBe(historical);
  expect(canRunSourceTest(shown, false)).toBe(true);

  // A late read of another version or selection cannot be shown.
  const otherVersion = apply(inspecting, {
    type: "version",
    version: 1,
    configuration: current.definition,
  });
  expect(apply(otherVersion, loaded)).toBe(otherVersion);
  expect(displayedConfiguration(apply(otherVersion, loaded))).toBeNull();
  const reopened = apply(inspecting, {
    type: "select",
    source: current,
    selection: 2,
  });
  expect(apply(reopened, loaded)).toBe(reopened);

  // Returning to the latest version shows the live draft again.
  const latest = apply(shown, {
    type: "version",
    version: 3,
    configuration: current.definition,
  });
  expect(displayedConfiguration(latest)).toBe(current.definition);
});

test("one test eligibility rule covers unsaved, edited, saving and running sources", () => {
  const saved = openSource(lookupSource(), 1);
  expect(canRunSourceTest(null, false)).toBe(false);
  expect(canRunSourceTest(saved, false)).toBe(true);
  expect(canRunSourceTest(saved, true)).toBe(false);
  expect(canRunSourceTest(openSource(lookupSource(0), 1), false)).toBe(false);
  expect(
    canRunSourceTest(
      apply(saved, { type: "metadata", patch: { name: "Edited" } }),
      false,
    ),
  ).toBe(false);
  expect(
    canRunSourceTest(apply(saved, { type: "test/start", request: 1 }), false),
  ).toBe(false);
});

test("the HTTP timeout keeps its raw text and accepts whole milliseconds from 100 to 10,000", () => {
  for (const [text, expected] of [
    ["100", 100],
    ["10000", 10_000],
    [" 250 ", 250],
    ["05000", 5000],
    ["", null],
    ["-", null],
    ["99", null],
    ["10001", null],
    ["1e3", null],
    ["3000.5", null],
    ["-100", null],
  ] as const)
    expect(parseHttpTimeout(text), JSON.stringify(text)).toBe(expected);

  const opened = openSource(httpSource(3000), 1);
  expect(opened.timeout).toBe("3000");

  const cleared = apply(opened, { type: "timeout", value: "" });
  expect(cleared.timeout).toBe("");
  expect(cleared.source.definition.timeoutMs).toBe(3000);
  expect(sourceIsDirty(cleared)).toBe(true);
  expect(sourceSaveProblem(cleared)).toMatch(/100 to 10,000/);

  const retyped = apply(cleared, { type: "timeout", value: "05000" });
  expect(retyped.timeout).toBe("05000");
  expect(retyped.source.definition.timeoutMs).toBe(5000);
  expect(sourceSaveProblem(retyped)).toBeNull();
  expect(sourceIsDirty(retyped)).toBe(true);

  // The same number with another spelling is not an edit.
  expect(
    sourceIsDirty(apply(retyped, { type: "timeout", value: "03000" })),
  ).toBe(false);

  const outOfRange = apply(opened, { type: "timeout", value: "50" });
  expect(outOfRange.source.definition.timeoutMs).toBe(3000);
  expect(sourceSaveProblem(outOfRange)).toMatch(/100 to 10,000/);
  // Lookup tables do not use the timeout, so its field cannot block their save.
  expect(
    sourceSaveProblem(apply(outOfRange, { type: "provider", kind: "LOOKUP" })),
  ).toBeNull();
});

test("a save acknowledgement keeps a timeout typed after the save started", () => {
  const original = httpSource(3000);
  const saving = apply(
    openSource(original, 1),
    { type: "timeout", value: "4000" },
    { type: "save/start", request: 1 },
    { type: "timeout", value: "" },
  );
  const acknowledged = apply(saving, {
    type: "save/success",
    request: 1,
    selection: 1,
    source: {
      ...original,
      version: 2,
      definition: { ...original.definition, timeoutMs: 4000 },
    },
  });
  expect(acknowledged.source.version).toBe(2);
  expect(acknowledged.timeout).toBe("");
  expect(sourceIsDirty(acknowledged)).toBe(true);
  expect(
    sourceIsDirty(apply(acknowledged, { type: "timeout", value: "4000" })),
  ).toBe(false);
});

test("a new source needs an API resource ID before it can be saved", () => {
  const draft = openSource(createSourceDraft(), 1);
  for (const id of ["", "Customer Profile", "customer_profile", "1st-source"])
    expect(
      sourceSaveProblem(apply(draft, { type: "metadata", patch: { id } })),
      id,
    ).toMatch(/source ID/);
  expect(
    sourceSaveProblem(
      apply(draft, { type: "metadata", patch: { id: "customer-profile" } }),
    ),
  ).toBeNull();
  // Saved sources keep their permanent ID; the server owns any legacy value.
  expect(
    sourceSaveProblem({
      ...openSource(lookupSource(), 1),
      source: { ...lookupSource(), id: "Legacy_ID" },
    }),
  ).toBeNull();
});

test("an HTTP URL the server could not send as written blocks saving", () => {
  // The transport sends the configured text byte for byte, so the server refuses these.
  const draft = openSource({ ...httpSource(), version: 0, id: "remote" }, 1);
  const withUrl = (url: string) =>
    sourceSaveProblem(apply(draft, { type: "configuration", patch: { url } }));
  expect(withUrl("https://api.example.com/cities/Zürich?q=東京")).toMatch(
    /^HTTP URL: Percent-encode non-ASCII/,
  );
  for (const port of ["0", "65536", "99999"])
    expect(withUrl(`https://api.example.com:${port}/x`), port).toBe(
      "HTTP URL: Use a port from 1 to 65535.",
    );
  for (const url of [
    "https://api.example.com/cities/Z%C3%BCrich?q=%E6%9D%B1%E4%BA%AC",
    "https://api.example.com:65535/x",
    "http://[::1]:8080/x",
    "https://api.example.com/customer",
  ])
    expect(withUrl(url), url).toBeNull();
});
