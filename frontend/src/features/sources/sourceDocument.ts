import type { DataSource, SourceConfig } from "../../types";
import { stringifyJson } from "../../domain/json";
import { isResourceId, resourceIdGuidance } from "../../domain/resourceIds";
import {
  providerParameterTemplate,
  sourceBuffers,
  sourceSample,
  type SourceBuffers,
} from "./model";
import { sourceProviders } from "./sourceProviders";

export interface SourceDocument {
  selection: number;
  source: DataSource;
  buffers: SourceBuffers;
  /**
   * The parameters text of each provider the user switched away from, so a
   * switch back restores it instead of the provider's template (lesson F7).
   */
  parametersByKind: Partial<Record<SourceConfig["kind"], string>>;
  /** Raw HTTP timeout text; the definition keeps its last valid value. */
  timeout: string;
  baseline: string;
  viewedVersion: number;
  /** The loaded configuration of a historical version; null while it loads or after it failed. */
  viewedConfiguration: SourceConfig | null;
  testInput: string;
  testInputEdited: boolean;
  result: unknown;
  error: string;
  saving: { request: number; snapshot: string } | null;
  testing: number | null;
}

/** The chip beside a source's name: its saved version, and whether it has unsaved edits. */
export function sourceVersionLabel(version: number, dirty: boolean): string {
  if (!version) return "Unsaved";
  return dirty ? `v${version} · edited` : `v${version}`;
}

/** The server accepts whole milliseconds in this range (HttpSourceAdapter). */
export const httpTimeoutLimits = { min: 100, max: 10_000 };
export const httpTimeoutGuidance =
  "Enter whole milliseconds from 100 to 10,000.";

/** The timeout in `text`, or null when the server would reject it. */
export function parseHttpTimeout(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const milliseconds = Number(trimmed);
  return milliseconds >= httpTimeoutLimits.min &&
    milliseconds <= httpTimeoutLimits.max
    ? milliseconds
    : null;
}

export function sourceSnapshot({
  source,
  buffers,
  timeout,
}: Pick<SourceDocument, "source" | "buffers" | "timeout">): string {
  // Raw buffers own these fields while editing; the parsed source is only their saved backing.
  const {
    parameters: _parameters,
    entries: _entries,
    secretHeaders: _secretHeaders,
    timeoutMs: _timeoutMs,
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
    // "05000" and "5000" are the same timeout; invalid text differs from every saved value.
    timeout: parseHttpTimeout(timeout) ?? timeout,
  });
}

export function openSource(
  source: DataSource,
  selection: number,
): SourceDocument {
  const buffers = sourceBuffers(source.definition);
  const timeout = String(source.definition.timeoutMs ?? "");
  return {
    selection,
    source,
    buffers,
    parametersByKind: {},
    timeout,
    baseline: sourceSnapshot({ source, buffers, timeout }),
    viewedVersion: source.version,
    viewedConfiguration: null,
    testInput: sourceSample(source.definition),
    testInputEdited: false,
    result: undefined,
    error: "",
    saving: null,
    testing: null,
  };
}

export function sourceIsDirty(document: SourceDocument): boolean {
  return sourceSnapshot(document) !== document.baseline;
}

export function isHistoricalVersion(document: SourceDocument): boolean {
  return document.viewedVersion !== document.source.version;
}

/** The latest version shows the live draft; a historical version shows its loaded configuration. */
export function displayedConfiguration(
  document: SourceDocument,
): SourceConfig | null {
  return isHistoricalVersion(document)
    ? document.viewedConfiguration
    : document.source.definition;
}

/** One eligibility rule for the Fetch sample command and its button. */
export function canRunSourceTest(
  document: SourceDocument | null,
  saving: boolean,
): boolean {
  return (
    document !== null &&
    document.source.version > 0 &&
    displayedConfiguration(document) !== null &&
    !sourceIsDirty(document) &&
    !saving &&
    document.testing === null
  );
}

/**
 * Why the server would refuse an HTTP URL that its transport could not send as
 * written, or null. The server checks the rest of the URL.
 */
