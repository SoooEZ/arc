import { expect, test } from "@playwright/test";
import type { Definition } from "../src/types";
import { setEditorText } from "./helpers/editor";

const definition: Definition = {
  schemaVersion: 1,
  inputs: [],
  nodes: [
    { id: "input", type: "INPUT", label: "Inputs", position: { x: 200, y: 0 } },
    {
      id: "out",
      type: "OUTPUT",
      label: "Result",
      expression: "42",
      position: { x: 200, y: 200 },
    },
  ],
  edges: [{ id: "next", source: "input", target: "out", sourceHandle: "next" }],
};

for (const outcome of ["success", "failure"] as const) {
  test(`leaving a pending graph switch ignores its late ${outcome}`, async ({
    page,
    request,
  }) => {
    const id = `command-lifecycle-${outcome}-${Date.now()}`;
    const created = await request.post("/api/rules", {
      data: { id, name: id, kind: "FORMULA", definition },
    });
    expect(created.ok()).toBeTruthy();
    const rendered = await request.post("/api/studio/render", {
      data: definition,
    });
    expect(rendered.ok()).toBeTruthy();
    const { source } = await rendered.json();
    await page.goto(`/#/studio/${id}`);
    await setEditorText(
      page,
      page.getByRole("textbox", { name: "ARC code editor", exact: true }),
      `${source}\n// Unbuilt edit`,
    );

    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held = false;
    let cancelled = false;
    let delivered = false;
    page.on("requestfailed", (failed) => {
      if (failed.url().endsWith("/api/studio/build")) cancelled = true;
    });
    await page.route("**/api/studio/build", async (route) => {
      held = true;
      await gate;
      await route.fulfill(
        outcome === "success"
          ? { json: { source, definition, diagnostics: [] } }
          : { status: 503, json: { message: "Delayed build failure" } },
      );
      delivered = true;
    });
    try {
      if (outcome === "success") {
        await page
          .getByRole("button", { name: "Graph view", exact: true })
          .click();
      } else {
        // History/hash navigation uses a separate fallback-to-code path.
        await page.evaluate((ruleId) => {
          window.location.hash = `/rules/${ruleId}`;
        }, id);
      }
      await expect.poll(() => held).toBe(true);
      page.once("dialog", (dialog) => dialog.accept());
      await page
        .getByRole("navigation", { name: "Workspace" })
        .getByRole("button", { name: "Rule library", exact: true })
        .click();
      await expect(page).toHaveURL(/#\/library$/);
      await expect.poll(() => cancelled).toBe(true);
      release();
      await expect.poll(() => delivered).toBe(true);
      await expect(page).toHaveURL(/#\/library$/);
      await expect(page.getByText("Delayed build failure")).toHaveCount(0);

      // A new session for the same rule must still build normally. Remove the
      // route first: a request that starts while Playwright turns interception
      // off can stay paused forever (here the rule read, leaving "Loading rule…").
      await page.unroute("**/api/studio/build");
      await page.evaluate((ruleId) => {
        window.location.hash = `/studio/${ruleId}`;
      }, id);
      await setEditorText(
        page,
        page.getByRole("textbox", { name: "ARC code editor", exact: true }),
        source.replace("return 42", "return 43"),
      );
      await page
        .getByRole("button", { name: "Graph view", exact: true })
        .click();
      await expect(page).toHaveURL(new RegExp(`#/rules/${id}$`));
      await page
        .getByRole("button", { name: "Save draft", exact: true })
        .click();
      await expect(page.getByText("All changes saved")).toBeVisible();
      const saved = await (await request.get(`/api/rules/${id}`)).json();
      expect(
        saved.draft.nodes.find((node: { id: string }) => node.id === "out")
          .expression,
      ).toBe("43");
    } finally {
      release();
    }
  });
}
