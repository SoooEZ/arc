import { expect, type Locator, type Page } from "@playwright/test";

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
