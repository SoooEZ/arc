import { expect, test } from "@playwright/test";
import {
  isResourceId,
  resourceIdGuidance,
  suggestedRuleId,
} from "../../src/domain/resourceIds";

test("rule and source IDs share the server's resource slug policy", () => {
  for (const valid of ["a", "tax", "customer-profile", "a1-", "a".repeat(80)])
    expect(isResourceId(valid), valid).toBe(true);
  for (const invalid of [
    "",
    "1st-source",
    "-tax",
    "Customer",
    "customer_profile",
    "customer profile",
    "customer-profile ",
    "tax$",
    "tax@v1",
    "tax\n",
    "a".repeat(81),
  ])
    expect(isResourceId(invalid), JSON.stringify(invalid)).toBe(false);
  expect(resourceIdGuidance).toContain("Maximum 80 characters");
});

test("suggested rule IDs always satisfy the policy", () => {
  expect(suggestedRuleId("Tax rules")).toBe("tax-rules");
  expect(suggestedRuleId("2026 Pricing")).toBe("rule-2026-pricing");
  expect(suggestedRuleId("$ @ !")).toBe("");
  const long = suggestedRuleId(`Pricing ${"x".repeat(100)}`);
  expect(long).toHaveLength(80);
  expect(isResourceId(long)).toBe(true);
});
