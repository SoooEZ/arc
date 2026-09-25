import { useState } from "react";
import { usePagedResource } from "../../../hooks/usePagedResource";
import CatalogPagination from "../../../components/CatalogPagination";
import { Alert, Button, MenuItem, TextField } from "@mui/material";
import { ArrowUpRight, Info } from "lucide-react";
import type { Version } from "../../../types";
import ValueBinding from "../../expressions/ValueBinding";
import { ruleApi } from "../../../api/rules";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import type { NodeFieldsProps } from "./types";
export default function ReferenceFields({
  node,
  rules,
  readOnly,
  patch,
  variables,
  onOpenReference,
}: NodeFieldsProps) {
  const [search, setSearch] = useState("");
  const catalog = usePagedResource(search, (offset, limit, signal) =>
    ruleApi.catalog({ offset, limit, search, publishedOnly: true }, { signal }),
  );
  const versions = usePagedResource(
    node.ruleId || "",
    (offset, limit, signal) =>
      ruleApi.versionSummaries(node.ruleId!, { offset, limit }, { signal }),
    !!node.ruleId,
  );
  const detail = useAsyncResource(
    `${node.ruleId}:${node.version}`,
    (signal) => ruleApi.version(node.ruleId!, node.version!, { signal }),
    null as Version | null,
    0,
    !!node.ruleId && !!node.version,
  );
  const child = detail.data;
  const refVersions = versions.data.items;
  const refError = catalog.error || versions.error || detail.error;
  return (
    <div className="inspector-section">
      <h4>Rule reference</h4>
      <TextField
        label="Find published rule"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <TextField
        select
        label="Published rule"
        value={node.ruleId || ""}
        disabled={readOnly}
        onChange={(e) => {
          const ref = catalog.data.items.find((r) => r.id === e.target.value);
          patch({
            ruleId: e.target.value,
            version: ref?.publishedVersion || null,
            bindings: {},
          });
        }}
      >
        <MenuItem value="" disabled>
          Select a rule
        </MenuItem>
        {node.ruleId &&
          !catalog.data.items.some((item) => item.id === node.ruleId) && (
            <MenuItem value={node.ruleId}>
              {rules.find((item) => item.id === node.ruleId)?.name ||
                node.ruleId}
            </MenuItem>
          )}
        {catalog.data.items.map((r) => (
          <MenuItem key={r.id} value={r.id}>
            {r.name}
          </MenuItem>
        ))}
      </TextField>
      <CatalogPagination
        label="Published rules"
        offset={catalog.offset}
        limit={catalog.limit}
        total={catalog.data.total}
        loading={catalog.loading}
        onPage={catalog.setOffset}
      />
      {refError && <Alert severity="error">{refError}</Alert>}
      {node.ruleId && (
        <TextField
          select
          label="Pinned version"
          value={node.version || ""}
          disabled={readOnly}
          onChange={(e) =>
            patch({
              version: Number(e.target.value),
              bindings: {},
            })
          }
        >
          {node.version &&
            !refVersions.some((item) => item.version === node.version) && (
              <MenuItem value={node.version}>Version {node.version}</MenuItem>
            )}
          {refVersions.map((v) => (
            <MenuItem value={v.version} key={v.version}>
              Version {v.version}
            </MenuItem>
          ))}
        </TextField>
      )}
      {node.ruleId && (
        <CatalogPagination
          label="Pinned versions"
          offset={versions.offset}
          limit={versions.limit}
          total={versions.data.total}
          loading={versions.loading}
          onPage={versions.setOffset}
        />
      )}
      {node.ruleId && node.version && (
        <Button
          size="small"
          endIcon={<ArrowUpRight size={14} />}
          onClick={() =>
            onOpenReference({
              ruleId: node.ruleId!,
              version: node.version!,
            })
          }
        >
          Open referenced rule
        </Button>
      )}
      <div className="inspector-note">
        <Info size={15} />
        <p>
          This reference stays on the selected version, even when that rule is
          updated.
        </p>
      </div>
      {child && (
        <>
          <h4>Parameter mapping</h4>
          <p className="muted-copy">
            Pass a variable, a value, or a formula into each input.
          </p>
          {child.definition.inputs.map((input) => (
            <ValueBinding
              key={`${node.id}:${node.ruleId}:${node.version}:${input.name}`}
              label={`${input.name}${input.required ? " *" : ""}`}
              type={input.type}
              value={node.bindings?.[input.name]}
              variables={variables}
              disabled={readOnly}
              helperText={`${input.type.toLowerCase()}${input.defaultValue != null ? ` · default: ${JSON.stringify(input.defaultValue)}` : ""}`}
              onChange={(value) => {
                const bindings = { ...node.bindings };
                if (value !== undefined) bindings[input.name] = value;
                else delete bindings[input.name];
                patch({ bindings });
              }}
            />
          ))}
        </>
      )}
    </div>
  );
}
