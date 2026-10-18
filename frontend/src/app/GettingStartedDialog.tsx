import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
} from "@mui/material";
import { ArrowRight, Plus } from "lucide-react";

interface Step {
  title: string;
  text: string;
  /** The page or dialog a step can open from here. */
  opens?: "create" | "api";
}

/** The path from an empty library to an application calling a rule. */
const steps: readonly Step[] = [
  {
    title: "Create a rule",
    text: "Start from a working template, import a graph exported from ARC, or duplicate a rule you already have.",
    opens: "create",
  },
  {
    title: "Add inputs and steps",
    text: "Select the Input card to declare parameters. An exit without a connection offers + for the next step: Conditions branch, Formulas calculate and Outputs return the result.",
  },
  {
    title: "Test as you build",
    text: "Test rule runs the unsaved draft and highlights the path it took. Save as test keeps the inputs and their result, so later edits are checked against them.",
  },
  {
    title: "Publish a version",
    text: "Publish lists what changed since the last version and runs your saved tests first. A published version never changes, so callers can rely on it.",
  },
  {
    title: "Call it from your application",
    text: "Send the inputs to POST /api/rules/{id}/execute. The API playground builds the request and its cURL command.",
    opens: "api",
  },
];

/** What each shortcut does, and the key combinations that do it. */
const shortcuts: readonly { action: string; combos: string[][] }[] = [
  { action: "Save the draft", combos: [["⌘/Ctrl", "S"]] },
  { action: "Undo a graph edit", combos: [["⌘/Ctrl", "Z"]] },
  { action: "Redo a graph edit", combos: [["⌘/Ctrl", "Shift", "Z"]] },
  {
    action: "Remove the selected card or connection",
    combos: [["Delete"], ["Backspace"]],
  },
  {
    action: "Build the code into the graph",
    combos: [["⌘/Ctrl", "Enter"]],
  },
  { action: "Show this help", combos: [["?"]] },
];

/**
 * The sidebar's Getting started: how a rule goes from the library to an
 * application, with the keyboard shortcuts and the pages that help on the way.
 */
export default function GettingStartedDialog({
  onClose,
  onCreate,
  onNavigate,
}: {
  onClose: () => void;
  /** Opens Create rule. */
  onCreate: () => void;
  /** Goes to a workspace page: the playground or the API reference. */
  onNavigate: (page: "playground" | "docs") => void;
}) {
  const leaveFor = (open: () => void) => () => {
    onClose();
    open();
  };
  const stepActions = (opens: Step["opens"]) => {
    if (opens === "create")
      return (
        <Button
          size="small"
          startIcon={<Plus size={14} />}
          onClick={leaveFor(onCreate)}
        >
          Create a rule
        </Button>
      );
    if (opens === "api")
      return (
        <>
          <Button
            size="small"
            endIcon={<ArrowRight size={14} />}
            onClick={leaveFor(() => onNavigate("playground"))}
          >
            Open the API playground
          </Button>
          <Button
            size="small"
            endIcon={<ArrowRight size={14} />}
            onClick={leaveFor(() => onNavigate("docs"))}
          >
            API reference
          </Button>
        </>
      );
    return null;
  };
  return (
    <Dialog
      open
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      aria-labelledby="getting-started-title"
    >
      <DialogTitle id="getting-started-title">Getting started</DialogTitle>
      <DialogContent className="help-dialog">
        <p className="muted-note">
          ARC keeps business logic as versioned rules that any application can
          call.
        </p>
        <ol className="help-steps">
          {steps.map((step) => (
            <li key={step.title}>
              <strong>{step.title}</strong>
              <p>{step.text}</p>
              {step.opens && (
                <div className="help-step-actions">
                  {stepActions(step.opens)}
                </div>
              )}
            </li>
          ))}
        </ol>
        <table className="help-shortcuts">
          <caption>Keyboard shortcuts</caption>
          <tbody>
            {shortcuts.map(({ action, combos }) => (
              <tr key={action}>
                <th scope="row">
                  {combos.map((keys, index) => (
                    <span key={keys.join("+")}>
                      {index > 0 && <span className="help-or"> or </span>}
                      {keys.map((key) => (
                        <kbd key={key}>{key}</kbd>
                      ))}
                    </span>
                  ))}
                </th>
                <td>{action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>
    </Dialog>
  );
}
