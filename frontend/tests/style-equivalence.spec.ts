/*
 * Computed-style equivalence for stylesheet refactors; skipped unless
 * ARC_STYLE_SNAPSHOT_DIR is set. Each scenario opens a UI state and records
 * the computed style of every element (and its ::before/::after box) at
 * several viewport widths, plus forced :hover/:focus states at desktop width.
 * API responses are replayed from a recording, so text and layout repeat
 * exactly. Record once with the old stylesheets, then again with the new ones
 * and ARC_STYLE_BASELINE set: any changed value fails the scenario and is
 * written to <label>/<scenario>.diff.json.
 *
 *   ARC_STYLE_SNAPSHOT_DIR  directory for recordings; API recordings go to har/
 *   ARC_STYLE_HAR=record    record the API responses (and create the fixture
 *                           rules) instead of replaying them; run this first
 *   ARC_STYLE_LABEL         name of this recording (default "current")
 *   ARC_STYLE_BASELINE      recording to compare with
 *   ARC_STYLE_LIVENESS=1    instead of recording, write <label>.liveness.json:
 *                           which declarations win the cascade for an element
 *                           in any scenario (the rest are deletion candidates)
 *
 * Run it only against a disposable stack: record mode creates rules.
 */
import fs from "node:fs";
import path from "node:path";
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from "@playwright/test";
import {
  capture,
  capturePseudoStates,
  compareCaptures,
  declarationLiveness,
  dynamicSelectors,
  readCaptures,
  replayApi,
  settle,
  stylesheetDeclarations,
  stylesheetSelectors,
  writeCaptures,
  type Capture,
} from "./style-snapshot";
import { setEditorText } from "./helpers/editor";

const directory = process.env.ARC_STYLE_SNAPSHOT_DIR ?? "";
const recordHar = process.env.ARC_STYLE_HAR === "record";
const label = process.env.ARC_STYLE_LABEL ?? "current";
const baselineLabel = process.env.ARC_STYLE_BASELINE ?? "";
const liveness = process.env.ARC_STYLE_LIVENESS === "1";

test.skip(!directory, "Set ARC_STYLE_SNAPSHOT_DIR to record style snapshots");

const viewports = {
  desktop: { width: 1440, height: 1000 },
  wide: { width: 1680, height: 1050 },
  laptop: { width: 1200, height: 900 },
  compact: { width: 1000, height: 900 },
  tablet: { width: 860, height: 900 },
  mobile: { width: 740, height: 900 },
  narrow: { width: 560, height: 560 },
} as const;
type Viewport = keyof typeof viewports;
const every = Object.keys(viewports) as Viewport[];
const small: Viewport[] = ["desktop", "laptop", "mobile", "narrow"];

interface Scenario {
  name: string;
  viewports: Viewport[];
  /** Force :hover/:focus rules on matching elements at desktop width. */
  pseudo?: boolean;
  /** Leave the mouse where setup put it, for example over a tooltip trigger. */
  keepPointer?: boolean;
  setup: (page: Page) => Promise<void>;
}

// ------------------------------------------------------------------ fixtures

