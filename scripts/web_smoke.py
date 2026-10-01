#!/usr/bin/env python3
"""Checks the built web image (nginx) as a browser sees it: health, redirects and the body cap.

Runs against a Compose stack's web port, never the Vite dev server (lesson: web-server behavior
must be checked against the built image). Redirects are not followed, so their Location is checked.
"""
import json
import os
import urllib.error
import urllib.request

BASE = os.environ.get("ARC_WEB_URL", "http://localhost:3080")
MIB = 1024 * 1024
checks = 0


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


opener = urllib.request.build_opener(NoRedirect)


def fetch(method, path, body=None, headers=None):
    global checks
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=headers or {})
    try:
        response = opener.open(req, timeout=60)
    except urllib.error.HTTPError as error:
        response = error
    checks += 1
    return response.status, response.headers, response.read()


status, headers, body = fetch("GET", "/health")
assert status == 200 and body == b"ok", (status, body)
# Exactly one Content-Type: `add_header` next to `return` used to send application/octet-stream first.
assert headers.get_all("Content-Type") == ["text/plain"], headers.get_all("Content-Type")

# Redirects keep the port the browser used: absolute ones named the container's port 80.
for path, target in [("/api", "/api/"), ("/assets", "/assets/")]:
    status, headers, _ = fetch("GET", path)
    assert status == 301 and headers.get("Location") == target, (path, status, headers.get("Location"))

# Above the 1 MiB cap the web origin answers the API's JSON 413 with CORS, not nginx's HTML page.
json_headers = {"Content-Type": "application/json", "Origin": "http://example.test"}
# The padding is a field rules have: requests are strict JSON, and an unknown field is a 400.
padded = lambda size: b'{"description":"' + b"x" * (size - 18) + b'"}'
status, headers, body = fetch("POST", "/api/rules", padded(MIB + 1), json_headers)
assert status == 413, status
assert headers.get("Content-Type", "").startswith("application/json"), headers.get("Content-Type")
assert headers.get("Access-Control-Allow-Origin") == "*", headers.get("Access-Control-Allow-Origin")
assert json.loads(body)["message"] == "Request body exceeds 1 MiB", body[:200]
# Exactly 1 MiB still reaches the API, which rejects the padded body as a rule (422, not 413).
status, headers, body = fetch("POST", "/api/rules", padded(MIB), json_headers)
assert status == 422, (status, body[:200])

print(f"PASS: {checks} web-server checks (health, relative redirects, JSON 413 with CORS).")
