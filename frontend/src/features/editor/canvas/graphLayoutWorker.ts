import ELK from "elkjs/lib/elk-api.js";
import elkWorkerUrl from "elkjs/lib/elk-worker.min.js?url";
import type { ElkLayout } from "./graphLayout";

type Layouter = InstanceType<typeof ELK>;

/**
 * ELK in a Web Worker, created on the first Arrange: laying out a large graph
 * on the main thread was one long task of up to about 1.3 s, during which the
 * page could not paint or accept input. elk-api listens to the worker's
 * messages only, so a worker that fails to load, or throws, would leave a
 * layout pending forever and the document locked (lesson F8): the worker's
 * error events reject the pending layout, and the next Arrange starts a new
 * worker.
 */
let current: { elk: Layouter; worker: Worker } | null = null;

function start(): { elk: Layouter; worker: Worker } {
  let worker!: Worker;
  const elk = new ELK({
    workerFactory: (url) => {
      worker = new Worker(url ?? elkWorkerUrl);
      return worker;
    },
    workerUrl: elkWorkerUrl,
  });
  return { elk, worker };
}

export const layoutInWorker: ElkLayout = (graph) => {
  const instance = (current ??= start());
  return new Promise((resolve, reject) => {
    const fail = (message: string) => {
      if (current === instance) {
        void instance.elk.terminateWorker();
        current = null;
      }
      reject(new Error(message));
    };
    const onError = () =>
      fail("The layout worker failed. Reload the page and try Arrange again.");
    instance.worker.addEventListener("error", onError, { once: true });
    instance.worker.addEventListener("messageerror", onError, { once: true });
    instance.elk.layout(graph).then(
      (result) => {
        instance.worker.removeEventListener("error", onError);
        instance.worker.removeEventListener("messageerror", onError);
        resolve(result);
      },
      (failure) => {
        instance.worker.removeEventListener("error", onError);
        instance.worker.removeEventListener("messageerror", onError);
        fail(failure instanceof Error ? failure.message : String(failure));
      },
    );
  });
};
