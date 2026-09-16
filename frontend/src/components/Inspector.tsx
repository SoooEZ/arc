import { useEffect, useState } from "react";
import {
  Alert,
  Button,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  Tab,
  Tabs,
  TextField,
  Tooltip,
} from "@mui/material";
import {
  ArrowUpRight,
  Braces,
  ChevronRight,
  Info,
  Plus,
  Trash2,
} from "lucide-react";
import { api, errorMessage } from "../api";
import type { Definition, InputType, Rule, RuleNode, Version } from "../types";
import { nodeLabel } from "../types";
import { NodeIcon } from "./Icons";

interface Props {
  rule: Rule;
  node: RuleNode;
  rules: Rule[];
  readOnly: boolean;
  onNodeChange: (id: string, patch: Partial<RuleNode>) => void;
  onDelete: (id: string) => void;
  onDefinitionChange: (fn: (d: Definition) => Definition) => void;
  onMetadata: (patch: Partial<Rule>) => void;
  navigate: (path: string) => void;
}
export default function Inspector({
  rule,
  node,
  rules,
  readOnly,
  onNodeChange,
  onDelete,
  onDefinitionChange,
  onMetadata,
  navigate,
}: Props) {
  const [tab, setTab] = useState(0);
  const [refVersions, setRefVersions] = useState<Version[]>([]);
  const [refError, setRefError] = useState("");
  const [expressionMode, setExpressionMode] = useState(false);
  useEffect(() => {
    setTab(0);
    setExpressionMode(false);
  }, [node.id]);
  useEffect(() => {
    let live = true;
    setRefError("");
    setRefVersions([]);
    if (node.type === "REFERENCE" && node.ruleId)
      api
        .versions(node.ruleId)
        .then((v) => {
          if (live) setRefVersions(v);
        })
        .catch((e) => {
          if (live) setRefError(errorMessage(e));
        });
    return () => {
      live = false;
    };
  }, [node.type, node.ruleId]);
  const patch = (value: Partial<RuleNode>) => onNodeChange(node.id, value);
  const child = refVersions.find((v) => v.version === node.version);
  const allVariables = [
    ...rule.draft.inputs.map((p) => ({
      name: p.name,
      type: p.type.toLowerCase(),
    })),
    ...rule.draft.nodes
      .filter((n) => n.output && n.id !== node.id)
      .map((n) => ({ name: n.output!, type: "result" })),
  ];
  const variables = allVariables.filter(
    (v, i) => allVariables.findIndex((other) => other.name === v.name) === i,
  );
  const condition = node.expression?.match(
    /^([^&|]+?)\s*(==|!=|>=|<=|>|<)\s*([^&|]+)$/,
  );
  const simpleCondition =
    node.type === "CONDITION" && !!condition && !expressionMode;
  const updateCondition = (index: number, value: string) => {
    const parts = condition
      ? [condition[1].trim(), condition[2], condition[3].trim()]
      : ["amount", ">=", "100"];
    parts[index] = value;
    patch({ expression: parts.join(" ") });
  };
  const addInput = () =>
    onDefinitionChange((d) => {
      let count = d.inputs.length + 1;
      while (d.inputs.some((i) => i.name === `input${count}`)) count++;
      return {
        ...d,
        inputs: [
          ...d.inputs,
          {
            name: `input${count}`,
            type: "NUMBER",
            required: true,
            defaultValue: null,
          },
        ],
      };
    });
  return (
    <aside className="inspector">
      <Tabs
        value={tab}
        onChange={(_, value) => setTab(value)}
        variant="fullWidth"
      >
        <Tab label="Node settings" />
        <Tab label="Rule settings" />
      </Tabs>
      <div className="inspector-scroll">
        {tab === 1 ? (
          <>
            <div className="inspector-section">
              <h3>Rule details</h3>
              <TextField
                label="Name"
                value={rule.name}
                onChange={(e) => onMetadata({ name: e.target.value })}
                disabled={readOnly}
              />
              <TextField
                label="Description"
                multiline
                rows={4}
                value={rule.description}
                onChange={(e) => onMetadata({ description: e.target.value })}
                disabled={readOnly}
              />
              <div className="read-only-field">
                <span>API identifier</span>
                <code>{rule.id}</code>
              </div>
              <div className="inspector-note">
                <Info size={15} />
                <p>
                  Rule IDs stay the same across versions, so your integrations
                  have a stable address.
                </p>
              </div>
            </div>
            <div className="inspector-section">
              <h4>Publication</h4>
              <p className="muted-copy">
                {rule.publishedVersion
                  ? `Version ${rule.publishedVersion} is available through the API. Draft edits take effect when you publish a new version.`
                  : "Publish this rule to make it available through the execution API."}
              </p>
            </div>
          </>
        ) : (
          <>
            <div className="inspector-section">
              <div className="inspector-node-title">
                <span className={`node-icon ${node.type.toLowerCase()}`}>
                  <NodeIcon type={node.type} size={19} />
                </span>
                <div>
                  <h3>{nodeLabel[node.type]}</h3>
                  <span>
                    {node.type === "CONDITION"
                      ? "Split your logic into two paths"
                      : node.type === "REFERENCE"
                        ? "Connect a published rule"
                        : node.type === "FORMULA"
                          ? "Calculate a value for the next step"
                          : node.type === "OUTPUT"
                            ? "Return the final result"
                            : "Define the data your rule needs"}
                  </span>
                </div>
              </div>
              <TextField
                label="Node name"
                value={node.label}
                onChange={(e) => patch({ label: e.target.value })}
                disabled={readOnly}
              />
            </div>
            {node.type === "INPUT" ? (
              <div className="inspector-section">
                <div className="section-title">
                  <h4>Input parameters</h4>
                  <span>{rule.draft.inputs.length}</span>
                </div>
                {rule.draft.inputs.map((input, i) => (
                  <div className="input-schema-card" key={i}>
                    <div className="input-card-title">
                      <Braces size={14} />
                      <span>Parameter {i + 1}</span>
                      <Tooltip title="Remove parameter">
                        <span>
                          <IconButton
                            size="small"
                            aria-label={`Remove ${input.name}`}
                            disabled={readOnly}
                            onClick={() =>
                              onDefinitionChange((d) => ({
                                ...d,
                                inputs: d.inputs.filter((_, j) => i !== j),
                              }))
                            }
                          >
                            <Trash2 size={13} />
                          </IconButton>
                        </span>
                      </Tooltip>
                    </div>
                    <TextField
                      label="Parameter name"
                      value={input.name}
                      onChange={(e) =>
                        onDefinitionChange((d) => ({
                          ...d,
                          inputs: d.inputs.map((p, j) =>
                            i === j ? { ...p, name: e.target.value } : p,
                          ),
                        }))
                      }
                      disabled={readOnly}
                    />
                    <TextField
                      select
                      label="Type"
                      value={input.type}
                      onChange={(e) =>
                        onDefinitionChange((d) => ({
                          ...d,
                          inputs: d.inputs.map((p, j) =>
                            i === j
                              ? {
                                  ...p,
                                  type: e.target.value as InputType,
                                  defaultValue: null,
                                }
                              : p,
                          ),
                        }))
                      }
                      disabled={readOnly}
                    >
                      {["NUMBER", "STRING", "BOOLEAN"].map((type) => (
                        <MenuItem key={type} value={type}>
                          {type.toLowerCase()}
                        </MenuItem>
                      ))}
                    </TextField>
                    {input.type === "BOOLEAN" ? (
                      <TextField
                        label="Default value"
                        select
                        value={
                          input.defaultValue == null
                            ? ""
                            : String(input.defaultValue)
                        }
                        onChange={(e) =>
                          onDefinitionChange((d) => ({
                            ...d,
                            inputs: d.inputs.map((p, j) =>
                              i === j
                                ? {
                                    ...p,
                                    defaultValue:
                                      e.target.value === ""
                                        ? null
                                        : e.target.value === "true",
                                  }
                                : p,
                            ),
                          }))
                        }
                        disabled={readOnly}
                      >
                        <MenuItem value="">No default</MenuItem>
                        <MenuItem value="true">true</MenuItem>
                        <MenuItem value="false">false</MenuItem>
                      </TextField>
                    ) : (
                      <TextField
                        label="Default value (optional)"
                        type={input.type === "NUMBER" ? "number" : "text"}
                        value={input.defaultValue ?? ""}
                        onChange={(e) =>
                          onDefinitionChange((d) => ({
                            ...d,
                            inputs: d.inputs.map((p, j) =>
                              i === j
                                ? {
                                    ...p,
                                    defaultValue:
                                      e.target.value === ""
                                        ? null
                                        : p.type === "NUMBER"
                                          ? Number(e.target.value)
                                          : e.target.value,
                                  }
                                : p,
                            ),
                          }))
                        }
                        disabled={readOnly}
                      />
                    )}
                    <FormControlLabel
                      control={
                        <Switch
                          size="small"
                          checked={input.required}
                          disabled={readOnly}
                          onChange={(_, checked) =>
                            onDefinitionChange((d) => ({
                              ...d,
                              inputs: d.inputs.map((p, j) =>
                                i === j ? { ...p, required: checked } : p,
                              ),
                            }))
                          }
                        />
                      }
                      label="Required"
                    />
                  </div>
                ))}
                {!readOnly && (
                  <Button
                    size="small"
                    fullWidth
                    variant="outlined"
                    startIcon={<Plus size={14} />}
                    onClick={addInput}
                  >
                    Add parameter
                  </Button>
                )}
              </div>
            ) : (
              <>
                {node.type === "REFERENCE" ? (
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
                          navigate(
                            `/rules/${node.ruleId}?version=${node.version}`,
                          )
                        }
                      >
                        Open referenced rule
                      </Button>
                    )}
                    <div className="inspector-note">
                      <Info size={15} />
                      <p>
                        This reference stays on the selected version, even when
                        that rule is updated.
                      </p>
                    </div>
                    {child && (
                      <>
                        <h4>Parameter mapping</h4>
                        <p className="muted-copy">
                          Pass a variable, a value, or a formula into each
                          input.
                        </p>
                        {child.definition.inputs.map((input) => (
                          <TextField
                            key={input.name}
                            label={`${input.name}${input.required ? " *" : ""}`}
                            placeholder={
                              input.type === "STRING"
                                ? '"text" or a variable'
                                : "Value or expression"
                            }
                            value={node.bindings?.[input.name] || ""}
                            helperText={`${input.type.toLowerCase()}${input.defaultValue != null ? ` · default: ${JSON.stringify(input.defaultValue)}` : ""}`}
                            disabled={readOnly}
                            onChange={(e) => {
                              const bindings = { ...node.bindings };
                              if (e.target.value.trim())
                                bindings[input.name] = e.target.value;
                              else delete bindings[input.name];
                              patch({ bindings });
                            }}
                          />
                        ))}
                      </>
                    )}
                  </div>
                ) : (
                  <div className="inspector-section">
                    <div className="section-title">
                      <h4>
                        {node.type === "CONDITION"
                          ? "Condition"
                          : node.type === "OUTPUT"
                            ? "Return value"
                            : "Expression"}
                      </h4>
                      {node.type === "CONDITION" && condition && (
                        <button onClick={() => setExpressionMode((m) => !m)}>
                          {expressionMode ? "Builder" : "Expression"}
                        </button>
                      )}
                    </div>
                    {simpleCondition ? (
                      <div className="condition-builder">
                        <TextField
                          label="When"
                          value={condition[1].trim()}
                          onChange={(e) => updateCondition(0, e.target.value)}
                          disabled={readOnly}
                        />
                        <TextField
                          select
                          label="Operator"
                          value={condition[2]}
                          onChange={(e) => updateCondition(1, e.target.value)}
                          disabled={readOnly}
                        >
                          {[
                            ["==", "Equals"],
                            ["!=", "Does not equal"],
                            [">", "Greater than"],
                            [">=", "Greater than or equal"],
                            ["<", "Less than"],
                            ["<=", "Less than or equal"],
                          ].map(([value, label]) => (
                            <MenuItem key={value} value={value}>
                              {label}
                            </MenuItem>
                          ))}
                        </TextField>
                        <TextField
                          label="Value or variable"
                          value={condition[3].trim()}
                          onChange={(e) => updateCondition(2, e.target.value)}
                          helperText={'Wrap text in quotes, like "premium".'}
                          disabled={readOnly}
                        />
                        <div className="expression-preview">
                          <code>{node.expression}</code>
                        </div>
                      </div>
                    ) : (
                      <TextField
                        className="expression-field"
                        label={
                          node.type === "OUTPUT"
                            ? "Result expression"
                            : "Expression"
                        }
                        multiline
                        minRows={3}
                        value={node.expression || ""}
                        onChange={(e) => patch({ expression: e.target.value })}
                        disabled={readOnly}
                        helperText={
                          node.type === "CONDITION"
                            ? "Combine checks with &&, ||, and parentheses."
                            : "Use variables, arithmetic, or a quoted text value."
                        }
                      />
                    )}
                    {node.type === "CONDITION" && (
                      <div className="branch-explainer">
                        <div>
                          <span className="status-dot published" />
                          <strong>True</strong>
                          <span>Condition is met</span>
                          <ChevronRight size={12} />
                        </div>
                        <div>
                          <span className="status-dot amber" />
                          <strong>False</strong>
                          <span>Condition is not met</span>
                          <ChevronRight size={12} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
                {(node.type === "FORMULA" || node.type === "REFERENCE") && (
                  <div className="inspector-section">
                    <h4>Store result as</h4>
                    <TextField
                      label="Result variable"
                      value={node.output || ""}
                      onChange={(e) => patch({ output: e.target.value })}
                      helperText="Use this variable in later nodes."
                      disabled={readOnly}
                    />
                  </div>
                )}
                <div className="inspector-section">
                  <h4>Variables in this rule</h4>
                  <p className="muted-copy">
                    Inputs and results from preceding nodes can be used in
                    expressions.
                  </p>
                  <div className="variable-list">
                    {variables.map((v, i) => (
                      <div key={`${v.name}-${i}`}>
                        <code>{v.name}</code>
                        <span>{v.type}</span>
                      </div>
                    ))}
                  </div>
                </div>
                {(node.type === "FORMULA" || node.type === "OUTPUT") && (
                  <div className="inspector-section">
                    <h4>Expression toolkit</h4>
                    <div className="expression-toolkit">
                      {[
                        "+  −  *  /  %",
                        "min(a, b)",
                        "max(a, b)",
                        "round(value, 2)",
                        "abs(value)",
                        "floor(value)",
                        "ceil(value)",
                        "if(check, yes, no)",
                      ].map((t) => (
                        <code key={t}>{t}</code>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
            {!readOnly && node.type !== "INPUT" && (
              <div className="inspector-section">
                <Button
                  size="small"
                  color="error"
                  startIcon={<Trash2 size={14} />}
                  onClick={() => onDelete(node.id)}
                >
                  Delete node
                </Button>
              </div>
            )}
          </>
        )}
      </div>
      <div className="inspector-footer">
        <Info size={13} />
        {readOnly
          ? "Published versions are read-only"
          : "Changes are saved when you save the draft"}
      </div>
    </aside>
  );
}
