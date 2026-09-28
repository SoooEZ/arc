import { Component, Fragment, Suspense, type ReactNode } from "react";
import { Alert, Button } from "@mui/material";

interface LazyBoundaryProps {
  /** Lower-case noun phrase for the failure message, e.g. "code editor". */
  label: string;
  /** Suspense fallback while the component loads. */
  fallback?: ReactNode;
  /**
   * Adds a Close action to the failure message. A lazy dialog uses it, because
   * the message replaces the dialog together with the dialog's own close button.
   */
  onDismiss?: () => void;
  children: ReactNode;
}

/**
 * Loads a lazy feature and keeps its failures local: the surrounding editor
 * and its siblings stay mounted. It also catches render errors in the subtree.
 */
export function LazyBoundary({
  label,
  fallback = null,
  onDismiss,
  children,
}: LazyBoundaryProps) {
  return (
    <FailureBoundary label={label} onDismiss={onDismiss}>
      <Suspense fallback={fallback}>{children}</Suspense>
    </FailureBoundary>
  );
}

interface FailureBoundaryProps {
  label: string;
  onDismiss?: () => void;
  children: ReactNode;
}

interface FailureBoundaryState {
  failed: boolean;
  /** Changes on Try again so the children remount. */
  attempt: number;
}

/**
 * A failed chunk fetch stays failed until the page reloads: the browser keeps
 * it in its module map and React.lazy keeps the rejection. Try again therefore
 * recovers render errors only. (Error boundaries have no hook equivalent.)
 */
class FailureBoundary extends Component<
  FailureBoundaryProps,
  FailureBoundaryState
> {
  state: FailureBoundaryState = { failed: false, attempt: 0 };

  static getDerivedStateFromError(): Partial<FailureBoundaryState> {
    return { failed: true };
  }

  private retry = () => {
    this.setState(({ attempt }) => ({ failed: false, attempt: attempt + 1 }));
  };

  render() {
    if (!this.state.failed)
      return (
        <Fragment key={this.state.attempt}>{this.props.children}</Fragment>
      );
    const { onDismiss } = this.props;
    return (
      <Alert
        severity="error"
        action={
          <>
            <Button color="inherit" size="small" onClick={this.retry}>
              Try again
            </Button>
            {onDismiss && (
              <Button color="inherit" size="small" onClick={onDismiss}>
                Close
              </Button>
            )}
          </>
        }
      >
        Could not load the {this.props.label}. Try again, or save your changes
        and reload the page.
      </Alert>
    );
  }
}
