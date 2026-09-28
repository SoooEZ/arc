export interface ErrorLocation {
  ruleId: string | null;
  version: number | null;
  nodeId: string;
  label: string;
}
export interface GraphProblem {
  message: string;
  locations: ErrorLocation[];
}
export class ApiError extends Error {
  constructor(
    message: string,
    public readonly locations: ErrorLocation[] = [],
    public readonly status?: number,
    /** The body's `issues`: for most errors the message again, for a refused deletion every caller. */
    public readonly issues: string[] = [],
  ) {
    super(message);
    this.name = "ApiError";
  }
}
/** The issues that say more than the message, such as the callers of a rule that cannot be deleted. */
export function errorDetails(error: unknown): string[] {
  if (!(error instanceof ApiError)) return [];
  return error.issues.filter((issue) => issue !== error.message);
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
