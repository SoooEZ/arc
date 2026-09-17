#!/usr/bin/env python3
"""Compare every enabled function between Java and Ruby using a checked-in corpus."""
import decimal
import json
import math
import pathlib
import sys
import urllib.request
import urllib.error
from contract import graph


def execute(base, expression):
    body = json.dumps({"definition": graph(expression), "inputs": {}}).encode()
    request = urllib.request.Request(base + "/api/preview", data=body, headers={"Content-Type": "application/json"})
    try:
        response = urllib.request.urlopen(request, timeout=30)
    except urllib.error.HTTPError as e:
        response = e
    data = json.loads(response.read(), parse_float=decimal.Decimal)
    return response.status, data.get("result") if response.status == 200 else data.get("message")


def same(a, b, absolute_tolerance=1e-12):
    if isinstance(a, (int, float, decimal.Decimal)) and not isinstance(a, bool) and isinstance(b, (int, float, decimal.Decimal)) and not isinstance(b, bool):
        return a == b or math.isclose(float(a), float(b), rel_tol=1e-11, abs_tol=absolute_tolerance)
    if isinstance(a, list) and isinstance(b, list):
        return len(a) == len(b) and all(same(x, y, absolute_tolerance) for x, y in zip(a, b))
    return a == b


if __name__ == "__main__":
    java, ruby = sys.argv[1:3]
    cases = json.loads((pathlib.Path(__file__).resolve().parent.parent / "contracts/function-cases.json").read_text())
    failures = []
    for case in cases:
        expected, actual = execute(java, case["expression"]), execute(ruby, case["expression"])
        if expected[0] != actual[0] or not same(expected[1], actual[1], case.get("absoluteTolerance", 1e-12)):
            failures.append({**case, "java": str(expected), "ruby": str(actual)})
    for failure in failures:
        print(json.dumps(failure, ensure_ascii=False))
    print(f"{len(cases)-len(failures)}/{len(cases)} function cases agree; {len(failures)} differences")
    sys.exit(bool(failures))
