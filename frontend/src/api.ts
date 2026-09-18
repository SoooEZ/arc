/** Public API facade; transport and endpoint domains are independently testable. */
export * from "./api/errors";
export { ruleApi } from "./api/rules";
export { studioApi } from "./api/studio";
export { sourceApi } from "./api/sources";
import { ruleApi } from "./api/rules";
import { studioApi } from "./api/studio";
import { sourceApi } from "./api/sources";
export const api = { ...ruleApi, ...studioApi, ...sourceApi };
