import type { Ref } from "react";
import { TextField } from "@mui/material";
import { NodeIcon } from "../../../components/Icons";
import { nodeLabel, type RuleNode } from "../../../types";

export default function NodeIdentity({
  node,
  readOnly,
  onRename,
  inputRef,
}: {
  node: RuleNode;
  readOnly: boolean;
  onRename: (label: string) => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="inspector-node-identity">
      <div className="inspector-node-kind">
        <span className={`node-icon ${node.type.toLowerCase()}`}>
          <NodeIcon type={node.type} size={19} />
        </span>
        <span>{nodeLabel[node.type]}</span>
      </div>
      <TextField
        className="inspector-node-name"
        label="Node name"
        size="small"
        value={node.label}
        title={node.label}
        inputRef={inputRef}
        onChange={(event) => onRename(event.target.value)}
        disabled={readOnly}
      />
    </div>
  );
}
