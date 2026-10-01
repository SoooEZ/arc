import { useEffect } from "react";

/** A workspace route change, as hash routes such as "/rules/tax?node=input". */
export interface RouteChange {
  from: string;
  to: string;
}

/**
 * Which route changes a guard confirms. Unloading the page ends every piece of
 * work, so it always confirms every active guard.
 */
export type GuardScope = (change: RouteChange) => boolean;

/** The default scope: work that any route change would discard. */
const everyRouteChange: GuardScope = () => true;

interface Guard {
  message: string;
  applies: GuardScope;
}

/**
 * Work that must confirm before the workspace route changes, such as unsaved
 * source edits or a pending save. Each registration is separate, so two owners
 * may use the same message.
 */
export function createNavigationGuards() {
  const active = new Map<object, Guard>();
  return {
    /** Adds a guard until the returned function removes that registration. */
    register(
      message: string,
      applies: GuardScope = everyRouteChange,
    ): () => void {
      const registration = {};
      active.set(registration, { message, applies });
      return () => {
        active.delete(registration);
      };
    },
    /**
     * Every distinct message that `change` must confirm, earliest registration
     * first. Without a change (the page unloads) every active guard applies.
     */
    messages(change?: RouteChange): string[] {
      const messages = new Set<string>();
      for (const guard of active.values())
        if (!change || guard.applies(change)) messages.add(guard.message);
      return [...messages];
    },
  };
}

const workspaceGuards = createNavigationGuards();

/** Edits staged in a dialog (node form, node code, expression) that Apply has not taken yet. */
const unsavedDialogWarning =
  "Discard the edits in this dialog? They are not applied to the draft yet.";

/**
 * Edits a dialog stages until Apply: a route change, a page unload, Escape and
 * a backdrop click ask before discarding them; pass the returned handler as
 * the Dialog's onClose. An explicit Cancel discards without asking. Escape and
 * the backdrop discarded silently, and Rule settings guarded nothing.
 */
export function useStagedDialogEdits(
  staged: boolean,
  onClose: () => void,
): () => void {
  useNavigationGuard(staged ? unsavedDialogWarning : null);
  return () => {
    if (staged && !window.confirm(unsavedDialogWarning)) return;
    onClose();
  };
}

/**
 * Guards workspace navigation with `message` while it is non-null. By default
 * the guard applies to every route change, including graph/code switches of the
 * same rule; `applies` narrows it (pass a stable, module-level function).
 * Unloading the page always asks.
 */
export function useNavigationGuard(
  message: string | null,
  applies: GuardScope = everyRouteChange,
): void {
  useEffect(() => {
    if (message === null) return;
    return workspaceGuards.register(message, applies);
  }, [message, applies]);
}

/** The messages that `change` must confirm; without a change, those for unloading the page. */
export function activeNavigationGuards(change?: RouteChange): string[] {
  return workspaceGuards.messages(change);
}
