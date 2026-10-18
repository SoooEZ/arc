import { memo, useState } from "react";
import { ruleApi } from "../../api/rules";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import {
  Button,
  Chip,
  IconButton,
  ListItemIcon,
  Menu,
  MenuItem,
} from "@mui/material";
import {
  ArrowUpRight,
  Copy,
  Download,
  FileCode2,
  MoreHorizontal,
  RotateCcw,
} from "lucide-react";
import type { RuleSummary, Rule } from "../../types";
import { ruleKinds } from "../../domain/ruleKinds";
import { KindIcon } from "../../components/Icons";
import { exportDefinition } from "../editor/exportDefinition";
import RulePreview from "./RulePreview";
import { cachedPreview, rememberPreview } from "./previewCache";

/**
 * A card's other actions, above the card-wide Open graph button. Export
 * writes the draft the card's preview read, so it waits for that read.
 */
function RuleCardActions({
  rule,
  loaded,
  onDuplicate,
  onOpenCode,
}: {
  rule: RuleSummary;
  /** The rule as the preview read it, or null while that read is pending or failed. */
  loaded: Rule | null;
  onDuplicate: (rule: RuleSummary) => void;
  onOpenCode: (rule: RuleSummary) => void;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const close = () => setAnchor(null);
  return (
    <>
      <IconButton
        className="rule-card-menu"
        size="small"
        aria-label={`More actions: ${rule.name}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => setAnchor(event.currentTarget)}
      >
        <MoreHorizontal size={16} />
      </IconButton>
      <Menu
        anchorEl={anchor}
        open={anchor !== null}
        onClose={close}
        slotProps={{ list: { "aria-label": `Actions for ${rule.name}` } }}
      >
        <MenuItem
          onClick={() => {
            close();
            onDuplicate(rule);
          }}
        >
          <ListItemIcon>
            <Copy size={15} />
          </ListItemIcon>
          Duplicate…
        </MenuItem>
        <MenuItem
          onClick={() => {
            close();
            onOpenCode(rule);
          }}
        >
          <ListItemIcon>
            <FileCode2 size={15} />
          </ListItemIcon>
          Open in Code studio
        </MenuItem>
        <MenuItem
          disabled={!loaded}
          onClick={() => {
            close();
            if (loaded) exportDefinition(loaded.draft, loaded.id, null);
          }}
        >
          <ListItemIcon>
            <Download size={15} />
          </ListItemIcon>
          Export draft JSON
        </MenuItem>
      </Menu>
    </>
  );
}

/**
 * Memoized: a card and its graph preview render again for another summary,
 * not for a keystroke in the library search above them.
 */
export default memo(function RuleCard({
  rule,
  onOpen,
  onDuplicate,
  onOpenCode,
}: {
  rule: RuleSummary;
  onOpen: (rule: RuleSummary) => void;
  onDuplicate: (rule: RuleSummary) => void;
  onOpenCode: (rule: RuleSummary) => void;
}) {
  const [attempt, setAttempt] = useState(0);
  const cached = cachedPreview(rule);
  // Only mounted cards on the current catalog page fetch; unmount aborts old previews.
  const detail = useAsyncResource<Rule | null>(
    `${rule.id}:${rule.createdAt}:${rule.revision}:${attempt}`,
    cached
      ? null
      : async (signal) => {
          const loaded = await ruleApi.get(rule.id, { signal });
          rememberPreview(rule, loaded);
          return loaded;
        },
    null,
  );
  const preview = cached ?? detail.data;
  return (
    <article className="rule-card">
      <div className="rule-card-top">
        <span className={`kind-icon ${rule.kind.toLowerCase()}`}>
          <KindIcon kind={rule.kind} />
        </span>
        <span className="rule-card-status">
          {rule.draftChanged && (
            <Chip
              size="small"
              className="changed-chip"
              label="Unpublished changes"
            />
          )}
          <Chip
            size="small"
            className={rule.publishedVersion ? "published-chip" : "draft-chip"}
            label={
              rule.publishedVersion
                ? `Published · v${rule.publishedVersion}`
                : "Draft"
            }
          />
          <RuleCardActions
            rule={rule}
            loaded={preview}
            onDuplicate={onDuplicate}
            onOpenCode={onOpenCode}
          />
        </span>
      </div>
      <div className="rule-card-title">
        <h3>{rule.name}</h3>
      </div>
      <p>
        {rule.description ||
          "Add a description to explain what this rule does."}
      </p>
      {preview ? (
        <RulePreview rule={preview} />
      ) : (
        <div className="rule-preview">
          <div className="mini-graph preview-state" aria-live="polite">
            {detail.error ? (
              <>
                <span>Graph preview unavailable</span>
                <small>{detail.error}</small>
                <Button
                  className="preview-retry"
                  size="small"
                  startIcon={<RotateCcw size={13} />}
                  onClick={() => setAttempt((value) => value + 1)}
                >
                  Retry preview
                </Button>
              </>
            ) : (
              <span>Loading graph…</span>
            )}
          </div>
          <div className="rule-preview-caption">Current draft</div>
        </div>
      )}
      <div className="rule-card-footer">
        <span>{ruleKinds[rule.kind].label}</span>
        <span>
          {rule.nodeCount} {rule.nodeCount === 1 ? "node" : "nodes"}
          <span className="tiny-divider" />
          {rule.inputCount} {rule.inputCount === 1 ? "input" : "inputs"}
        </span>
      </div>
      <button
        className="rule-card-open"
        aria-label={`Open graph: ${rule.name}`}
        onClick={() => onOpen(rule)}
      >
        <span>
          Open graph <ArrowUpRight size={14} />
        </span>
      </button>
    </article>
  );
});
