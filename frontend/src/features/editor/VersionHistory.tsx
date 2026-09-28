import { Alert, CircularProgress, IconButton } from "@mui/material";
import { Clock3, X } from "lucide-react";
import { ruleApi } from "../../api/rules";
import { rulePath } from "../../app/routing";
import { usePagedResource } from "../../hooks/usePagedResource";
import CatalogPagination from "../../components/CatalogPagination";
export default function VersionHistory({
  ruleId,
  publishedVersion,
  navigate,
  onClose,
}: {
  ruleId: string;
  /** The latest published version; publishing changes it and reloads the list. */
  publishedVersion: number | null;
  navigate: (path: string) => void;
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
              onClick={() => navigate(rulePath({ ruleId, version: v.version }))}
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
        ))}
      <CatalogPagination
        label="Rule versions"
        offset={page.offset}
        limit={page.limit}
        total={page.data.total}
        loading={loading}
        onPage={page.setOffset}
      />
      <IconButton aria-label="Close history" onClick={() => onClose()}>
        <X size={15} />
      </IconButton>
    </div>
  );
}
