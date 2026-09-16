package dev.arc.engine;

import dev.arc.api.ArcException;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import dev.arc.store.Samples;
import java.util.*;
import org.junit.jupiter.api.Test;
import static dev.arc.engine.EngineTest.*;
import static org.assertj.core.api.Assertions.*;

class ValidatorTest {
    private final Validator validator = new Validator();
    private final RuleResolver resolver = (id, version) -> { throw new ArcException(404, "Published version not found"); };
    @Test void templatesAreValid() {
        for (String kind : List.of("FORMULA", "RULE", "DECISION_TREE")) validator.validate(Samples.blank(kind), resolver);
    }
    @Test void incompleteDraftsCanBeSavedButNotPublished() {
        var d = new Definition(1, List.of(), List.of(node("input", "INPUT", null, null)), List.of());
        validator.shape(d);
        assertThatThrownBy(() -> validator.validate(d, resolver)).hasMessageContaining("connect");
    }
    @Test void cyclesAndDisconnectedNodesAreRejected() {
        var d = new Definition(1, List.of(), List.of(node("input", "INPUT", null, null), node("loop", "FORMULA", "1", "x")), List.of(edge("input", "loop", "next"), edge("loop", "loop", "next")));
        assertThatThrownBy(() -> validator.validate(d, resolver)).hasMessageContaining("cycles");
        var base = Samples.blank("FORMULA"); var nodes = new ArrayList<>(base.nodes()); nodes.add(node("orphan", "OUTPUT", "0", null));
        assertThatThrownBy(() -> validator.validate(new Definition(1, base.inputs(), nodes, base.edges()), resolver)).hasMessageContaining("reachable");
    }
    @Test void variablesMustExistOnEveryIncomingPath() {
        var d = new Definition(1, List.of(), List.of(node("input", "INPUT", null, null), node("test", "CONDITION", "true", null), node("calculation", "FORMULA", "10", "x"), node("result", "OUTPUT", "x", null)), List.of(edge("input", "test", "next"), edge("test", "calculation", "true"), edge("test", "result", "false"), edge("calculation", "result", "next")));
        assertThatThrownBy(() -> validator.validate(d, resolver)).hasMessageContaining("unavailable on every incoming path: x");
    }
    @Test void bothBranchesMayAssignTheSameResult() {
        var d = new Definition(1, List.of(), List.of(node("input", "INPUT", null, null), node("test", "CONDITION", "true", null), node("a", "FORMULA", "10", "x"), node("b", "FORMULA", "20", "x"), node("result", "OUTPUT", "x", null)), List.of(edge("input", "test", "next"), edge("test", "a", "true"), edge("test", "b", "false"), edge("a", "result", "next"), edge("b", "result", "next")));
        assertThatCode(() -> validator.validate(d, resolver)).doesNotThrowAnyException();
    }
    @Test void duplicateAndInvalidInputsAreRejected() {
        var base = Samples.blank("FORMULA");
        assertThatThrownBy(() -> validator.shape(new Definition(1, List.of(new Input("true", "NUMBER", true, null)), base.nodes(), base.edges()))).hasMessageContaining("identifiers");
        assertThatThrownBy(() -> validator.shape(new Definition(1, List.of(new Input("amount", "NUMBER", true, "bad")), base.nodes(), base.edges()))).hasMessageContaining("must be number");
        assertThatThrownBy(() -> validator.shape(new Definition(2, base.inputs(), base.nodes(), base.edges()))).hasMessageContaining("schemaVersion");
    }
    @Test void referencesMustExistAndBindRequiredInputs() {
        var ref = new Node("reuse", "REFERENCE", "reuse", new Position(0, 0), null, "value", "missing", 1, Map.of());
        var d = new Definition(1, List.of(), List.of(node("input", "INPUT", null, null), ref, node("out", "OUTPUT", "value", null)), List.of(edge("input", "reuse", "next"), edge("reuse", "out", "next")));
        assertThatThrownBy(() -> validator.validate(d, resolver)).hasMessageContaining("not found");
        var child = new Definition(1, List.of(new Input("amount", "NUMBER", true, null)), Samples.blank("FORMULA").nodes(), Samples.blank("FORMULA").edges());
        assertThatThrownBy(() -> validator.validate(d, (id, v) -> child)).hasMessageContaining("missing binding for amount");
    }
}
