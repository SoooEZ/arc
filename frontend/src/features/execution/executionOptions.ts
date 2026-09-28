/**
 * The execution options every execution surface (the editor's Test panel and
 * the API playground) offers, with the server's defaults (`trace` on, the
 * 30,000 ms timeout ceiling) so the request, the cURL example and the fields
 * agree on one value.
 */
export const executionTimeoutChoicesMs = [1000, 5000, 10000, 30000] as const;

export const defaultExecutionOptions = {
  trace: true,
  timeoutMs: 30_000,
} as const satisfies { trace: boolean; timeoutMs: number };
