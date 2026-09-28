#!/usr/bin/env python3
"""Each rule of check_architecture.py against one-line probe files, plus the real tree.

Run from the repository root: python3 scripts/check_architecture_test.py
"""
from pathlib import Path
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import check_architecture as check  # noqa: E402

# RuleSamples.java as committed in 49bb365: node types and handles were plain strings.
OLD_RULE_SAMPLES = '''package dev.arc.rule;

import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.List;

public class RuleSamples {
  private static Node node(
      String id, String type, String label, double x, double y, String expression, String output) {
    return new Node(id, type, label, new Position(x, y), expression, output, null, null, null);
  }

  private static Edge edge(String source, String target, String branch) {
    return new Edge(source + "-" + branch + "-" + target, source, target, branch);
  }

  public static Definition blank(String kind) {
    if (kind.equals("RULE"))
      return new Definition(
          1,
          List.of(new Input("amount", "NUMBER", true, 100)),
          List.of(
              node("input", "INPUT", "Inputs", 300, 0, null, null),
              node("condition", "CONDITION", "Check amount", 300, 160, "amount >= 100", null),
              node("yes", "OUTPUT", "Eligible", 100, 340, "true", null),
              node("no", "OUTPUT", "Not eligible", 500, 340, "false", null)),
          List.of(
              edge("input", "condition", "next"),
              edge("condition", "yes", "true"),
              edge("condition", "no", "false")));
    return null;
  }
}
'''

# Every spelling of a kind or handle that only the model may use, one probe each.
REJECTED_JAVA = {
    "TypeEquals.java": 'boolean b = node.type().equals("INPUT");',
    "EqualsType.java": 'boolean b = "INPUT".equals(node.type());',
    "CaseLabel.java": 'switch (t) { case "SWITCH" -> 1; default -> 0; }',
    "KindTable.java": 'Set<String> kinds = Set.of("INPUT", "OUTPUT");',
    "KindAlternation.java": 'Pattern p = Pattern.compile("INPUT|FORMULA");',
    "HandleAlternation.java": 'Pattern p = Pattern.compile("(next|true|false)");',
    "CaseHandle.java": 'String handle = "case:" + id;',
    "CaseHandleWhole.java": 'String handle = "case:premium";',
    "KindComparison.java": 'boolean b = type == "OUTPUT";',
    "KindAsArgument.java": 'Node n = node("input", "INPUT", "Inputs");',
    "HandleEquals.java": 'boolean b = handle.equals("next");',
    "EqualsHandle.java": 'boolean b = "true".equals(branch);',
    "ObjectsEqualsHandle.java": 'boolean b = Objects.equals(handle, "default");',
    "HandleCase.java": 'switch (h) { case "false" -> 1; default -> 0; }',
    "HandleColonCase.java": 'switch (h) { case "false": break; }',
    "HandleSet.java": 'Set<String> h = Set.of("next", "true", "false");',
    "HandleMap.java": 'Map<String, Integer> h = Map.of("next", 1);',
    "HandleList.java": 'List<String> h = List.of("default");',
    "HandleOperand.java": 'boolean b = branch == "next";',
    "HandleNotEqual.java": 'boolean b = "next" != branch;',
    "HandleIgnoreCase.java": 'boolean b = h.equalsIgnoreCase("next");',
}

# Legitimate uses: the allowlisted literals, a message that merely contains a name, a handle passed
# as a plain argument, and a kind spelled in a comment.
ACCEPTED_JAVA = {
    "engine/expression/ExpressionRuntime.java": 'Map<String, Object> f = Map.of("SWITCH", x);',
    "engine/expression/BuiltinFunctionCatalog.java": 'add(specs, "SWITCH", 3, 255);',
    "engine/expression/ExpressionParser.java": 'boolean t = token.equalsIgnoreCase("true") || token.equalsIgnoreCase("false");',
    "engine/expression/DataFunctions.java": 'boolean t = text.equalsIgnoreCase("true");',
    "engine/Identifiers.java": 'Set<String> r = Set.of("true", "false", "null", "and", "or");',
    "engine/Message.java": 'String m = "Expected true or false, got " + value;',
    "engine/Argument.java": 'String s = statement("next", value);',
    "engine/Commented.java": '// a Switch case handle is "case:" + id; the "INPUT" node\n/* "next" == handle */ int x = 1;',
    "engine/Onward.java": 'String s = Handles.NEXT;',
}


def java_file(name, body):
    package = "dev.arc." + ".".join(Path(name).parts[:-1]) if len(Path(name).parts) > 1 else "dev.arc"
    return f"package {package};\n\nclass Probe {{\n  void probe() {{\n    {body}\n  }}\n}}\n"


