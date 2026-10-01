import { expect, test } from "@playwright/test";
import type { DataSource, SourceConfig } from "../../src/types";
import {
  createSourceDraft,
  providerParameterTemplate,
  sourceCandidate,
} from "../../src/features/sources/model";
import {
  openSource,
  sourceDocumentReducer,
  sourceSaveProblem,
} from "../../src/features/sources/sourceDocument";
import {
  isSourceKind,
  sourceKinds,
  sourceProviders,
} from "../../src/features/sources/sourceProviders";

const lookup = (): DataSource => ({
  ...createSourceDraft(),
  id: "rates",
  name: "Rates",
  version: 1,
});

test("every source kind has a descriptor, and the menu lists each kind once", () => {
  const every: Record<SourceConfig["kind"], true> = {
    LOOKUP: true,
    HTTP: true,
  };
  expect([...sourceKinds].sort()).toEqual(Object.keys(every).sort());
  expect(new Set(sourceKinds).size).toBe(sourceKinds.length);
  for (const kind of sourceKinds) {
    expect(sourceProviders[kind].label).not.toBe("");
    expect(isSourceKind(kind)).toBe(true);
  }
  expect(isSourceKind("FTP")).toBe(false);
  expect(isSourceKind("constructor")).toBe(false);
});

test("a candidate carries only its provider's payload fields", () => {
  const document = openSource(lookup(), 1);
  const asLookup = sourceCandidate(document.source, document.buffers);
  expect(asLookup.definition).toHaveProperty("entries");
  expect(asLookup.definition).not.toHaveProperty("url");
  expect(asLookup.definition).not.toHaveProperty("secretHeaders");
  const http = sourceDocumentReducer(document, {
    type: "provider",
    kind: "HTTP",
  });
  const withUrl = sourceDocumentReducer(http, {
    type: "configuration",
    patch: { url: "https://example.com/rates" },
  });
  const asHttp = sourceCandidate(withUrl!.source, withUrl!.buffers);
  expect(asHttp.definition).toMatchObject({
    kind: "HTTP",
    url: "https://example.com/rates",
    secretHeaders: {},
  });
  expect(asHttp.definition).not.toHaveProperty("entries");
});

test("the timeout is checked only where the provider uses one, and each provider starts with its parameter", () => {
  const document = openSource(lookup(), 1);
  const badTimeout = sourceDocumentReducer(document, {
    type: "timeout",
    value: "5",
  });
  expect(sourceProviders.LOOKUP.usesTimeout).toBe(false);
  expect(sourceSaveProblem(badTimeout!)).toBeNull();
  const http = sourceDocumentReducer(badTimeout, {
    type: "provider",
    kind: "HTTP",
  });
  expect(sourceProviders.HTTP.usesTimeout).toBe(true);
  const located = sourceDocumentReducer(http, {
    type: "configuration",
    patch: { url: "https://api.example.com/rates" },
  });
  expect(sourceSaveProblem(located!)).toMatch(/^Timeout: /);
  expect(providerParameterTemplate("LOOKUP")[0].name).toBe(
    sourceProviders.LOOKUP.starterParameter,
  );
  expect(providerParameterTemplate("HTTP")[0].name).toBe(
    sourceProviders.HTTP.starterParameter,
  );
  expect(JSON.parse(http!.buffers.parameters)[0].name).toBe("customerId");
});
