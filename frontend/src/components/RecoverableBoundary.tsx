import { Component, type ReactNode } from "react";
import { Button } from "@mui/material";

interface Props {
  /** Heading of the fallback, e.g. "This page stopped working". */
  title: string;
  /** A new value (such as the route) clears a previous failure. */
  resetKey?: string;
  children: ReactNode;
}

interface State {
  failed: boolean;
  resetKey?: string;
}

/**
 * Keeps an unexpected render error from unmounting the whole application.
 * Try again remounts the children; the error itself is logged by the root's
 * onCaughtError. (Error boundaries have no hook equivalent.)
 */
export class RecoverableBoundary extends Component<Props, State> {
  state: State = { failed: false, resetKey: this.props.resetKey };

  static getDerivedStateFromError(): Partial<State> {
    return { failed: true };
  }

  static getDerivedStateFromProps(props: Props, state: State) {
    return props.resetKey === state.resetKey
      ? null
      : { failed: false, resetKey: props.resetKey };
  }

  private retry = () => this.setState({ failed: false });

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="center-state" role="alert">
        <h2>{this.props.title}</h2>
        <p>
          An unexpected error interrupted this view. Changes that were not saved
          here may be lost.
        </p>
        <div className="recoverable-actions">
          <Button variant="contained" onClick={this.retry}>
            Try again
          </Button>
          <Button onClick={() => window.location.reload()}>Reload page</Button>
        </div>
      </div>
    );
  }
}
