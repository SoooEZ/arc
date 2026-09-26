import { useState } from "react";
import PagedAutocomplete from "../../../components/PagedAutocomplete";
import { Alert, Button } from "@mui/material";
import { ArrowUpRight, Info } from "lucide-react";
import type { RuleSummary, Version, VersionSummary } from "../../../types";
import ValueBinding from "../../expressions/ValueBinding";
import { ruleApi } from "../../../api/rules";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";
type RuleChoice = Pick<RuleSummary, "id" | "name" | "publishedVersion">;

export default function ReferenceFields({
  node,
  rules,
  readOnly,
  patch,
  variables,
  onOpenReference,
}: NodeFieldsProps) {
  const [chosenRule, setChosenRule] = useState<RuleChoice | null>(null);
  const knownRule =
    chosenRule?.id === node.ruleId
      ? chosenRule
      : rules.find((rule) => rule.id === node.ruleId);
  const selectedRule = useAsyncResource(
    node.ruleId || "",
    (signal) => ruleApi.get(node.ruleId!, { signal }),
    null as RuleChoice | null,
    0,
    !!node.ruleId && !knownRule,
  );
  const ruleValue: RuleChoice | null = node.ruleId
    ? knownRule ||
      selectedRule.data || {
        id: node.ruleId,
        name: node.ruleId,
        publishedVersion: node.version ?? null,
      }
    : null;
  const detail = useAsyncResource(
    `${node.ruleId}:${node.version}`,
    (signal) => ruleApi.version(node.ruleId!, node.version!, { signal }),
    null as Version | null,
    0,
    !!node.ruleId && !!node.version,
  );
  const child = detail.data;
  const refError = selectedRule.error || detail.error;
  return (
    <>
      <InspectorSection title="Rule reference">
        <PagedAutocomplete<RuleChoice>
          label="Published rule"
          owner="published-rules"
          value={ruleValue}
          disabled={readOnly}
          loadPage={(search, offset, limit, signal) =>
            ruleApi.catalog(
              { search, offset, limit, publishedOnly: true },
              { signal },
            )
          }
          itemKey={(rule) => rule.id}
          itemLabel={(rule) => rule.name}
          onChange={(rule) => {
            if (readOnly) return;
            setChosenRule(rule);
            if (rule.id !== node.ruleId)
              patch({
                ruleId: rule.id,
                version: rule.publishedVersion,
                bindings: {},
              });
          }}
        />
        {refError && <Alert severity="error">{refError}</Alert>}
        {node.ruleId && (
          <PagedAutocomplete<VersionSummary>
            key={node.ruleId}
            label="Pinned version"
            owner={node.ruleId}
            value={
              node.version
                ? {
                    ruleId: node.ruleId,
                    version: node.version,
                    publishedAt: "",
                  }
                : null
            }
            disabled={readOnly}
            loadPage={(search, offset, limit, signal) =>
              ruleApi.versionSummaries(
                node.ruleId!,
                { search, offset, limit },
                { signal },
              )
            }
            itemKey={(version) => String(version.version)}
            itemLabel={(version) => `Version ${version.version}`}
            onChange={(version) => {
              if (!readOnly && version.version !== node.version)
                patch({ version: version.version, bindings: {} });
            }}
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
      </InspectorSection>
      {child && (
        <InspectorSection title="Parameter mapping" variables={variables}>
          <p className="muted-copy">
            Pass a variable, a value, or an expression into each input.
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
        </InspectorSection>
      )}
    </>
  );
}
