package dev.arc.engine.expression;

import static org.assertj.core.api.Assertions.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.script.ArcScript;
import dev.arc.engine.validation.Validator;
import dev.arc.error.ArcException;
import dev.arc.model.Definition;
import java.math.BigDecimal;
import java.util.*;
import org.junit.jupiter.api.Test;

/** A direct {@code @id:version} call receives exactly what a Reference node stores. */
class FormulaCallParityTest {
  private final Validator validator = new Validator();
  private final ArcScript script = new ArcScript(new ObjectMapper(), validator);
  private final Engine engine = new Engine(validator);

  private RuleResolver publishing(Definition child) {
    return new RuleResolver() {
      @Override
      public Definition resolve(String id, int version) {
        if (id.equals("child") && version == 1) return child;
        throw new ArcException(404, "Missing published rule");
      }

      @Override
      public Definition resolveFormula(String id, int version) {
        return resolve(id, version);
      }
    };
  }

  private Object run(Definition parent, Definition child, Map<String, Object> inputs) {
    return engine.execute("parent", 1, parent, inputs, publishing(child)).result();
  }

  private Definition referenceParent(String inputs, String bindings, String result) {
    return script.parse(
        inputs
            + " node input INPUT \"Input\" { next -> bundle; }"
            + " node bundle REFERENCE \"Bundle\" { use \"child\" version 1; "
            + bindings
            + " as bundle; next -> out; }"
            + " node out OUTPUT \"Out\" { return "
            + result
            + "; }");
  }

  private Definition callingParent(String inputs, String result) {
    return script.parse(
        inputs
            + " node input INPUT \"Input\" { next -> out; }"
            + " node out OUTPUT \"Out\" { return "
            + result
            + "; }");
  }

  @Test
  void aDeepMultiOutputAggregateReachesBothCallers() {
    // The child of OutputAggregationTest: its aggregate is one level deeper than a value may be.
    String nested = "1";
    for (int depth = 0; depth < 8; depth++) nested = "[" + nested + "]";
    var child =
        script.parse(
            "node input INPUT \"Input\" { next -> deep; next -> other; }"
                + " node deep OUTPUT \"Deep\" { return "
                + nested
                + "; as nested; }"
                + " node other OUTPUT \"Other\" { return null; }");
    Object viaReference = run(referenceParent("", "", "$COUNT(bundle.nested)"), child, Map.of());
    Object viaCall =
        run(callingParent("", "$COUNT($GET(@child:1(), \"nested\"))"), child, Map.of());
    assertThat(viaReference).isEqualTo(BigDecimal.ONE);
    assertThat(viaCall).isEqualTo(viaReference);
  }

  @Test
  void aLargeMultiOutputAggregateReachesBothCallers() {
    // Eleven Outputs of a 1,000-item array: 11,000 elements, more than one value may hold.
    var child = new StringBuilder("inputs { items: ARRAY required; } node input INPUT \"Input\" {");
    for (int field = 0; field <= 10; field++) child.append(" next -> o").append(field).append(';');
    child.append(" }");
    for (int field = 0; field <= 10; field++)
      child
          .append(" node o")
          .append(field)
          .append(" OUTPUT \"O")
          .append(field)
          .append("\" { return items; as f")
          .append(field)
          .append("; }");
    var items = new ArrayList<Object>();
    for (int i = 0; i < 1000; i++) items.add(BigDecimal.valueOf(i));
    var inputs = Map.<String, Object>of("items", items);
    String declared = "inputs { items: ARRAY required; }";
    Definition published = script.parse(child.toString());
    Object viaReference =
        run(
            referenceParent(declared, "bind items = items;", "$COUNT(bundle.f10)"),
            published,
            inputs);
    Object viaCall =
        run(callingParent(declared, "$COUNT($GET(@child:1(items), \"f10\"))"), published, inputs);
    assertThat(viaReference).isEqualTo(new BigDecimal("1000"));
    assertThat(viaCall).isEqualTo(viaReference);
    // Returning the whole aggregate is still bounded where the caller's Output produces it.
    assertThatThrownBy(() -> run(callingParent(declared, "@child:1(items)"), published, inputs))
        .hasMessageContaining("collection depth or size limit");
  }
}
