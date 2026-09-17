import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Autocomplete,
  Button,
  FormControlLabel,
  IconButton,
  MenuItem,
  Switch,
  TextField,
  Tooltip,
} from "@mui/material";
import {
  ArrowUpRight,
  Braces,
  Code2,
  ChevronRight,
  Info,
  Plus,
  Trash2,
} from "lucide-react";
import { api, errorMessage } from "../api";
import type { Definition, InputType, Rule, RuleNode, Version } from "../types";
import { nodeLabel } from "../types";
import { NodeIcon } from "./Icons";
import SourceBindingEditor from "./SourceBindingEditor";
import JsonField from "./JsonField";
import ValueBinding, { type VariableOption, literalText } from "./ValueBinding";
import type { ReferenceTarget } from "./ReferenceDialog";

interface Props {
  rule: Rule;
  node: RuleNode;
  rules: Rule[];
  readOnly: boolean;
  onNodeChange: (id: string, patch: Partial<RuleNode>) => void;
  onDelete: (id: string) => void;
  onDefinitionChange: (fn: (d: Definition) => Definition) => void;
  onInvalidJson: (key: string, invalid: boolean) => void;
  onExpression: (id: string) => void;
  onOpenReference: (target: ReferenceTarget) => void;
  errors: string[];
}
export default function Inspector({
  rule,
  node,
  rules,
  readOnly,
  onNodeChange,
  onDelete,
  onDefinitionChange,
  onInvalidJson,
  onExpression,
  onOpenReference,
  errors,
}: Props) {
  const scroll = useRef<HTMLDivElement>(null);
  const [available, setAvailable] = useState<Record<string, string[]>>({});
  useEffect(() => {
    let active = true;
    setAvailable({});
    const timer = setTimeout(() => {
      api
        .variables(rule.draft)
        .then((v) => {
          if (active) setAvailable(v);
        })
        .catch(() => {
          if (active) setAvailable({});
        });
    }, 150);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [rule.draft]);
  const [refVersions, setRefVersions] = useState<Version[]>([]);
  const [refError, setRefError] = useState("");
  const [expressionMode, setExpressionMode] = useState(false);
  useEffect(() => {
    scroll.current?.scrollTo({ top: 0 });
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
  const upstream = new Set<string>();
  const parents = rule.draft.edges
    .filter((e) => e.target === node.id)
    .map((e) => e.source);
  while (parents.length) {
    const id = parents.pop()!;
    if (id === node.id || upstream.has(id)) continue;
    upstream.add(id);
    parents.push(
      ...rule.draft.edges.filter((e) => e.target === id).map((e) => e.source),
    );
  }
  const allVariables: VariableOption[] = [
    ...rule.draft.inputs.map((p) => ({
      name: p.name,
      type: p.type,
      label: `Input · ${p.type.toLowerCase()}`,
    })),
    ...rule.draft.nodes
      .filter(
        (n) =>
          n.output &&
          upstream.has(n.id) &&
          available[node.id]?.includes(n.output),
      )
      .map((n) => ({ name: n.output!, type: "RESULT", label: n.label })),
  ];
  const variables = allVariables
    .filter(
      (v, i) => allVariables.findIndex((other) => other.name === v.name) === i,
    )
    .map((v) => ({
      ...v,
      label: [
        ...new Set(
          allVariables
            .filter((other) => other.name === v.name)
            .map((other) => other.label),
        ),
      ].join(" / "),
    }));
  const condition = simpleComparison(node.expression || "");
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
      <div className="inspector-heading">
        <span>Node settings</span>
        <Button
          size="small"
          startIcon={<Code2 size={13} />}
          onClick={() => onExpression(node.id)}
        >
          Node expression
        </Button>
      </div>
      <div className="inspector-scroll" ref={scroll}>
        {errors.map((error, i) => (
          <Alert key={i} severity="error">
            {error}
          </Alert>
        ))}
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
                  {["NUMBER", "STRING", "BOOLEAN", "ARRAY", "OBJECT"].map(
                    (type) => (
                      <MenuItem key={type} value={type}>
                        {type.toLowerCase()}
                      </MenuItem>
                    ),
                  )}
                </TextField>
                {input.type === "ARRAY" || input.type === "OBJECT" ? (
                  <JsonField
                    label="Default JSON (optional)"
                    onValidity={(valid) => onInvalidJson(String(i), !valid)}
                    rows={2}
                    value={input.defaultValue}
                    disabled={readOnly}
                    onChange={(value) =>
                      onDefinitionChange((d) => ({
                        ...d,
                        inputs: d.inputs.map((p, j) =>
                          i === j ? { ...p, defaultValue: value } : p,
                        ),
                      }))
                    }
                  />
                ) : input.type === "BOOLEAN" ? (
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
                <SourceBindingEditor
                  input={input}
                  variables={allVariables.filter(
                    (v) => v.name !== input.name && v.type !== "RESULT",
                  )}
                  readOnly={readOnly}
                  onChange={(source) =>
                    onDefinitionChange((d) => ({
                      ...d,
                      inputs: d.inputs.map((p, j) =>
                        i === j ? { ...p, source } : p,
                      ),
                    }))
                  }
                />
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
                    This reference stays on the selected version, even when that
                    rule is updated.
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
                {node.type === "OUTPUT" ? (
                  <>
                    <ValueBinding
                      key={node.id}
                      label="Return value"
                      type="ANY"
                      value={node.expression ?? undefined}
                      variables={variables}
                      disabled={readOnly}
                      optional={false}
                      onChange={(value) => patch({ expression: value ?? "" })}
                    />
                    <div className="expression-preview">
                      <code>{node.expression || "Choose a return value"}</code>
                    </div>
                  </>
                ) : simpleCondition ? (
                  <div className="condition-builder">
                    <Autocomplete
                      freeSolo
                      options={variables.map((v) => v.name)}
                      value={condition[1].trim()}
                      disabled={readOnly}
                      onInputChange={(_, value, reason) => {
                        if (reason === "input" || reason === "clear")
                          updateCondition(0, value);
                      }}
                      onChange={(_, value) => updateCondition(0, value || "")}
                      renderInput={(params) => (
                        <TextField {...params} label="When" />
                      )}
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
                    <ValueBinding
                      key={`${node.id}:${condition[1].trim()}`}
                      label="Comparison value"
                      type={
                        rule.draft.inputs.find(
                          (v) => v.name === condition[1].trim(),
                        )?.type ||
                        (literalText(condition[3].trim()) !== null
                          ? "STRING"
                          : "NUMBER")
                      }
                      value={condition[3].trim()}
                      variables={variables}
                      disabled={readOnly}
                      optional={false}
                      onChange={(value) => updateCondition(2, value ?? "")}
                    />
                    <div className="expression-preview">
                      <code>{node.expression}</code>
                    </div>
                  </div>
                ) : (
                  <TextField
                    className="expression-field"
                    label="Expression"
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
              <h4>Available variables</h4>
              <p className="muted-copy">
                Inputs and results from preceding nodes can be used in
                expressions.
              </p>
              <div className="variable-list">
                {variables.map((v, i) => (
                  <div key={`${v.name}-${i}`}>
                    <code>{v.name}</code>
                    <span>{v.type.toLowerCase()}</span>
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

function simpleComparison(expression: string): string[] | null {
  let masked = "",
    quote = "",
    escaped = false,
    depth = 0;
  for (const c of expression) {
    if (quote) {
      masked += " ".repeat(c.length);
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") {
      quote = c;
      masked += " ".repeat(c.length);
    } else if (c === "(" || c === "[") {
      depth++;
      masked += " ".repeat(c.length);
    } else if (c === ")" || c === "]") {
      depth--;
      masked += " ".repeat(c.length);
    } else masked += depth ? " " : c;
  }
  if (quote || /&&|\|\||\b(?:and|or)\b/i.test(masked)) return null;
  const operators = [...masked.matchAll(/==|!=|>=|<=|>|</g)];
  if (operators.length !== 1) return null;
  const operator = operators[0],
    index = operator.index!;
  return [
    expression,
    expression.slice(0, index).trim(),
    operator[0],
    expression.slice(index + operator[0].length).trim(),
  ];
}
