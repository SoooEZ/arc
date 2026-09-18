import { IconButton } from "@mui/material";
import { Clock3, X } from "lucide-react";
import type { Version } from "../../types";
export default function VersionHistory({
  ruleId,
  versions,
  navigate,
  onClose,
}: {
  ruleId: string;
  versions: Version[];
  navigate: (path: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="version-bar">
      <Clock3 size={16} />
      <strong>Published versions</strong>
      {versions.length ? (
        versions.map((v) => (
          <button
            key={v.version}
            onClick={() => navigate(`/rules/${ruleId}?version=${v.version}`)}
          >
            v{v.version}
            <small>{new Date(v.publishedAt).toLocaleDateString()}</small>
          </button>
        ))
      ) : (
        <span>
          No published versions yet. Publish your first version to create a
          stable API.
        </span>
      )}
      <IconButton aria-label="Close history" onClick={() => onClose()}>
        <X size={15} />
      </IconButton>
    </div>
  );
}
