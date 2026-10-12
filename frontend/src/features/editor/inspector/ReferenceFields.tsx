import { memo, useCallback, useState } from "react";
import PagedAutocomplete from "../../../components/PagedAutocomplete";
import { Alert, IconButton, Tooltip } from "@mui/material";
import { ExternalLink } from "lucide-react";
import type {
  Input,
  RuleSummary,
  Version,
  VersionSummary,
} from "../../../types";
import ValueBinding from "../../expressions/ValueBinding";
import { ruleApi } from "../../../api/rules";
import { readRuleVersion } from "../../../app/pinnedVersions";
import { useAsyncResource } from "../../../hooks/useAsyncResource";
import { updateGraphNode } from "../../../domain/graph";
import { stringifyJson } from "../../../domain/json";
import { ownValue } from "../../../domain/records";
import type { VariableOption } from "../../../domain/variables";
import {
  undeclaredBindings,
  withBinding,
  withoutBindings,
} from "../../../domain/valueBinding";
import UndeclaredBindings from "../../expressions/UndeclaredBindings";
import type { NodeFieldsProps } from "./types";
import InspectorSection from "./InspectorSection";
type RuleChoice = Pick<
  RuleSummary,
  "id" | "name" | "publishedVersion" | "createdAt"
>;

export default function ReferenceFields({
  node,
  readOnly,
  patch,
  variables,
  scopeKnown,
  onDefinitionChange,
  onOpenReference,
}: NodeFieldsProps) {
  const { ruleId, version } = node;
  const nodeId = node.id;
  // One stable updater for every parameter card: it reads the node's current
  // mappings from the draft, so the memoized cards keep their callback.
  const bind = useCallback(
    (name: string, value: string | undefined) =>
      onDefinitionChange((definition) =>
        updateGraphNode(definition, nodeId, (current) => ({
          bindings: withBinding(current.bindings, name, value),
        })),
      ),
    [onDefinitionChange, nodeId],
  );
  // The picker's own summary is fresh; any other pin reads its rule's summary,
  // so a renamed rule shows its current name without its graph being read.
  const [chosenRule, setChosenRule] = useState<RuleChoice | null>(null);
  const knownRule = chosenRule?.id === ruleId ? chosenRule : null;
  const selectedRule = useAsyncResource<RuleChoice | null>(
    ruleId || "",
    ruleId && !knownRule
      ? (signal) => ruleApi.summary(ruleId, { signal })
      : null,
    null,
  );
  // The rule as read now; a deleted ID created again is another incarnation.
  const identity = knownRule ?? selectedRule.data;
  const ruleValue: RuleChoice | null = ruleId
    ? (identity ?? {
        id: ruleId,
        name: ruleId,
        publishedVersion: version ?? null,
        createdAt: "",
      })
    : null;
  // The pinned version is immutable for one incarnation: the page-wide cache
  // serves every selection of it, keyed by the rule's creation time.
  const detail = useAsyncResource<Version | null>(
    `${ruleId}:${version}:${identity?.createdAt ?? ""}`,
    ruleId && version && identity
      ? (signal) => readRuleVersion(identity, version, signal)
      : null,
    null,
  );
  const child = detail.data;
  const refError = selectedRule.error || detail.error;
  // Mappings for parameters the pinned version does not declare; validation rejects them.
  const undeclared = child
    ? undeclaredBindings(
        node.bindings,
        child.definition.inputs.map((input) => input.name),
      )
    : [];
  return (
    <>
      <InspectorSection
        title="Select Rule"
        help="Choose a published rule and version. This reference stays on the selected version, even when that rule is updated."
        actions={
          <>
            <Tooltip
              title={
                node.ruleId && node.version
                  ? "Open the selected published version in a rule viewer."
                  : "Select a published rule and version to open it."
              }
            >
              <span>
                <IconButton
                  className="inspector-reference-action"
                  size="small"
                  aria-label="Open referenced rule"
                  disabled={!node.ruleId || !node.version}
                  onClick={() => {
                    if (node.ruleId && node.version)
                      onOpenReference({
                        ruleId: node.ruleId,
                        version: node.version,
                      });
                  }}
                >
                  <ExternalLink size={16} />
                </IconButton>
              </span>
            </Tooltip>
          </>
        }
      >
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
            // Another version of the same rule keeps every mapping: the
            // parameters it still declares keep their values, and the notice
            // below names any others for removal. Dropping them all let an
            // optional parameter silently take its default.
            onChange={(version) => {
              if (!readOnly && version.version !== node.version)
                patch({ version: version.version });
            }}
          />
        )}
      </InspectorSection>
      {child && (
        <InspectorSection
          title="Parameters for Rule"
          help="Supply values for the selected version’s parameters. Each card shows its required status and type; values may come from variables, constants, expressions or the referenced rule’s defaults."
        >
          <p className="muted-copy">
            Pass a variable, a value, or an expression into each input.
          </p>
          {child.definition.inputs.map((input) => (
            <ReferenceParameterCard
              key={`${node.id}:${node.ruleId}:${node.version}:${input.name}`}
              input={input}
              value={ownValue(node.bindings, input.name)}
              variables={variables}
              scopeKnown={scopeKnown}
              readOnly={readOnly}
              onBind={bind}
            />
          ))}
          <UndeclaredBindings
            names={undeclared}
            target={`version ${node.version} of ${node.ruleId}`}
            readOnly={readOnly}
            onRemove={() =>
              patch({ bindings: withoutBindings(node.bindings, undeclared) })
            }
          />
        </InspectorSection>
      )}
    </>
  );
}

/**
 * One parameter of the pinned version. Memoized with a stable binding
 * callback: a keystroke in one mapping renders that card alone (lesson F39).
 */
const ReferenceParameterCard = memo(function ReferenceParameterCard({
  input,
  value,
  variables,
  scopeKnown,
  readOnly,
  onBind,
}: {
  input: Input;
  /** The node's mapping for this parameter, or none. */
  value: string | undefined;
  variables: VariableOption[];
  scopeKnown: boolean;
  readOnly: boolean;
  onBind: (name: string, value: string | undefined) => void;
}) {
  return (
    <div
      className="input-schema-card reference-parameter-card"
      role="group"
      aria-label={`Parameter ${input.name}`}
    >
      <div className="reference-parameter-heading">
        <strong>{input.name}</strong>
        <span>{input.required ? "Required" : "Optional"}</span>
      </div>
      <div className="reference-parameter-type">
        Type: <code>{input.type.toLowerCase()}</code>
      </div>
      <ValueBinding
        label={`${input.name}${input.required ? " *" : ""}`}
        type={input.type}
        value={value}
        variables={variables}
        scopeKnown={scopeKnown}
        disabled={readOnly}
        helperText={
          input.defaultValue != null
            ? `Default: ${stringifyJson(input.defaultValue)}`
            : undefined
        }
        onChange={(next) => onBind(input.name, next)}
      />
    </div>
  );
});
