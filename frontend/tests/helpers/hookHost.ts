import { act, createElement } from "react";
import { createRoot } from "react-dom/client";

/**
 * Renders a hook in Node, with no DOM: the host component renders nothing, so
 * react-dom touches only the container and the few window/document members
 * it reads around a commit, stubbed here. Commands returned by the hook are
 * called inside `act`, so their state updates are flushed before the next
 * `current` is read. Unit tests of the pending-command hooks use it; a real
 * browser remains the place for anything that renders elements.
 */

class HTMLIFrameElement {}
const document = {
  nodeType: 9,
  activeElement: null,
  defaultView: null as unknown,
  documentElement: null,
  addEventListener() {},
  removeEventListener() {},
  createElement() {
    throw new Error("A hook host renders no elements");
  },
};
const window = {
  document,
  HTMLIFrameElement,
  event: undefined,
  addEventListener() {},
  removeEventListener() {},
};
document.defaultView = window;

const stubs = ["window", "document", "IS_REACT_ACT_ENVIRONMENT"] as const;
let installed = false;
let mounted = 0;

/** The stubs live while a host is mounted: later spec files in the worker see Node as it was. */
function installDom() {
  if (installed || typeof globalThis.window !== "undefined") return;
  Object.assign(globalThis, {
    window,
    document,
    IS_REACT_ACT_ENVIRONMENT: true,
  });
  installed = true;
}

function uninstallDom() {
  if (!installed || mounted > 0) return;
  for (const name of stubs)
    delete (globalThis as Record<string, unknown>)[name];
  installed = false;
}

function container() {
  return {
    nodeType: 1,
    tagName: "DIV",
    namespaceURI: "http://www.w3.org/1999/xhtml",
    ownerDocument: document,
    childNodes: [],
    firstChild: null,
    textContent: "",
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    insertBefore() {},
  } as unknown as Element;
}

export interface HookHost<Props, Result> {
  /** What the hook returned in its latest render. */
  readonly current: Result;
  /** Renders again with new props and flushes effects. */
  rerender(props: Props): Promise<void>;
  /** Runs `command` inside act, flushing the state it changes. */
  run<T>(command: () => T | Promise<T>): Promise<T>;
  unmount(): Promise<void>;
}

export async function renderHook<Props, Result>(
  hook: (props: Props) => Result,
  props: Props,
): Promise<HookHost<Props, Result>> {
  installDom();
  mounted += 1;
  const results: Result[] = [];
  function Host(hostProps: { props: Props }) {
    results.push(hook(hostProps.props));
    return null;
  }
  const root = createRoot(container());
  const render = (next: Props) =>
    act(async () => {
      root.render(createElement(Host, { props: next }));
    });
  await render(props);
  let open = true;
  return {
    get current() {
      return results[results.length - 1];
    },
    rerender: render,
    run: async <T>(command: () => T | Promise<T>) => {
      let result!: T;
      await act(async () => {
        result = await command();
      });
      return result;
    },
    unmount: async () => {
      if (!open) return;
      open = false;
      await act(async () => {
        root.unmount();
      });
      mounted -= 1;
      uninstallDom();
    },
  };
}
