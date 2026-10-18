import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  TextField,
} from "@mui/material";
import { CheckCircle2 } from "lucide-react";
import type { Definition } from "../../../types";
import { MAX_RELEASE_NOTE_CHARACTERS } from "../../../domain/limits";
import {
  resultCounts,
  runSavedTests,
  type TestResult,
} from "../../execution/testPanel/savedTests";
import type { SavedTests } from "../../execution/testPanel/useSavedTests";
import type { PublishReview } from "../document/useRuleDocument";
import VersionChangeList from "./VersionChangeList";

/**
 * Confirms a publication after its review: what the new version changes since
 * the latest one, how the reviewed draft does on the rule's saved tests, and
 * an optional note the version history shows. A draft identical to the latest
 * version cannot be published again; one that fails a saved test can, once
 * the publisher says so.
 */
export default function PublishDialog({
  review,
  tests,
  onConfirm,
  onCancel,
}: {
  review: PublishReview;
  tests: SavedTests;
  onConfirm: (note: string) => void;
  onCancel: () => void;
}) {
  const [note, setNote] = useState("");
  const [failuresAccepted, setFailuresAccepted] = useState(false);
  const check = useTestCheck(tests, review.definition);
  const tooLong = note.length > MAX_RELEASE_NOTE_CHARACTERS;
  const unchanged = !!review.previous?.changes.identical;
  const held = check.running || (check.failed > 0 && !failuresAccepted);
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
        {!unchanged && (
          <TestCheck
            tests={tests}
            check={check}
            accepted={failuresAccepted}
            onAccept={setFailuresAccepted}
          />
        )}
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
          disabled={unchanged || tooLong || held}
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
    <div className="version-changes">
      <strong>Changes since v{version}</strong>
      <VersionChangeList changes={changes} />
    </div>
  );
}

/** The saved tests run against the reviewed draft once they are read. */
function useTestCheck(tests: SavedTests, definition: Definition) {
  const [results, setResults] = useState<Record<number, TestResult>>({});
  const [done, setDone] = useState(false);
  const { status, tests: saved } = tests;
  useEffect(() => {
    if (status !== "ready" || !saved.length) return;
    const controller = new AbortController();
    void runSavedTests(definition, saved, controller.signal, (id, result) =>
      setResults((current) => ({ ...current, [id]: result })),
    ).then(() => {
      if (!controller.signal.aborted) setDone(true);
    });
    return () => controller.abort();
  }, [status, saved, definition]);
  const counts = resultCounts(saved, results);
  return {
    results,
    running: status === "loading" || (saved.length > 0 && !done),
    ...counts,
  };
}

function TestCheck({
  tests,
  check,
  accepted,
  onAccept,
}: {
  tests: SavedTests;
  check: ReturnType<typeof useTestCheck>;
  accepted: boolean;
  onAccept: (accepted: boolean) => void;
}) {
  if (tests.status === "failed")
    return (
      <Alert severity="warning">
        The saved tests could not be read: {tests.error}
      </Alert>
    );
  if (check.running)
    return (
      <div className="publish-tests">
        <CircularProgress size={14} /> Running the saved tests…
      </div>
    );
  if (!tests.tests.length)
    return (
      <p className="muted-copy">
        No saved tests. Save tests in the Test panel to check every version
        before it is published.
      </p>
    );
  if (!check.failed)
    return (
      <div className="publish-tests passed">
        <CheckCircle2 size={15} />
        {tests.tests.length === 1
          ? "The saved test passes."
          : `All ${tests.tests.length} saved tests pass.`}
      </div>
    );
  const failing = tests.tests.filter(
    (test) => check.results[test.id] && !check.results[test.id].passed,
  );
  return (
    <Alert severity="warning" className="publish-tests-failed">
      <strong>
        {check.failed} of {tests.tests.length} saved tests fail
      </strong>
      <ul>
        {failing.slice(0, 5).map((test) => (
          <li key={test.id}>
            {test.name}: {check.results[test.id].reason}
          </li>
        ))}
        {failing.length > 5 && <li>and {failing.length - 5} more</li>}
      </ul>
      <FormControlLabel
        control={
          <Checkbox
            size="small"
            checked={accepted}
            onChange={(_, value) => onAccept(value)}
          />
        }
        label="Publish anyway"
      />
    </Alert>
  );
}