class ProbeTree:
    """A temporary repository with dev/arc and frontend/src roots."""

    def __init__(self):
        self.directory = tempfile.TemporaryDirectory()
        root = Path(self.directory.name)
        self.java = root / "backend/src/main/java/dev/arc"
        self.frontend = root / "frontend/src"
        self.java.mkdir(parents=True)
        self.frontend.mkdir(parents=True)

    def add_java(self, relative, content):
        path = self.java / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def add_frontend(self, relative, content):
        path = self.frontend / relative
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(content)

    def close(self):
        self.directory.cleanup()


def java_violations_of(relative, content):
    tree = ProbeTree()
    try:
        tree.add_java(relative, content)
        return check.java_violations(tree.java)
    finally:
        tree.close()


def frontend_violations_of(relative, content):
    tree = ProbeTree()
    try:
        tree.add_frontend(relative, content)
        return check.frontend_violations(tree.frontend)
    finally:
        tree.close()


class NodeVocabularyTest(unittest.TestCase):
    def test_every_hand_written_kind_or_handle_spelling_is_rejected(self):
        for name, body in REJECTED_JAVA.items():
            with self.subTest(name):
                violations = java_violations_of("engine/" + name, java_file("engine/" + name, body))
                self.assertTrue(violations, name + " must be rejected")
                self.assertTrue(all(check.VOCABULARY_REASON in v for v in violations), violations)

    def test_legitimate_literals_pass(self):
        for name, body in ACCEPTED_JAVA.items():
            with self.subTest(name):
                self.assertEqual(java_violations_of(name, java_file(name, body)), [])

    def test_the_model_package_may_spell_its_own_vocabulary(self):
        body = 'Set<String> h = Set.of("next", "true", "false", "default"); String k = "INPUT";'
        self.assertEqual(java_violations_of("model/Handles.java", java_file("model/Handles.java", body)), [])

    def test_the_old_rule_samples_are_rejected(self):
        violations = java_violations_of("rule/RuleSamples.java", OLD_RULE_SAMPLES)
        self.assertTrue(violations, "string node types must be rejected")
        self.assertTrue(all(check.VOCABULARY_REASON in v for v in violations), violations)
        literals = {v.split(": ")[1] for v in violations}
        self.assertEqual(literals, {'"INPUT"', '"CONDITION"', '"OUTPUT"'})


class JavaPackageTest(unittest.TestCase):
    def test_an_unknown_package_is_rejected_even_when_it_imports_jdbc(self):
        content = "package dev.arc.extra;\n\nimport org.springframework.jdbc.core.JdbcTemplate;\n\nclass Thing {}\n"
        violations = java_violations_of("extra/Thing.java", content)
        self.assertEqual(len(violations), 1, violations)
        self.assertIn("unknown package", violations[0])

    def test_the_composition_root_is_exempt_but_no_other_root_class_is(self):
        content = "package dev.arc;\n\nimport org.springframework.jdbc.core.JdbcTemplate;\nimport dev.arc.persistence.JdbcRuleRepository;\n\nclass App {}\n"
        self.assertEqual(java_violations_of("ArcApplication.java", content), [])
        violations = java_violations_of("Other.java", content)
        self.assertEqual(len(violations), 1, violations)
        self.assertIn("unknown package", violations[0])

    def test_root_engine_contracts_cannot_depend_on_engine_features(self):
        importing_feature = "package dev.arc.engine;\n\nimport dev.arc.engine.execution.Engine;\n\nclass Root {}\n"
        violations = java_violations_of("engine/Root.java", importing_feature)
        self.assertEqual(len(violations), 1, violations)
        self.assertIn("root engine contracts cannot depend on engine.execution", violations[0])
        importing_contracts = (
            "package dev.arc.engine;\n\nimport dev.arc.engine.Limits;\nimport dev.arc.model.Definition;\n"
            "import dev.arc.error.ArcException;\n\nclass Root {}\n"
        )
        self.assertEqual(java_violations_of("engine/Root.java", importing_contracts), [])

    def test_engine_features_import_only_their_listed_dependencies(self):
        content = "package dev.arc.engine.graph;\n\nimport dev.arc.engine.expression.Expressions;\n\nclass Plan {}\n"
        violations = java_violations_of("engine/graph/Plan.java", content)
        self.assertEqual(len(violations), 1, violations)
        self.assertIn("engine.graph cannot depend on engine.expression", violations[0])

    def test_layer_sql_and_repository_rules(self):
        cases = {
            "model/Bad.java": ("package dev.arc.model;\n\nimport org.springframework.stereotype.Component;\n\nclass Bad {}\n", "frameworks"),
            "engine/Bad.java": ("package dev.arc.engine;\n\nimport dev.arc.rule.RuleService;\n\nclass Bad {}\n", "engine cannot depend on rule"),
            "rule/Bad.java": ("package dev.arc.rule;\n\nimport java.sql.ResultSet;\n\nclass Bad {}\n", "SQL access belongs in persistence"),
            "api/Bad.java": ("package dev.arc.api;\n\nimport dev.arc.rule.RuleRepository;\n\nclass Bad {}\n", "controllers must call application services"),
            "source/http/Bad.java": ("package dev.arc.source.http;\n\nimport dev.arc.source.SourceService;\n\nclass Bad {}\n", "source providers depend on their contract"),
            "engine/Locale.java": ("package dev.arc.engine;\n\nclass L { String s = \"x\".toLowerCase(); }\n", "Locale.ROOT"),
        }
        for name, (content, reason) in cases.items():
            with self.subTest(name):
                violations = java_violations_of(name, content)
                self.assertEqual(len(violations), 1, violations)
                self.assertIn(reason, violations[0])


