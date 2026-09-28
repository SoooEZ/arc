import { Alert, Button, CircularProgress, TextField } from "@mui/material";
import { Database, Globe2, type LucideIcon } from "lucide-react";
import CatalogPagination from "../../components/CatalogPagination";
import type { SourceSummary } from "../../types";
import type { SourceKind } from "./sourceProviders";
import type { SourceEditor } from "./useSourceEditor";

// Exhaustive: a new provider fails to compile until it has a list icon.
const providerIcons: Record<SourceKind, LucideIcon> = {
  LOOKUP: Database,
  HTTP: Globe2,
};

/** The searchable, paged list of sources beside the open one. */
export default function SourceList({
  catalog,
  selectedId,
  onSelect,
}: {
  catalog: SourceEditor["catalog"];
  selectedId: string | undefined;
  onSelect: (source: SourceSummary) => Promise<void>;
}) {
  return (
    <aside className="source-list">
      <TextField
        label="Search data sources"
        value={catalog.search}
        onChange={(event) => catalog.setSearch(event.target.value)}
      />
      {catalog.loading && (
        <CircularProgress size={20} aria-label="Loading data sources" />
      )}
      {catalog.error && (
        <Alert
          severity="error"
          action={
            <Button color="inherit" size="small" onClick={catalog.retry}>
              Retry
            </Button>
          }
        >
          Could not load data sources: {catalog.error}
        </Alert>
      )}
      {catalog.rows.map((source) => (
        <button
          className={selectedId === source.id ? "active" : ""}
          key={source.id}
          onClick={() => void onSelect(source)}
        >
          <ProviderIcon kind={source.kind} />
          <span>
            {source.name}
            <small>
              {source.id} · v{source.version}
            </small>
          </span>
        </button>
      ))}
      <CatalogPagination
        label="Data sources"
        offset={catalog.page.offset}
        limit={catalog.page.limit}
        total={catalog.total}
        loading={catalog.loading}
        onPage={catalog.page.setOffset}
      />
      <p>
        Lookup tables work offline. HTTP sources read JSON APIs. Both use
        immutable configuration versions.
      </p>
    </aside>
  );
}

function ProviderIcon({ kind }: { kind: SourceKind }) {
  const Icon = providerIcons[kind];
  return <Icon size={19} />;
}
