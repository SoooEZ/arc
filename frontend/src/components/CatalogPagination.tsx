import { Button } from "@mui/material";
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
  return (
    <nav
      aria-label={`${label} pages`}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        flexWrap: "wrap",
      }}
    >
      <Button
        size="small"
        disabled={loading || offset === 0}
        onClick={() => onPage(offset - limit)}
      >
        Previous
      </Button>
      <span>
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
