import { expect, test } from "@playwright/test";
import { parseCssColor } from "../../src/features/studio/cssColor";

test("a token color reaches Monaco as #rrggbb whatever its CSS spelling", () => {
  // The studio threw on a 3-digit token and never opened.
  expect(parseCssColor("#abc")).toBe("#aabbcc");
  expect(parseCssColor("#ABCD")).toBe("#aabbcc");
  expect(parseCssColor(" #8B682F ")).toBe("#8b682f");
  expect(parseCssColor("#8b682f80")).toBe("#8b682f");
  expect(parseCssColor("rgb(1, 2, 3)")).toBe("#010203");
  expect(parseCssColor("rgba(255, 0, 128, 0.5)")).toBe("#ff0080");
  expect(parseCssColor("rgb(1 2 3 / 50%)")).toBe("#010203");
  for (const other of ["", "red", "hsl(1, 2%, 3%)", "rgb(256, 0, 0)", "#12"])
    expect(parseCssColor(other), other).toBeNull();
});
