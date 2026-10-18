import { Button } from "@mui/material";

/**
 * A catalog's page and count. Previous and Next show only when there is more
 * than one page: a list that fits on one keeps just its count.
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
  return (
    <nav
      aria-label={`${label} pages`}
      className={`catalog-pagination ${paged ? "" : "single-page"}`}
    >
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
