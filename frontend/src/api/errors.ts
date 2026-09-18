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
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Something went wrong. Please try again.";
}
