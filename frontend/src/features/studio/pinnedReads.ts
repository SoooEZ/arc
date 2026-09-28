/**
 * A bounded cache of immutable pinned reads (a source version, a published
 * rule version) shared by every editor on the page. Reads that start together
 * share one request; a subscriber that aborts leaves the read to the others,
 * and the request is aborted only when every subscriber has. Only completed
 * reads are kept, least recently used first out; `forget(id)` drops every
 * version of an ID, for a rule deleted in this page.
 */
export class PinnedReads<T> {
  private readonly completed = new Map<string, T>();
  private readonly inFlight = new Map<string, InFlight<T>>();

  constructor(private readonly capacity = 64) {}

  async load(
    key: string,
    read: (signal: AbortSignal) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    // A subscriber that has already left starts nothing and joins nothing.
    if (signal?.aborted) throw abortError();
    const cached = this.completed.get(key);
    if (cached !== undefined) {
      this.remember(key, cached);
      return cached;
    }
    const shared = this.inFlight.get(key) ?? this.start(key, read);
    shared.subscribers += 1;
    // The subscriber's own promise settles on its own abort; the shared read goes on for the others.
    let onAbort = () => {};
    const aborted = new Promise<T>((_, reject) => {
      onAbort = () => {
        this.leave(key, shared);
        reject(abortError());
      };
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await Promise.race([shared.promise, aborted]);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /**
   * Stops remembering `id` (every key starts with "id:"): a completed read is
   * dropped and an in-flight one is no longer cached, but subscribers still
   * awaiting it receive its value. The next load starts a fresh read.
   */
  forget(id: string): void {
    for (const key of [...this.completed.keys()])
      if (key.startsWith(`${id}:`)) this.completed.delete(key);
    for (const [key, read] of [...this.inFlight])
      if (key.startsWith(`${id}:`)) {
        read.forgotten = true;
        this.inFlight.delete(key);
      }
  }

  private start(key: string, read: (signal: AbortSignal) => Promise<T>) {
    const controller = new AbortController();
    // The read starts now, so callers observe one request per key at once; a
    // read that throws instead of rejecting fails the same way.
    let promise: Promise<T>;
    try {
      promise = read(controller.signal);
    } catch (failure) {
      promise = Promise.reject(failure);
    }
    const started: InFlight<T> = {
      controller,
      subscribers: 0,
      forgotten: false,
      promise,
    };
    started.promise = promise.then(
      (value) => {
        this.settle(key, started);
        if (!controller.signal.aborted && !started.forgotten)
          this.remember(key, value);
        return value;
      },
      (failure) => {
        this.settle(key, started);
        throw failure;
      },
    );
    this.inFlight.set(key, started);
    return started;
  }

  /** The last subscriber to leave ends the shared read, and a later load starts afresh. */
  private leave(key: string, read: InFlight<T>) {
    read.subscribers -= 1;
    if (read.subscribers > 0) return;
    read.controller.abort();
    this.settle(key, read);
  }

  /** Only the read that holds the key leaves the table: a fresh read under the same key stays. */
  private settle(key: string, read: InFlight<T>) {
    if (this.inFlight.get(key) === read) this.inFlight.delete(key);
  }

  private remember(key: string, value: T) {
    this.completed.delete(key);
    this.completed.set(key, value);
    if (this.completed.size <= this.capacity) return;
    const oldest = this.completed.keys().next();
    if (!oldest.done) this.completed.delete(oldest.value);
  }
}

const abortError = () => new DOMException("The read was aborted", "AbortError");

interface InFlight<T> {
  controller: AbortController;
  subscribers: number;
  /** Forgotten while in flight: delivered to its subscribers, never cached. */
  forgotten: boolean;
  promise: Promise<T>;
}
