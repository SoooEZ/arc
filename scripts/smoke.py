#!/usr/bin/env python3
"""Exercise ARC against a real running API. Creates isolated smoke-* rule fixtures."""
import concurrent.futures
import copy
import json
import os
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get("ARC_API_URL", "http://localhost:8080")
PREFIX = "smoke-" + uuid.uuid4().hex[:8]
created = []
checks = 0


def request(method, path, body=None, expected=200, headers=None):
    global checks
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method,
                                 headers={"Content-Type": "application/json", **(headers or {})})
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    content = response.read()
    assert response.status == expected, (method, path, response.status, content.decode())
    if headers and "Origin" in headers:
        assert response.headers.get("Access-Control-Allow-Origin") == "*"
    checks += 1
    return json.loads(content) if content else None


def create(suffix, kind="FORMULA", definition=None):
    rule_id = PREFIX + "-" + suffix
    rule = request("POST", "/api/rules", {"id": rule_id, "name": "Smoke " + suffix,
                   "description": "Automated integration fixture", "kind": kind, "definition": definition}, 201)
    created.append(rule_id)
    return rule


def save(rule, expected=200):
    return request("PUT", "/api/rules/" + rule["id"], {"name": rule["name"], "description": rule["description"],
                   "revision": rule["revision"], "definition": rule["draft"]}, expected)


def publish(rule, expected=200):
    return request("POST", "/api/rules/" + rule["id"] + "/publish", {"revision": rule["revision"]}, expected)


def execute(rule_id, inputs, version=None, expected=200):
    return request("POST", f"/api/rules/{rule_id}/execute", {"inputs": inputs, "version": version}, expected)


