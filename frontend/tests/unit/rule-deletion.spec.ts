import { expect, test } from "@playwright/test";
import { ApiError } from "../../src/api/errors";
import {
  createCommandRunner,
  type CommandRunner,
} from "../../src/features/editor/document/commandRunner";
import {
  deleteRuleCommand,
  deletionDeclined,
} from "../../src/features/editor/document/ruleDeletion";

/** A runner over an open session that records what it tells its host. */
function runner(events: string[], session = new AbortController()) {
  return {
    session,
    runner: createCommandRunner({
      session: () => session.signal,
      versionReady: () => true,
      started: (name) => events.push(`started ${name}`),
      failed: (failure) => events.push(`failed ${String(failure)}`),
      finished: () => events.push("finished"),
    }),
  };
}

/** A deletion with every collaborator recording into `calls`. */
function deletion(
  run: CommandRunner,
  calls: string[],
  remove: (id: string, revision: number) => Promise<void> = async (
    id,
    revision,
  ) => {
    calls.push(`DELETE ${id}@${revision}`);
  },
) {
  return deleteRuleCommand({
    rule: { id: "tax", revision: 3 },
    runner: run,
    remove,
    onDeleted: (id) => calls.push(`deleted ${id}`),
    notify: (message) => calls.push(message),
    onDirty: (dirty) => calls.push(`dirty ${dirty}`),
    navigate: (path) => calls.push(`navigate ${path}`),
  });
}

// deleteRule resolved to null both for a deletion and for a start the lock
// declined, so a caller could take a declined start for a deleted rule.
test("a deletion the command lock declines is a refusal, not a silent success", async () => {
  const events: string[] = [];
  const { runner: run } = runner(events);
  let releaseSave!: () => void;
  const saving = run.run(
    "save",
    () => new Promise<void>((resolve) => (releaseSave = resolve)),
  );
  expect(run.running()).toBe("save");
  const calls: string[] = [];
  expect(await deletion(run, calls)).toEqual(deletionDeclined);
  expect(deletionDeclined.message).toContain("not deleted");
  expect(calls).toEqual([]);
  expect(run.running()).toBe("save");
  releaseSave();
  expect(await saving).toBe(true);
  expect(run.running()).toBe("");
  // Once the lock is free the deletion runs, reports and leaves for the library.
  expect(await deletion(run, calls)).toBeNull();
  expect(calls).toEqual([
    "DELETE tax@3",
    "deleted tax",
    "Rule tax deleted",
    "dirty false",
    "navigate /library",
  ]);
  expect(events).toEqual([
    "started save",
    "finished",
    "started delete",
    "finished",
  ]);
});

test("a refused deletion carries the server's message and callers, and a closed session runs nothing", async () => {
  const events: string[] = [];
  const { runner: run, session } = runner(events);
  const calls: string[] = [];
  const refused = await deletion(run, calls, async () => {
    throw new ApiError("Rule tax is called by other rules", [], 409, [
      "Rule tax is called by other rules",
      "caller-a",
      "caller-b",
    ]);
  });
  expect(refused).toEqual({
    message: "Rule tax is called by other rules",
    callers: ["caller-a", "caller-b"],
  });
  // The dialog shows the refusal; nothing left or was forgotten.
  expect(calls).toEqual([]);
  // A deletion cannot be recalled: one that fails after the editor closed is
  // reported through the workspace, and nothing else runs on a closed session.
  const late = deletion(run, calls, async () => {
    session.abort();
    throw new Error("Network failed");
  });
  expect(await late).toEqual({ message: "Network failed", callers: [] });
  expect(calls).toEqual(["Rule tax was not deleted: Network failed"]);
  expect(await deletion(run, calls)).toEqual(deletionDeclined);
  expect(calls).toHaveLength(1);
  // The host hears a completion only while the session is open: the refusal
  // released the lock, the late failure did not report, the closed session
  // never started.
  expect(events).toEqual(["started delete", "finished", "started delete"]);
});

test("the runner reports a failure to its host and resolves to whether the command ran", async () => {
  const events: string[] = [];
  const { runner: run } = runner(events);
  expect(
    await run.run("validate", async () => {
      throw new Error("Invalid graph");
    }),
  ).toBe(true);
  expect(run.running()).toBe("");
  const unready = createCommandRunner({
    session: () => new AbortController().signal,
    versionReady: () => false,
    started: () => events.push("started"),
    failed: () => events.push("failed"),
    finished: () => events.push("finished"),
  });
  expect(await unready.run("validate", async () => {})).toBe(false);
  expect(events).toEqual([
    "started validate",
    "failed Error: Invalid graph",
    "finished",
  ]);
});
