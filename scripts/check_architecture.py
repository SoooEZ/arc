#!/usr/bin/env python3
"""Guard module import boundaries without adding a runtime/build dependency.

This checks declared imports, not runtime reflection or fully qualified calls.
Behavioral tests and code review remain necessary.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
JAVA = ROOT / "backend/src/main/java/dev/arc"
FRONTEND = ROOT / "frontend/src"
ALLOWED_JAVA = {
    "model": {"model"},
    "error": {"error"},
    "engine": {"engine", "model", "error"},
    "source": {"source", "engine", "model", "error"},
    "rule": {"rule", "source", "engine", "model", "error"},
    "persistence": {"persistence", "rule", "source", "engine", "model", "error"},
    "api": {"api", "rule", "source", "engine", "model", "error"},
}
errors = []


def reject(path, dependency, reason):
    errors.append(f"{path.relative_to(ROOT)}: {dependency}: {reason}")


for path in sorted(JAVA.rglob("*.java")):
    module = path.relative_to(JAVA).parts[0]
    if module not in ALLOWED_JAVA:
        continue  # Spring application composition root.
    imports = re.findall(r"^import\s+(?:static\s+)?([\w.*]+);", path.read_text(), re.M)
    for dependency in imports:
        if dependency.startswith("dev.arc."):
            target = dependency.split(".")[2]
            if target not in ALLOWED_JAVA[module]:
                reject(path, dependency, f"{module} cannot depend on {target}")
        if module != "persistence" and dependency.startswith(("java.sql.", "org.springframework.jdbc.")):
            reject(path, dependency, "SQL access belongs in persistence")
        if module in {"model", "error"} and not dependency.startswith(("java.", "dev.arc.")):
            reject(path, dependency, "portable models/errors cannot depend on frameworks")
        if module == "api" and "Repository" in dependency:
            reject(path, dependency, "controllers must call application services")


for path in sorted(FRONTEND.rglob("*.ts*")):
    relative = path.relative_to(FRONTEND).as_posix()
    pure = relative.startswith("domain/") or relative == "features/editor/documentState.ts"
    transport = relative.startswith("api/")
    if not (pure or transport):
        continue
    imports = re.findall(r'''(?:from\s+|import\s*\(?\s*)["']([^"']+)["']''', path.read_text())
    for dependency in imports:
        if not dependency.startswith("."):
            reject(path, dependency, "pure domain and HTTP modules cannot import UI libraries")
            continue
        target = (path.parent / dependency).resolve().relative_to(FRONTEND).as_posix()
        allowed = (target == "types" or target.startswith("domain/")) if pure else (
            target == "types" or target.startswith("api/")
        )
        if not allowed:
            reject(path, dependency, "dependency crosses the domain/transport boundary")

if errors:
    print("Architecture boundary violations:\n" + "\n".join(errors), file=sys.stderr)
    sys.exit(1)
print("Architecture boundaries passed (Java packages, pure frontend state, HTTP clients).")