try:
    assert request("GET", "/actuator/health")["status"] == "UP"
    request("GET", "/api/missing-endpoint", expected=404)
    request("POST", "/api/rules", {"description": "x" * (1024 * 1024)}, 413)
    for tier, amount, result in [("premium", 150, 120), ("standard", 150, 135), ("standard", 80, 80)]:
        output = execute("order-pricing", {"customerTier": tier, "orderTotal": amount})
        assert output["result"] == result and output["trace"] and output["version"] == 1
    assert execute("apply-discount", {"amount": 0.3, "rate": 0.1})["result"] == 0.27
    without_trace = request("POST", "/api/rules/order-pricing/execute", {
        "version": 1, "inputs": {"orderTotal": 150, "customerTier": "premium"},
        "trace": False, "timeoutMs": 5000})
    assert without_trace["result"] == 120 and without_trace["trace"] == []
    assert without_trace["traceEnabled"] is False and without_trace["traceTruncated"] is False
    assert without_trace["executedSteps"] > 0 and without_trace["traceBytes"] == 2
    timing = without_trace["timing"]
    assert timing["totalMicros"] >= timing["preparationMicros"] >= 0
    assert timing["totalMicros"] >= timing["executionMicros"] >= 0
    for timeout in [99, 30001]:
        request("POST", "/api/rules/order-pricing/execute", {"inputs": {}, "timeoutMs": timeout}, 422)
    execute("order-pricing", {"orderTotal": "bad", "customerTier": "premium"}, expected=422)
    execute("order-pricing", {}, expected=422)
    execute("order-pricing", {"orderTotal": 100, "customerTier": "premium", "typo": 1}, expected=422)
    execute("not-a-rule", {}, expected=404)
    execute("order-pricing", {}, 999, expected=404)
    request("OPTIONS", "/api/rules/order-pricing/execute", headers={"Origin": "https://example.com",
            "Access-Control-Request-Method": "POST", "Access-Control-Request-Headers": "Content-Type"})

    child = create("child")
    execute(child["id"], {"amount": 100}, expected=409)
    child = publish(child)
    assert execute(child["id"], {"amount": 100})["result"] == 90
    definition = copy.deepcopy(child["draft"])
    definition["nodes"][1] = {"id": "calculate", "type": "REFERENCE", "label": "Pinned child",
        "position": {"x": 280, "y": 160}, "ruleId": child["id"], "version": 1,
        "bindings": {"amount": "amount * 2"}, "output": "total"}
    parent = publish(create("parent", "DECISION_TREE", definition))
    assert execute(parent["id"], {"amount": 100})["result"] == 180
    original = copy.deepcopy(child)
    child["draft"]["nodes"][1]["expression"] = "amount * 0.5"
    child = save(child)
    assert execute(child["id"], {"amount": 100})["result"] == 90, "Draft edits must not change live execution"
    preview = request("POST", "/api/preview", {"definition": child["draft"], "inputs": {"amount": 100}})
    assert preview["result"] == 50
    save(original, expected=409)
    child = publish(child)
    assert execute(child["id"], {"amount": 100})["result"] == 50
    assert execute(child["id"], {"amount": 100}, 1)["result"] == 90
    assert execute(parent["id"], {"amount": 100})["result"] == 180, "Pinned references must be immutable"
    assert len(request("GET", f"/api/rules/{child['id']}/versions")) == 2
    assert request("GET", f"/api/rules/{child['id']}/versions/1")["definition"]["nodes"][1]["expression"] == "amount * 0.9"
    history = request("GET", f"/api/rules/{child['id']}/version-summaries?limit=1&offset=0")
    assert history["total"] == 2 and history["items"][0]["version"] == 2
    assert "definition" not in history["items"][0]
    assert request("GET", f"/api/rules/{child['id']}/version-summaries?limit=1&offset=1")["items"][0]["version"] == 1
    first = request("GET", f"/api/rule-summaries?search={PREFIX}&limit=1&offset=0")
    second = request("GET", f"/api/rule-summaries?search={PREFIX}&limit=1&offset=1")
    assert first["total"] == 2 and len(first["items"]) == 1
    assert first["items"][0]["id"] != second["items"][0]["id"]
    assert "draft" not in first["items"][0] and "nodeCount" in first["items"][0]
    assert request("GET", f"/api/rule-summaries?search={PREFIX}&limit=1&offset=99")["items"] == []
    request("GET", "/api/rule-summaries?limit=101", expected=422)
    request("GET", "/api/rule-summaries?offset=-1", expected=422)

    version_search = create("version-search")
    for _ in range(12):
        version_search = publish(version_search)
    version_history = f"/api/rules/{version_search['id']}/version-summaries"
    matches = request("GET", version_history + "?search=%202%20&limit=1")
    assert matches["total"] == 2 and matches["items"][0]["version"] == 12
    older = request("GET", version_history + "?search=2&limit=1&offset=1")
    assert older["total"] == 2 and older["items"][0]["version"] == 2
    assert request("GET", version_history + "?search=2&offset=2")["items"] == []
    assert request("GET", version_history + "?search=%20")["total"] == 12
    for query in ["99", "%25", "_", "invalid"]:
        missing = request("GET", version_history + "?search=" + query)
        assert missing["total"] == 0 and missing["items"] == []
    request("GET", version_history + "?search=" + "1" * 201, expected=422)
    request("GET", f"/api/rules/{PREFIX}-missing/version-summaries?search=2", expected=404)

    # A valid graph can repeat large intermediate values; only trace is bounded.
    payload = ['x' * 100 for _ in range(100)]
    large = {"schemaVersion": 1, "inputs": [{"name": "payload", "type": "ARRAY", "required": True}],
             "nodes": [{"id": "input", "type": "INPUT", "label": "Input", "position": {"x": 0, "y": 0}}], "edges": []}
    previous = "input"
    for index in range(98):
        node_id = f"value{index}"
        large["nodes"].append({"id": node_id, "type": "FORMULA", "label": node_id,
                               "expression": "payload", "output": node_id, "position": {"x": 0, "y": index}})
        large["edges"].append({"id": f"e{index}", "source": previous, "target": node_id, "sourceHandle": "next"})
        previous = node_id
    large["nodes"].append({"id": "output", "type": "OUTPUT", "label": "Output", "expression": "payload", "position": {"x": 0, "y": 100}})
    large["edges"].append({"id": "last", "source": previous, "target": "output", "sourceHandle": "next"})
    bounded = request("POST", "/api/preview", {"definition": large, "inputs": {"payload": payload}})
    assert bounded["result"] == payload and bounded["traceTruncated"] is True
    assert bounded["executedSteps"] == 100 and 0 < len(bounded["trace"]) < 100
    assert bounded["traceBytes"] == len(json.dumps(bounded["trace"], separators=(',', ':'), ensure_ascii=False).encode())
    assert bounded["traceBytes"] <= 262144
    invalid = copy.deepcopy(child["draft"])
    invalid["nodes"][1]["expression"] = "unavailable + 1"
    request("POST", "/api/validate", invalid, 422)
    child["draft"] = invalid
    child = save(child)  # Incomplete drafts are allowed.
    publish(child, expected=422)
    assert execute(child["id"], {"amount": 100})["result"] == 50

    # Row locks + revision checks allow exactly one competing update.
    race = create("concurrent")
    def competing_update(number):
        body = {"name": f"Concurrent {number}", "description": "", "revision": race["revision"], "definition": race["draft"]}
        req = urllib.request.Request(BASE + "/api/rules/" + race["id"], data=json.dumps(body).encode(),
                                     method="PUT", headers={"Content-Type": "application/json"})
        try:
            return urllib.request.urlopen(req, timeout=20).status
        except urllib.error.HTTPError as error:
            return error.code
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        statuses = sorted(executor.map(competing_update, [1, 2]))
    assert statuses == [200, 409], statuses
    print(f"PASS: {checks} HTTP checks, all pricing branches, immutable references, and concurrent edits.")
finally:
    print("Created fixtures: " + ", ".join(created))
