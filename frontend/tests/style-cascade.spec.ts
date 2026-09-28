/*
 * Cascade checks on the stylesheet sources, parsed by Chrome in index.css
 * import order with custom properties substituted and shorthands expanded to
 * longhands.
 *
 * The first test always runs: no declaration may be overridden by a later
 * rule with the same selector (an override layer that leaves the owning rule
 * dead). A selector list may still refine one of its selectors later.
 *
 * The second compares with an earlier copy of src/styles and is skipped unless
 * ARC_STYLE_CASCADE_BASELINE names it. It compares, per (media, selector,
 * property), the declaration that wins among rules with that exact selector;
 * ARC_STYLE_CASCADE_EXPECTED lists reviewed differences, such as a removed
 * declaration that a more specific rule always overrode.
 * ARC_STYLE_CASCADE_REPORT also receives equal-specificity rule pairs whose
 * order changed; whether such a pair meets on one element is for
 * style-equivalence.spec.ts (computed styles) or a reviewer to decide.
 */
import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

const baselineDirectory = process.env.ARC_STYLE_CASCADE_BASELINE ?? "";
const expectedFile = process.env.ARC_STYLE_CASCADE_EXPECTED ?? "";
const reportFile = process.env.ARC_STYLE_CASCADE_REPORT ?? "";

const stylesDirectory = () =>
  path.resolve(test.info().project.testDir, "../src/styles");

interface SourceFile {
  file: string;
  text: string;
}

/** Files in cascade order: a file's imports precede its own rules. */
function readStyles(directory: string): SourceFile[] {
  const files: SourceFile[] = [];
  const visit = (file: string) => {
    const text = fs.readFileSync(path.join(directory, file), "utf8");
    const importPattern = /@import\s+"([^"]+)";/g;
    for (const [, imported] of text.matchAll(importPattern))
      visit(path.normalize(path.join(path.dirname(file), imported)));
    files.push({ file, text: text.replace(importPattern, "") });
  };
  visit("index.css");
  return files;
}

/** Replaces var(--token) with the :root definition, recursively. */
function substituteTokens(files: SourceFile[]): SourceFile[] {
  const tokens = new Map<string, string>();
  for (const { text } of files)
    for (const [, body] of text
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .matchAll(/:root\s*\{([^}]*)\}/g))
      for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
        tokens.set(name, value.trim());
  const resolve = (value: string, depth = 0): string =>
    value.replace(/var\(\s*(--[\w-]+)\s*\)/g, (whole, name: string) => {
      const token = tokens.get(name);
      if (token === undefined || depth > 10)
        throw new Error(`Unknown custom property ${whole}`);
      return resolve(token, depth + 1);
    });
  return files.map(({ file, text }) => ({ file, text: resolve(text) }));
}

interface Declaration {
  rule: number;
  file: string;
  media: string;
  selector: string;
  property: string;
  value: string;
  important: boolean;
}

/** Runs in the page: every longhand declaration of every style rule. */
function parseInPage(files: SourceFile[]): Declaration[] {
  const declarations: Declaration[] = [];
  let rule = 0;
  const splitList = (text: string) => {
    const parts: string[] = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === "(") depth++;
      else if (text[i] === ")") depth--;
      else if (text[i] === "," && depth === 0) {
        parts.push(text.slice(start, i).trim());
        start = i + 1;
      }
    }
    parts.push(text.slice(start).trim());
    return parts;
  };
  const walk = (rules: CSSRuleList, media: string, file: string) => {
    for (const cssRule of Array.from(rules)) {
      if (cssRule instanceof CSSMediaRule) {
        const condition = cssRule.conditionText;
        walk(
          cssRule.cssRules,
          media ? `${media} and ${condition}` : condition,
          file,
        );
      } else if (cssRule instanceof CSSStyleRule) {
        const style = cssRule.style;
        for (let i = 0; i < style.length; i++) {
          const property = style[i];
          if (property.startsWith("--")) continue;
          for (const selector of splitList(cssRule.selectorText))
            declarations.push({
              rule,
              file,
              media,
              selector,
              property,
              value: style.getPropertyValue(property),
              important: style.getPropertyPriority(property) === "important",
            });
        }
        rule++;
      } else {
        throw new Error(`Unsupported rule in ${file}: ${cssRule.cssText}`);
      }
    }
  };
  for (const { file, text } of files) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text);
    walk(sheet.cssRules, "", file);
  }
  return declarations;
}

