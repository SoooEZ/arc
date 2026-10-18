import { Button } from "@mui/material";

/**
 * A catalog's page and count. A list that fits on one page, an empty one
 * included, shows no pager: its items are all in view, and each list says
 * itself when it has none ("0 results" under an empty state repeated it, and
 * suggested an empty catalog while a read had failed).
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
  if (offset === 0 && total <= limit) return null;
  return (
    <nav aria-label={`${label} pages`} className="catalog-pagination">
      <Button
        size="small"
        disabled={loading || offset === 0}
        onClick={() => onPage(offset - limit)}
      >
        Previous
      </Button>
      <span>
        {/* A page past a list that shrank meanwhile has no range to show. */}
        {total
          ? `${offset + 1}–${Math.min(offset + limit, total)} of ${total}`
          : "0 results"}
      </span>
      <Button
        size="small"
        disabled={loading || offset + limit >= total}
        onClick={() => onPage(offset + limit)}
      >
        Next
      </Button>
    </nav>
  );
}
