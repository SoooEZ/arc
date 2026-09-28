#!/usr/bin/env python3
"""Exercise ARC against a real running API. Creates isolated smoke-* rule fixtures."""
import concurrent.futures
import copy
import json
import os
import re
import time
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


def raw_request(method, path, body):
    """Status and body text, for checks that the parsed JSON would hide (such as 1E+2 == 100)."""
    return raw_text_request(method, path, json.dumps(body))


def raw_text_request(method, path, text):
    """Sends JSON text as written, for number tokens Python's json module would rewrite (0e-1500)."""
    global checks
    req = urllib.request.Request(BASE + path, data=text.encode(), method=method,
                                 headers={"Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    checks += 1
    return response.status, response.read().decode()


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


def delete(rule_id, expected=204, headers=None):
    body = request("DELETE", "/api/rules/" + rule_id, expected=expected, headers=headers)
    if expected == 204:
        created.remove(rule_id)
    return body


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

    # Boundaries answer with client errors, never 500 or a silently different value.
    request("POST", "/api;x=1/preview", {"definition": None, "pad": "x" * (1024 * 1024)}, 413)
    duplicate_rule = request("POST", "/api/rules", {"id": "order-pricing", "name": "Duplicate",
                             "description": "", "kind": "RULE", "definition": None}, 409)
    assert duplicate_rule["message"] == "This rule ID already exists", duplicate_rule
    duplicate_source = request("POST", "/api/sources", {"id": "country-tax", "name": "Duplicate", "definition": {
        "kind": "LOOKUP", "parameters": [{"name": "key", "type": "STRING", "required": True}],
        "entries": {"US": {"rate": 0.07}}, "timeoutMs": 3000}}, 409)
    assert duplicate_source["message"] == "This source ID already exists", duplicate_source
    request("GET", f"/api/sources/{PREFIX}-missing/versions", expected=404)
    power = {"schemaVersion": 1, "inputs": [],
             "nodes": [{"id": "input", "type": "INPUT", "label": "Inputs"},
                       {"id": "out", "type": "OUTPUT", "label": "Result", "expression": "$POWER(10, 2)"}],
             "edges": [{"id": "next", "source": "input", "target": "out", "sourceHandle": "next"}]}
    status, text = raw_request("POST", "/api/preview", {"definition": power, "inputs": {}})
    assert status == 200 and re.search(r'"result":100[,}]', text), (status, text[:200])
    nul = request("POST", "/api/rules", {"id": PREFIX + "-nul", "name": "Bad\u0000name",
                  "description": "", "kind": "RULE", "definition": None}, 422)
    assert nul["message"] == "Text cannot contain the NUL character (U+0000)", nul

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
    assert request("GET", f"/api/rule-summaries?search=%20{PREFIX}%20&limit=1")["total"] == first["total"]
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

    # Multiple reached Outputs name fields without adding a second alias wrapper.
    named_graph = {
        "schemaVersion": 1,
        "inputs": [{"name": "amount", "type": "NUMBER", "required": True}],
        "nodes": [
            {"id": "input", "type": "INPUT", "label": "Inputs"},
            {"id": "first", "type": "OUTPUT", "label": "Original", "expression": "amount"},
            {"id": "second", "type": "OUTPUT", "label": "Discounted",
             "expression": "amount * 0.72", "outputName": "discounted"}],
        "edges": [{"id": name, "source": "input", "target": name, "sourceHandle": "next"}
                  for name in ["first", "second"]]}
    outputs = publish(create("outputs", definition=named_graph))
    pinned_outputs = request("GET", f"/api/rules/{outputs['id']}/versions/1")["definition"]
    for amount in [100, 50]:
        expected = {"amount": amount, "discounted": amount * 0.72}
        assert execute(outputs["id"], {"amount": amount}, 1)["result"] == expected
        assert request("POST", "/api/preview", {
            "definition": named_graph, "inputs": {"amount": amount}})["result"] == expected
    rendered_outputs = request("POST", "/api/studio/render", named_graph)
    assert "as discounted;" in rendered_outputs["source"]
    rebuilt_outputs = request("POST", "/api/studio/build", rendered_outputs)
    assert not rebuilt_outputs["diagnostics"]
    assert request("POST", "/api/preview", {
        "definition": rebuilt_outputs["definition"], "inputs": {"amount": 100}
    })["result"] == {"amount": 100, "discounted": 72}

    reused_graph = copy.deepcopy(parent["draft"])
    reused_graph["nodes"][1].update(ruleId=outputs["id"], version=1,
                                     bindings={"amount": "amount"}, output="totals")
    reused_graph["nodes"][2]["expression"] = "totals.discounted"
    reused_outputs = publish(create("reused-outputs", definition=reused_graph))
    called_graph = copy.deepcopy(child["draft"])
    called_graph["nodes"][1]["expression"] = f"@{outputs['id']}:1(amount)"
    called_graph["nodes"][2]["expression"] = "total.amount"
    called_outputs = publish(create("called-outputs", definition=called_graph))
    assert execute(reused_outputs["id"], {"amount": 100})["result"] == 72
    assert execute(called_outputs["id"], {"amount": 100})["result"] == 100
    outputs["draft"]["nodes"][1]["outputName"] = "original"
    outputs["draft"]["nodes"][2]["outputName"] = "payable"
    outputs = publish(save(outputs))
    assert execute(outputs["id"], {"amount": 100})["result"] == {"original": 100, "payable": 72}
    assert execute(outputs["id"], {"amount": 100}, 1)["result"] == {"amount": 100, "discounted": 72}
    assert execute(reused_outputs["id"], {"amount": 100})["result"] == 72
    assert execute(called_outputs["id"], {"amount": 100})["result"] == 100
    assert request("GET", f"/api/rules/{outputs['id']}/versions/1")["definition"] == pinned_outputs

    collision = copy.deepcopy(named_graph)
    collision["nodes"][1].update(expression="null", outputName="amount")
    collision["nodes"][2].update(expression="amount", outputName=None)
    failed = request("POST", "/api/preview", {"definition": collision, "inputs": {"amount": 100}}, 422)
    assert "amount" in failed["message"]
    assert {location["nodeId"] for location in failed["locations"]} == {"first", "second"}
    collided_outputs = publish(create("output-collision", definition=collision))
    failed = execute(collided_outputs["id"], {"amount": 100}, 1, expected=422)
    assert {location["nodeId"] for location in failed["locations"]} == {"first", "second"}
    nullable = copy.deepcopy(named_graph)
    nullable["nodes"][1].update(expression="null", outputName="absent")
    nullable["nodes"][2].update(expression='$OBJECT("amount", amount)', outputName="details")
    assert request("POST", "/api/preview", {"definition": nullable, "inputs": {"amount": 100}})["result"] == {
        "absent": None, "details": {"amount": 100}}

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

    # PostgreSQL stores a 1e100 default written out (101 digits); limits apply by value, so it saves again.
    big_graph = {"schemaVersion": 1,
                 "inputs": [{"name": "amount", "type": "NUMBER", "required": False, "defaultValue": 1e100}],
                 "nodes": [{"id": "input", "type": "INPUT", "label": "Inputs"},
                           {"id": "out", "type": "OUTPUT", "label": "Result", "expression": "amount"}],
                 "edges": [{"id": "next", "source": "input", "target": "out", "sourceHandle": "next"}]}
    big_default = create("big-default", definition=big_graph)
    assert big_default["draft"]["inputs"][0]["defaultValue"] == 10 ** 100
    big_default = save(big_default)
    assert request("POST", "/api/preview", {"definition": big_default["draft"], "inputs": {}})["result"] == 10 ** 100
    # A zero's scale counts as written: 0e-1500 has no digits to strip and would print as 1,500 characters.
    zero_graph = copy.deepcopy(big_graph)
    zero_graph["inputs"][0]["defaultValue"] = "ZERO_TOKEN"
    zero_body = json.dumps({"id": PREFIX + "-zero-default", "name": "Smoke zero", "description": "",
                            "kind": "FORMULA", "definition": zero_graph}).replace('"ZERO_TOKEN"', "0e-1500")
    status, text = raw_text_request("POST", "/api/rules", zero_body)
    assert status == 422 and "precision or magnitude" in text, (status, text[:200])
    request("GET", "/api/rules/" + PREFIX + "-zero-default", expected=404)

    # POI's number parser backtracks on long digit text; ARC rejects the call before POI runs.
    digit_text = {"schemaVersion": 1,
                  "inputs": [{"name": "items", "type": "ARRAY", "required": True}],
                  "nodes": [{"id": "input", "type": "INPUT", "label": "Inputs"},
                            {"id": "out", "type": "OUTPUT", "label": "Result",
                             "expression": '$MAP([$CONCAT($REPT("1", 1999), "x")], s, $COUNTIF($MAP(items, i, s), 5))'}],
                  "edges": [{"id": "next", "source": "input", "target": "out", "sourceHandle": "next"}]}
    started = time.monotonic()
    rejected = request("POST", "/api/preview", {"definition": digit_text, "inputs": {"items": list(range(20))},
                                                "timeoutMs": 100}, 422)
    assert "numeric text needs more than" in rejected["message"], rejected
    assert time.monotonic() - started < 1.5, "the call must fail before POI parses the text"

    # A rule that other rules call is kept; once none does, it goes with every version.
    callee = publish(create("delete-callee"))
    assert execute(callee["id"], {"amount": 100}, 1)["result"] == 90
    calling = copy.deepcopy(callee["draft"])
    calling["nodes"][1] = {"id": "calculate", "type": "REFERENCE", "label": "Callee",
        "position": {"x": 280, "y": 160}, "ruleId": callee["id"], "version": 1,
        "bindings": {"amount": "amount"}, "output": "total"}
    caller = create("delete-caller", "DECISION_TREE", calling)
    assert delete(callee["id"], 409)["issues"] == [caller["id"] + " (draft)"]
    caller = publish(caller)
    assert delete(callee["id"], 409)["issues"] == [caller["id"] + " (draft)", caller["id"] + " v1"]
    # Browsers send an Origin with every DELETE, so CORS must allow the method.
    request("OPTIONS", "/api/rules/" + caller["id"], headers={"Origin": "https://example.com",
            "Access-Control-Request-Method": "DELETE"})
    delete(caller["id"], headers={"Origin": "https://example.com"})
    # An unfinished draft keeps the rules it names: a Reference without a version, and a source
    # mapping that calls the rule while the draft has no Input node.
    unpinned = copy.deepcopy(calling)
    unpinned["nodes"][1]["version"] = None
    unpinned_caller = create("delete-unpinned", "DECISION_TREE", unpinned)
    assert delete(callee["id"], 409)["issues"] == [unpinned_caller["id"] + " (draft)"]
    delete(unpinned_caller["id"])
    sourced = {"schemaVersion": 1,
               "inputs": [{"name": "amount", "type": "NUMBER", "required": True, "defaultValue": None,
                           "source": {"id": "country-tax", "version": 1, "onError": "FAIL", "pointer": "/rate",
                                      "bindings": {"key": '$TO_STRING(@' + callee["id"] + ':1(1))'}}}],
               "nodes": [{"id": "out", "type": "OUTPUT", "label": "Result", "expression": "amount"}],
               "edges": []}
    sourced_caller = create("delete-sourced", definition=sourced)
    assert delete(callee["id"], 409)["issues"] == [sourced_caller["id"] + " (draft)"]
    delete(sourced_caller["id"])
    # The revision a client read is a precondition: a rule published since then is kept.
    before_publish = request("GET", "/api/rules/" + callee["id"])
    callee = save(before_publish)
    callee = publish(callee)
    assert "changed in another editor" in request("DELETE", "/api/rules/" + callee["id"] + "?revision=" + str(before_publish["revision"]), expected=409)["message"]
    assert execute(callee["id"], {"amount": 100}, 1)["result"] == 90
    request("DELETE", "/api/rules/" + callee["id"] + "?revision=" + str(callee["revision"]), expected=204)
    created.remove(callee["id"])
    request("GET", "/api/rules/" + callee["id"], expected=404)
    execute(callee["id"], {"amount": 100}, 1, expected=404)
    delete(callee["id"], 404)
    # The ID is free again, and its new version 1 never runs the deleted rule's cached plan.
    halving = copy.deepcopy(callee["draft"])
    halving["nodes"][1]["expression"] = "amount * 0.5"
    recreated = publish(create("delete-callee", definition=halving))
    assert execute(recreated["id"], {"amount": 100}, 1)["result"] == 50
    # Revisions come from one sequence, so an editor still holding the deleted rule cannot overwrite it.
    assert recreated["revision"] > callee["revision"]
    save(dict(callee, name="Stale editor"), expected=409)
    assert request("GET", "/api/rules/" + recreated["id"])["name"] == recreated["name"]

    # A deletion and the publication of a new caller never both succeed: the callee's lock is
    # held by whichever write commits first, and the other sees its outcome.
    for attempt in range(4):
        racing_callee = publish(create(f"race-callee-{attempt}"))
        racing_caller = create(f"race-caller-{attempt}")
        call = copy.deepcopy(racing_caller["draft"])
        call["nodes"][1]["expression"] = "@" + racing_callee["id"] + ":1(amount)"
        def publish_caller():
            saved = save(dict(racing_caller, draft=call))
            return raw_request("POST", "/api/rules/" + saved["id"] + "/publish", {"revision": saved["revision"]})
        with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
            deletion = executor.submit(raw_text_request, "DELETE", "/api/rules/" + racing_callee["id"], "")
            publication = executor.submit(publish_caller)
            delete_status, _ = deletion.result()
            publish_status, publish_text = publication.result()
        caller_published = publish_status == 200
        assert not (delete_status == 204 and caller_published), (delete_status, publish_status, publish_text[:200])
        if caller_published:
            assert delete_status == 409
            assert execute(racing_caller["id"], {"amount": 100}, 1)["result"] == 90
        delete(racing_caller["id"])
        if delete_status == 204:
            created.remove(racing_callee["id"])
        else:
            delete(racing_callee["id"])

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
    print(f"PASS: {checks} HTTP checks, pricing branches, named Output fields, pinned calls, collisions, immutable references, deletions, and concurrent edits.")
finally:
    print("Created fixtures: " + ", ".join(created))
