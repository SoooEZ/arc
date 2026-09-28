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
ENGINE_DEPENDENCIES = {
    "expression": {"expression", "Identifiers", "ExecutionDeadline", "Limits", "ValueText"},
    "graph": {"graph"},
    "validation": {"validation", "graph", "expression", "Identifiers", "InputTypes", "RuleResolver", "Limits"},
    "script": {"script", "expression", "validation", "Identifiers", "InputTypes", "Limits"},
    "execution": {"execution", "graph", "validation", "expression", "Identifiers", "InputTypes", "RuleResolver", "SourceReader", "ExecutionDeadline", "Limits"},
}
# Node kinds and connection handles have one vocabulary: dev.arc.model.NodeKind and Handles.
NODE_KINDS = "(?:INPUT|FORMULA|CONDITION|SWITCH|TRANSFORM|REFERENCE|OUTPUT)"
HAND_WRITTEN_NODE_VOCABULARY = re.compile(
    r'\.type\(\)\s*\.equals\(\s*"' + NODE_KINDS + '"'  # node.type().equals("INPUT")
    + r'|"' + NODE_KINDS + r'"\s*\.equals\(\s*[\w.]*\.type\(\)'  # "INPUT".equals(node.type())
    + r'|case\s+"' + NODE_KINDS + r'"\s*->'  # a string switch over node types
    + r'|"' + NODE_KINDS + r'"\s*,\s*"' + NODE_KINDS + '"'  # a hand-written table of kinds
    + r'|' + NODE_KINDS + r'\|' + NODE_KINDS  # a hand-written regex alternation of kinds
    + r'|next\|true\|false'  # a hand-written regex alternation of handles
    + r'|"case:"'  # a hand-built Switch case handle
)
PURE_FRONTEND = {
    "domain/": ("types", "domain/"),
    "app/routing.ts": (),
    "features/editor/documentState.ts": ("types", "domain/"),
    "features/editor/editorCapabilities.ts": (),
    "features/editor/nodeSelection.ts": ("types", "domain/"),
    "features/library/previewCache.ts": ("types", "domain/"),
    "features/sources/model.ts": ("types", "domain/"),
    "features/sources/sourceDocument.ts": ("types", "domain/", "features/sources/model"),
    "features/sources/sourceBindings.ts": ("types", "domain/"),
    "features/sources/sourceCatalog.ts": ("types",),
    "features/execution/publishedSelection.ts": ("types", "domain/"),
    "features/studio/snippets.ts": ("types", "domain/"),
    "features/studio/formulaCalls.ts": ("types", "domain/", "features/studio/snippets"),
    "features/studio/scriptOutline.ts": (),
    "features/editor/canvas/edgeRouting.ts": (),
    "features/editor/canvas/graphGeometry.ts": ("domain/",),
}
# HTTP clients may use the lossless JSON codec, but no other domain logic.
TRANSPORT_FRONTEND = ("types", "api/", "domain/json")
errors = []


def reject(path, dependency, reason):
    errors.append(f"{path.relative_to(ROOT)}: {dependency}: {reason}")


def matches_boundary(path, boundary):
    return path.startswith(boundary) if boundary.endswith("/") else path == boundary


for path in sorted(JAVA.rglob("*.java")):
    parts = path.relative_to(JAVA).parts
    module = parts[0]
    if module not in ALLOWED_JAVA:
        continue  # Spring application composition root.
    source = path.read_text()
    if module != "model" and HAND_WRITTEN_NODE_VOCABULARY.search(source):
        reject(path, HAND_WRITTEN_NODE_VOCABULARY.search(source).group(0),
               "use NodeKind (Node.kind(), exhaustive switches) and Handles instead of node-type or handle strings")
    imports = re.findall(r"^import\s+(?:static\s+)?([\w.*]+);", source, re.M)
    for dependency in imports:
        if dependency.startswith("dev.arc."):
            target = dependency.split(".")[2]
            if target not in ALLOWED_JAVA[module]:
                reject(path, dependency, f"{module} cannot depend on {target}")
        if module == "engine" and len(parts) > 2 and dependency.startswith("dev.arc.engine."):
            owner = parts[1]
            target = dependency.split(".")[3]
            if target not in ENGINE_DEPENDENCIES.get(owner, {owner}):
                reject(path, dependency, f"engine.{owner} cannot depend on engine.{target}")
        if module == "source" and len(parts) > 2 and dependency.startswith("dev.arc.source."):
            owner = parts[1]
            target = dependency.split(".")[3]
            if target not in {owner, "SourceAdapter"}:
                reject(path, dependency, "source providers depend on their contract, not application orchestration")
        if module != "persistence" and dependency.startswith(("java.sql.", "org.springframework.jdbc.")):
            reject(path, dependency, "SQL access belongs in persistence")
        if module in {"model", "error"} and not dependency.startswith(("java.", "dev.arc.")):
            reject(path, dependency, "portable models/errors cannot depend on frameworks")
        if module == "api" and "Repository" in dependency:
            reject(path, dependency, "controllers must call application services")


for path in sorted(FRONTEND.rglob("*.ts*")):
    relative = path.relative_to(FRONTEND).as_posix()
    pure_imports = next((
        allowed for owner, allowed in PURE_FRONTEND.items()
        if matches_boundary(relative, owner)
    ), None)
    pure = pure_imports is not None
    transport = relative.startswith("api/")
    shared_ui = relative.startswith("components/")
    if not (pure or transport or shared_ui):
        continue
    imports = re.findall(r'''(?:from\s+|import\s*\(?\s*)["']([^"']+)["']''', path.read_text())
    for dependency in imports:
        if shared_ui:
            if dependency.startswith("."):
                target = (path.parent / dependency).resolve().relative_to(FRONTEND).as_posix()
                if target.startswith(("features/", "app/", "api/")):
                    reject(path, dependency, "shared controls cannot depend on feature or application orchestration")
            continue
        if not dependency.startswith("."):
            reject(path, dependency, "pure domain and HTTP modules cannot import UI libraries")
            continue
        target = (path.parent / dependency).resolve().relative_to(FRONTEND).as_posix()
        allowed_targets = pure_imports if pure else TRANSPORT_FRONTEND
        allowed = any(
            matches_boundary(target, owner)
            for owner in allowed_targets
        )
        if not allowed:
            reject(path, dependency, "dependency crosses the domain/transport boundary")

if errors:
    print("Architecture boundary violations:\n" + "\n".join(errors), file=sys.stderr)
    sys.exit(1)
print("Architecture boundaries passed (Java packages, pure frontend state, HTTP clients, shared controls).")
