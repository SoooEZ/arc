import { expect, type Locator, type Page } from "@playwright/test";

export function editorSurface(input: Locator) {
  return input.locator(
    'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " monaco-editor ")][1]',
  );
}

export function editorLines(input: Locator) {
  return editorSurface(input).locator(".view-lines");
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
