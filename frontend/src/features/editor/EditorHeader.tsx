import { Button, Chip, IconButton, Tooltip } from "@mui/material";
import {
  Clock3,
  Code2,
  GitBranch,
  Play,
  Save,
  Settings,
  Upload,
} from "lucide-react";
import type { Rule } from "../../types";
import { kindLabel } from "../../types";
import { KindIcon } from "../../components/Icons";
import { rulePath } from "../../app/routing";
import {
  viewToggleLabel,
  type EditorCapabilities,
  type EditorTask,
} from "./editorCapabilities";

/** How the draft relates to what is saved, shown beside the rule kind. */
function saveStatus(dirty: boolean, readOnly: boolean): string {
  if (dirty) return "Unsaved changes";
  if (readOnly) return "Immutable published version";
  return "All changes saved";
}

interface Props {
  rule: Rule;
  /** The view on screen (`shownView`), which the toggle leaves. */
  mode: "code" | "graph";
  readOnly: boolean;
  dirty: boolean;
  /** The running command, which the Save and Publish labels report. */
  busy: EditorTask | "";
  capabilities: EditorCapabilities;
  requestedVersion: number | null;
  testOpen: boolean;
  embedded: boolean;
  navigate: (path: string) => void;
  switchView: () => Promise<void>;
  showHistory: () => void;
  setSettingsOpen: (open: boolean) => void;
  action: (type: "save" | "validate" | "publish") => Promise<void>;
  onToggleTest: () => void;
}
export default function EditorHeader({
  rule,
  mode,
  readOnly,
  dirty,
  busy,
  capabilities: can,
  requestedVersion,
  testOpen,
  embedded,
  navigate,
  switchView,
  showHistory,
  setSettingsOpen,
  action,
  onToggleTest,
}: Props) {
  return (
    <div className="editor-heading">
      <div className="editor-title">
        <span className={`kind-icon ${rule.kind.toLowerCase()}`}>
          <KindIcon kind={rule.kind} />
        </span>
        <div>
          <div className="editor-name">
            <h1>{rule.name}</h1>
            <Tooltip title="Rule settings">
              <IconButton
                aria-label="Rule settings"
                size="small"
                disabled={!can.openSettings}
                onClick={() => setSettingsOpen(true)}
              >
                <Settings size={17} />
              </IconButton>
            </Tooltip>
            <Chip
              size="small"
              className={readOnly ? "published-chip" : "draft-chip"}
              label={readOnly ? `Version ${requestedVersion}` : "Draft"}
            />
          </div>
          <span>
            {kindLabel[rule.kind]}
            <span className="tiny-divider" />
            {saveStatus(dirty, readOnly)}
          </span>
        </div>
      </div>
      <div className="editor-actions">
        <Button
          startIcon={
            mode === "code" ? <GitBranch size={15} /> : <Code2 size={15} />
          }
          onClick={() => void switchView()}
          disabled={!can.switchView}
        >
          {viewToggleLabel(mode)}
        </Button>
        <Tooltip title="Version history">
          <IconButton aria-label="Version history" onClick={showHistory}>
            <Clock3 size={18} />
          </IconButton>
        </Tooltip>
        <Button
          startIcon={<Play size={15} />}
          variant="outlined"
          disabled={!can.test}
          onClick={onToggleTest}
        >
          {testOpen ? "Hide test" : "Test rule"}
        </Button>
        {!readOnly && (
          <>
            <Button
              startIcon={<Save size={15} />}
              variant="outlined"
              onClick={() => action("save")}
              disabled={!can.save}
            >
              {busy === "save" ? "Saving…" : "Save draft"}
            </Button>
            <Button
              startIcon={<Upload size={15} />}
              variant="contained"
              onClick={() => action("publish")}
              disabled={!can.publish}
            >
              {busy === "publish" ? "Publishing…" : "Publish"}
            </Button>
          </>
        )}
        {readOnly && !embedded && (
          <Button
            variant="contained"
            onClick={() => navigate(rulePath({ ruleId: rule.id }))}
          >
            Edit draft
          </Button>
        )}
      </div>
    </div>
  );
}
