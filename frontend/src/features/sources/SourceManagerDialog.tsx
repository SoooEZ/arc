import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import SourceWorkspace from "./SourceWorkspace";
import { unsavedSourceWarning, useSourceEditor } from "./useSourceEditor";

/**
 * The source editor inside a rule editor. The dialog owns the controller, so
 * Close reads the editor's own dirty and pending state; route changes and
 * page unloads are guarded by the editor's navigation guards.
 */
export default function SourceManagerDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const [notice, setNotice] = useState("");
  const editor = useSourceEditor({ notify: setNotice });
  const close = () => {
    if (editor.pending) return;
    if (editor.dirty && !window.confirm(unsavedSourceWarning)) return;
    onClose();
  };
  return (
    <Dialog
      open
      fullWidth
      maxWidth="xl"
      className="source-manager-dialog"
      onClose={close}
      aria-labelledby="source-manager-title"
    >
      <DialogTitle id="source-manager-title">Manage data sources</DialogTitle>
      <DialogContent dividers>
        {notice && (
          <Alert severity="success" onClose={() => setNotice("")}>
            {notice}
          </Alert>
        )}
        <SourceWorkspace editor={editor} />
      </DialogContent>
      <DialogActions>
        {editor.pending && (
          <span role="status">Wait for the source operation to finish.</span>
        )}
        <Button onClick={close} disabled={editor.pending}>
          Close data sources
        </Button>
      </DialogActions>
    </Dialog>
  );
}
