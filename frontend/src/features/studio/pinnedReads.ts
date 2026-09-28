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
    const cached = this.completed.get(key);
    if (cached !== undefined) {
      this.remember(key, cached);
      return cached;
    }
    let shared = this.inFlight.get(key);
    if (!shared) {
      const controller = new AbortController();
      const started: InFlight<T> = {
        controller,
        subscribers: 0,
        promise: read(controller.signal).then(
          (value) => {
            this.inFlight.delete(key);
            if (!controller.signal.aborted) this.remember(key, value);
            return value;
          },
          (failure) => {
            this.inFlight.delete(key);
            throw failure;
          },
        ),
      };
      this.inFlight.set(key, started);
      shared = started;
    }
    const read_ = shared;
    read_.subscribers += 1;
    const leave = () => {
      read_.subscribers -= 1;
      if (read_.subscribers === 0) read_.controller.abort();
    };
    if (signal?.aborted) {
      leave();
      throw new DOMException("The read was aborted", "AbortError");
    }
    // The subscriber's own promise settles on its own abort; the shared read goes on for the others.
    let onAbort = () => {};
    const aborted = new Promise<T>((_, reject) => {
      onAbort = () => {
        leave();
        reject(new DOMException("The read was aborted", "AbortError"));
      };
    });
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      return await Promise.race([read_.promise, aborted]);
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }
  }

  /** The keys of every version of `id` start with "id:". */
  forget(id: string): void {
    for (const key of [...this.completed.keys()])
      if (key.startsWith(`${id}:`)) this.completed.delete(key);
    for (const [key, read] of [...this.inFlight])
      if (key.startsWith(`${id}:`)) {
        read.controller.abort();
        this.inFlight.delete(key);
      }
  }

  private remember(key: string, value: T) {
    this.completed.delete(key);
    this.completed.set(key, value);
    if (this.completed.size <= this.capacity) return;
    const oldest = this.completed.keys().next();
    if (!oldest.done) this.completed.delete(oldest.value);
  }
}

interface InFlight<T> {
  controller: AbortController;
  subscribers: number;
  promise: Promise<T>;
}
