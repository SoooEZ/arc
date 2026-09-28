/*
 * Computed-style snapshots for stylesheet refactors (used by
 * style-equivalence.spec.ts). A snapshot records getComputedStyle for every
 * element, its ::before/::after boxes and forced :hover/:focus states, so two
 * builds can be compared value by value. Run it against a production build:
 * coverage and liveness read the bundled /assets/index-*.css stylesheet.
 */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import type { BrowserContext, CDPSession, Page } from "@playwright/test";

/** [key, tag, classes, style, ::before style or null, ::after style or null] */
export type Row = [
  string,
  string,
  string,
  number[],
  number[] | null,
  number[] | null,
];

export interface Capture {
  state: string;
  properties: string[];
  /** Computed values; rows refer to them by index. */
  values: string[];
  rows: Row[];
  /** Application stylesheet selectors that matched at least one element. */
  matched: string[];
}

export interface Difference {
  state: string;
  key: string;
  element: string;
  property: string;
  before: string;
  after: string;
}

export interface Comparison {
  elements: number;
  comparedValues: number;
  differences: Difference[];
  /** Elements present in only one snapshot, or with another tag. */
  structural: string[];
  missingStates: string[];
}

// ---------------------------------------------------------------- page side

interface StyleRule {
  /** Position in the stylesheet, e.g. "12" or "40/3" inside a media rule. */
  id: string;
  media: string;
  /** Whether the enclosing media queries match the viewport now. */
  applies: boolean;
  rule: CSSStyleRule;
  selectors: string[];
}

interface PageTools {
  capture(root: { selector: string; index: number } | null): {
    properties: string[];
    values: string[];
    rows: Row[];
    matched: string[];
  };
  selectors(): string[];
  dynamicSelectors(): string[];
  declarations(): string[][];
  liveness(known: string[]): { live: string[]; tested: string[] };
}

declare global {
  interface Window {
    arcStyleTools?: PageTools;
  }
}

/**
 * Runs in the page and installs window.arcStyleTools. page.evaluate sends one
 * function without its closure, so every page-side helper lives in here.
 */
