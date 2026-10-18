import type { Rule } from "../../src/types";

/** A draft with an Input, two Formulas that both set `price`, and an Output. */
export const exampleRule = (): Rule => ({
  id: "example",
  name: "Example",
  description: "",
  kind: "FORMULA",
  revision: 1,
  publishedVersion: null,
  createdAt: "",
  updatedAt: "",
  draft: {
    schemaVersion: 1,
    inputs: [
      { name: "amount", type: "NUMBER", required: true, defaultValue: 100 },
    ],
    nodes: [
      { id: "input", type: "INPUT", label: "Input", position: { x: 0, y: 0 } },
      {
        id: "left",
        type: "FORMULA",
        label: "First calculation",
        expression: "amount * 0.8",
        output: "price",
        position: { x: 0, y: 100 },
      },
      {
        id: "right",
        type: "FORMULA",
        label: "Second calculation",
        expression: "amount * 0.9",
        output: "price",
        position: { x: 300, y: 100 },
      },
      {
        id: "output",
        type: "OUTPUT",
        label: "Result",
        expression: "price",
        position: { x: 0, y: 200 },
      },
    ],
    edges: [
      { id: "a", source: "input", sourceHandle: "next", target: "left" },
      { id: "b", source: "left", sourceHandle: "next", target: "output" },
    ],
  },
});

/** A draft as the editor holds it, and as the server echoes it back after a save. */
// Captured from PUT /api/rules/{id}: a draft edited in the browser (an added
// parameter without `source`, a new node with its own key order) and the
// server's response for it (every record field, unset ones as null).
export const clientDraft = `{"schemaVersion":1,"inputs":[{"name":"amount","type":"NUMBER","required":true,"defaultValue":150,"source":null},{"name":"input2","type":"NUMBER","required":true,"defaultValue":null}],"nodes":[{"id":"input","type":"INPUT","label":"Inputs","position":{"x":250,"y":0},"expression":null,"output":null,"ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null},{"id":"out","type":"OUTPUT","label":"Result","position":{"x":250,"y":200},"expression":"amount","output":null,"ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null},{"id":"node-abc12345","type":"FORMULA","position":{"x":412.5,"y":97.25},"label":"Formula","expression":"1 + 1","output":"result_2"}],"edges":[{"id":"next","source":"input","target":"out","sourceHandle":"next"},{"id":"e-new","source":"input","target":"node-abc12345","sourceHandle":"next"}],"notes":null}`;
export const serverEcho = `{"schemaVersion":1,"inputs":[{"name":"amount","type":"NUMBER","required":true,"defaultValue":150,"source":null},{"name":"input2","type":"NUMBER","required":true,"defaultValue":null,"source":null}],"nodes":[{"id":"input","type":"INPUT","label":"Inputs","position":{"x":250.0,"y":0.0},"expression":null,"output":null,"ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null},{"id":"out","type":"OUTPUT","label":"Result","position":{"x":250.0,"y":200.0},"expression":"amount","output":null,"ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null},{"id":"node-abc12345","type":"FORMULA","label":"Formula","position":{"x":412.5,"y":97.25},"expression":"1 + 1","output":"result_2","ruleId":null,"version":null,"bindings":null,"cases":null,"fields":null,"selector":null,"outputName":null}],"edges":[{"id":"next","source":"input","target":"out","sourceHandle":"next"},{"id":"e-new","source":"input","target":"node-abc12345","sourceHandle":"next"}],"notes":null}`;
