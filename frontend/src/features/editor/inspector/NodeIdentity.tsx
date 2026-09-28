import type { Ref } from "react";
import { TextField } from "@mui/material";
import { NodeIcon } from "../../../components/Icons";
import type { RuleNode } from "../../../types";
import { nodeKinds } from "../../../domain/nodeKinds";

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
  const kind = nodeKinds[node.type];
  return (
    <div className="inspector-node-identity">
      <div className="inspector-node-kind">
        <span className={`node-icon ${kind.className}`}>
          <NodeIcon type={node.type} size={19} />
        </span>
        <span>{kind.label}</span>
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