function installPageTools() {
  if (window.arcStyleTools) return;
  const dynamicPseudo = /:(hover|focus-visible|focus-within|focus|active)\b/g;
  const generatedPseudo = /::?(before|after|placeholder)\b/g;

  const splitList = (text: string) => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i <= text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      else if (i === text.length || (text[i] === "," && depth === 0)) {
        parts.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    return parts;
  };

  const styleRules = () => {
    const sheet = Array.from(document.styleSheets).find((candidate) =>
      /\/assets\/index-[^/]+\.css$/.test(candidate.href ?? ""),
    );
    const found: StyleRule[] = [];
    const visit = (
      rules: CSSRuleList,
      prefix: string,
      media: string,
      applies: boolean,
    ) => {
      Array.from(rules).forEach((rule, index) => {
        const id = `${prefix}${index}`;
        if (rule instanceof CSSMediaRule)
          visit(
            rule.cssRules,
            `${id}/`,
            `@media ${rule.conditionText} `,
            applies && matchMedia(rule.conditionText).matches,
          );
        else if (rule instanceof CSSStyleRule)
          found.push({
            id,
            media,
            applies,
            rule,
            selectors: splitList(rule.selectorText),
          });
      });
    };
    if (sheet) visit(sheet.cssRules, "", "", true);
    return found;
  };

  /** A selector's elements, ignoring dynamic pseudo-classes and generated boxes. */
  const matchesAny = (selector: string) => {
    const base = selector
      .replace(generatedPseudo, "")
      .replace(dynamicPseudo, "")
      .trim();
    try {
      return !!document.querySelector(base || "*");
    } catch {
      return false;
    }
  };

  const capture: PageTools["capture"] = (root) => {
    const properties = Array.from(
      getComputedStyle(document.documentElement),
    ).filter((property) => !property.startsWith("--"));
    const values: string[] = [];
    const index = new Map<string, number>();
    const encode = (value: string) => {
      let id = index.get(value);
      if (id === undefined) {
        id = values.length;
        values.push(value);
        index.set(value, id);
      }
      return id;
    };
    const read = (style: CSSStyleDeclaration) =>
      properties.map((property) => encode(style.getPropertyValue(property)));
    const generated = (element: Element, pseudo: string) => {
      const style = getComputedStyle(element, pseudo);
      const content = style.getPropertyValue("content");
      return content === "none" || content === "normal" ? null : read(style);
    };
    const rows: Row[] = [];
    const visit = (element: Element, key: string) => {
      const classes = (element.getAttribute("class") ?? "")
        .split(/\s+/)
        .filter((name) => name && !/^css-/.test(name))
        .join(" ");
      rows.push([
        key,
        element.localName,
        classes,
        read(getComputedStyle(element)),
        generated(element, "::before"),
        generated(element, "::after"),
      ]);
      Array.from(element.children).forEach((child, position) =>
        visit(child, `${key}/${position}`),
      );
    };
    if (root) {
      const element = document.querySelectorAll(root.selector)[root.index];
      if (element) visit(element, "root");
      return { properties, values, rows, matched: [] };
    }
    const html = document.documentElement;
    rows.push(["html", "html", "", read(getComputedStyle(html)), null, null]);
    visit(document.body, "body");
    const matched = styleRules().flatMap(({ media, selectors }) =>
      selectors.filter(matchesAny).map((selector) => `${media}${selector}`),
    );
    return { properties, values, rows, matched };
  };

  const selectors = () =>
    styleRules().flatMap(({ media, selectors }) =>
      selectors.map((selector) => `${media}${selector}`),
    );

  /** [pseudo-class, selector of the element that takes it] pairs. */
  const dynamicSelectors = () => {
    const found = new Set<string>();
    const combinator = /[\s>+~]/;
    for (const { selectors } of styleRules())
      for (const selector of selectors) {
        const match = /:(hover|focus-visible|focus-within|active)\b/.exec(
          selector,
        );
        if (!match) continue;
        // The pseudo-class belongs to its compound selector: keep the rest of
        // that compound and drop everything after it.
        let end = match.index + match[0].length;
        while (end < selector.length && !combinator.test(selector[end])) end++;
        const subject =
          selector.slice(0, match.index) +
          selector.slice(match.index + match[0].length, end);
        found.add(`${match[1]}\u0000${subject.trim()}`);
      }
    return [...found].sort();
  };

  const declarations = () =>
    styleRules().flatMap(({ id, media, rule }) =>
      Array.from(rule.style).map((property) => [
        id,
        media,
        rule.selectorText,
        property,
        rule.style.getPropertyValue(property),
        rule.style.getPropertyPriority(property),
      ]),
    );

  /**
   * A declaration wins the cascade for an element when replacing its value
   * with a sentinel (initial, inherit, or a colour, length or keyword the
   * property accepts) changes that element's computed value. Rules behind
   * dynamic pseudo-classes are not tested.
   */
  const liveness = (known: string[]) => {
    const alreadyLive = new Set(known);
    const live: string[] = [];
    const tested: string[] = [];
    const sentinels = (property: string) => [
      "initial",
      "inherit",
      ...["rgb(1, 2, 3)", "12345px", "7", "sticky", "grid"].filter(
        (candidate) => CSS.supports(property, candidate),
      ),
    ];
    for (const { id, applies, rule, selectors } of styleRules()) {
      if (!applies) continue;
      const targets: [Element, string | null][] = [];
      for (const selector of selectors) {
        if (new RegExp(dynamicPseudo.source).test(selector)) continue;
        const pseudo = /::(before|after)\b/.exec(selector)?.[0] ?? null;
        const base = selector.replace(generatedPseudo, "").trim() || "*";
        for (const element of Array.from(document.querySelectorAll(base)))
          targets.push([element, pseudo]);
      }
      if (!targets.length) continue;
      const style = rule.style;
      for (const property of Array.from(style)) {
        const key = `${id}|${property}`;
        if (property.startsWith("--") || alreadyLive.has(key)) continue;
        tested.push(key);
        const value = style.getPropertyValue(property);
        const priority = style.getPropertyPriority(property);
        const read = () =>
          targets
            .map(([element, pseudo]) =>
              getComputedStyle(element, pseudo).getPropertyValue(property),
            )
            .join("\u0001");
        const before = read();
        const wins = sentinels(property).some((sentinel) => {
          style.setProperty(property, sentinel, priority);
          return read() !== before;
        });
        style.setProperty(property, value, priority);
        if (wins) live.push(key);
      }
    }
    return { live, tested };
  };

  window.arcStyleTools = {
    capture,
    selectors,
    dynamicSelectors,
    declarations,
    liveness,
  };
}

async function tools(page: Page) {
  await page.evaluate(installPageTools);
}

// ---------------------------------------------------------------- node side