/** Every node kind, a source-bound input and a formula with a static error. */
const nodeKinds = {
  id: "style-node-kinds",
  name: "Style node kinds",
  description: "Every node kind, a source-bound input and a broken formula.",
  kind: "DECISION_TREE",
  definition: {
    schemaVersion: 1,
    notes: [],
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 120 },
      { name: "region", type: "STRING", required: false, defaultValue: "DE" },
      {
        name: "taxRate",
        type: "NUMBER",
        required: false,
        defaultValue: 0.1,
        source: {
          id: "country-tax",
          version: 1,
          bindings: { key: "region" },
          pointer: "/rate",
          onError: "DEFAULT",
        },
      },
    ],
    nodes: [
      node("input", "INPUT", "Order inputs", 300, 0),
      node("check", "CONDITION", "Large order", 300, 180, {
        expression: "amount >= 100",
      }),
      node("band", "SWITCH", "Choose region", 300, 360, {
        selector: "region",
        cases: [
          { id: "de", label: "Germany", expression: '"DE"' },
          { id: "us", label: "United States", expression: '"US"' },
        ],
      }),
      node("small", "OUTPUT", "Small order", 700, 360, {
        expression: '"small"',
      }),
      node("total", "FORMULA", "Total with tax", 0, 560, {
        expression: "amount * (1 + taxRate)",
        output: "total",
      }),
      node("shape", "TRANSFORM", "Shape summary", 0, 740, {
        fields: [
          { name: "amount", expression: "amount" },
          { name: "total", expression: "total" },
        ],
        output: "summary",
      }),
      node("reuse", "REFERENCE", "Discount", 350, 560, {
        ruleId: "apply-discount",
        version: 1,
        bindings: { amount: "amount", rate: "0.1" },
        output: "discounted",
      }),
      node("broken", "FORMULA", "Broken formula", 700, 560, {
        expression: "missing * 2",
        output: "broken",
      }),
      node("out", "OUTPUT", "Summary", 0, 920, { expression: "summary" }),
      node("out2", "OUTPUT", "Discounted", 350, 740, {
        expression: "discounted",
      }),
      node("out3", "OUTPUT", "Broken result", 700, 740, {
        expression: "broken",
      }),
    ],
    edges: [
      ["input", "check", "next"],
      ["check", "band", "true"],
      ["check", "small", "false"],
      ["band", "total", "case:de"],
      ["band", "reuse", "case:us"],
      ["band", "broken", "default"],
      ["total", "shape", "next"],
      ["shape", "out", "next"],
      ["reuse", "out2", "next"],
      ["broken", "out3", "next"],
    ].map(([source, target, sourceHandle], index) => ({
      id: `e${index + 1}`,
      source,
      target,
      sourceHandle,
    })),
  },
};

function node(
  id: string,
  type: string,
  label: string,
  x: number,
  y: number,
  fields: Record<string, unknown> = {},
) {
  return { id, type, label, position: { x, y }, ...fields };
}

/** Two overlapping cards, so the connection between them cannot be routed. */
const blockedRoutes = {
  id: "style-blocked-routes",
  name: "Style blocked routes",
  description: "Overlapping cards block their connection.",
  kind: "FORMULA",
  definition: {
    schemaVersion: 1,
    notes: [],
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 1 },
    ],
    nodes: [
      node("input", "INPUT", "Inputs", 0, 0),
      node("result", "OUTPUT", "Result", 10, 20, { expression: "amount" }),
    ],
    edges: [
      { id: "e1", source: "input", target: "result", sourceHandle: "next" },
    ],
  },
};

/** An input read from a data source when the caller omits it. */
const sourceReads = {
  id: "style-source-reads",
  name: "Style source reads",
  description: "Returns a tax rate read from a lookup source.",
  kind: "FORMULA",
  definition: {
    schemaVersion: 1,
    notes: [],
    inputs: [
      { name: "region", type: "STRING", required: true, defaultValue: "DE" },
      {
        name: "taxRate",
        type: "NUMBER",
        required: false,
        defaultValue: null,
        source: {
          id: "country-tax",
          version: 1,
          bindings: { key: "region" },
          pointer: "/rate",
          onError: "FAIL",
        },
      },
    ],
    nodes: [
      node("input", "INPUT", "Inputs", 0, 0),
      node("rate", "OUTPUT", "Tax rate", 0, 180, { expression: "taxRate" }),
    ],
    edges: [
      { id: "e1", source: "input", target: "rate", sourceHandle: "next" },
    ],
  },
};

/** A formula whose scope includes an upstream result. */
const resultVariables = {
  id: "style-result-variables",
  name: "Style result variables",
  description: "A formula that reads an upstream result.",
  kind: "FORMULA",
  definition: {
    schemaVersion: 1,
    notes: [],
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 1 },
    ],
    nodes: [
      node("input", "INPUT", "Inputs", 0, 0),
      node("double", "FORMULA", "Double", 0, 180, {
        expression: "amount * 2",
        output: "doubled",
      }),
      node("describe", "FORMULA", "Add one", 0, 360, {
        expression: "doubled + 1",
        output: "described",
      }),
      node("out", "OUTPUT", "Result", 0, 540, { expression: "described" }),
    ],
    edges: [
      { id: "e1", source: "input", target: "double", sourceHandle: "next" },
      { id: "e2", source: "double", target: "describe", sourceHandle: "next" },
      { id: "e3", source: "describe", target: "out", sourceHandle: "next" },
    ],
  },
};

