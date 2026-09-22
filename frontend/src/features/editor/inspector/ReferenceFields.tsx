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
  const { data: refVersions, error: refError } = useAsyncResource(
    node.ruleId || "",
    (signal) => ruleApi.versions(node.ruleId!, { signal }),
    [] as Version[],
    0,
    !!node.ruleId,
  );
  const child = refVersions.find((version) => version.version === node.version);
  return (
    <div className="inspector-section">
      <h4>Rule reference</h4>
      <TextField
        select
        label="Published rule"
        value={node.ruleId || ""}
        disabled={readOnly}
        onChange={(e) => {
          const ref = rules.find((r) => r.id === e.target.value);
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
        {rules
          .filter((r) => r.publishedVersion)
          .map((r) => (
            <MenuItem key={r.id} value={r.id}>
              {r.name}
            </MenuItem>
          ))}
      </TextField>
      {refError && <Alert severity="error">{refError}</Alert>}
      {refVersions.length > 0 && (
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
          {refVersions.map((v) => (
            <MenuItem value={v.version} key={v.version}>
              Version {v.version}
            </MenuItem>
          ))}
        </TextField>
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