/** Waits for fonts, network and transitions, and freezes endless animations. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => undefined);
  await page.evaluate(async () => {
    await document.fonts.ready;
    const finite = () =>
      document
        .getAnimations()
        .filter(
          (animation) =>
            animation.playState === "running" &&
            animation.effect?.getTiming().iterations !== Infinity,
        );
    for (let attempt = 0; attempt < 50 && finite().length; attempt++)
      await new Promise((resolve) => setTimeout(resolve, 50));
    // Endless animations (animated edges, spinners) stop at their start.
    for (const animation of document.getAnimations())
      if (animation.effect?.getTiming().iterations === Infinity) {
        animation.pause();
        animation.currentTime = 0;
      }
    // Execution timing is measured by the browser; mask it so text is stable.
    for (const element of Array.from(document.querySelectorAll("span"))) {
      if (/^Request \d+(\.\d+)? ms$/.test(element.textContent ?? ""))
        element.textContent = "Request 0.00 ms";
    }
    // A focused Monaco editor blinks its cursor with an animation.
    const active = document.activeElement;
    if (active instanceof HTMLElement && active.closest(".monaco-editor"))
      active.blur();
    await new Promise((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(resolve)),
    );
  });
  await page.waitForTimeout(150);
}

/** `keepPointer` leaves the mouse where the scenario put it, e.g. over a tooltip trigger. */
export async function capture(
  page: Page,
  state: string,
  keepPointer = false,
): Promise<Capture> {
  if (!keepPointer) await page.mouse.move(1, 1);
  await settle(page);
  await tools(page);
  const result = await page.evaluate(() => window.arcStyleTools!.capture(null));
  return { state, ...result };
}

/**
 * Forces each [pseudo-class, selector] pair on up to two matching elements and
 * records their subtrees. The pairs come from the first recording, so both
 * builds force the same states.
 */
export async function capturePseudoStates(
  page: Page,
  state: string,
  pairs: string[],
): Promise<Capture[]> {
  const captures: Capture[] = [];
  const cdp: CDPSession = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  await page.mouse.move(1, 1);
  await settle(page);
  await tools(page);
  for (const pair of pairs) {
    const [pseudo, selector] = pair.split("\u0000");
    const { root } = await cdp.send("DOM.getDocument", { depth: 0 });
    let nodeIds: number[] = [];
    try {
      ({ nodeIds } = await cdp.send("DOM.querySelectorAll", {
        nodeId: root.nodeId,
        selector,
      }));
    } catch {
      continue;
    }
    for (const [index, nodeId] of nodeIds.slice(0, 2).entries()) {
      await cdp.send("CSS.forcePseudoState", {
        nodeId,
        forcedPseudoClasses: [pseudo],
      });
      await settle(page);
      const result = await page.evaluate(
        (target) => window.arcStyleTools!.capture(target),
        { selector, index },
      );
      captures.push({
        state: `${state}#${pseudo}:${selector}[${index}]`,
        ...result,
      });
      await cdp.send("CSS.forcePseudoState", {
        nodeId,
        forcedPseudoClasses: [],
      });
    }
  }
  await settle(page);
  await cdp.detach();
  return captures;
}

/** [pseudo-class, element selector] pairs for the :hover/:focus rules. */
export async function dynamicSelectors(page: Page): Promise<string[]> {
  await tools(page);
  return page.evaluate(() => window.arcStyleTools!.dynamicSelectors());
}

/** Every selector of the application stylesheet, prefixed with its media. */
export async function stylesheetSelectors(page: Page): Promise<string[]> {
  await tools(page);
  return page.evaluate(() => window.arcStyleTools!.selectors());
}

/** [id, media, selector, longhand, value, priority] for every declaration. */
export async function stylesheetDeclarations(page: Page) {
  await tools(page);
  return page.evaluate(() => window.arcStyleTools!.declarations());
}

/** Declarations (id|longhand) that win the cascade for an element now. */
export async function declarationLiveness(page: Page, known: string[]) {
  await page.mouse.move(1, 1);
  await settle(page);
  await tools(page);
  return page.evaluate((known) => window.arcStyleTools!.liveness(known), known);
}

// ---------------------------------------------------------------- recording

interface HarEntry {
  request: { method: string; url: string; postData?: { text?: string } };
  response: {
    status: number;
    headers: { name: string; value: string }[];
    content: { text?: string; encoding?: string };
  };
}

/**
 * Replays recorded API responses in request order per method, URL and body.
 * Requests missing from the recording go to the server and are reported.
 */
