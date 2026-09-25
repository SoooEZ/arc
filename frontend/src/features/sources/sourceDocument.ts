import type { DataSource, SourceConfig } from "../../types";
import { sourceBuffers, sourceSample, type SourceBuffers } from "./model";

export interface SourceDocument {
  selection: number;
  source: DataSource;
  buffers: SourceBuffers;
  baseline: string;
  viewedVersion: number;
  testInput: string;
  result: unknown;
  error: string;
  saving: { request: number; snapshot: string } | null;
  testing: number | null;
}

export function sourceSnapshot(
  source: DataSource,
  buffers: SourceBuffers,
): string {
  // JSON buffers own these fields while editing; the parsed source is only their saved backing.
  const {
    parameters: _parameters,
    entries: _entries,
    secretHeaders: _secretHeaders,
    ...configuration
  } = source.definition;
  return JSON.stringify({
    id: source.id,
    name: source.name,
    configuration: Object.fromEntries(
      Object.entries(configuration).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    buffers,
  });
}

export function openSource(
  source: DataSource,
  selection: number,
): SourceDocument {
  const buffers = sourceBuffers(source.definition);
  return {
    selection,
    source,
    buffers,
    baseline: sourceSnapshot(source, buffers),
    viewedVersion: source.version,
    testInput: sourceSample(source.definition),
    result: undefined,
    error: "",
    saving: null,
    testing: null,
  };
}

export function sourceIsDirty(document: SourceDocument): boolean {
  return (
    sourceSnapshot(document.source, document.buffers) !== document.baseline
  );
}

export type SourceDocumentAction =
  | { type: "close" }
  | { type: "select"; source: DataSource; selection: number }
  | { type: "metadata"; patch: Pick<Partial<DataSource>, "id" | "name"> }
  | { type: "configuration"; patch: Partial<SourceConfig> }
  | { type: "buffer"; field: keyof SourceBuffers; value: string }
  | { type: "provider"; kind: SourceConfig["kind"] }
  | { type: "version"; version: number; configuration: SourceConfig }
  | { type: "test/input"; value: string }
  | { type: "save/start"; request: number }
  | {
      type: "save/success";
      request: number;
      selection: number;
      source: DataSource;
    }
  | { type: "save/failure"; request: number; selection: number; error: string }
  | { type: "test/start"; request: number }
  | { type: "test/success"; request: number; result: unknown }
  | { type: "test/failure"; request: number; error: string }
  | { type: "error/clear" };

function invalidateTest(document: SourceDocument): SourceDocument {
  return { ...document, result: undefined, testing: null, error: "" };
}

/** Responses belong to one selection and request, never to whichever source is open later. */
export function sourceDocumentReducer(
  document: SourceDocument | null,
  action: SourceDocumentAction,
): SourceDocument | null {
  if (action.type === "close") return null;
  if (action.type === "select")
    return openSource(action.source, action.selection);
  if (!document) return null;
  switch (action.type) {
    case "metadata":
      return {
        ...invalidateTest(document),
        source: { ...document.source, ...action.patch },
      };
    case "configuration":
      return {
        ...invalidateTest(document),
        source: {
          ...document.source,
          definition: { ...document.source.definition, ...action.patch },
        },
      };
    case "buffer":
      return {
        ...invalidateTest(document),
        buffers: { ...document.buffers, [action.field]: action.value },
      };
    case "provider": {
      const parameters = [
        {
          name: action.kind === "LOOKUP" ? "key" : "customerId",
          type: "STRING",
          required: true,
          defaultValue: null,
        },
      ];
      return {
        ...invalidateTest(document),
        source: {
          ...document.source,
          definition: { ...document.source.definition, kind: action.kind },
        },
        buffers: {
          ...document.buffers,
          parameters: JSON.stringify(parameters, null, 2),
        },
      };
    }
    case "version":
      return {
        ...invalidateTest(document),
        viewedVersion: action.version,
        testInput: sourceSample(action.configuration),
      };
    case "test/input":
      return { ...invalidateTest(document), testInput: action.value };
    case "save/start":
      return {
        ...document,
        error: "",
        saving: {
          request: action.request,
          snapshot: sourceSnapshot(document.source, document.buffers),
        },
      };
    case "save/success": {
      if (
        document.source.id !== action.source.id ||
        document.source.version > action.source.version
      )
        return document;
      if (
        document.selection !== action.selection ||
        document.saving?.request !== action.request
      ) {
        // Reopening A while its save completes should expose its new revision, without
        // replacing edits made in that reopened document.
        if (!sourceIsDirty(document))
          return openSource(action.source, document.selection);
        const saved = openSource(action.source, document.selection);
        return {
          ...document,
          source: { ...document.source, version: action.source.version },
          viewedVersion: action.source.version,
          baseline: saved.baseline,
        };
      }
      const saved = openSource(action.source, document.selection);
      if (
        document.saving.snapshot ===
        sourceSnapshot(document.source, document.buffers)
      )
        return saved;
      // Advance the server revision without discarding an edit made after this save started.
      return {
        ...document,
        source: { ...document.source, version: action.source.version },
        viewedVersion: action.source.version,
        baseline: saved.baseline,
        saving: null,
      };
    }
    case "save/failure":
      return document.selection === action.selection &&
        document.saving?.request === action.request
        ? { ...document, saving: null, error: action.error }
        : document;
    case "test/start":
      return {
        ...document,
        result: undefined,
        error: "",
        testing: action.request,
      };
    case "test/success":
      return document.testing === action.request
        ? { ...document, result: action.result, testing: null }
        : document;
    case "test/failure":
      return document.testing === action.request
        ? { ...document, error: action.error, testing: null }
        : document;
    case "error/clear":
      return { ...document, error: "" };
  }
}
