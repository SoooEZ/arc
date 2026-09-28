import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import SourcesPage from "./SourcesPage";

export default function SourceManagerDialog({
  onClose,
}: {
  onClose: () => void;
}) {
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  // Route changes and page unloads are guarded by the source editor's navigation guard.
  const close = () => {
    if (busy) return;
    if (dirty && !window.confirm("Discard unsaved source changes?")) return;
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
        <SourcesPage onDirty={setDirty} onBusy={setBusy} notify={setNotice} />
      </DialogContent>
      <DialogActions>
        {busy && (
          <span role="status">Wait for the source operation to finish.</span>
        )}
        <Button onClick={close} disabled={busy}>
          Close data sources
        </Button>
      </DialogActions>
    </Dialog>
  );
}
