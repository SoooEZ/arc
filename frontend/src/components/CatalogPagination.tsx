import { Button } from "@mui/material";

/**
 * A catalog's page and count. A list that fits on one page shows no pager:
 * its items are all in view. An empty list still says "0 results", where it
 * may be the only sign that a search matched nothing.
 */
export default function CatalogPagination({
  offset,
  limit,
  total,
  loading,
  onPage,
  label = "Results",
}: {
  offset: number;
  limit: number;
  total: number;
  loading: boolean;
  onPage: (offset: number) => void;
  label?: string;
}) {
  const paged = offset > 0 || total > limit;
  if (!paged && total > 0) return null;
  return (
    <nav aria-label={`${label} pages`} className="catalog-pagination">
      {paged && (
        <Button
          size="small"
          disabled={loading || offset === 0}
          onClick={() => onPage(offset - limit)}
        >
          Previous
        </Button>
      )}
      <span>
        {total
          ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`
          : "0 results"}
      </span>
      {paged && (
        <Button
          size="small"
          disabled={loading || offset + limit >= total}
          onClick={() => onPage(offset + limit)}
        >
          Next
        </Button>
      )}
    </nav>
  );
}