class FrontendTest(unittest.TestCase):
    def test_template_literal_and_glob_imports_are_rejected_in_pure_modules(self):
        rejected = {
            "domain/lazy.ts": 'export const load = (name: string) => import(`./${name}`);',
            "domain/glob.ts": 'export const modules = import.meta.glob("./*.ts");',
            "domain/variable.ts": 'export const load = (path: string) => import(path);',
            "api/lazy.ts": 'export const load = (name: string) => import(`./${name}`);',
            "components/lazy.tsx": 'export const load = (name: string) => import(`../features/${name}`);',
        }
        for name, content in rejected.items():
            with self.subTest(name):
                violations = frontend_violations_of(name, content)
                self.assertEqual(len(violations), 1, violations)
                self.assertIn("import", violations[0])

    def test_literal_dynamic_imports_follow_the_static_rules(self):
        tree = ProbeTree()
        try:
            tree.add_frontend("domain/other.ts", "export const x = 1;\n")
            tree.add_frontend("domain/quoted.ts", 'export const load = () => import("./other");\n')
            tree.add_frontend("domain/template.ts", "export const load = () => import(`./other`);\n")
            tree.add_frontend("features/editor/Editor.tsx", 'const Studio = lazy(() => import("../studio/CodeStudio"));\n')
            self.assertEqual(check.frontend_violations(tree.frontend), [])
            tree.add_frontend("domain/ui.ts", 'export const load = () => import("../features/editor/Editor");\n')
            violations = check.frontend_violations(tree.frontend)
            self.assertEqual(len(violations), 1, violations)
            self.assertIn("domain/transport boundary", violations[0])
        finally:
            tree.close()

    def test_static_import_rules(self):
        cases = {
            "domain/react.ts": ('import { useState } from "react";\n', "UI libraries"),
            "api/graph.ts": ('import { graph } from "../domain/graph";\n', "domain/transport boundary"),
            "components/Button.tsx": ('import { useRuleDocument } from "../features/editor/useRuleDocument";\n', "shared controls"),
        }
        for name, (content, reason) in cases.items():
            with self.subTest(name):
                violations = frontend_violations_of(name, content)
                self.assertEqual(len(violations), 1, violations)
                self.assertIn(reason, violations[0])


class FrontendHandleTest(unittest.TestCase):
    def test_handle_literals_are_rejected_outside_the_port_owner(self):
        rejected = {
            "features/editor/canvas/edges.ts": 'const fallback = edge.sourceHandle === "false";\n',
            "domain/switches.ts": 'const taken = edges.filter((e) => e.sourceHandle !== "default");\n',
            "features/editor/inspector/Return.tsx": 'const edge = { sourceHandle: "next", target };\n',
            "domain/cases.ts": 'const id = "case:" + option.id;\n',
            "domain/template.ts": 'const id = `case:${option.id}`;\n',
        }
        for name, content in rejected.items():
            with self.subTest(name):
                violations = frontend_violations_of(name, content)
                self.assertEqual(len(violations), 1, violations)
                self.assertIn("domain/nodePorts", violations[0])

    def test_the_port_owner_and_port_reads_pass(self):
        accepted = {
            "domain/nodePorts.ts": 'export const handles = { next: "next", false: "false", default: "default" } as const;\nexport const caseHandle = (id: string) => `case:${id}`;\n',
            "features/editor/canvas/edges.ts": 'import { handles } from "../../../domain/nodePorts";\nconst fallback = edge.sourceHandle === handles.false;\n',
        }
        for name, content in accepted.items():
            with self.subTest(name):
                self.assertEqual(frontend_violations_of(name, content), [])


class CurrentTreeTest(unittest.TestCase):
    def test_the_repository_has_no_violations(self):
        self.assertEqual(check.java_violations(check.JAVA), [])
        self.assertEqual(check.frontend_violations(check.FRONTEND), [])


if __name__ == "__main__":
    unittest.main()
