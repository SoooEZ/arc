import { expect, test } from "@playwright/test";
import {
  counted,
  listed,
  markdownText,
  messageForNode,
} from "../../src/domain/text";

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

// Editor hovers render Markdown, and node labels, rule names and default
// values are the user's: "Net *price*" lost its stars and a "[docs](…)" label
// became a link.
test("text shown in a Markdown hover keeps every character as written", () => {
  expect(markdownText("Net *price*")).toBe("Net \\*price\\*");
  expect(markdownText("[docs](https://example.com)")).toBe(
    "\\[docs\\]\\(https://example\\.com\\)",
  );
  expect(markdownText("# 1. <b>_a_</b> `x` ~y~ a|b & c\\d!")).toBe(
    "\\# 1\\. \\<b\\>\\_a\\_\\</b\\> \\`x\\` \\~y\\~ a\\|b \\& c\\\\d\\!",
  );
  expect(markdownText("Plain label 2")).toBe("Plain label 2");
});
