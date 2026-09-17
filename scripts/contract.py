#!/usr/bin/env python3
"""Shared black-box contract. Pass two API URLs to also compare their complete responses.
Creates isolated contract-* fixtures; intended for disposable test databases.
"""
import concurrent.futures
import copy
import decimal
import json
import pathlib
import sys
import urllib.error
import urllib.request
import uuid

ROOT = pathlib.Path(__file__).resolve().parent.parent
PREFIX = "contract-" + uuid.uuid4().hex[:10]


def encode(value):
    if isinstance(value, decimal.Decimal):
        return str(value)
    if isinstance(value, dict):
        return "{" + ",".join(json.dumps(k) + ":" + encode(v) for k, v in value.items()) + "}"
    if isinstance(value, list):
        return "[" + ",".join(map(encode, value)) + "]"
    return json.dumps(value, ensure_ascii=False)


def normalize(value):
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()
                if k not in ("createdAt", "updatedAt", "publishedAt", "durationMicros")}
    if isinstance(value, list):
        return [normalize(v) for v in value]
    return value


class Api:
    def __init__(self, base):
        self.base, self.responses = base.rstrip("/"), []

    def call(self, method, path, body=None, status=200, raw=None, record=True):
        data = raw if raw is not None else (encode(body).encode() if body is not None else None)
        req = urllib.request.Request(self.base + path, method=method, data=data,
                                     headers={"Content-Type": "application/json", "Origin": "https://consumer.example"})
        try:
            response = urllib.request.urlopen(req, timeout=40)
        except urllib.error.HTTPError as error:
            response = error
        payload = response.read()
        assert response.status == status, (self.base, method, path, response.status, payload)
        if path.startswith("/api/"):
            assert response.headers.get("Access-Control-Allow-Origin") == "*", path
        result = json.loads(payload, parse_float=decimal.Decimal) if payload else None
        if record:
            self.responses.append((method, path, status, normalize(result)))
        return result


def graph(expression, inputs=None, types=None):
    return {"schemaVersion": 1,
            "inputs": [{"name": k, "type": (types or {}).get(k, "NUMBER"), "required": True} for k in (inputs or {})],
            "nodes": [{"id": "input", "type": "INPUT", "label": "Inputs"},
                      {"id": "result", "type": "OUTPUT", "label": "Result", "expression": expression}],
            "edges": [{"id": "edge", "source": "input", "target": "result", "sourceHandle": "next"}]}


