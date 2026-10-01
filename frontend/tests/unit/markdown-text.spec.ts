import { expect, test } from "@playwright/test";
import { markdownText } from "../../src/domain/text";

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
