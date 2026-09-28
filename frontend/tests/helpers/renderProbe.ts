import type { Page } from "@playwright/test";

/**
 * Counts of the work React committed, read from the page (`window.__renderProbe`).
 * The suite runs the minified build, so fibers are told apart by their props
 * and host elements, never by component names.
 */
export interface RenderCounts {
  /** Renders of @monaco-editor/react hosts (props carry `options` and `onMount`). */
  monacoRenders: number;
  /** Monaco hosts that received an `options` object other than their previous one. */
  optionsChanges: number;
  /** Cards (`.react-flow__node`) under which a component rendered, summed over commits. */
  cardRenders: number;
  /** `.node-mapping-card` and `[data-testid^="switch-case-"]` rows with a render that do not hold the focus. */
  otherRowRenders: number;
  /** Renders of GraphCanvas (props carry `canvas` and `onAddNode`). */
  canvasRenders: number;
  commits: number;
}

/**
 * Installs a minimal React DevTools hook before the page loads. On every commit
 * it walks the fiber tree once and records which hosts rendered, so a test can
 * assert render cost without instrumenting the application.
 */
export async function installRenderProbe(page: Page) {
  await page.addInitScript(() => {
    const counts = {
      monacoRenders: 0,
      optionsChanges: 0,
      cardRenders: 0,
      otherRowRenders: 0,
      canvasRenders: 0,
      commits: 0,
    };
    const PerformedWork = 1;
    const HostRoot = 3;
    const HostComponent = 5;
    // A text fiber's props are its string: `in` would throw, and React swallows
    // hook errors silently, so every count would stay 0.
    const HostText = 6;
    type Fiber = {
      tag: number;
      flags: number;
      child: Fiber | null;
      sibling: Fiber | null;
      return: Fiber | null;
      alternate: Fiber | null;
      memoizedProps: Record<string, unknown> | null;
      stateNode: unknown;
    };
    const hostAncestor = (fiber: Fiber): Element | null => {
      for (let at = fiber.return; at; at = at.return)
        if (at.tag === HostComponent && at.stateNode instanceof Element)
          return at.stateNode;
      return null;
    };
    const closest = (element: Element | null, selector: string) =>
      element ? element.closest(selector) : null;
    /**
     * A subtree that bailed out keeps its committed fibers, flags included, so
     * a stale PerformedWork flag would count it forever. React clones the
     * children of every fiber it revisits, so the walk descends only where the
     * child list differs from the previous commit's (React DevTools' rule).
     */
    const revisited = (fiber: Fiber): boolean =>
      fiber.alternate === null || fiber.alternate.child !== fiber.child;
    const walk = (root: Fiber) => {
      const cards = new Set<Element>();
      const rows = new Set<Element>();
      const pending: Fiber[] = [root];
      while (pending.length) {
        const fiber = pending.pop()!;
        if (fiber.child && revisited(fiber)) pending.push(fiber.child);
        if (fiber.sibling) pending.push(fiber.sibling);
        if (
          fiber.tag === HostRoot ||
          fiber.tag === HostComponent ||
          fiber.tag === HostText
        )
          continue;
        const props =
          fiber.memoizedProps && typeof fiber.memoizedProps === "object"
            ? fiber.memoizedProps
            : null;
        const rendered =
          fiber.alternate !== null && (fiber.flags & PerformedWork) !== 0;
        if (props && "options" in props && "onMount" in props) {
          if (rendered) counts.monacoRenders++;
          const before = fiber.alternate?.memoizedProps;
          if (before && before.options !== props.options)
            counts.optionsChanges++;
        }
        if (props && "canvas" in props && "onAddNode" in props && rendered)
          counts.canvasRenders++;
        if (!rendered) continue;
        const host = hostAncestor(fiber);
        const card = closest(host, ".react-flow__node");
        if (card) cards.add(card);
        // The row being typed into holds the focus; every other row is "other".
        const row = closest(
          host,
          '.node-mapping-card, [data-testid^="switch-case-"]',
        );
        if (row && !row.contains(document.activeElement)) rows.add(row);
      }
      counts.cardRenders += cards.size;
      counts.otherRowRenders += rows.size;
      counts.commits++;
    };
    const hook = {
      isDisabled: false,
      supportsFiber: true,
      supportsFlight: false,
      renderers: new Map(),
      rendererInterfaces: new Map(),
      inject(renderer: unknown) {
        const id = hook.renderers.size + 1;
        hook.renderers.set(id, renderer);
        return id;
      },
      on() {},
      off() {},
      emit() {},
      sub() {
        return () => {};
      },
      checkDCE() {},
      onCommitFiberUnmount() {},
      onPostCommitFiberRoot() {},
      onCommitFiberRoot(_id: number, root: { current: Fiber }) {
        walk(root.current);
      },
    };
    Object.assign(window, {
      __REACT_DEVTOOLS_GLOBAL_HOOK__: hook,
      __renderProbe: {
        counts,
        reset() {
          for (const key of Object.keys(counts))
            counts[key as keyof typeof counts] = 0;
        },
      },
    });
  });
}

type ProbeWindow = Window & {
  __renderProbe: { counts: RenderCounts; reset: () => void };
};

export function renderCounts(page: Page): Promise<RenderCounts> {
  return page.evaluate(() => ({
    ...(window as unknown as ProbeWindow).__renderProbe.counts,
  }));
}

export function resetRenderCounts(page: Page): Promise<void> {
  return page.evaluate(() =>
    (window as unknown as ProbeWindow).__renderProbe.reset(),
  );
}
