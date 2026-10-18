"""HTTP plumbing shared by the API smoke scripts: one way to send a request, and the count of checks
they report. web_smoke.py keeps its own opener, because it must see redirects instead of following
them.
"""
import os
import urllib.error
import urllib.request

BASE = os.environ.get("ARC_API_URL", "http://localhost:8080")
checks = 0


def exchange(method, path, data=None, headers=None):
    """Sends one request and returns its status, headers and body bytes, whatever the status.
    It is not a check: nothing is counted."""
    req = urllib.request.Request(BASE + path, data=data, method=method, headers=headers or {})
    try:
        response = urllib.request.urlopen(req, timeout=20)
    except urllib.error.HTTPError as error:
        response = error
    return response.status, response.headers, response.read()


def send(method, path, data=None, content_type="application/json", headers=None):
    """One counted check: sends `data` (bytes or None) with its content type and returns the status,
    headers and body bytes."""
    global checks
    checks += 1
    return exchange(method, path, data, {"Content-Type": content_type, **(headers or {})})
