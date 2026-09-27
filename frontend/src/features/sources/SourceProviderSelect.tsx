import PagedAutocomplete from "../../components/PagedAutocomplete";
import { sourceApi } from "../../api/sources";
import type { SourceSummary } from "../../types";

type ProviderOption =
  { type: "source"; source: SourceSummary } | { type: "caller" };

function optionLabel(option: ProviderOption) {
  return option.type === "source"
    ? option.source.name
    : "Caller / default value";
}

/** Search pages are separate from the currently selected immutable source pin. */
export default function SourceProviderSelect({
  selected,
  revision,
  readOnly,
  onChange,
}: {
  selected: SourceSummary | null;
  revision: number;
  readOnly: boolean;
  onChange: (source: SourceSummary | null) => void;
}) {
  return (
    <PagedAutocomplete<ProviderOption>
      label="Value provider"
      owner={`source-providers:${revision}`}
      value={
        selected ? { type: "source", source: selected } : { type: "caller" }
      }
      fixedOptions={[{ type: "caller" }]}
      disabled={readOnly}
      loadPage={async (search, offset, limit, signal) => {
        const page = await sourceApi.catalog(
          { search, offset, limit },
          { signal },
        );
        return {
          ...page,
          items: page.items.map((source): ProviderOption => ({
            type: "source",
            source,
          })),
        };
      }}
      itemKey={(option) =>
        option.type === "source" ? `source:${option.source.id}` : "caller"
      }
      itemLabel={optionLabel}
      helperText="Type a source name or ID to search. Scroll for more results."
      onChange={(option) =>
        onChange(option.type === "source" ? option.source : null)
      }
    />
  );
}
