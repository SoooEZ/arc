import { useState } from "react";
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { RotateCcw } from "lucide-react";
import type { Rule } from "../../../types";
import { rulePath } from "../../../app/routing";
import { requestRestore } from "./draftRestore";

/**
 * A shown version's "Restore to draft": after confirming, the draft editor
 * opens with this version as an unsaved edit, to save or publish as the next
 * version. Nothing is written until then.
 */
export default function RestoreVersion({
  rule,
  version,
  disabled,
  navigate,
}: {
  /** The rule with the shown version as its draft. */
  rule: Rule;
  version: number;
  disabled: boolean;
  navigate: (path: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <Button
        variant="outlined"
        startIcon={<RotateCcw size={15} />}
        disabled={disabled}
        onClick={() => setConfirming(true)}
      >
        Restore to draft
      </Button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        aria-labelledby="restore-version-title"
      >
        <DialogTitle id="restore-version-title">
          Restore version {version}?
        </DialogTitle>
        <DialogContent>
          <p>
            The draft becomes a copy of version {version}. Nothing is saved yet:
            save the draft to keep it or publish it as a new version, and Undo
            brings the current draft back.
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setConfirming(false);
              requestRestore(rule, version, rule.draft);
              navigate(rulePath({ ruleId: rule.id }));
            }}
          >
            Restore to draft
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
