import { expect, test } from "@playwright/test";
import { quoteText } from "../../src/domain/expressions";
import { placeholderLiteral } from "../../src/domain/placeholderLiterals";
import { formulaSnippet } from "../../src/features/studio/formulaCalls";
import {
  escapeSnippetText,
  referenceSnippet,
} from "../../src/features/studio/snippets";
import type { Definition, Input, InputType } from "../../src/types";

const inputTypes: InputType[] = [
  "NUMBER",
  "STRING",
  "BOOLEAN",
  "ARRAY",
  "OBJECT",
];

function required(name: string, type: InputType): Input {
  return { name, type, required: true, defaultValue: null };
}

const noInputs: Definition = {
  schemaVersion: 1,
  inputs: [],
  nodes: [],
  edges: [],
};

test("placeholders are type-correct ARC literals, with strings quoted by the ARC string helper", () => {
  expect(placeholderLiteral).toEqual({
    NUMBER: "0",
    STRING: quoteText("value"),
    BOOLEAN: "false",
    ARRAY: "[]",
    // null would count as a missing required input; an empty object passes.
    OBJECT: "$OBJECT()",
  });
});

test("Formula calls and Reference modules insert the same placeholder for each input type", () => {
  for (const type of inputTypes) {
    const expected = escapeSnippetText(placeholderLiteral[type]);
    const call = formulaSnippet(
      { id: "child", name: "Child", version: 1, inputs: [required("x", type)] },
      [],
    );
    expect(call).toBe(`@child:1(\${1:${expected}})`);
    const module = referenceSnippet(
      { id: "child", name: "Child" },
      {
        ruleId: "child",
        version: 1,
        publishedAt: "",
        definition: { ...noInputs, inputs: [required("x", type)] },
      },
      noInputs,
      "reuse-child-0000",
    );
    expect(module).toContain(`  bind x = ${expected};`);
  }
});
