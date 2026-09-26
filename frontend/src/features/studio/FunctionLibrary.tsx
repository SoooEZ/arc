import { useState } from "react";
import { Chip, MenuItem, TextField, Tooltip } from "@mui/material";
import { ChevronRight, Search } from "lucide-react";
import type { FunctionEntry } from "../../types";

export default function FunctionLibrary({
  functions,
  readOnly,
  onInsert,
}: {
  functions: FunctionEntry[];
  readOnly: boolean;
  onInsert: (snippet: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [reference, setReference] = useState(false);
  const [expanded, setExpanded] = useState<string[]>([]);
  const categories = [...new Set(functions.map((f) => f.category))].sort();
  const shown = functions.filter(
    (f) =>
      f.supported !== reference &&
      (category === "All" || f.category === category) &&
      `${f.name} ${f.category} ${f.description}`
        .toLowerCase()
        .includes(search.trim().toLowerCase()),
  );
  return (
    <>
      <TextField
        size="small"
        placeholder="Search functions…"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        slotProps={{ input: { startAdornment: <Search size={15} /> } }}
      />
      <TextField
        select
        size="small"
        label="Category"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
      >
        {["All", ...categories].map((c) => (
          <MenuItem key={c} value={c}>
            {c}
          </MenuItem>
        ))}
      </TextField>
      <div className="function-scope">
        <button
          className={!reference ? "active" : ""}
          onClick={() => setReference(false)}
        >
          Available · {functions.filter((f) => f.supported).length}
        </button>
        <button
          className={reference ? "active" : ""}
          onClick={() => setReference(true)}
        >
          Reference only
        </button>
      </div>
      <p className="studio-hint">
        Functions start with $. Hover for usage; click to insert. Arrays act as
        Excel ranges.
      </p>
      <div className="function-groups">
        {categories.map((c) => {
          const entries = shown.filter((f) => f.category === c);
          if (!entries.length) return null;
          const open =
            !!search.trim() || category !== "All" || expanded.includes(c);
          return (
            <section className="function-group" key={c}>
              <button
                className="function-group-heading"
                aria-expanded={open}
                onClick={() => {
                  setSearch("");
                  setCategory("All");
                  setExpanded((old) =>
                    open ? old.filter((x) => x !== c) : [...old, c],
                  );
                }}
              >
                <ChevronRight size={14} className={open ? "expanded" : ""} />
                <strong>{c}</strong>
                <span>{entries.length}</span>
              </button>
              {open && (
                <div className="function-chips">
                  {entries.map((f) => (
                    <Tooltip
                      key={f.name}
                      arrow
                      placement="right"
                      title={
                        <div className="function-tooltip">
                          <strong>{f.signature}</strong>
                          <p>{f.description}</p>
                          <small>
                            {f.origin}
                            {!f.supported &&
                              " · Reference only; not executable"}
                          </small>
                        </div>
                      }
                    >
                      <span>
                        <Chip
                          size="small"
                          label={f.name}
                          variant="outlined"
                          disabled={readOnly || !f.supported}
                          onClick={() => onInsert(f.snippet)}
                        />
                      </span>
                    </Tooltip>
                  ))}
                </div>
              )}
            </section>
          );
        })}
      </div>
      {!shown.length && <p className="studio-hint">No matching functions.</p>}
    </>
  );
}
