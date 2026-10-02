#!/usr/bin/env python3
"""Guard module boundaries without adding a runtime/build dependency.

This checks declared imports and string literals, not runtime reflection or fully qualified
calls. Behavioral tests and code review remain necessary. `check_architecture_test.py` runs every
rule against probe files; `main` runs them against the repository.
"""
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[1]
JAVA = ROOT / "backend/src/main/java/dev/arc"
FRONTEND = ROOT / "frontend/src"
# The Spring composition root is the one class outside the packages below.
COMPOSITION_ROOT = "ArcApplication.java"
ALLOWED_JAVA = {
    "model": {"model"},
    "error": {"error"},
    "engine": {"engine", "model", "error"},
    "source": {"source", "engine", "model", "error"},
    "rule": {"rule", "source", "engine", "model", "error"},
    "persistence": {"persistence", "rule", "source", "engine", "model", "error"},
    "api": {"api", "rule", "source", "engine", "model", "error"},
}
# Engine features import their own package, the listed siblings and root contracts. A root engine
# class (dev.arc.engine.X) is a shared contract: it imports other root contracts, model and error,
# never a feature package.
ENGINE_DEPENDENCIES = {
    "expression": {"expression", "Identifiers", "ExecutionDeadline", "Limits", "ValueText", "ValueBounds"},
    "graph": {"graph"},
    "validation": {"validation", "graph", "expression", "Identifiers", "InputTypes", "RuleResolver", "Limits"},
    "script": {"script", "expression", "validation", "Identifiers", "InputTypes", "Limits"},
    "execution": {"execution", "graph", "validation", "expression", "Identifiers", "InputTypes", "RuleResolver", "SourceReader", "ExecutionDeadline", "Limits", "BoundedCache"},
}
ENGINE_FEATURES = set(ENGINE_DEPENDENCIES)
# Node kinds and connection handles have one vocabulary: dev.arc.model.NodeKind and Handles. Outside
# dev.arc.model no literal may spell a kind, a case handle or a regex alternation of them, and a
# handle literal may not be compared or collected. The allowlist names each legitimate literal.
NODE_KINDS = ("INPUT", "FORMULA", "CONDITION", "SWITCH", "TRANSFORM", "REFERENCE", "OUTPUT")
HANDLES = ("next", "true", "false", "default")
CASE_HANDLE_PREFIX = "case:"
NODE_VOCABULARY_ALLOWED = {
    ("engine/expression/ExpressionRuntime.java", "SWITCH"): "the $SWITCH expression function",
    ("engine/expression/BuiltinFunctionCatalog.java", "SWITCH"): "the $SWITCH expression function",
    ("engine/expression/ExpressionParser.java", "true"): "the boolean literal of the expression language",
    ("engine/expression/ExpressionParser.java", "false"): "the boolean literal of the expression language",
    ("engine/expression/DataFunctions.java", "true"): "$TO_BOOLEAN reads a boolean's text",
    ("engine/expression/DataFunctions.java", "false"): "$TO_BOOLEAN reads a boolean's text",
    ("engine/Identifiers.java", "true"): "a reserved word of the expression language",
    ("engine/Identifiers.java", "false"): "a reserved word of the expression language",
}
VOCABULARY_REASON = "use NodeKind (Node.kind(), exhaustive switches) and Handles instead of node-type or handle strings"
COMMENTS = re.compile(r"//[^\n]*|/\*.*?\*/", re.S)
STRING_LITERAL = re.compile(r'"((?:[^"\\\n]|\\.)*)"')
KIND_ALTERNATION = re.compile(r"(?:%s)\|(?:%s)" % ("|".join(NODE_KINDS), "|".join(NODE_KINDS)))
HANDLE_ALTERNATION = re.compile(r"next\|true\|false")
# Case conversion must name a Locale: the JVM default is host state ("STRING" is "strıng" under tr).
DEFAULT_LOCALE_CASE = re.compile(r"\.to(?:Lower|Upper)Case\(\)")
IMPORT = re.compile(r"^import\s+(?:static\s+)?([\w.*]+);", re.M)

