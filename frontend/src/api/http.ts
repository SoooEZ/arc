import { ApiError } from "./errors";
import { isJsonObject, parseJson, stringifyJson } from "../domain/json";
export type RequestOptions = Pick<RequestInit, "signal">;

/** Successful statuses that never carry a body (the Fetch standard's null body statuses). */
const noContentStatuses = new Set([204, 205]);

const unreadableResponse = (status: number) =>
  new ApiError(
    `The server response could not be read (${status}). Check your connection and try again.`,
    [],
    status,
  );

/**
 * Reads a successful response without rounding numbers. Every other 2xx response
 * must carry a JSON document: an empty, truncated or non-JSON body (for example a
 * proxy's HTML page) rejects instead of reaching the caller as null.
 */
async function successBody(
  response: Response,
  signal: AbortSignal | null | undefined,
): Promise<unknown> {
  if (noContentStatuses.has(response.status)) return undefined;
  let text: string;
  try {
    text = await response.text();
  } catch (failure) {
    // Callers recognize their own cancellation; keep its original error.
    if (signal?.aborted) throw failure;
    throw unreadableResponse(response.status);
  }
  try {
    return parseJson(text);
  } catch {
    throw unreadableResponse(response.status);
  }
}

/** Error bodies are optional JSON; anything else still reports the status. */
async function failureBody(response: Response): Promise<unknown> {
  try {
    return parseJson(await response.text());
  } catch {
    return null;
  }
}

function requestFailure(payload: unknown, status: number): ApiError {
  const body: Record<string, unknown> = isJsonObject(payload) ? payload : {};
  const issues = Array.isArray(body.issues) ? body.issues : [];
  return new ApiError(
    body.message ? String(body.message) : `Request failed (${status})`,
    Array.isArray(body.locations) ? body.locations : [],
    status,
    issues.filter((issue): issue is string => typeof issue === "string"),
  );
}

/** Transport boundary: endpoint modules own paths and payloads, never UI state. */
export function createHttpClient(
  baseUrl = "/api",
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  /** The URL the client requests for an endpoint path, e.g. "/api/rules". */
  const url = (path: string) => `${baseUrl}${path}`;
  async function request<T>(
    path: string,
    method: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const response = await fetcher(url(path), {
      method,
      signal: options?.signal,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: stringifyJson(body) }),
    });
    if (!response.ok)
      throw requestFailure(await failureBody(response), response.status);
    // The endpoint module declares the payload type; the transport only decodes JSON.
    return (await successBody(response, options?.signal)) as T;
  }
  return {
    url,
    get: <T>(path: string, options?: RequestOptions) =>
      request<T>(path, "GET", undefined, options),
    post: <T>(path: string, body: unknown, options?: RequestOptions) =>
      request<T>(path, "POST", body, options),
    put: <T>(path: string, body: unknown, options?: RequestOptions) =>
      request<T>(path, "PUT", body, options),
    delete: <T>(path: string, options?: RequestOptions) =>
      request<T>(path, "DELETE", undefined, options),
  };
}
export const http = createHttpClient();
export const pathId = (id: string) => encodeURIComponent(id);

/**
 * The query string of a catalog request: fields left undefined are omitted,
 * every other value is written as text (an empty string stays, as `kind=`).
 */
export function queryString(
  query: Record<string, string | number | boolean | undefined>,
): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query))
    if (value !== undefined) parameters.set(key, String(value));
  return parameters.toString();
}

/** The API base as an absolute URL, e.g. "https://arc.example/api", for the reference page. */
export function apiBaseUrl(origin: string = window.location.origin): string {
  return new URL(http.url(""), origin).href;
}
