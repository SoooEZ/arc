import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Autocomplete, CircularProgress, TextField } from "@mui/material";
import { useAutocompletePages } from "../hooks/useAutocompletePages";
import type { Page } from "../types";

type Choice<T> = { type: "item"; item: T } | { type: "retry" };

/** One editable field combines server search with an append-only option list. */
export default function PagedAutocomplete<T>({
  label,
  owner,
  value,
  disabled,
  loadPage,
  itemKey,
  itemLabel,
  onChange,
}: {
  label: string;
  owner: string;
  value: T | null;
  disabled: boolean;
  loadPage: (
    search: string,
    offset: number,
    limit: number,
    signal: AbortSignal,
  ) => Promise<Page<T>>;
  itemKey: (item: T) => string;
  itemLabel: (item: T) => string;
  onChange: (item: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState(false);
  const pages = useAutocompletePages(
    owner,
    search,
    open && !disabled,
    loadPage,
    itemKey,
  );
  const listbox = useRef<HTMLElement | null>(null);
  const setListbox = useCallback((element: Element | null) => {
    listbox.current = element instanceof HTMLElement ? element : null;
  }, []);
  const scroll = useRef<number | null>(null);
  const options: Choice<T>[] = pages.items.map((item) => ({
    type: "item",
    item,
  }));
  if (pages.error) options.push({ type: "retry" });
  const selected: Choice<T> | null = value
    ? { type: "item", item: value }
    : null;
  const close = () => {
    setOpen(false);
    setSearch("");
    setEditing(false);
    scroll.current = null;
  };
  const more = () => {
    if (!pages.loading && (pages.error || pages.nextOffset < pages.total)) {
      scroll.current = listbox.current?.scrollTop ?? 0;
      pages.next();
    }
  };
  // A native scroll event can lag the DOM scroll position. Capture that position
  // before MUI's passive highlight sync, including a user returning to the top.
  useLayoutEffect(() => {
    if (scroll.current !== null && listbox.current)
      scroll.current = listbox.current.scrollTop;
  }, [pages.items, pages.loading, pages.error]);
  // MUI re-syncs its highlighted option after an async append. Restore the
  // captured position in the same effect flush, without moving input focus.
  useEffect(() => {
    if (scroll.current === null || !listbox.current) return;
    listbox.current.scrollTop = scroll.current;
    if (!pages.loading) scroll.current = null;
  }, [pages.items, pages.loading, pages.error]);
  return (
    <Autocomplete<Choice<T>, false, boolean>
      open={open && !disabled}
      onOpen={() => {
        setOpen(true);
      }}
      onClose={(_event, reason) => {
        if (reason !== "selectOption") close();
      }}
      value={selected}
      inputValue={open && editing ? search : value ? itemLabel(value) : ""}
      onInputChange={(_event, text, reason) => {
        if (reason === "input") {
          scroll.current = null;
          setSearch(text);
          setEditing(true);
        }
      }}
      options={options}
      filterOptions={(items) => items}
      getOptionKey={(option) =>
        option.type === "item" ? `item:${itemKey(option.item)}` : "retry"
      }
      getOptionLabel={(option) =>
        option.type === "item"
          ? itemLabel(option.item)
          : "Retry loading results"
      }
      isOptionEqualToValue={(option, selectedOption) =>
        option.type === "item" &&
        selectedOption.type === "item" &&
        itemKey(option.item) === itemKey(selectedOption.item)
      }
      loading={pages.loading}
      loadingText="Loading results…"
      noOptionsText="No matching results"
      disabled={disabled}
      disableClearable
      disableCloseOnSelect
      selectOnFocus
      onChange={(_event, option) => {
        if (disabled || !option) return;
        if (option.type === "retry") more();
        else {
          onChange(option.item);
          close();
        }
      }}
      onHighlightChange={(_event, option, reason) => {
        if (
          reason === "keyboard" &&
          option?.type === "item" &&
          pages.items.findIndex(
            (item) => itemKey(item) === itemKey(option.item),
          ) >=
            pages.items.length - 3
        )
          more();
      }}
      slotProps={{
        listbox: {
          ref: setListbox,
          onScroll: (event) => {
            const element = event.currentTarget;
            if (scroll.current !== null) scroll.current = element.scrollTop;
            if (
              !pages.error &&
              element.scrollHeight - element.scrollTop - element.clientHeight <
                64
            )
              more();
          },
          sx: { maxHeight: 280 },
        },
      }}
      renderOption={({ key, ...props }, option) => (
        <li key={key} {...props}>
          {option.type === "item" ? (
            itemLabel(option.item)
          ) : (
            <span>
              <strong>Retry loading results</strong>
              <small style={{ display: "block" }}>{pages.error}</small>
            </span>
          )}
        </li>
      )}
      renderInput={(params) => (
        <TextField
          {...params}
          label={label}
          placeholder="Type to search"
          slotProps={{
            ...params.slotProps,
            input: {
              ...params.slotProps.input,
              endAdornment: (
                <>
                  {pages.loading && (
                    <CircularProgress
                      size={15}
                      aria-label={`Loading ${label.toLowerCase()}`}
                    />
                  )}
                  {params.slotProps.input.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
}
