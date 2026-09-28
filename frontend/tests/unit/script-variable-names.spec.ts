import { expect, test } from "@playwright/test";
import { scriptVariableNames } from "../../src/domain/expressionSymbols";
import { uniqueName } from "../../src/domain/ids";

test("an unbuilt buffer's declared names count when a result name is generated", () => {
  const source = `inputs { amount: NUMBER required; rate: NUMBER optional; }
node calc FORMULA "Calc" { let result_1 = amount * 2; next -> reuse; }
node reuse REFERENCE "Reuse" { use "child" version 1; bind x = 1; as result_2; next -> out; }
node out OUTPUT "Result" { return result_2; as total; }`;
  // Output aliases and bind targets are not variables; inputs, lets and stored results are.
  expect(scriptVariableNames(source)).toEqual([
    "amount",
    "rate",
    "result_1",
    "result_2",
  ]);
  expect(uniqueName("result_", ["price", ...scriptVariableNames(source)])).toBe(
    "result_3",
  );
  expect(scriptVariableNames("")).toEqual([]);
});