async function ensureFixtures(request: APIRequestContext) {
  for (const rule of [nodeKinds, blockedRoutes, sourceReads, resultVariables]) {
    const existing = await request.get(`/api/rules/${rule.id}`);
    if (existing.ok()) continue;
    const created = await request.post("/api/rules", { data: rule });
    expect(created.ok(), await created.text()).toBeTruthy();
  }
}

// ------------------------------------------------------------------ helpers

async function open(page: Page, route: string) {
  await page.goto(`/#${route}`);
  await expect(page.locator(".app-shell")).toBeVisible();
}

async function openEditor(page: Page, route: string, nodes: number) {
  await open(page, route);
  await expect(page.locator(".react-flow__node")).toHaveCount(nodes);
  await expect(page.locator(".react-flow__edge").first()).toBeAttached();
  await expect(page.locator(".inspector-heading")).toBeVisible();
  await settle(page);
}

async function openCode(page: Page, route: string) {
  await open(page, route);
  await expect(
    page
      .getByLabel("ARC code editor", { exact: true })
      .locator(
        'xpath=ancestor::div[contains(concat(" ", normalize-space(@class), " "), " monaco-editor ")][1]',
      )
      .locator(".view-line")
      .first(),
  ).toBeVisible();
  await settle(page);
}

async function openLibrary(page: Page) {
  await open(page, "/library");
  await expect(page.locator(".rule-card").first()).toBeVisible();
  await expect(page.locator(".rule-card .preview-state")).toHaveCount(0);
}

const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

// ------------------------------------------------------------------ scenarios

