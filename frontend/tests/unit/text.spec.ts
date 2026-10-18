import { expect, test } from "@playwright/test";
import { counted, listed } from "../../src/domain/text";

// Counts were pluralized inline in fifteen places, and one of them shipped "1 inputs".
test("a count agrees with its noun, regular or not", () => {
  expect(counted(0, "input")).toBe("0 inputs");
  expect(counted(1, "input")).toBe("1 input");
  expect(counted(2, "input parameter")).toBe("2 input parameters");
  expect(counted(1, "entry", "entries")).toBe("1 entry");
  expect(counted(3, "entry", "entries")).toBe("3 entries");
});

test("names read as an English list", () => {
  expect(listed([])).toBe("");
  expect(listed(["a"])).toBe("a");
  expect(listed(["a", "b"])).toBe("a and b");
  expect(listed(["a", "b", "c"])).toBe("a, b and c");
});
