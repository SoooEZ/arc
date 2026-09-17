#!/usr/bin/env python3
"""Verify Rails -> Java -> Rails -> Java on one fresh database, then remove only this test stack."""
import os
import subprocess
import uuid
from contract import Api, normalize, PREFIX

project = "arc-switch-" + uuid.uuid4().hex[:8]
env = {**os.environ, "COMPOSE_PROJECT_NAME": project,
       "ARC_API_PORT": os.environ.get("ARC_SWITCH_API_PORT", "18082"),
       "ARC_WEB_PORT": os.environ.get("ARC_SWITCH_WEB_PORT", "13082")}
api = Api("http://localhost:" + env["ARC_API_PORT"])
base = ["docker", "compose", "-f", "compose.yaml"]
rails = base + ["-f", "compose.rails.yaml"]


def compose(command, *args):
    subprocess.run(command + list(args), env=env, check=True)


try:
    # First initialize an empty database using Ruby's SQL runner. Java/Flyway must
    # accept that history, then Ruby must accept the Java-validated history too.
    compose(rails, "up", "-d", "--build", "--wait", "--wait-timeout", "180")
    rule_id = PREFIX + "-switch"
    rule = api.call("POST", "/api/rules", {"id": rule_id, "name": "Switch test", "kind": "FORMULA"}, 201)
    rule = api.call("POST", f"/api/rules/{rule_id}/publish", {"revision": rule["revision"]})
    v1 = api.call("GET", f"/api/rules/{rule_id}/versions/1")
    compose(base, "up", "-d", "--build", "--wait", "--wait-timeout", "180")
    assert normalize(api.call("GET", f"/api/rules/{rule_id}")) == normalize(rule)
    assert api.call("POST", f"/api/rules/{rule_id}/execute", {"inputs": {"amount": 100}})["result"] == 90
    compose(rails, "up", "-d", "--build", "--wait", "--wait-timeout", "180")
    assert normalize(api.call("GET", f"/api/rules/{rule_id}")) == normalize(rule)
    assert api.call("POST", f"/api/rules/{rule_id}/execute", {"inputs": {"amount": 100}})["result"] == 90
    rule["draft"]["nodes"][1]["expression"] = "amount * 0.5"
    updated = api.call("PUT", f"/api/rules/{rule_id}", {"name": rule["name"], "description": rule["description"],
                        "revision": rule["revision"], "definition": rule["draft"]})
    published = api.call("POST", f"/api/rules/{rule_id}/publish", {"revision": updated["revision"]})
    compose(base, "up", "-d", "--build", "--wait", "--wait-timeout", "180")
    assert normalize(api.call("GET", f"/api/rules/{rule_id}")) == normalize(published)
    assert normalize(api.call("GET", f"/api/rules/{rule_id}/versions/1")) == normalize(v1)
    assert api.call("POST", f"/api/rules/{rule_id}/execute", {"inputs": {"amount": 100}})["result"] == 50
    assert api.call("POST", f"/api/rules/{rule_id}/execute", {"inputs": {"amount": 100}, "version": 1})["result"] == 90
    print("PASS: Rails -> Java -> Rails -> Java preserves data, version history, execution, and migration checksums")
finally:
    compose(rails, "down", "-v", "--remove-orphans")
