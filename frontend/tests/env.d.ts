/**
 * The one Node global the type-checked tests and the Playwright configuration
 * read. @types/node is not a dependency; adding it replaces this declaration.
 */
declare const process: { env: Record<string, string | undefined> };