PURE_FRONTEND = {
    "domain/": ("types", "domain/"),
    "app/routing.ts": (),
    "app/pinnedReads.ts": (),
    "features/editor/documentState.ts": ("types", "domain/"),
    "features/editor/editorCapabilities.ts": (),
    "features/editor/nodeFormDraft.ts": ("types", "domain/"),
    "features/editor/nodeSelection.ts": ("types", "domain/"),
    "features/library/previewCache.ts": ("types", "domain/"),
    "features/library/previewLayout.ts": ("types", "domain/"),
    "features/library/libraryOrder.ts": ("types",),
    "features/sources/sourceProviders.ts": ("types", "domain/"),
    "features/sources/model.ts": ("types", "domain/", "features/sources/sourceProviders"),
    "features/sources/sourceDocument.ts": ("types", "domain/", "features/sources/model", "features/sources/sourceProviders"),
    "features/sources/sourceBindings.ts": ("types", "domain/"),
    "features/sources/sourceCatalog.ts": ("types",),
    "features/execution/publishedSelection.ts": ("types", "domain/"),
    "features/execution/executionOptions.ts": (),
    "features/studio/snippets.ts": ("types", "domain/"),
    "features/studio/formulaCalls.ts": ("types", "domain/", "features/studio/snippets"),
    "features/studio/definitionJson.ts": ("types", "domain/"),
    "features/studio/scriptOutline.ts": (),
    "features/studio/cssColor.ts": (),
    "features/editor/canvas/edgeRouting.ts": (),
    "features/editor/canvas/graphGeometry.ts": ("types", "domain/"),
}
# HTTP clients may use the lossless JSON codec, but no other domain logic.
TRANSPORT_FRONTEND = ("types", "api/", "domain/json")
STATIC_IMPORT = re.compile(r'''(?:\bfrom\s+|\bimport\s+)["']([^"']+)["']''')
# import("./x"), import(`./x`) or import(anything else); only the first two name a module.
DYNAMIC_IMPORT = re.compile(r'''\bimport\s*\(\s*(?:(["'])([^"'`]+)\1|`([^`]*)`|([^)]*))\s*\)''')
IMPORT_META_GLOB = re.compile(r"\bimport\.meta\.glob\b")
# Connection handles have one frontend owner, domain/nodePorts.ts (`handles`, `sourcePort`,
# `sourcePort`): no other file compares or writes a handle literal, or builds a case handle.
FRONTEND_HANDLE_OWNER = "domain/nodePorts.ts"
FRONTEND_HANDLE_LITERAL = re.compile(
    r"""sourceHandle\s*(?:===|!==|:)\s*["'](?:%s)["']|["'`]case:(?:["']|\$\{)""" % "|".join(HANDLES)
)
FRONTEND_HANDLE_REASON = "use handles/sourcePort from domain/nodePorts instead of handle strings"


def handle_contexts(handle):
    """Where a handle literal decides behavior: comparisons, case labels and collections."""
    quoted = re.escape('"' + handle + '"')
    return [
        re.compile(r"\.equals(?:IgnoreCase)?\(\s*" + quoted),
        re.compile(quoted + r"\s*\.equals(?:IgnoreCase)?\("),
        re.compile(r"Objects\.equals\([^;]*?" + quoted),
        re.compile(r"[=!]=\s*" + quoted),
        re.compile(quoted + r"\s*[=!]="),
        re.compile(r"\bcase\s+" + quoted + r"\s*(?:->|:)"),
        re.compile(r"\b(?:Set|Map|List)\.of\((?:[^()]|\([^()]*\))*?" + quoted),
    ]


HANDLE_CONTEXTS = {handle: handle_contexts(handle) for handle in HANDLES}


def hand_written_vocabulary(relative, source):
    """The node-kind and handle literals a Java file spells outside dev.arc.model."""
    found = []
    stripped = COMMENTS.sub("", source)
    seen = set()
    for match in STRING_LITERAL.finditer(stripped):
        literal = match.group(1)
        if literal in seen:
            continue
        if literal in NODE_KINDS or literal.startswith(CASE_HANDLE_PREFIX):
            if (relative, literal) not in NODE_VOCABULARY_ALLOWED:
                found.append('"%s"' % literal)
        elif KIND_ALTERNATION.search(literal) or HANDLE_ALTERNATION.search(literal):
            found.append('"%s"' % literal)
        elif literal in HANDLES and (relative, literal) not in NODE_VOCABULARY_ALLOWED:
            if any(context.search(stripped) for context in HANDLE_CONTEXTS[literal]):
                found.append('"%s"' % literal)
        seen.add(literal)
    return found