export async function replayApi(
  context: BrowserContext,
  harFile: string,
  unmatched: string[],
) {
  const har = JSON.parse(fs.readFileSync(harFile, "utf8")) as {
    log: { entries: HarEntry[] };
  };
  const queues = new Map<string, HarEntry[]>();
  const keyOf = (method: string, url: string, body: string | null) =>
    `${method} ${new URL(url).pathname}${new URL(url).search} ${body ?? ""}`;
  for (const entry of har.log.entries) {
    const key = keyOf(
      entry.request.method,
      entry.request.url,
      entry.request.postData?.text ?? null,
    );
    queues.set(key, [...(queues.get(key) ?? []), entry]);
  }
  await context.route(/\/api\//, async (route) => {
    const request = route.request();
    const key = keyOf(request.method(), request.url(), request.postData());
    const queue = queues.get(key);
    if (!queue?.length) {
      unmatched.push(key);
      await route.continue();
      return;
    }
    // Repeated requests get the recorded responses in order; the last repeats.
    const entry = queue.length > 1 ? queue.shift()! : queue[0];
    const { content } = entry.response;
    const body =
      content.encoding === "base64"
        ? Buffer.from(content.text ?? "", "base64")
        : (content.text ?? "");
    const headers = Object.fromEntries(
      entry.response.headers
        .filter(
          ({ name }) =>
            !/^(content-length|content-encoding|transfer-encoding)$/i.test(
              name,
            ),
        )
        .map(({ name, value }) => [name, value]),
    );
    await route.fulfill({ status: entry.response.status, headers, body });
  });
}

export function writeCaptures(file: string, captures: Capture[]) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, zlib.gzipSync(JSON.stringify(captures)));
}

export function readCaptures(file: string): Capture[] {
  return JSON.parse(zlib.gunzipSync(fs.readFileSync(file)).toString("utf8"));
}

// ---------------------------------------------------------------- comparison

/**
 * Body children are portals (dialogs, menus, Monaco's helpers) whose order
 * depends on which finished loading first, so they are keyed by tag, first
 * class and occurrence instead of position.
 */
function portalKeys(rows: Row[]): Map<string, Row> {
  const renamed = new Map<string, string>();
  const occurrences = new Map<string, number>();
  for (const row of rows) {
    if (!/^body\/\d+$/.test(row[0])) continue;
    const signature = `${row[1]}.${row[2].split(" ")[0]}`;
    const occurrence = occurrences.get(signature) ?? 0;
    occurrences.set(signature, occurrence + 1);
    renamed.set(row[0], `body/${signature}#${occurrence}`);
  }
  const keyed = new Map<string, Row>();
  for (const row of rows) {
    const [, portal, rest] = /^(body\/\d+)(\/.*)?$/.exec(row[0]) ?? [];
    const key =
      portal && renamed.has(portal)
        ? renamed.get(portal)! + (rest ?? "")
        : row[0];
    keyed.set(key, row);
  }
  return keyed;
}

export function compareCaptures(
  baseline: Capture[],
  current: Capture[],
): Comparison {
  const result: Comparison = {
    elements: 0,
    comparedValues: 0,
    differences: [],
    structural: [],
    missingStates: [],
  };
  const currentByState = new Map(current.map((c) => [c.state, c]));
  for (const before of baseline) {
    const after = currentByState.get(before.state);
    if (!after) {
      result.missingStates.push(before.state);
      continue;
    }
    currentByState.delete(before.state);
    const afterRows = portalKeys(after.rows);
    const afterProperty = new Map(after.properties.map((p, i) => [p, i]));
    for (const [key, row] of portalKeys(before.rows)) {
      const other = afterRows.get(key);
      afterRows.delete(key);
      if (!other || other[1] !== row[1]) {
        result.structural.push(
          `${before.state} ${key} ${row[1]}.${row[2]} -> ${other ? `${other[1]}.${other[2]}` : "missing"}`,
        );
        continue;
      }
      result.elements++;
      const element = `${row[1]}${row[2] ? "." + row[2].split(" ").join(".") : ""}`;
      const parts: [string, number[] | null, number[] | null][] = [
        ["", row[3], other[3]],
        ["::before ", row[4], other[4]],
        ["::after ", row[5], other[5]],
      ];
      for (const [prefix, beforeValues, afterValues] of parts) {
        if (!beforeValues && !afterValues) continue;
        if (!beforeValues || !afterValues) {
          result.differences.push({
            state: before.state,
            key,
            element,
            property: `${prefix}content`,
            before: beforeValues ? "present" : "absent",
            after: afterValues ? "present" : "absent",
          });
          continue;
        }
        before.properties.forEach((property, i) => {
          const j = afterProperty.get(property);
          if (j === undefined) return;
          result.comparedValues++;
          const a = before.values[beforeValues[i]];
          const b = after.values[afterValues[j]];
          if (a !== b)
            result.differences.push({
              state: before.state,
              key,
              element,
              property: `${prefix}${property}`,
              before: a,
              after: b,
            });
        });
      }
    }
    for (const [key, row] of afterRows)
      result.structural.push(
        `${before.state} ${key} added ${row[1]}.${row[2]}`,
      );
  }
  for (const state of currentByState.keys())
    result.structural.push(`${state} is a new state`);
  return result;
}