const scenarios: Scenario[] = [
  {
    name: "library",
    viewports: every,
    pseudo: true,
    setup: async (page) => {
      await openLibrary(page);
    },
  },
  {
    name: "library-empty-search",
    viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await open(page, "/library");
      await page.locator(".library-toolbar input").fill("no-such-rule");
      await expect(page.locator(".empty-library")).toBeVisible();
    },
  },
  {
    name: "sidebar-expanded",
    viewports: ["desktop", "mobile", "narrow"],
    pseudo: true,
    setup: async (page) => {
      await openLibrary(page);
      await button(page, "Expand navigation").click();
      await expect(page.locator(".sidebar.is-expanded")).toBeVisible();
    },
  },
  {
    name: "create-rule-dialog",
    viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await open(page, "/library");
      await button(page, "Create rule").first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  },
  {
    name: "rule-not-found",
    viewports: ["desktop"],
    setup: async (page) => {
      await open(page, "/rules/no-such-rule");
      await expect(
        page.getByRole("heading", { name: "Rule not found" }),
      ).toBeVisible();
    },
  },
  {
    name: "editor-graph",
    viewports: every,
    pseudo: true,
    setup: async (page) => {
      await openEditor(page, "/rules/order-pricing", 7);
    },
  },
  {
    name: "editor-outline-and-edge",
    viewports: ["desktop", "mobile"],
    pseudo: true,
    setup: async (page) => {
      await openEditor(page, "/rules/order-pricing", 7);
      await button(page, "Node outline").click();
      await expect(page.locator(".node-outline")).toBeVisible();
      await page
        .locator(".react-flow__edge-interaction")
        .first()
        .dispatchEvent("click");
      await expect(page.locator(".edge-delete")).toBeVisible();
    },
  },
  {
    name: "editor-add-node-menu",
    viewports: ["desktop"],
    setup: async (page) => {
      await openEditor(page, "/rules/order-pricing", 7);
      await button(page, "Add node").click();
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  {
    name: "editor-node-context-menu",
    viewports: ["desktop"],
    setup: async (page) => {
      await openEditor(page, "/rules/order-pricing", 7);
      await page
        .locator(".react-flow__node .graph-node")
        .nth(1)
        .click({ button: "right" });
      await expect(page.getByRole("menu")).toBeVisible();
    },
  },
  ...["input", "check", "band", "total", "shape", "reuse", "out"].map(
    (id): Scenario => ({
      name: `inspector-${id}`,
      viewports: small,
      pseudo: true,
      setup: async (page) => {
        await openEditor(page, `/rules/${nodeKinds.id}?node=${id}`, 11);
        await expect(page.locator(".react-flow__node.selected")).toHaveCount(1);
        // Inline expression editors load lazily.
        await expect(page.locator(".inline-expression-loading")).toHaveCount(0);
      },
    }),
  ),
  {
    name: "inspector-errors",
    viewports: ["desktop"],
    setup: async (page) => {
      await openEditor(page, `/rules/${nodeKinds.id}?node=broken`, 11);
      await expect(page.locator(".inline-expression-loading")).toHaveCount(0);
      await page.getByRole("button", { name: /^Node errors/ }).click();
      await expect(page.locator(".inspector-error-popover")).toBeVisible();
    },
  },
  {
    name: "available-variables-tooltip",
    viewports: ["desktop"],
    keepPointer: true,
    setup: async (page) => {
      await openEditor(page, `/rules/${resultVariables.id}?node=describe`, 4);
      await expect(page.locator(".inline-expression-loading")).toHaveCount(0);
      await page
        .getByRole("button", { name: /^Available variables/ })
        .first()
        .hover();
      await expect(page.locator(".expression-variable-tooltip")).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  {
    name: "available-variables",
    viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await openEditor(page, `/rules/${nodeKinds.id}?node=total`, 11);
      await expect(page.locator(".inline-expression-loading")).toHaveCount(0);
      await page
        .getByRole("button", { name: /^Available variables/ })
        .first()
        .click();
      await expect(page.locator(".expression-variable-popover")).toBeVisible();
    },
  },
  {
    name: "node-edit-dialog",
    viewports: ["desktop", "mobile", "narrow"],
    pseudo: true,
    setup: async (page) => {
      await openEditor(page, `/rules/${nodeKinds.id}?node=input`, 11);
      await page
        .locator('.react-flow__node[data-id="band"] .graph-node')
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await expect(page.locator(".node-edit-dialog")).toBeVisible();
      await expect(page.locator(".inline-expression-loading")).toHaveCount(0);
    },
  },
  {
    name: "node-edit-dialog-input",
    viewports: ["desktop"],
    setup: async (page) => {
      await openEditor(page, `/rules/${nodeKinds.id}?node=check`, 11);
      await page
        .locator('.react-flow__node[data-id="input"] .graph-node')
        .click({ button: "right" });
      await page.getByRole("menuitem", { name: "Edit" }).click();
      await expect(page.locator(".node-edit-dialog")).toBeVisible();
      await expect(page.locator(".input-schema-card").first()).toBeVisible();
    },
  },
  {
    name: "node-code-dialog",
    viewports: ["desktop", "mobile", "narrow"],
    setup: async (page) => {
      await openEditor(page, `/rules/${nodeKinds.id}?node=total`, 11);
      await button(page, "Node expression").click();
      await expect(page.locator(".node-expression-dialog")).toBeVisible();
      await expect(
        page.locator(".node-expression-dialog .view-line").first(),
      ).toBeVisible();
      await page.locator(".function-group-heading").first().click();
      await expect(page.locator(".function-chips").first()).toBeVisible();
    },
  },
  {
    name: "expression-dialog",
    viewports: ["desktop", "narrow"],
    setup: async (page) => {
      await openEditor(page, `/rules/${nodeKinds.id}?node=check`, 11);
      await expect(page.locator(".inline-expression-loading")).toHaveCount(0);
      await page
        .getByRole("button", { name: /^Open in Editor/ })
        .first()
        .click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("dialog").locator(".view-line").first(),
      ).toBeVisible();
    },
  },
  {
    name: "source-manager-dialog",
    viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await openEditor(page, `/rules/${nodeKinds.id}?node=input`, 11);
      await button(page, "Manage data sources").first().click();
      await expect(page.locator(".source-manager-dialog")).toBeVisible();
      await expect(
        page.locator(".source-manager-dialog .source-detail h2"),
      ).toBeVisible();
    },
  },
  {
    name: "test-panel-empty",
    viewports: ["desktop", "compact", "mobile"],
    setup: async (page) => {
      await openEditor(page, "/rules/order-pricing", 7);
      await button(page, "Test rule").click();
      await expect(page.locator(".test-panel")).toBeVisible();
      await expect(
        page.locator(".test-input .view-line").first(),
      ).toBeVisible();
    },
  },
  {
    name: "test-panel-result",
    viewports: ["desktop", "compact", "mobile", "narrow"],
    pseudo: true,
    setup: async (page) => {
      await openEditor(page, "/rules/order-pricing", 7);
      await button(page, "Test rule").click();
      await expect(
        page.locator(".test-input .view-line").first(),
      ).toBeVisible();
      await button(page, "Run test").click();
      await expect(
        page.locator(".test-output .test-result, .test-output .MuiAlert-root"),
      ).toBeVisible();
    },
  },
  {
    name: "test-panel-curl",
    viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await openEditor(page, "/rules/order-pricing", 7);
      await button(page, "Test rule").click();
      await page.getByRole("tab", { name: "cURL" }).click();
      await expect(page.locator(".curl-preview")).toBeVisible();
    },
  },
  {
    name: "test-panel-error",
    viewports: ["desktop"],
    setup: async (page) => {
      await openEditor(page, `/rules/${nodeKinds.id}?node=input`, 11);
      await button(page, "Test rule").click();
      await expect(
        page.locator(".test-input .view-line").first(),
      ).toBeVisible();
      await button(page, "Run test").click();
      await expect(page.locator(".test-output .MuiAlert-root")).toBeVisible();
    },
  },
  {
    name: "published-version",
    viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await openEditor(page, "/rules/free-shipping?version=1", 4);
      await button(page, "Version history").click();
      await expect(page.locator(".version-bar")).toBeVisible();
      await expect(page.locator(".version-bar small").first()).toBeVisible();
    },
  },
  {
    name: "rule-settings",
    viewports: ["desktop"],
    setup: async (page) => {
      await openEditor(page, "/rules/order-pricing", 7);
      await button(page, "Rule settings").click();
      await expect(page.locator(".rule-settings-content")).toBeVisible();
    },
  },
  {
    name: "reference-dialog",
    viewports: ["desktop", "narrow"],
    setup: async (page) => {
      await openEditor(page, `/rules/${nodeKinds.id}?node=reuse`, 11);
      await button(page, "Open referenced rule").click();
      await expect(page.locator(".reference-dialog")).toBeVisible();
      await expect(
        page.locator(".reference-dialog .react-flow__node"),
      ).toHaveCount(3);
      await settle(page);
    },
  },
  {
    name: "code-studio",
    viewports: every,
    pseudo: true,
    setup: async (page) => {
      await openCode(page, "/studio/order-pricing");
      await page.locator(".function-group-heading").first().click();
      await expect(page.locator(".function-chips").first()).toBeVisible();
    },
  },
  {
    name: "code-studio-modules",
    viewports: ["desktop", "narrow"],
    pseudo: true,
    setup: async (page) => {
      await openCode(page, "/studio/order-pricing");
      await page.locator(".studio-tabs button", { hasText: "modules" }).click();
      await expect(page.locator(".snippet-card").first()).toBeVisible();
    },
  },
  {
    name: "code-studio-formulas",
    viewports: ["desktop"],
    pseudo: true,
    setup: async (page) => {
      await openCode(page, "/studio/order-pricing");
      await page
        .locator(".function-scope button", { hasText: "Formulas" })
        .click();
      await expect(
        page.locator(".published-formula-results .snippet-card").first(),
      ).toBeVisible();
    },
  },
  {
    name: "code-studio-function-tooltip",
    viewports: ["desktop"],
    keepPointer: true,
    setup: async (page) => {
      await openCode(page, "/studio/order-pricing");
      await page.locator(".function-group-heading").first().click();
      await page.locator(".function-chips .MuiChip-root").first().hover();
      await expect(page.locator(".function-tooltip")).toBeVisible();
      await page.waitForTimeout(400);
    },
  },
  {
    name: "code-studio-problems",
    viewports: ["desktop", "narrow"],
    pseudo: true,
    setup: async (page) => {
      await openCode(page, "/studio/free-shipping");
      await setEditorText(
        page,
        page.getByLabel("ARC code editor", { exact: true }),
        "rule broken {",
      );
      await button(page, "Build graph").click();
      await expect(page.locator(".studio-problems.has-errors")).toBeVisible();
    },
  },
  {
    name: "routing-warning",
    viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await open(page, `/rules/${blockedRoutes.id}`);
      await expect(page.locator(".react-flow__node")).toHaveCount(2);
      await expect(page.locator(".routing-warning")).toBeVisible();
    },
  },
  {
    name: "test-panel-source-reads",
    viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await openEditor(page, `/rules/${sourceReads.id}`, 2);
      await button(page, "Test rule").click();
      await setEditorText(
        page,
        page.getByLabel("Test input JSON", { exact: true }),
        '{"region": "DE"}',
      );
      await button(page, "Run test").click();
      await expect(page.locator(".source-reads")).toBeVisible();
    },
  },
  {
    name: "test-panel-false-branch",
    viewports: ["desktop"],
    setup: async (page) => {
      await openEditor(page, "/rules/free-shipping", 4);
      await button(page, "Test rule").click();
      await setEditorText(
        page,
        page.getByLabel("Test input JSON", { exact: true }),
        '{"amount": 50}',
      );
      await button(page, "Run test").click();
      await expect(page.locator(".trace-branch.false")).toBeVisible();
    },
  },
  {
    name: "sources",
    viewports: every,
    pseudo: true,
    setup: async (page) => {
      await open(page, "/sources");
      await expect(page.locator(".source-detail h2")).toBeVisible();
    },
  },
  {
    name: "sources-test-result",
    viewports: ["desktop", "mobile"],
    setup: async (page) => {
      await open(page, "/sources");
      await expect(page.locator(".source-detail h2")).toBeVisible();
      await button(page, "Fetch sample").click();
      await expect(page.locator(".source-test .source-json")).toBeVisible();
    },
  },
  {
    name: "playground",
    viewports: every,
    setup: async (page) => {
      await open(page, "/playground");
      await expect(page.locator(".parameter-chips")).toBeVisible();
      await expect(
        page.locator(".api-request .view-line").first(),
      ).toBeVisible();
    },
  },
  {
    name: "playground-response",
    viewports: ["desktop", "compact", "mobile"],
    setup: async (page) => {
      await open(page, "/playground");
      await expect(page.locator(".parameter-chips")).toBeVisible();
      await button(page, "Execute rule").click();
      await expect(page.locator(".api-response pre")).toBeVisible();
    },
  },
  {
    name: "playground-rule-select",
    viewports: ["desktop"],
    setup: async (page) => {
      await open(page, "/playground");
      await expect(page.locator(".parameter-chips")).toBeVisible();
      await expect(
        page.locator(".api-request .view-line").first(),
      ).toBeVisible();
      await page.getByRole("combobox", { name: "Rule" }).click();
      await expect(page.getByRole("listbox")).toBeVisible();
    },
  },
  {
    name: "docs",
    viewports: every,
    setup: async (page) => {
      await open(page, "/docs");
      await expect(page.locator(".endpoint-table")).toBeVisible();
      await expect(page.locator(".parameter-chips")).toBeVisible();
    },
  },
];

