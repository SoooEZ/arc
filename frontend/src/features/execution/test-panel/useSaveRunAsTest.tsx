import { useState } from "react";
import { Button } from "@mui/material";
import { ClipboardCheck, ClipboardPlus } from "lucide-react";
import type { TestCaseWrite } from "../../../types";
import { tryParseExecutionInputs } from "../../../domain/executionInputs";
import { suggestedTestName, type TestRun } from "../../../domain/testCases";
import type { PreviewExecution } from "./usePreviewExecution";
import type { SavedTests } from "./useSavedTests";
import SaveTestDialog from "./SaveTestDialog";

/** A shown run being saved as a test: what it will expect, the run, and which run it was. */
interface SavingRun {
  write: TestCaseWrite;
  run: TestRun;
  /** The shown run's identity (its result, problem or message). */
  from: unknown;
}

/**
 * Save as test for the run the panel shows: the action beside its result and
 * the dialog it opens. The test expects what the run produced, and the run
 * counts as the test's result on this graph. Once saved, Try inputs stays
 * open for the next case, and the run's action leads to the saved tests.
 */
export function useSaveRunAsTest(preview: PreviewExecution, tests: SavedTests) {
  const [saving, setSaving] = useState<SavingRun | null>(null);
  const [savedFrom, setSavedFrom] = useState<unknown>(null);
  const shownRun = preview.result ?? preview.problem ?? preview.error;
  /** The shown run as a test that expects what it produced. */
  const savable = (): SavingRun | null => {
    const inputs = tryParseExecutionInputs(preview.input);
    if (!inputs || (!preview.result && !preview.error)) return null;
    return {
      write: {
        name: suggestedTestName(inputs),
        inputs,
        expectedResult: preview.result ? preview.result.result : null,
        expectedError: preview.result ? null : preview.error,
      },
      run: preview.result
        ? { result: preview.result.result }
        : { error: preview.error },
      from: shownRun,
    };
  };
  const action =
    savedFrom !== null && savedFrom === shownRun ? (
      <Button
        size="small"
        startIcon={<ClipboardCheck size={14} />}
        onClick={() => preview.setPanelView("saved")}
      >
        Saved · View tests
      </Button>
    ) : (
      <Button
        size="small"
        startIcon={<ClipboardPlus size={14} />}
        onClick={() => setSaving(savable())}
      >
        Save as test
      </Button>
    );
  const dialog = saving && (
    <SaveTestDialog
      title="Save as test"
      initial={saving.write}
      editInputs={false}
      onSave={async (write) => {
        await tests.create(write, saving.run);
        setSavedFrom(saving.from);
      }}
      onClose={() => setSaving(null)}
    />
  );
  return { action, dialog };
}