def java_violations(java_root):
    """Boundary violations under a dev/arc source root, as 'path: dependency: reason' lines."""
    java_root = java_root.resolve()
    violations = []

    def reject(path, dependency, reason):
        violations.append(f"{path.relative_to(java_root.parents[4])}: {dependency}: {reason}")

    for path in sorted(java_root.rglob("*.java")):
        relative = path.relative_to(java_root)
        parts = relative.parts
        module = parts[0]
        if len(parts) == 1 and module == COMPOSITION_ROOT:
            continue  # Spring application composition root.
        if module not in ALLOWED_JAVA:
            reject(path, module, "unknown package: add it to ALLOWED_JAVA and the backend table in maintaining.md")
            continue
        source = path.read_text()
        if module != "model":
            for literal in hand_written_vocabulary(relative.as_posix(), source):
                reject(path, literal, VOCABULARY_REASON)
        if DEFAULT_LOCALE_CASE.search(source):
            reject(path, DEFAULT_LOCALE_CASE.search(source).group(0),
                   "pass a Locale (Locale.ROOT) to case conversion; the JVM default locale is host state")
        for dependency in IMPORT.findall(source):
            if dependency.startswith("dev.arc."):
                target = dependency.split(".")[2]
                if target not in ALLOWED_JAVA[module]:
                    reject(path, dependency, f"{module} cannot depend on {target}")
            if module == "engine" and dependency.startswith("dev.arc.engine."):
                target = dependency.split(".")[3]
                if len(parts) > 2:
                    owner = parts[1]
                    if target not in ENGINE_DEPENDENCIES.get(owner, {owner}):
                        reject(path, dependency, f"engine.{owner} cannot depend on engine.{target}")
                elif target in ENGINE_FEATURES:
                    reject(path, dependency, f"root engine contracts cannot depend on engine.{target}")
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
    return violations


def matches_boundary(path, boundary):
    return path.startswith(boundary) if boundary.endswith("/") else path == boundary


def frontend_imports(source):
    """Every module specifier a file imports, and the dynamic imports that name no literal module."""
    specifiers = STATIC_IMPORT.findall(source)
    unresolvable = []
    for match in DYNAMIC_IMPORT.finditer(source):
        quoted, template, other = match.group(2), match.group(3), match.group(4)
        if quoted is not None:
            specifiers.append(quoted)
        elif template is not None and "${" not in template:
            specifiers.append(template)
        else:
            unresolvable.append(match.group(0))
    return specifiers, unresolvable


def frontend_violations(frontend_root):
    """Boundary violations under a frontend src root, as 'path: dependency: reason' lines."""
    frontend_root = frontend_root.resolve()
    violations = []

    def reject(path, dependency, reason):
        violations.append(f"{path.relative_to(frontend_root.parents[1])}: {dependency}: {reason}")

    for path in sorted(frontend_root.rglob("*.ts*")):
        relative = path.relative_to(frontend_root).as_posix()
        if relative != FRONTEND_HANDLE_OWNER:
            for literal in FRONTEND_HANDLE_LITERAL.findall(path.read_text()):
                reject(path, literal, FRONTEND_HANDLE_REASON)
        pure_imports = next((
            allowed for owner, allowed in PURE_FRONTEND.items()
            if matches_boundary(relative, owner)
        ), None)
        pure = pure_imports is not None
        transport = relative.startswith("api/")
        shared_ui = relative.startswith("components/")
        if not (pure or transport or shared_ui):
            continue
        source = path.read_text()
        imports, unresolvable = frontend_imports(source)
        for dynamic in unresolvable:
            reject(path, dynamic, "a dynamic import must name one module literally, so its boundary can be checked")
        for glob in IMPORT_META_GLOB.findall(source):
            reject(path, glob, "import.meta.glob imports modules the boundary check cannot see")
        for dependency in imports:
            if shared_ui:
                if dependency.startswith("."):
                    target = (path.parent / dependency).resolve().relative_to(frontend_root).as_posix()
                    if target.startswith(("features/", "app/", "api/")):
                        reject(path, dependency, "shared controls cannot depend on feature or application orchestration")
                continue
            if not dependency.startswith("."):
                reject(path, dependency, "pure domain and HTTP modules cannot import UI libraries")
                continue
            target = (path.parent / dependency).resolve().relative_to(frontend_root).as_posix()
            allowed_targets = pure_imports if pure else TRANSPORT_FRONTEND
            allowed = any(
                matches_boundary(target, owner)
                for owner in allowed_targets
            )
            if not allowed:
                reject(path, dependency, "dependency crosses the domain/transport boundary")
    return violations


def main():
    errors = java_violations(JAVA) + frontend_violations(FRONTEND)
    if errors:
        print("Architecture boundary violations:\n" + "\n".join(errors), file=sys.stderr)
        sys.exit(1)
    print("Architecture boundaries passed (Java packages, node vocabulary, pure frontend state, HTTP clients, shared controls).")


if __name__ == "__main__":
    main()
