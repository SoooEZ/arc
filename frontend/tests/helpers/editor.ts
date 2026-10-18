import {
  expect,
  type APIRequestContext,
  type Locator,
  type Page,
} from "@playwright/test";
import type { Definition, Input } from "../../src/types";
import { createRule } from "./api";
import { nodeCard } from "./canvas";

export function editorSurface(input: Locator) {
  return input.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " monaco-editor ")][1]',
  );
}

export function editorLines(input: Locator) {
  return editorSurface(input).locator(".view-lines");
}

/**
 * The text of the line holding the caret: the rendered line at the offset of
 * Monaco's current-line highlight (the editor exposes no position otherwise).
 */
export function caretLineText(input: Locator): Promise<string> {
  return editorSurface(input).evaluate((surface) => {
    const highlight = surface.querySelector(
      ".view-overlays .current-line",
    )?.parentElement;
    if (!highlight) return "";
    const top = highlight.style.top;
    const line = [...surface.querySelectorAll<HTMLElement>(".view-line")].find(
      (element) => element.style.top === top,
    );
    return (line?.textContent ?? "").replace(/ /g, " ");
  });
}

/** Exercise Monaco through its keyboard input; its textarea is not the document. */
export async function setEditorText(
  page: Page,
  input: Locator,
  source: string,
) {
  await expect(input).toBeVisible();
  await input.focus();
  await page.keyboard.press("ControlOrMeta+a");
  if (!source) {
    await page.keyboard.press("Backspace");
    return;
  }
  // Paste is the user operation for replacing a whole document. insertText
  // enters Monaco's typing path, whose quote/bracket completion may add text.
  await input.evaluate((element, text) => {
    const clipboard = new DataTransfer();
    clipboard.setData("text/plain", text);
    element.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: clipboard,
      }),
    );
  }, source);
}

/**
 * Publishes the open draft through the editor: Publish reviews the draft and
 * opens the confirmation, whose button publishes it with the optional note.
 */
export async function publishDraft(page: Page, note?: string) {
  await page.getByRole("button", { name: "Publish", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: /^Publish version \d+$/ });
  await expect(dialog).toBeVisible();
  if (note) await dialog.getByLabel("Release note (optional)").fill(note);
  await dialog.getByRole("button", { name: /^Publish v\d+$/ }).click();
  await expect(dialog).toHaveCount(0);
}

/** Unfolds the Test panel's Run options, where the trace switch and timeout are. */
export async function openRunOptions(page: Page) {
  const options = page.locator(".test-panel .run-options");
  if (
    !(await options.evaluate((element) => (element as HTMLDetailsElement).open))
  )
    await options.locator("summary").click();
}

/**
 * Creates a rule whose Input declares `inputs` and whose Output returns
 * `amount` when it is one of them, then opens it with the Input selected.
 */
export async function openInputRule(
  page: Page,
  request: APIRequestContext,
  id: string,
  inputs: Input[],
) {
  const definition: Definition = {
    schemaVersion: 1,
    inputs,
    nodes: [
      {
        id: "input",
        type: "INPUT",
        label: "Inputs",
        position: { x: 300, y: 0 },
      },
      {
        id: "output",
        type: "OUTPUT",
        label: "Result",
        expression: inputs.some((input) => input.name === "amount")
          ? "amount"
          : "7",
        position: { x: 300, y: 200 },
      },
    ],
    edges: [
      { id: "next", source: "input", target: "output", sourceHandle: "next" },
    ],
  };
  await createRule(request, {
    id,
    name: "Input editing fixture",
    kind: "FORMULA",
    definition,
  });
  await page.goto(`/#/rules/${id}`);
  await nodeCard(page, "input").click();
}
