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
