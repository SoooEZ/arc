import { useState } from "react";
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  TextField,
} from "@mui/material";
import { MAX_RELEASE_NOTE_CHARACTERS } from "../../domain/limits";
import { changeLines } from "../../domain/versionChanges";
import type { PublishReview } from "./useRuleDocument";

/**
 * Confirms a publication after its review: what the new version changes since
 * the latest one, and an optional note the version history shows. A draft
 * identical to the latest version cannot be published again.
 */
export default function PublishDialog({
  review,
  onConfirm,
  onCancel,
}: {
  review: PublishReview;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const tooLong = note.length > MAX_RELEASE_NOTE_CHARACTERS;
  const unchanged = !!review.previous?.changes.identical;
  return (
    <Dialog
      open
      onClose={onCancel}
      fullWidth
      maxWidth="sm"
      aria-labelledby="publish-dialog-title"
    >
      <DialogTitle id="publish-dialog-title">
        Publish version {review.version}
      </DialogTitle>
      <DialogContent className="publish-review">
        <ReviewedChanges review={review} />
        <TextField
          label="Release note (optional)"
          multiline
          minRows={2}
          value={note}
          disabled={unchanged}
          onChange={(event) => setNote(event.target.value)}
          error={tooLong}
          helperText={
            tooLong
              ? `A note holds at most ${MAX_RELEASE_NOTE_CHARACTERS} characters`
              : "What changed and why. The version history shows it."
          }
        />
        <p className="muted-copy">
          A published version never changes. Callers that name an earlier
          version keep running it.
        </p>
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="contained"
          disabled={unchanged || tooLong}
          onClick={() => onConfirm(note)}
        >
          Publish v{review.version}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function ReviewedChanges({ review }: { review: PublishReview }) {
  if (!review.previous)
    return (
      <p>
        This is the rule&apos;s first version. Once published, apps can call it
        through the API as version {review.version}.
      </p>
    );
  const { version, changes } = review.previous;
  if (changes.identical)
    return (
      <Alert severity="info">
        Nothing changed since v{version}. Change the draft to publish a new
        version.
      </Alert>
    );
  return (
    <div className="publish-changes">
      <strong>Changes since v{version}</strong>
      <ul>
        {changeLines(changes).map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
    </div>
  );
}
