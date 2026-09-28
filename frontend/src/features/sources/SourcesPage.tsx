import SourceWorkspace from "./SourceWorkspace";
import { useSourceEditor } from "./useSourceEditor";

/**
 * The Data sources page: the source editor's controller and its workspace.
 * Unsaved edits and pending saves guard workspace navigation themselves.
 */
export default function SourcesPage({
  notify,
}: {
  notify: (message: string) => void;
}) {
  const editor = useSourceEditor({ notify });
  return <SourceWorkspace editor={editor} />;
}