// ------------------------------------------------------------------ runner

const recordingDir = (name: string) => path.join(directory, name);
const harFile = (scenario: string) =>
  path.join(directory, "har", `${scenario}.har`);
const captureFile = (recording: string, scenario: string) =>
  path.join(recordingDir(recording), `${scenario}.json.gz`);
const pseudoPairsFile = () => path.join(directory, "pseudo-selectors.json");

/**
 * Accumulates the declarations proven to win somewhere across scenarios and
 * viewports; declarations never proven live are candidates for deletion.
 */
async function recordLiveness(page: Page, scenario: Scenario) {
  const file = path.join(directory, `${label}.liveness.json`);
  const state = fs.existsSync(file)
    ? (JSON.parse(fs.readFileSync(file, "utf8")) as {
        live: string[];
        tested: string[];
        declarations: string[][];
      })
    : { live: [], tested: [], declarations: [] as string[][] };
  if (!state.declarations.length)
    state.declarations = await stylesheetDeclarations(page);
  const live = new Set(state.live);
  const tested = new Set(state.tested);
  for (const viewport of scenario.viewports) {
    await page.setViewportSize(viewports[viewport]);
    await page.waitForTimeout(250);
    const result = await declarationLiveness(page, [...live]);
    result.live.forEach((key) => live.add(key));
    result.tested.forEach((key) => tested.add(key));
  }
  fs.writeFileSync(
    file,
    JSON.stringify({
      live: [...live].sort(),
      tested: [...tested].sort(),
      declarations: state.declarations,
    }),
  );
}

