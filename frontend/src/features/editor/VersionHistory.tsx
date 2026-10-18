import { Alert, Button, CircularProgress, IconButton } from "@mui/material";
import { Clock3, GitCompare, X } from "lucide-react";
import { ruleApi } from "../../api/rules";
import { rulePath } from "../../app/routing";
import {
  paginationProps,
  usePagedResource,
} from "../../hooks/usePagedResource";
import CatalogPagination from "../../components/CatalogPagination";
import type { ComparedState } from "./CompareVersions";
export default function VersionHistory({
  ruleId,
  publishedVersion,
  navigate,
  onCompare,
  onClose,
}: {
  ruleId: string;
  /** The latest published version; publishing changes it and reloads the list. */
  publishedVersion: number | null;
  navigate: (path: string) => void;
  /** Opens the version comparison with these two states. */
  onCompare: (states: { from: ComparedState; to: ComparedState }) => void;
  onClose: () => void;
}) {
  const page = usePagedResource(
    JSON.stringify([ruleId, publishedVersion]),
    (offset, limit, signal) =>
      ruleApi.versionSummaries(ruleId, { offset, limit }, { signal }),
  );
  const {
    data: { items: versions },
    error,
    loading,
  } = page;
  return (
    <div className="version-bar">
      <Clock3 size={16} />
      <strong>Published versions</strong>
      {loading && <CircularProgress size={16} aria-label="Loading versions" />}
      {error && (
        <Alert severity="error">Could not load versions: {error}</Alert>
      )}
      {!loading &&
        !error &&
        (versions.length ? (
          versions.map((v) => (
            <button
              key={v.version}
              className="version-chip"
              title={v.note ?? undefined}
              onClick={() => navigate(rulePath({ ruleId, version: v.version }))}
            >
              v{v.version}
              <small>{new Date(v.publishedAt).toLocaleDateString()}</small>
              {v.note && <span className="version-note">{v.note}</span>}
            </button>
          ))
        ) : (
          <span>
            No published versions yet. Publish your first version to create a
            stable API.
          </span>
        ))}
      {page.data.total > 0 && (
        <CatalogPagination
          label="Rule versions"
          {...paginationProps(page)}
          loading={loading}
        />
      )}
      {publishedVersion !== null && (
        <Button
          size="small"
          startIcon={<GitCompare size={14} />}
          onClick={() => onCompare({ from: publishedVersion, to: "draft" })}
        >
          Compare
        </Button>
      )}
      <IconButton aria-label="Close history" onClick={() => onClose()}>
        <X size={15} />
      </IconButton>
    </div>
  );
}
