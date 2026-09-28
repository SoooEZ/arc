import { expect, test } from "@playwright/test";
import { shownInputs } from "../../src/domain/executionInputs";

test("an untouched input buffer follows the current sample", () => {
  expect(shownInputs(null, '["tax",1]', '{"amount": 1}')).toBe('{"amount": 1}');
  expect(shownInputs(null, '["tax",1]', '{"amount": 2}')).toBe('{"amount": 2}');
});

test("typed inputs stay with their target and never move to another", () => {
  const edited = { target: '["tax",1]', text: '{"amount": 250}' };
  // The sample changes (an input was added) but the typed text is kept.
  expect(shownInputs(edited, '["tax",1]', '{"amount": 1, "tier": ""}')).toBe(
    '{"amount": 250}',
  );
  // Another rule or version shows its own sample.
  expect(shownInputs(edited, '["tax",2]', '{"rate": 0.1}')).toBe(
    '{"rate": 0.1}',
  );
  // Invalid JSON stays editable as typed.
  expect(
    shownInputs({ target: "preview", text: '{"amount":' }, "preview", "{}"),
  ).toBe('{"amount":');
});
