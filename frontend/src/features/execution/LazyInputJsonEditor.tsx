import { lazy, type ComponentProps } from "react";
import { LazyBoundary } from "../../components/LazyBoundary";

// One lazy module for both execution surfaces, so its chunk keeps the
// InputJsonEditor name that the chunk-failure tests route.
const InputJsonEditor = lazy(() => import("./InputJsonEditor"));

/** The Monaco JSON input editor, loaded when an execution surface first shows it. */
export default function LazyInputJsonEditor(
  props: ComponentProps<typeof InputJsonEditor>,
) {
  return (
    <LazyBoundary
      label="JSON editor"
      fallback={
        <div className="execution-json-editor" role="status">
          Loading JSON editor…
        </div>
      }
    >
      <InputJsonEditor {...props} />
    </LazyBoundary>
  );
}
