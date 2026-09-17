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
assert any(f["name"] == "MAP" and f["supported"] for f in functions)
assert any(f["name"] == "INDIRECT" and not f["supported"] for f in functions)
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
script = '''schema 1;
// source configuration remains pinned
inputs {
  amount: NUMBER required default 100;
  country: STRING required default "US";
  rate: NUMBER required default 0.01;
  source rate = {"id":"SOURCE_ID","version":1,"bindings":{"key":"country"},"pointer":"/rate","onError":"DEFAULT"};
}
node input INPUT "Inputs" { next -> output; }
node output OUTPUT "Result" { return ROUND(amount * (1 + rate), 2); }
'''.replace("SOURCE_ID", source_id)
build = call("POST", "/studio/build", {"source": script})
assert not build["diagnostics"]
definition = build["definition"]
rendered = call("POST", "/studio/render", definition)
rebuilt = call("POST", "/studio/build", rendered)
assert rebuilt["definition"] == definition
call("POST", "/validate", definition)
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
invalid = call("POST", "/studio/build", {"source": script.replace("ROUND(amount * (1 + rate), 2)", "1 +")})
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
print(f"PASS: {checks} studio/source HTTP checks, version pins, fallbacks, caller overrides, diagnostics, and HTTP destination policy.")
print(f"Created rule fixture: {rule_id}")
print(f"Created source fixtures: {source_id}, {http_id}")
