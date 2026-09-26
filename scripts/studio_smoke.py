#!/usr/bin/env python3
"""Exercise script compilation and source versioning against a real ARC API."""
import copy
import json
import os
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("ARC_API_URL", "http://localhost:8080")
PREFIX = "studio-smoke-" + uuid.uuid4().hex[:8]
checks = 0


def call(method, path, body=None, status=200):
    global checks
    req = urllib.request.Request(BASE + "/api" + path, method=method,
                                 data=None if body is None else json.dumps(body).encode(),
                                 headers={"Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    value = json.loads(response.read())
    assert response.status == status, (path, response.status, value)
    checks += 1
    return value


functions = call("GET", "/functions")
assert len([f for f in functions if f["supported"]]) >= 150
assert all(f["name"].startswith("$") and f["signature"].startswith(f["name"] + "(") for f in functions)
assert all(f["snippet"].startswith("\\" + f["name"] + "(") for f in functions)
assert any(f["name"] == "$MAP" and f["supported"] for f in functions)
assert any(f["name"] == "$INDIRECT" and not f["supported"] for f in functions)
source_id = PREFIX + "-table"
config = {"kind": "LOOKUP", "parameters": [{"name": "key", "type": "STRING", "required": True}],
          "entries": {"US": {"rate": 0.07}}, "timeoutMs": 3000}
source = call("POST", "/sources", {"id": source_id, "name": "Studio integration table", "definition": config})
source2 = copy.deepcopy(config)
source2["entries"]["US"]["rate"] = 0.20
call("PUT", "/sources/" + source_id, {"name": source["name"], "revision": 1, "definition": source2})
call("PUT", "/sources/" + source_id, {"name": source["name"], "revision": 1, "definition": source2}, 409)
assert call("POST", f"/sources/{source_id}/test", {"version": 1, "inputs": {"key": "US"}})["result"]["rate"] == 0.07
assert call("POST", f"/sources/{source_id}/test", {"version": 2, "inputs": {"key": "US"}})["result"]["rate"] == 0.20
assert call("POST", f"/sources/{source_id}/test", {"inputs": {"key": "US"}})["result"]["rate"] == 0.20
assert call("POST", f"/sources/{PREFIX}-missing/test", {"inputs": {}}, 404)["message"] == "Source not found"
catalog = call("GET", f"/source-summaries?search={source_id}&limit=1")
assert catalog["total"] == 1 and catalog["items"][0]["id"] == source_id
assert "definition" not in catalog["items"][0] and catalog["items"][0]["kind"] == "LOOKUP"
versions = call("GET", f"/sources/{source_id}/version-summaries?limit=1")
assert versions["total"] == 2 and versions["items"][0]["version"] == 2
assert "definition" not in versions["items"][0]
assert call("GET", f"/sources/{source_id}/version-summaries?limit=1&offset=1")["items"][0]["version"] == 1
assert call("GET", f"/sources/{source_id}/versions/1")["definition"]["entries"]["US"]["rate"] == 0.07
script = '''schema 1;
// source configuration remains pinned
inputs {
  amount: NUMBER required default 100;
  country: STRING required default "US";
  rate: NUMBER required default 0.01;
  source rate = {"id":"SOURCE_ID","version":1,"bindings":{"key":"country"},"pointer":"/rate","onError":"DEFAULT"};
}
node input INPUT "Inputs" { next -> output; }
node output OUTPUT "Result" { return $ROUND(amount * (1 + rate), 2); }
'''.replace("SOURCE_ID", source_id)
build = call("POST", "/studio/build", {"source": script})
assert not build["diagnostics"]
definition = build["definition"]
rendered = call("POST", "/studio/render", definition)
rebuilt = call("POST", "/studio/build", rendered)
assert rebuilt["definition"] == definition
call("POST", "/validate", definition)
# A valid graph can render beyond the old 100,000-character parser bound while
# both JSON requests remain below the independent 1 MiB HTTP body limit.
large_graph = copy.deepcopy(definition)
large_graph["inputs"] = []
large_graph["notes"] = []
large_graph["nodes"] = [copy.deepcopy(definition["nodes"][0])]
large_graph["edges"] = []
previous = "input"
for index in range(60):
    node_id = f"formula{index}"
    node = copy.deepcopy(definition["nodes"][1])
    node.update(id=node_id, type="FORMULA", label=f"Formula {index}",
                expression=json.dumps("x" * 1900), output=f"value{index}")
    large_graph["nodes"].append(node)
    large_graph["edges"].append({"id": f"{previous}-{node_id}", "source": previous,
                                 "target": node_id, "sourceHandle": "next"})
    previous = node_id
output = copy.deepcopy(definition["nodes"][1])
output["expression"] = "value59"
large_graph["nodes"].append(output)
large_graph["edges"].append({"id": f"{previous}-output", "source": previous,
                             "target": "output", "sourceHandle": "next"})
call("POST", "/validate", large_graph)
large_source = call("POST", "/studio/render", large_graph)
assert len(large_source["source"]) > 100_000
large_build = call("POST", "/studio/build", large_source)
assert not large_build["diagnostics"]
assert large_build["definition"] == large_graph
rule_id = PREFIX + "-rule"
rule = call("POST", "/rules", {"id": rule_id, "name": "Connected smoke rule", "kind": "FORMULA", "definition": definition}, 201)
call("POST", f"/rules/{rule_id}/publish", {"revision": rule["revision"]})
result = call("POST", f"/rules/{rule_id}/execute", {"inputs": {}})
assert result["result"] == 107 and result["sources"][0]["version"] == 1
fallback = call("POST", f"/rules/{rule_id}/execute", {"inputs": {"country": "XX"}})
assert fallback["result"] == 101 and fallback["sources"][0]["status"] == "DEFAULT"
override = call("POST", f"/rules/{rule_id}/execute", {"inputs": {"country": "XX", "rate": 0.3}})
assert override["result"] == 130 and not override["sources"]
call("POST", f"/rules/{rule_id}/execute", {"inputs": {"rate": "bad"}}, 422)
invalid = call("POST", "/studio/build", {"source": script.replace("$ROUND(amount * (1 + rate), 2)", "1 +")})
assert invalid["definition"] is None and invalid["diagnostics"][0]["line"] > 1
missing = copy.deepcopy(definition)
missing["inputs"][2]["source"]["id"] = "no-such-source"
call("POST", "/validate", missing, 404)
bad_mapping = copy.deepcopy(definition)
bad_mapping["inputs"][2]["source"]["bindings"] = {}
call("POST", "/validate", bad_mapping, 422)
wrong_pointer = copy.deepcopy(definition)
wrong_pointer["inputs"][2]["source"]["pointer"] = "/missing"
assert call("POST", "/preview", {"definition": wrong_pointer, "inputs": {}})["result"] == 101
wrong_pointer["inputs"][2]["source"]["onError"] = "FAIL"
call("POST", "/preview", {"definition": wrong_pointer, "inputs": {}}, 422)
http_id = PREFIX + "-http"
call("POST", "/sources", {"id": http_id, "name": "Blocked internal fixture", "definition": {"kind": "HTTP", "url": "http://127.0.0.1:8080/api/rules", "parameters": [], "timeoutMs": 500}})
call("POST", f"/sources/{http_id}/test", {"inputs": {}}, 422)

# Functions and inputs can share a basename. All calls require the namespace;
# an invalid legacy draft must be corrected before publication/execution.
namespace_script = '''schema 1;
inputs {
  SUM: NUMBER required default 3;
  ROUND: NUMBER required default 1.234;
}
node input INPUT "Inputs" { next -> output; }
node output OUTPUT "Result" { return $SUM(SUM, $ROUND(ROUND, 2)); }
'''
namespace_build = call("POST", "/studio/build", {"source": namespace_script})
assert not namespace_build["diagnostics"]
namespace_definition = namespace_build["definition"]
expression = namespace_definition["nodes"][1]["expression"]
assert expression == "$SUM(SUM, $ROUND(ROUND, 2))"
dependencies = call("POST", "/studio/expression/check", {"expression": expression})
assert dependencies["valid"] and set(dependencies["variables"]) == {"SUM", "ROUND"}
legacy_definition = copy.deepcopy(namespace_definition)
legacy_definition["nodes"][1]["expression"] = "SUM(SUM, ROUND(ROUND, 2))"
namespace_id = PREFIX + "-namespace"
namespace_rule = call("POST", "/rules", {"id": namespace_id, "name": "Function namespace", "kind": "FORMULA", "definition": namespace_definition}, 201)
namespace_rule = call("POST", f"/rules/{namespace_id}/publish", {"revision": namespace_rule["revision"]})
legacy_check = call("POST", "/studio/expression/check", {"expression": legacy_definition["nodes"][1]["expression"]})
assert not legacy_check["valid"] and "$SUM" in legacy_check["error"]
call("POST", "/preview", {"definition": legacy_definition, "inputs": {}}, 422)
namespace_rule = call("PUT", f"/rules/{namespace_id}", {
    "name": namespace_rule["name"], "description": namespace_rule["description"],
    "revision": namespace_rule["revision"], "definition": legacy_definition})
call("POST", f"/rules/{namespace_id}/publish", {"revision": namespace_rule["revision"]}, 422)
namespace_rule = call("PUT", f"/rules/{namespace_id}", {
    "name": namespace_rule["name"], "description": namespace_rule["description"],
    "revision": namespace_rule["revision"], "definition": namespace_definition})
call("POST", f"/rules/{namespace_id}/publish", {"revision": namespace_rule["revision"]})
for version in [1, 2]:
    assert call("POST", f"/rules/{namespace_id}/execute", {"version": version, "inputs": {}})["result"] == 4.23
assert call("GET", f"/rules/{namespace_id}/versions/1")["definition"] == namespace_definition
namespace_rendered = call("POST", "/studio/render", namespace_definition)
assert "$SUM(SUM, $ROUND(ROUND, 2))" in namespace_rendered["source"]
assert call("POST", "/studio/build", namespace_rendered)["definition"] == namespace_definition

for index, invalid_name in enumerate(["bad name", "$SUM", "bad\tname"]):
    invalid_definition = copy.deepcopy(namespace_definition)
    invalid_definition["inputs"][0]["name"] = invalid_name
    call("POST", "/rules", {"id": PREFIX + f"-invalid-name-{index}", "name": "Invalid name", "kind": "FORMULA", "definition": invalid_definition}, 422)
    invalid_config = {"kind": "HTTP", "url": "https://example.com/data", "timeoutMs": 500,
                      "parameters": [{"name": invalid_name, "type": "STRING", "required": True}]}
    call("POST", "/sources", {"id": PREFIX + f"-invalid-source-name-{index}", "name": "Invalid source name", "definition": invalid_config}, 422)

# Direct Formula calls keep their immutable version and use the ordinary nested
# execution session, including sourced inputs, explicit null and lazy branches.
def formula_graph(inputs, expression):
    return {"schemaVersion": 1, "notes": [], "inputs": inputs, "nodes": [
        {"id": "input", "type": "INPUT", "label": "Inputs", "position": {"x": 0, "y": 0}},
        {"id": "output", "type": "OUTPUT", "label": "Result", "position": {"x": 0, "y": 160},
         "expression": expression}], "edges": [
        {"id": "input-output", "source": "input", "target": "output", "sourceHandle": "next"}]}


def publish_formula(suffix, graph, kind="FORMULA"):
    created = call("POST", "/rules", {"id": PREFIX + suffix, "name": "Formula call " + suffix,
                   "kind": kind, "definition": graph}, 201)
    return call("POST", f"/rules/{created['id']}/publish", {"revision": created["revision"]})


callee_graph = formula_graph([
    {"name": "amount", "type": "NUMBER", "required": True},
    {"name": "rate", "type": "NUMBER", "required": True, "defaultValue": 0.1}],
    "$ROUND(amount * (1 - rate), 2)")
callee = publish_formula("-callee", callee_graph)
formula_expression = f"$ROUND(@{callee['id']}:1(amount), 2)"
check = call("POST", "/studio/expression/check", {"expression": formula_expression})
assert check["valid"] and check["variables"] == ["amount"]
assert check["formulaCalls"] == [{"id": callee["id"], "version": 1, "argumentCount": 1}]
parent_graph = formula_graph([{"name": "amount", "type": "NUMBER", "required": True}], formula_expression)
parent_formula = publish_formula("-caller", parent_graph)
parent_rendered = call("POST", "/studio/render", parent_graph)
assert formula_expression in parent_rendered["source"]
assert call("POST", "/studio/build", parent_rendered)["definition"] == call(
    "GET", f"/rules/{parent_formula['id']}/versions/1")["definition"]
parent_result = call("POST", f"/rules/{parent_formula['id']}/execute", {"inputs": {"amount": 100}})
assert parent_result["result"] == 90
assert {step["ruleId"] for step in parent_result["trace"]} == {callee["id"], parent_formula["id"]}
assert parent_result["executedSteps"] == 4
callee_v2 = copy.deepcopy(callee_graph)
callee_v2["nodes"][1]["expression"] = "amount * 0.5"
callee = call("PUT", f"/rules/{callee['id']}", {
    "name": callee["name"], "description": callee["description"],
    "revision": callee["revision"], "definition": callee_v2})
call("POST", f"/rules/{callee['id']}/publish", {"revision": callee["revision"]})
assert call("POST", f"/rules/{callee['id']}/execute", {"inputs": {"amount": 100}})["result"] == 50
assert call("POST", f"/rules/{parent_formula['id']}/execute", {
    "inputs": {"amount": 100}, "trace": False})["result"] == 90

for invalid_call in [f"@{callee['id']}:999(100)", f"@{callee['id']}:1()",
                     f"@{callee['id']}:1(100, 0.1, 2)"]:
    rejected = call("POST", "/studio/expression/check", {"expression": invalid_call})
    assert not rejected["valid"] and rejected["error"]
tree = publish_formula("-tree", formula_graph([], "1"), "DECISION_TREE")
assert not call("POST", "/studio/expression/check", {"expression": f"@{tree['id']}:1()"})["valid"]

# Required null fails at the child input and keeps the calling node location.
null_graph = formula_graph([], f"@{callee['id']}:1(100, null)")
null_failure = call("POST", "/preview", {"definition": null_graph, "inputs": {}}, 422)
assert any(location["ruleId"] == callee["id"] and location["nodeId"] == "input"
           for location in null_failure["locations"])
assert any(location["nodeId"] == "output" for location in null_failure["locations"])
optional = publish_formula("-optional", formula_graph([
    {"name": "value", "type": "NUMBER", "required": False, "defaultValue": 9}], "value"))
for arguments, expected in [("", 9), ("null", None)]:
    graph = formula_graph([], f"@{optional['id']}:1({arguments})")
    assert call("POST", "/preview", {"definition": graph, "inputs": {}})["result"] == expected

sourced_call = f"@{rule_id}:1()"
assert call("POST", "/studio/expression/check", {"expression": sourced_call})["valid"]
sourced = call("POST", "/preview", {"definition": formula_graph([], sourced_call), "inputs": {}})
assert sourced["result"] == 107 and sourced["sources"][0]["version"] == 1
lazy = call("POST", "/preview", {
    "definition": formula_graph([], f"$IF(false, {sourced_call}, 7)"), "inputs": {}})
assert lazy["result"] == 7 and not lazy["sources"] and lazy["executedSteps"] == 2
assert not any(step["ruleId"] == rule_id for step in lazy["trace"])

print(f"PASS: {checks} studio/source HTTP checks, pinned Formula calls, function namespaces, identifier validation, version pins, fallbacks, caller overrides, diagnostics, and HTTP destination policy.")
print(f"Created rule fixture: {rule_id}")
print(f"Created source fixtures: {source_id}, {http_id}")
