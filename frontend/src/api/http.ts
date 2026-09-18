import { ApiError } from "./errors";
export type RequestOptions = Pick<RequestInit, "signal">;
/** Transport boundary: endpoint modules own paths and payloads, never UI state. */
export function createHttpClient(
  baseUrl = "/api",
  fetcher: typeof fetch = (...args) => fetch(...args),
) {
  async function request<T>(
    path: string,
    method: string,
    body?: unknown,
    options?: RequestOptions,
  ): Promise<T> {
    const response = await fetcher(`${baseUrl}${path}`, {
      method,
      signal: options?.signal,
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok)
      throw new ApiError(
        payload?.message || `Request failed (${response.status})`,
        payload?.locations || [],
        response.status,
      );
    return payload as T;
  }
  return {
    get: <T>(path: string, options?: RequestOptions) =>
      request<T>(path, "GET", undefined, options),
    post: <T>(path: string, body: unknown, options?: RequestOptions) =>
      request<T>(path, "POST", body, options),
    put: <T>(path: string, body: unknown, options?: RequestOptions) =>
      request<T>(path, "PUT", body, options),
  };
}
export const http = createHttpClient();
export const pathId = (id: string) => encodeURIComponent(id);
