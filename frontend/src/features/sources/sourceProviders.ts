import type { SourceConfig } from "../../types";
import { parseJsonObject } from "../../domain/json";

export type SourceKind = SourceConfig["kind"];

/** The raw JSON buffers a provider reads its payload fields from (see `SourceBuffers`). */
export interface ProviderBuffers {
  entries: string;
  secretHeaders: string;
}

/**
 * One descriptor per data source provider, in the style of `domain/nodeKinds`:
 * the facts the editor needs about a kind, so no call site decides them with
 * an implicit "else" branch. React parts (icons, form sections) live in
 * exhaustive tables beside the components that render them.
 */
export interface SourceProvider {
  /** The Provider menu text. */
  label: string;
  /** The parameter a new source of this kind starts with. */
  starterParameter: string;
  /** Whether the configuration carries a URL the save checks. */
  usesUrl: boolean;
  /** Whether the HTTP timeout applies (and is validated) for this kind. */
  usesTimeout: boolean;
  /** Whether the configuration sends secret headers the save checks. */
  usesSecretHeaders: boolean;
  /** The parameters JSON field's help, before the shared identifier guidance. */
  parametersHelp: string;
  /** What the parameters table says when the parameters have no problem. */
  parametersTableHelp: string;
  /** Why the server would refuse these parameter names for this kind, or null. */
  parametersProblem(names: string[]): string | null;
  /** The provider's payload fields from the definition and the raw buffers; throws today's messages for unusable text. */
  activeFields(
    definition: SourceConfig,
    buffers: ProviderBuffers,
  ): Partial<SourceConfig>;
}

/** The secret header aliases in `text`; throws today's messages for unusable text. */
export function secretHeaderAliases(text: string): Record<string, string> {
  const aliases = parseJsonObject(
    text,
    "Secret header aliases must be a JSON object.",
  );
  if (!hasTextValues(aliases))
    throw new Error(
      'Secret header aliases must be text, for example {"Authorization":"CRM_TOKEN"}.',
    );
  return aliases;
}

function hasTextValues(
  record: Record<string, unknown>,
): record is Record<string, string> {
  return Object.values(record).every((value) => typeof value === "string");
}

export const sourceProviders: Record<SourceKind, SourceProvider> = {
  LOOKUP: {
    label: "Local lookup table",
    starterParameter: "key",
    usesUrl: false,
    usesTimeout: false,
    usesSecretHeaders: false,
    parametersHelp: 'Lookup tables take exactly one parameter, named "key".',
    parametersTableHelp: "A rule reads one row of the table by its key.",
    // LookupSourceAdapter: a table is read by its key and nothing else.
    parametersProblem: (names) =>
      names.length === 1 && names[0] === "key"
        ? null
        : "Lookup tables require exactly one parameter named key",
    activeFields: (_definition, buffers) => ({
      entries: parseJsonObject(
        buffers.entries,
        "Lookup entries must be a JSON object.",
      ),
    }),
  },
  HTTP: {
    label: "HTTP GET · JSON response",
    starterParameter: "customerId",
    usesUrl: true,
    usesTimeout: true,
    usesSecretHeaders: true,
    parametersHelp:
      "Declare name, type (STRING / NUMBER / BOOLEAN), required, and optional defaultValue.",
    parametersTableHelp:
      "A rule maps a value to each parameter when it reads this source.",
    parametersProblem: () => null,
    activeFields: (definition, buffers) => ({
      url: definition.url,
      secretHeaders: secretHeaderAliases(buffers.secretHeaders),
    }),
  },
};

/** The kinds in menu order. */
export const sourceKinds: readonly SourceKind[] = ["LOOKUP", "HTTP"];

export function isSourceKind(value: string): value is SourceKind {
  return Object.hasOwn(sourceProviders, value);
}
