import { test } from "@playwright/test";
// The tests' one door to the repository's files. Node's typings are not a
// dependency (see tsconfig.tests.json), so the two imports are untyped here
// and this module exposes typed functions instead.
// @ts-expect-error @types/node is not installed
import * as fs from "node:fs";
// @ts-expect-error @types/node is not installed
import * as path from "node:path";

/** The repository root, from the running project's test directory. */
export function repositoryRoot(): string {
  return path.resolve(test.info().project.testDir, "../..") as string;
}

/** A repository file's text, by its path from the root. */
export function readRepositoryFile(relative: string): string {
  return fs.readFileSync(path.join(repositoryRoot(), relative), "utf8");
}

/** Every file under `directory` (from the root) with one of the extensions, as root-relative paths. */
export function repositoryFiles(
  directory: string,
  extensions: readonly string[],
): string[] {
  const root = repositoryRoot();
  const found: string[] = [];
  const visit = (absolute: string) => {
    for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
      const child = path.join(absolute, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (extensions.some((extension) => entry.name.endsWith(extension)))
        found.push(path.relative(root, child));
    }
  };
  visit(path.join(root, directory));
  return found.sort();
}