export function httpUrlProblem(url: string): string | null {
  if (/[^\x00-\x7f]/.test(url))
    return "Percent-encode non-ASCII characters as UTF-8 (Zürich → Z%C3%BCrich).";
  const port = /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*:(\d+)(?=[/?#]|$)/i.exec(
    url,
  )?.[1];
  if (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
    return "Use a port from 1 to 65535.";
  return null;
}

/** Why the Save command refuses the draft, or null. The server rejects the same values. */
export function sourceSaveProblem(document: SourceDocument): string | null {
  if (!document.source.version && !isResourceId(document.source.id))
    return `Enter a valid source ID. ${resourceIdGuidance}`;
  const { kind, url } = document.source.definition;
  const provider = sourceProviders[kind];
  if (provider.usesUrl) {
    const urlProblem = httpUrlProblem(url ?? "");
    if (urlProblem) return `HTTP URL: ${urlProblem}`;
  }
  if (provider.usesTimeout && parseHttpTimeout(document.timeout) === null)
    return `Timeout: ${httpTimeoutGuidance}`;
  return null;
}

export type SourceDocumentAction =
  | { type: "close" }
  | { type: "select"; source: DataSource; selection: number }
  | { type: "metadata"; patch: Pick<Partial<DataSource>, "id" | "name"> }
  | { type: "configuration"; patch: Partial<SourceConfig> }
  | { type: "buffer"; field: keyof SourceBuffers; value: string }
  | { type: "timeout"; value: string }
  | { type: "provider"; kind: SourceConfig["kind"] }
  | { type: "version"; version: number; configuration: SourceConfig }
  | {
      type: "version/loaded";
      selection: number;
      version: number;
      configuration: SourceConfig;
    }
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
    case "timeout": {
      const timeoutMs = parseHttpTimeout(action.value);
      return {
        ...invalidateTest(document),
        timeout: action.value,
        source:
          timeoutMs === null
            ? document.source
            : {
                ...document.source,
                definition: { ...document.source.definition, timeoutMs },
              },
      };
    }
    case "provider": {
      const current = document.source.definition.kind;
      if (action.kind === current) return document;
      // The text typed for the current provider waits under its kind; the target
      // gets its own text back, or the template on its first visit. A round
      // trip therefore ends with the original text and a clean document.
      const parametersByKind = {
        ...document.parametersByKind,
        [current]: document.buffers.parameters,
      };
      const parameters =
        parametersByKind[action.kind] ??
        stringifyJson(providerParameterTemplate(action.kind), 2);
      return {
        ...invalidateTest(document),
        source: {
          ...document.source,
          definition: { ...document.source.definition, kind: action.kind },
        },
        buffers: { ...document.buffers, parameters },
        parametersByKind,
      };
    }
    case "version":
      return {
        ...invalidateTest(document),
        viewedVersion: action.version,
        viewedConfiguration: null,
        testInput: sourceSample(action.configuration),
        testInputEdited: false,
      };
    case "version/loaded":
      if (
        document.selection !== action.selection ||
        document.viewedVersion !== action.version
      )
        return document;
      return {
        ...document,
        viewedConfiguration: action.configuration,
        // Loaded metadata may initialize an untouched sample, never an edited buffer.
        testInput: document.testInputEdited
          ? document.testInput
          : sourceSample(action.configuration),
      };
    case "test/input":
      return {
        ...invalidateTest(document),
        testInput: action.value,
        testInputEdited: true,
      };
    case "save/start":
      return {
        ...document,
        error: "",
        saving: { request: action.request, snapshot: sourceSnapshot(document) },
      };
    case "save/success": {
      if (
        document.source.id !== action.source.id ||
        document.source.version > action.source.version
      )
        return document;
      const saved = openSource(action.source, document.selection);
      // Saving configuration must not reinitialize a user-owned test buffer.
      if (document.testInputEdited) {
        saved.testInput = document.testInput;
        saved.testInputEdited = true;
      }
      if (
        document.selection !== action.selection ||
        document.saving?.request !== action.request
      ) {
        // Only a stored copy of the source adopts a save from another selection or request:
        // reopening A while its save completes exposes its new revision, without replacing
        // edits made in that reopened document. A new draft that merely took the ID of a
        // pending create was never that source; it keeps its state, and its own Create
        // receives the server's 409 instead of publishing it as the next version.
        if (document.source.version === 0) return document;
        if (!sourceIsDirty(document)) return saved;
        return {
          ...document,
          source: { ...document.source, version: action.source.version },
          viewedVersion: action.source.version,
          baseline: saved.baseline,
        };
      }
      if (document.saving.snapshot === sourceSnapshot(document)) return saved;
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
