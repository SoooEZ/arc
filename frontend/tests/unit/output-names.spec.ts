import { expect, test } from "@playwright/test";
import { multipleOutputFieldName } from "../../src/domain/outputNames";

// GraphExecution trims an unnamed Output's expression with Java's String.trim
// (U+0020 and below): a JavaScript trim also removed U+00A0 and U+3000, so
// the preview named a field the result does not have.
test("an unnamed Output's field is its expression trimmed as the server trims it", () => {
  const field = (expression: string, outputName: string | null = null) =>
    multipleOutputFieldName({ id: "out", expression, outputName });
  expect(field(" total\t")).toBe("total");
  expect(field(" total")).toBe("out");
  expect(field("total　")).toBe("out");
  expect(field("total * 2")).toBe("out");
  expect(field("total", "sum")).toBe("sum");
});
