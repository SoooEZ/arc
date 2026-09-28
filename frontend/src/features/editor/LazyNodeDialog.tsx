import type { ReactNode } from "react";
import { Box, Button } from "@mui/material";
import { LazyBoundary } from "../../components/LazyBoundary";

/**
 * Hosts a lazily loaded node dialog. Requesting the dialog already locks the
 * inspector (lesson F6), so the loading row offers Cancel and the failure
 * message offers Close, and both release that lock: a slow or failed module
 * download, or a render error, must not leave the inspector locked. Once shown,
 * the dialog's own controls close it.
 */
export default function LazyNodeDialog({
  label,
  onCancel,
  children,
}: {
  /** Lower-case name for loading and failure messages, e.g. "node editor". */
  label: string;
  onCancel: () => void;
  children: ReactNode;
}) {
  return (
    <LazyBoundary
      label={label}
      onDismiss={onCancel}
      fallback={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 3 }}>
          <span role="status">Loading the {label}…</span>
          <Button size="small" onClick={onCancel}>
            Cancel
          </Button>
        </Box>
      }
    >
      {children}
    </LazyBoundary>
  );
}
