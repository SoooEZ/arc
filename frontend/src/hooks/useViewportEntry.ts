import { useEffect, useState, type RefObject } from "react";

/** The nearest ancestor that scrolls its content, which clips what can be seen of the element. */
function scrollParent(element: Element): Element | null {
  for (let at = element.parentElement; at; at = at.parentElement) {
    const { overflowY } = getComputedStyle(at);
    if (overflowY === "auto" || overflowY === "scroll") return at;
  }
  return null;
}

/**
 * Whether the element has come within `margin` pixels of the visible part of
 * its scroll container (or the viewport), and stays true once it has: what
 * mounted on its account is not unmounted by scrolling away, so an editor
 * keeps its undo history and the focused control is never swapped (lesson
 * F13). True from the start where IntersectionObserver is unavailable.
 */
export function useViewportEntry(
  ref: RefObject<Element | null>,
  margin = 200,
): boolean {
  const [entered, setEntered] = useState(
    () => typeof IntersectionObserver === "undefined",
  );
  useEffect(() => {
    const element = ref.current;
    if (entered || !element) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setEntered(true);
      },
      { root: scrollParent(element), rootMargin: `${margin}px 0px` },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [ref, entered, margin]);
  return entered;
}
