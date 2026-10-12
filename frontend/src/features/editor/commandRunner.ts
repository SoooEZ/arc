import { commandsIdle, type EditorTask } from "./editorCapabilities";

/** What the runner tells its host (the document hook) as commands start and end. */
export interface CommandRunnerHost {
  /** The editor session's signal; no session, or a closed one, runs nothing. */
  session: () => AbortSignal | undefined;
  /** Whether the shown version has loaded; no command starts before it has. */
  versionReady: () => boolean;
  /** A command took the lock; the host shows it as `busy` from the next render. */
  started: (name: EditorTask) => void;
  /** A command failed while its session was still open. */
  failed: (failure: unknown) => void;
  /** A command released the lock while its session was still open. */
  finished: () => void;
}

export interface CommandRunner {
  /** The command holding the lock right now, or "" (`busy` shows it from the next render). */
  running: () => EditorTask | "";
  /**
   * Runs `task` under the lock and resolves to whether it ran: a closed
   * session or a running command declines the start, which a caller can tell
   * from a result, since a declined deletion is no deletion.
   */
  run: (
    name: EditorTask,
    task: (signal: AbortSignal) => Promise<unknown>,
  ) => Promise<boolean>;
}

/**
 * The document's command lock: commands take turns, none starts before the
 * shown version has loaded, and a closed session runs nothing. A failure is
 * reported to the host unless the session closed meanwhile.
 */
export function createCommandRunner(host: CommandRunnerHost): CommandRunner {
  let running: EditorTask | "" = "";
  return {
    running: () => running,
    async run(name, task) {
      const signal = host.session();
      const idle = commandsIdle({
        task: running,
        versionReady: host.versionReady(),
      });
      if (!signal || signal.aborted || !idle) return false;
      running = name;
      host.started(name);
      try {
        await task(signal);
      } catch (failure) {
        if (!signal.aborted) host.failed(failure);
      } finally {
        running = "";
        if (!signal.aborted) host.finished();
      }
      return true;
    },
  };
}
