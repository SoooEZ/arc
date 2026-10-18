import type { TestCase, TestCaseWrite } from "../types";
import { http, pathId, type RequestOptions } from "./http";

const casesPath = (ruleId: string) => `/rules/${pathId(ruleId)}/test-cases`;

/** A rule's saved tests, oldest first; they belong to the rule, not to a version. */
export const testCaseApi = {
  list: (ruleId: string, options?: RequestOptions) =>
    http.get<TestCase[]>(casesPath(ruleId), options),
  create: (ruleId: string, write: TestCaseWrite, options?: RequestOptions) =>
    http.post<TestCase>(casesPath(ruleId), write, options),
  update: (
    ruleId: string,
    id: number,
    write: TestCaseWrite,
    options?: RequestOptions,
  ) => http.put<TestCase>(`${casesPath(ruleId)}/${id}`, write, options),
  delete: (ruleId: string, id: number, options?: RequestOptions) =>
    http.delete<void>(`${casesPath(ruleId)}/${id}`, options),
};
