import { Button, Chip, IconButton, Tooltip } from "@mui/material";
import {
  Clock3,
  Code2,
  GitBranch,
  GitCompare,
  Play,
  Save,
  Settings,
  Upload,
} from "lucide-react";
import type { Rule } from "../../types";
import { ruleKinds } from "../../domain/ruleKinds";
import { KindIcon } from "../../components/Icons";
import { rulePath } from "../../app/routing";
import {
  viewToggleLabel,
  type EditorCapabilities,
  type EditorTask,
} from "./document/editorCapabilities";
import type { Publication } from "./versions/usePublication";
import RestoreVersion from "./versions/RestoreVersion";
import type { ComparedState } from "./versions/CompareVersions";

/** How the draft relates to what is saved, shown beside the rule kind. */
function saveStatus(dirty: boolean, readOnly: boolean): string {
  if (dirty) return "Unsaved changes";
  if (readOnly) return "Immutable published version";
  return "All changes saved";
}

/**
 * Whether the draft is live: never published, the latest version as it is,
 * or changed since that version, as the library card says it.
 */
function PublicationChips({ publication }: { publication: Publication }) {
  if (publication.state === "unpublished")
    return (
      <Tooltip title="Publish a version to make this rule callable through the API.">
        <Chip size="small" className="draft-chip" label="Not published" />
      </Tooltip>
    );
  return (
    <>
      <Tooltip
        title={
          publication.state === "current"
            ? `The draft is version ${publication.version} as published.`
            : `Version ${publication.version} is what the API runs.`
        }
      >
        <Chip
          size="small"
          className="published-chip"
          label={`Published · v${publication.version}`}
        />
      </Tooltip>
      {publication.state === "changed" && (
        <Tooltip
          title={`The draft differs from version ${publication.version}. Publish to make the changes callable.`}
        >
          <Chip
            size="small"
            className="changed-chip"
            label="Unpublished changes"
          />
        </Tooltip>
      )}
    </>
  );
}

interface Props {
  rule: Rule;
  /** How the draft relates to the latest published version. */
  publication: Publication;
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
  /** Opens the version comparison with these two states. */
  onCompare: (states: { from: ComparedState; to: ComparedState }) => void;
  setSettingsOpen: (open: boolean) => void;
  action: (type: "save" | "validate" | "publish") => Promise<void>;
  onToggleTest: () => void;
}
export default function EditorHeader({
  rule,
  publication,
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
  onCompare,
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
            {readOnly ? (
              <Chip
                size="small"
                className="published-chip"
                label={`Version ${requestedVersion}`}
              />
            ) : (
              <PublicationChips publication={publication} />
            )}
          </div>
          <span>
            {ruleKinds[rule.kind].label}
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
            <Tooltip
              title={
                publication.state === "current"
                  ? `Nothing to publish: the draft is version ${publication.version} as published.`
                  : ""
              }
            >
              <span>
                <Button
                  startIcon={<Upload size={15} />}
                  variant="contained"
                  onClick={() => action("publish")}
                  // Publishing the latest version again is refused, so it is not offered.
                  disabled={!can.publish || publication.state === "current"}
                >
                  {publishLabel(busy)}
                </Button>
              </span>
            </Tooltip>
          </>
        )}
        {readOnly && !embedded && requestedVersion !== null && (
          <>
            <Button
              startIcon={<GitCompare size={15} />}
              onClick={() =>
                // What this version changed, or for the first, what changed since.
                onCompare(
                  requestedVersion > 1
                    ? { from: requestedVersion - 1, to: requestedVersion }
                    : { from: requestedVersion, to: "draft" },
                )
              }
            >
              Compare
            </Button>
            <RestoreVersion
              rule={rule}
              version={requestedVersion}
              disabled={!can.validate}
              navigate={navigate}
            />
            <Button
              variant="contained"
              onClick={() => navigate(rulePath({ ruleId: rule.id }))}
            >
              Edit draft
            </Button>
          </>
        )}
      </div>
    </div>
  );
}

/** The Publish button while its review or its publication runs. */
function publishLabel(busy: EditorTask | ""): string {
  if (busy === "review") return "Checking…";
  if (busy === "publish") return "Publishing…";
  return "Publish";
}