/** Every viewport, then the forced pseudo-class states at desktop width. */
async function recordStyles(page: Page, scenario: Scenario) {
  const captures: Capture[] = [];
  for (const viewport of scenario.viewports) {
    await page.setViewportSize(viewports[viewport]);
    await page.waitForTimeout(250);
    const state = `${scenario.name}@${viewport}`;
    captures.push(await capture(page, state, scenario.keepPointer));
  }
  if (scenario.pseudo) {
    await page.setViewportSize(viewports.desktop);
    // The first recording fixes the forced states, so later runs force the same.
    if (!fs.existsSync(pseudoPairsFile()))
      fs.writeFileSync(
        pseudoPairsFile(),
        JSON.stringify(await dynamicSelectors(page), null, 1),
      );
    const pairs = JSON.parse(
      fs.readFileSync(pseudoPairsFile(), "utf8"),
    ) as string[];
    const state = `${scenario.name}@desktop`;
    captures.push(...(await capturePseudoStates(page, state, pairs)));
  }
  return captures;
}

/** The stylesheet's selectors, for coverage: which never matched a recorded element. */
async function recordSelectorList(page: Page) {
  const file = path.join(recordingDir(label), "selectors.json");
  if (fs.existsSync(file)) return;
  fs.mkdirSync(recordingDir(label), { recursive: true });
  fs.writeFileSync(
    file,
    JSON.stringify(await stylesheetSelectors(page), null, 1),
  );
}