def run(base):
    api = Api(base)
    api.call("GET", "/actuator/health")
    catalog = api.call("GET", "/api/functions")
    assert len([f for f in catalog if f["supported"]]) >= 150
    cases = json.loads((ROOT / "contracts/expressions.json").read_text(), parse_float=decimal.Decimal)
    for case in cases:
        definition = graph(case["expression"], case.get("inputs"), case.get("types"))
        output = api.call("POST", "/api/preview", {"definition": definition, "inputs": case.get("inputs", {})})
        assert output["result"] == case["result"], (case["name"], output)
        source = api.call("POST", "/api/studio/render", definition)
        built = api.call("POST", "/api/studio/build", source)
        assert not built["diagnostics"], built
        node = api.call("POST", "/api/studio/node/render", {"definition": built["definition"], "nodeId": "result"})
        api.call("POST", "/api/studio/node/build", {"definition": built["definition"], "nodeId": "result", **node})

    # Two active outputs return a map; inactive branches do not contribute.
    fan = graph("10")
    fan["nodes"][1]["id"] = "tax"
    fan["nodes"].append({"id": "shipping", "type": "OUTPUT", "label": "Shipping", "expression": "5"})
    fan["edges"] = [{"id": node, "source": "input", "target": node, "sourceHandle": "next"} for node in ("tax", "shipping")]
    assert api.call("POST", "/api/preview", {"definition": fan, "inputs": {}})["result"] == {"tax": 10, "shipping": 5}
    api.call("POST", "/api/variables", fan)
    for expr in ("1 / 0", "missing + 1", '"1" + 2'):
        invalid = graph(expr)
        error = api.call("POST", "/api/preview", {"definition": invalid, "inputs": {}}, 422)
        assert error["locations"][0]["nodeId"] == "result", error
        api.call("POST", "/api/diagnostics", invalid)
    api.call("POST", "/api/studio/build", {"source": "node broken"})

    # Rails and Java must expose the same persistence/version behavior.
    rule_id = PREFIX + "-formula"
    rule = api.call("POST", "/api/rules", {"id": rule_id, "name": "Contract", "kind": "FORMULA"}, 201)
    api.call("POST", "/api/rules", {"id": rule_id, "name": "Duplicate", "kind": "FORMULA"}, 409)
    rule = api.call("POST", f"/api/rules/{rule_id}/publish", {"revision": rule["revision"]})
    api.call("POST", f"/api/rules/{rule_id}/execute", {"inputs": {"amount": 100}})
    parent_id = PREFIX + "-parent"
    definition = copy.deepcopy(rule["draft"])
    definition["nodes"][1] = {"id": "calculate", "type": "REFERENCE", "label": "Pinned child", "ruleId": rule_id,
                               "version": 1, "bindings": {"amount": "amount * 2"}, "output": "total"}
    parent = api.call("POST", "/api/rules", {"id": parent_id, "name": "Parent", "kind": "DECISION_TREE", "definition": definition}, 201)
    api.call("POST", f"/api/rules/{parent_id}/publish", {"revision": parent["revision"]})
    assert api.call("POST", f"/api/rules/{parent_id}/execute", {"inputs": {"amount": 100}})["result"] == 180
    old_revision = rule["revision"]
    rule["draft"]["nodes"][1]["expression"] = "amount / 2"
    update = {"name": rule["name"], "description": rule["description"], "revision": old_revision, "definition": rule["draft"]}
    rule = api.call("PUT", f"/api/rules/{rule_id}", update)
    api.call("PUT", f"/api/rules/{rule_id}", update, 409)
    api.call("POST", f"/api/rules/{rule_id}/publish", {"revision": rule["revision"]})
    assert api.call("POST", f"/api/rules/{rule_id}/execute", {"inputs": {"amount": 100}})["result"] == 50
    assert api.call("POST", f"/api/rules/{parent_id}/execute", {"inputs": {"amount": 100}})["result"] == 180
    api.call("GET", f"/api/rules/{rule_id}/versions")
    api.call("GET", f"/api/rules/{rule_id}/versions/1")
    api.call("GET", f"/api/rules/{rule_id}")
    missing = copy.deepcopy(definition)
    missing["nodes"][1]["version"] = 999
    api.call("POST", "/api/diagnostics", missing)
    api.call("POST", "/api/validate", missing, 404)

    # Numeric values in JSONB retain precision; historical source definitions stay pinned.
    source_id = PREFIX + "-source"
    amount = decimal.Decimal("12345678901234567890.123456789")
    config = {"kind": "LOOKUP", "parameters": [{"name": "key", "type": "STRING", "required": True}],
              "entries": {"US": {"rate": amount}, "null": None}, "timeoutMs": 3000}
    api.call("POST", "/api/sources", {"id": source_id, "name": "Contract table", "definition": config})
    assert api.call("POST", f"/api/sources/{source_id}/test", {"inputs": {"key": "US"}})["result"]["rate"] == amount
    api.call("POST", f"/api/sources/{source_id}/test", {"inputs": {"key": "null"}})
    connected = graph("rate", {"rate": 0})
    connected["inputs"][0].update({"defaultValue": 3, "source": {"id": source_id, "version": 1, "bindings": {"key": '"US"'}, "pointer": "/rate", "onError": "DEFAULT"}})
    assert api.call("POST", "/api/preview", {"definition": connected, "inputs": {}})["result"] == amount
    config["entries"]["US"]["rate"] = 2
    update_source = {"name": "Contract table", "revision": 1, "definition": config}
    api.call("PUT", f"/api/sources/{source_id}", update_source)
    api.call("PUT", f"/api/sources/{source_id}", update_source, 409)
    api.call("GET", f"/api/sources/{source_id}/versions")
    api.call("GET", f"/api/sources/{source_id}/versions/1")
    assert api.call("POST", "/api/preview", {"definition": connected, "inputs": {}})["result"] == amount
    connected["inputs"][0]["source"]["bindings"]["key"] = '"missing"'
    assert api.call("POST", "/api/preview", {"definition": connected, "inputs": {}})["result"] == 3
    api.call("POST", "/api/rules", status=400, raw=b'{"broken":')
    api.call("POST", "/api/rules", status=413, raw=b'{"value":"' + b'x' * 1048576 + b'"}')
    api.call("GET", "/api/rules/no-such-contract", status=404)
    print(f"PASS {base}: {len(api.responses)} shared contract checks")
    return api.responses


if __name__ == "__main__":
    urls = sys.argv[1:] or ["http://localhost:8080"]
    results = [run(url) for url in urls]
    for index, result in enumerate(results[1:], 1):
        for expected, actual in zip(results[0], result, strict=True):
            assert expected == actual, (urls[index], expected, actual)
    if len(results) > 1:
        print("PASS: backend responses match (excluding timestamps and execution durations)")