/** [ids, classes/attributes/pseudo-classes, types/pseudo-elements] */
function specificity(selector: string): number[] {
  const total = [0, 0, 0];
  const add = (other: number[]) => other.forEach((n, i) => (total[i] += n));
  let rest = selector;
  // :not()/:is()/:has() count their most specific argument; :where() counts nothing.
  const functional = /:(not|is|has|where)\(/;
  for (
    let match = functional.exec(rest);
    match;
    match = functional.exec(rest)
  ) {
    let depth = 1;
    let end = match.index + match[0].length;
    while (depth && end < rest.length) {
      if (rest[end] === "(") depth++;
      else if (rest[end] === ")") depth--;
      end++;
    }
    const inner = rest.slice(match.index + match[0].length, end - 1);
    if (match[1] !== "where") {
      const best = inner
        .split(",")
        .map((part) => specificity(part.trim()))
        .sort((a, b) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2])[0];
      add(best);
    }
    rest = rest.slice(0, match.index) + rest.slice(end);
  }
  rest = rest.replace(/\([^)]*\)/g, "");
  total[0] += (rest.match(/#[\w-]+/g) ?? []).length;
  total[1] += (rest.match(/\.[\w-]+|\[[^\]]*\]/g) ?? []).length;
  const pseudo = rest.match(/::?[\w-]+/g) ?? [];
  for (const item of pseudo) {
    if (
      item.startsWith("::") ||
      /^:(before|after|first-line|first-letter)$/.test(item)
    )
      total[2]++;
    else total[1]++;
  }
  const types = rest
    .replace(/::?[\w-]+|#[\w-]+|\.[\w-]+|\[[^\]]*\]/g, " ")
    .match(/(^|[\s>+~])([a-zA-Z][\w-]*)/g);
  total[2] += types?.length ?? 0;
  return total;
}

type Winner = Declaration & { specificity: string };

/** The declaration that wins among rules with the same media and selector. */
function winners(declarations: Declaration[]): Map<string, Winner> {
  const result = new Map<string, Winner>();
  for (const declaration of declarations) {
    const key = `${declaration.media} | ${declaration.selector} | ${declaration.property}`;
    const previous = result.get(key);
    if (previous?.important && !declaration.important) continue;
    result.set(key, {
      ...declaration,
      specificity: specificity(declaration.selector).join(","),
    });
  }
  return result;
}

function mediaOverlap(first: string, second: string): boolean {
  const bounds = (media: string) => ({
    min: Math.max(
      0,
      ...[...media.matchAll(/min-width:\s*(\d+)px/g)].map((m) => Number(m[1])),
    ),
    max: Math.min(
      Infinity,
      ...[...media.matchAll(/max-width:\s*(\d+)px/g)].map((m) => Number(m[1])),
    ),
  });
  const a = bounds(first);
  const b = bounds(second);
  return Math.max(a.min, b.min) <= Math.min(a.max, b.max);
}

/** Whether every viewport matching `inner` also matches `outer`. */
function mediaContains(outer: string, inner: string): boolean {
  const widths = (media: string, kind: "min" | "max") =>
    [
      ...media.matchAll(new RegExp(`${kind}-(width|height):\\s*(\\d+)px`, "g")),
    ].map((m) => ({ axis: m[1], value: Number(m[2]) }));
  return (["min", "max"] as const).every((kind) =>
    widths(outer, kind).every((condition) =>
      widths(inner, kind).some(
        (own) =>
          own.axis === condition.axis &&
          (kind === "max"
            ? own.value <= condition.value
            : own.value >= condition.value),
      ),
    ),
  );
}

/**
 * Declarations that never win: a later rule with the same selector sets the
 * same longhand wherever this one applies (or an !important one always
 * wins). A rule with a selector list counts only when every one of its
 * selectors is overridden, so a list may be refined for one member later.
 */
function shadowedDeclarations(declarations: Declaration[]): string[] {
  const winner = (declaration: Declaration, index: number) =>
    declarations.find(
      (other, otherIndex) =>
        other.selector === declaration.selector &&
        other.property === declaration.property &&
        other !== declaration &&
        mediaContains(other.media, declaration.media) &&
        ((otherIndex > index && (other.important || !declaration.important)) ||
          (other.important && !declaration.important)),
    );
  const byRuleProperty = new Map<
    string,
    [Declaration, Declaration | undefined][]
  >();
  declarations.forEach((declaration, index) => {
    const key = `${declaration.rule}|${declaration.property}`;
    byRuleProperty.set(key, [
      ...(byRuleProperty.get(key) ?? []),
      [declaration, winner(declaration, index)],
    ]);
  });
  const shadowed: string[] = [];
  for (const entries of byRuleProperty.values())
    if (entries.every(([, over]) => over))
      for (const [declaration, over] of entries)
        shadowed.push(
          `${declaration.file} [${declaration.media}] ${declaration.selector} { ${declaration.property}: ${declaration.value} } <- ${over!.file} ${over!.value}`,
        );
  return shadowed;
}

test("no rule restates another rule's selector to override it", async ({
  page,
}) => {
  const declarations = await page.evaluate(
    parseInPage,
    substituteTokens(readStyles(stylesDirectory())),
  );
  expect(shadowedDeclarations(declarations)).toEqual([]);
});

test("stylesheet cascade matches the baseline tree", async ({ page }) => {
  test.skip(
    !baselineDirectory,
    "Set ARC_STYLE_CASCADE_BASELINE to compare stylesheet cascades",
  );
  const baseline = await page.evaluate(
    parseInPage,
    substituteTokens(readStyles(baselineDirectory)),
  );
  const current = await page.evaluate(
    parseInPage,
    substituteTokens(readStyles(stylesDirectory())),
  );
  const before = winners(baseline);
  const after = winners(current);
  const changed: string[] = [];
  const removed: string[] = [];
  const added: string[] = [];
  for (const [key, old] of before) {
    const now = after.get(key);
    if (!now)
      removed.push(
        `${key}: ${old.value}${old.important ? " !important" : ""} (${old.file})`,
      );
    else if (now.value !== old.value || now.important !== old.important)
      changed.push(`${key}: ${old.value} -> ${now.value}`);
  }
  for (const [key, now] of after)
    if (!before.has(key))
      added.push(
        `${key}: ${now.value}${now.important ? " !important" : ""} (${now.file})`,
      );

  // Equal-specificity winners for one property: their order decides an
  // element that both selectors match.
  const reordered: string[] = [];
  const byProperty = new Map<string, string[]>();
  for (const [key, winner] of after)
    if (before.has(key))
      byProperty.set(winner.property, [
        ...(byProperty.get(winner.property) ?? []),
        key,
      ]);
  for (const keys of byProperty.values())
    for (let i = 0; i < keys.length; i++)
      for (let j = i + 1; j < keys.length; j++) {
        const [a0, b0, a1, b1] = [
          before.get(keys[i])!,
          before.get(keys[j])!,
          after.get(keys[i])!,
          after.get(keys[j])!,
        ];
        if (a1.value === b1.value && a0.value === b0.value) continue;
        if (a1.specificity !== b1.specificity || a1.important !== b1.important)
          continue;
        if (!mediaOverlap(a1.media, b1.media)) continue;
        const beforeOrder = Math.sign(a0.rule - b0.rule);
        const afterOrder = Math.sign(a1.rule - b1.rule);
        if (beforeOrder !== afterOrder)
          reordered.push(
            `${keys[i]} (${a1.value}) <> ${keys[j]} (${b1.value})`,
          );
      }

  const report = {
    changed,
    removed,
    added,
    reordered,
    shadowedBefore: shadowedDeclarations(baseline),
    shadowedNow: shadowedDeclarations(current),
  };
  if (reportFile) fs.writeFileSync(reportFile, JSON.stringify(report, null, 1));
  const expected = new Set<string>(
    expectedFile
      ? (
          JSON.parse(fs.readFileSync(expectedFile, "utf8")) as {
            difference: string;
          }[]
        ).map((item) => item.difference)
      : [],
  );
  const unexplained = [...changed, ...removed, ...added].filter(
    (difference) => !expected.has(difference),
  );
  expect(unexplained).toEqual([]);
});
