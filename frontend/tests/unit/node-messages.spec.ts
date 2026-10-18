import { test, expect } from "@playwright/test";
import { messageForNode } from "../../src/domain/text";

test("a node's own problem drops its label prefix and reads as a sentence", () => {
  expect(
    messageForNode("Check: connect the True and False exits", "Check"),
  ).toBe("Connect the True and False exits");
  expect(messageForNode("Every graph needs an Output", "Check")).toBe(
    "Every graph needs an Output",
  );
  // Only the node's own label is a prefix: another label stays in the message.
  expect(messageForNode("Other: connect it to a next step", "Check")).toBe(
    "Other: connect it to a next step",
  );
  expect(messageForNode("a: b", "")).toBe("a: b");
});