function compareWithBaseline(scenario: Scenario, captures: Capture[]) {
  const comparison = compareCaptures(
    readCaptures(captureFile(baselineLabel, scenario.name)),
    captures,
  );
  fs.writeFileSync(
    path.join(recordingDir(label), `${scenario.name}.diff.json`),
    JSON.stringify(comparison, null, 1),
  );
  expect(comparison.missingStates).toEqual([]);
  expect(comparison.structural).toEqual([]);
  expect(
    comparison.differences
      .slice(0, 20)
      .map(
        (d) =>
          `${d.state} ${d.key} ${d.element} ${d.property}: ${d.before} -> ${d.after}`,
      ),
  ).toEqual([]);
}

for (const scenario of scenarios) {
  test(`style snapshot: ${scenario.name}`, async ({
    browser,
    baseURL,
    request,
  }) => {
    test.setTimeout(240_000);
    if (recordHar) await ensureFixtures(request);
    fs.mkdirSync(path.join(directory, "har"), { recursive: true });
    const context = await browser.newContext({
      baseURL,
      viewport: viewports.desktop,
      ...(recordHar
        ? {
            recordHar: {
              path: harFile(scenario.name),
              urlFilter: /\/api\//,
              content: "embed" as const,
            },
          }
        : {}),
    });
    const unmatched: string[] = [];
    if (!recordHar) await replayApi(context, harFile(scenario.name), unmatched);
    const page = await context.newPage();
    let captures: Capture[] = [];
    try {
      await scenario.setup(page);
      await recordSelectorList(page);
      if (liveness) await recordLiveness(page, scenario);
      else captures = await recordStyles(page, scenario);
    } finally {
      await context.close();
    }
    expect(unmatched, "API requests missing from the recording").toEqual([]);
    if (liveness) return;
    writeCaptures(captureFile(label, scenario.name), captures);
    if (baselineLabel) compareWithBaseline(scenario, captures);
  });
}
