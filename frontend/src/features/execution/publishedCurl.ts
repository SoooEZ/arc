import { ruleApi } from "../../api/rules";
import {
  curlExample,
  tryParseExecutionInputs,
} from "../../domain/executionInputs";
import type { ExecutionOptions } from "../../types";

/**
 * The cURL example for the published endpoint of `ruleId`, from the input
 * buffer as typed: text that is not a JSON object sends empty inputs.
 */
export function publishedCurl(
  ruleId: string,
  inputText: string,
  version: number | null,
  options: Required<ExecutionOptions>,
): string {
  return curlExample(
    ruleApi.executeUrl(ruleId),
    tryParseExecutionInputs(inputText),
    version,
    options,
  );
}
