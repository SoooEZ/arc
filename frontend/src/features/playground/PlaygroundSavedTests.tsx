import { useState } from "react";
import {
  Alert,
  Button,
  CircularProgress,
  ListItemText,
  Menu,
  MenuItem,
} from "@mui/material";
import { ClipboardCheck } from "lucide-react";
import type { RuleSummary, TestCase } from "../../types";
import { testCaseApi } from "../../api/testCases";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import { ruleIncarnation } from "../../domain/ruleIdentity";
import { inputsText, testOutcome, type TestRun } from "../../domain/testCases";

const noTests: TestCase[] = [];

/**
 * Fills the playground's inputs from one of the rule's saved tests. The list
 * is read each time the menu opens, so a test saved in the editor meanwhile is
 * offered, and a playground visit that never opens it reads nothing.
 */
export function SavedTestMenu({
  rule,
  disabled,
  onChoose,
}: {
  rule: RuleSummary | null;
  disabled: boolean;
  onChoose: (test: TestCase) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [attempt, setAttempt] = useState(0);
  const open = anchor !== null && rule !== null;
  // A deleted rule created again under its ID has other tests (lesson F36).
  const tests = useAsyncResource<TestCase[]>(
    JSON.stringify([rule ? ruleIncarnation(rule) : "", attempt]),
    open && rule ? (signal) => testCaseApi.list(rule.id, { signal }) : null,
    noTests,
  );
  const close = () => setAnchor(null);
  return (
    <>
      <Button
        size="small"
        startIcon={<ClipboardCheck size={14} />}
        disabled={disabled || !rule}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        Load saved test
      </Button>
      <Menu
        anchorEl={anchor}
        open={open}
        onClose={close}
        slotProps={{ list: { "aria-label": "Saved tests" } }}
      >
        {savedTestItems({
          tests: tests.data,
          loading: tests.loading,
          error: tests.error,
          onRetry: () => setAttempt((current) => current + 1),
          onChoose: (test) => {
            close();
            onChoose(test);
          },
        })}
      </Menu>
    </>
  );
}

/**
 * The menu's items, returned as the Menu's direct children: its keyboard focus
 * finds the first item among them, not inside a wrapping component.
 */
function savedTestItems({
  tests,
  loading,
  error,
  onRetry,
  onChoose,
}: {
  tests: TestCase[];
  loading: boolean;
  error: string;
  onRetry: () => void;
  onChoose: (test: TestCase) => void;
}) {
  if (loading)
    return [
      <MenuItem key="loading" disabled>
        <CircularProgress size={14} />
        &nbsp; Loading saved tests…
      </MenuItem>,
    ];
  if (error)
    return [
      <MenuItem key="error" onClick={onRetry}>
        <ListItemText
          primary="Could not load saved tests. Retry"
          secondary={error}
        />
      </MenuItem>,
    ];
  if (!tests.length)
    return [
      <MenuItem key="none" disabled className="saved-test-empty">
        <ListItemText
          primary="No saved tests yet"
          secondary="Save a test from the Test panel in the rule's editor."
        />
      </MenuItem>,
    ];
  return tests.map((test) => (
    <MenuItem
      key={test.id}
      className="saved-test-option"
      onClick={() => onChoose(test)}
    >
      <ListItemText primary={test.name} secondary={inputsText(test.inputs)} />
    </MenuItem>
  ));
}

/**
 * Whether the response meets the saved test whose inputs were loaded: the
 * result it expects, or a failure whose message contains its expected text.
 */
export function SavedTestComparison({
  test,
  run,
}: {
  test: TestCase;
  run: TestRun;
}) {
  const outcome = testOutcome(test, run);
  return outcome.passed ? (
    <Alert severity="success" className="saved-test-comparison">
      Matches the saved test “{test.name}”.
    </Alert>
  ) : (
    <Alert severity="warning" className="saved-test-comparison">
      Differs from the saved test “{test.name}”: {outcome.reason}
    </Alert>
  );
}
