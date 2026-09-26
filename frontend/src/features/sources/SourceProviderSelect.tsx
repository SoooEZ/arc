import { useState } from "react";
import { Autocomplete, TextField } from "@mui/material";
import { sourceApi } from "../../api/sources";
import { useAsyncResource } from "../../hooks/useAsyncResource";
import type { Page, SourceSummary } from "../../types";

type ProviderOption =
  | { type: "source"; source: SourceSummary }
  | { type: "caller" }
  | { type: "status"; label: string }
  | { type: "page"; offset: number; label: string };

function optionLabel(option: ProviderOption) {
  if (option.type === "source") return option.source.name;
  return option.type === "caller" ? "Caller / default value" : option.label;
}

/** One open picker owns one bounded search page; the binding remains a separate immutable pin. */
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
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const key = JSON.stringify([search, revision]);
  const [position, setPosition] = useState({ key, offset: 0 });
  const offset = position.key === key ? position.offset : 0;
  const limit = 20;
  const catalog = useAsyncResource(
    JSON.stringify([key, offset]),
    (signal) => sourceApi.catalog({ search, offset, limit }, { signal }),
    { items: [], total: 0, offset, limit } as Page<SourceSummary>,
    180,
    open && !readOnly,
  );
  const value: ProviderOption = selected
    ? { type: "source", source: selected }
    : { type: "caller" };
  const options: ProviderOption[] = [
    { type: "caller" },
    ...catalog.data.items.map((source): ProviderOption => ({
      type: "source",
      source,
    })),
  ];
  if (
    selected &&
    !search &&
    !catalog.data.items.some((source) => source.id === selected.id)
  )
    options.splice(1, 0, value);
  options.push({
    type: "status",
    label:
      catalog.error ||
      (catalog.loading
        ? "Searching data sources…"
        : catalog.data.total
          ? `${offset + 1}–${Math.min(offset + limit, catalog.data.total)} of ${catalog.data.total} provider${catalog.data.total === 1 ? "" : "s"}`
          : "No matching data sources"),
  });
  if (offset > 0)
    options.push({
      type: "page",
      offset: Math.max(0, offset - limit),
      label: "Previous providers",
    });
  if (offset + limit < catalog.data.total)
    options.push({
      type: "page",
      offset: offset + limit,
      label: "More providers",
    });
  return (
    <Autocomplete
      className="source-provider-select"
      open={open}
      onOpen={() => setOpen(true)}
      onClose={() => {
        setOpen(false);
        setSearch("");
      }}
      value={value}
      inputValue={open ? search : optionLabel(value)}
      onInputChange={(_event, text, reason) => {
        if (reason === "input") setSearch(text);
      }}
      options={options}
      filterOptions={(items) => items}
      getOptionLabel={optionLabel}
      getOptionKey={(option) =>
        option.type === "source"
          ? `source:${option.source.id}`
          : option.type === "page"
            ? `page:${option.offset}`
            : option.type
      }
      isOptionEqualToValue={(option, selectedOption) =>
        option.type === "source" && selectedOption.type === "source"
          ? option.source.id === selectedOption.source.id
          : option.type === selectedOption.type
      }
      getOptionDisabled={(option) =>
        option.type === "status" || (option.type === "page" && catalog.loading)
      }
      loading={catalog.loading}
      disabled={readOnly}
      disableClearable
      disableCloseOnSelect
      onChange={(_event, option) => {
        if (readOnly || option.type === "status") return;
        if (option.type === "page") setPosition({ key, offset: option.offset });
        else {
          onChange(option.type === "source" ? option.source : null);
          setOpen(false);
          setSearch("");
        }
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          label="Value provider"
          placeholder="Search data sources"
          error={!!catalog.error}
          helperText="Search by source name or ID."
        />
      )}
    />
  );
}
