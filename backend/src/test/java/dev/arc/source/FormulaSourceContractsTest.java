package dev.arc.source;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

import dev.arc.engine.RuleResolver;
import dev.arc.error.ArcException;
import dev.arc.model.*;
import dev.arc.model.Definition.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class FormulaSourceContractsTest {
  private Definition graph(List<Input> inputs, String expression) {
    return new Definition(
        1,
        inputs,
        List.of(
            new Node("in", "INPUT", "Input", null, null, null, null, null, null),
            new Node("out", "OUTPUT", "Output", null, expression, null, null, null, null)),
        List.of(new Edge("next", "in", "out", "next")));
  }

  @Test
  void directCallsAndCallsInInputMappingsValidateNestedSourceContractsWithoutFetchingValues() {
    var repository = mock(SourceRepository.class);
    var source =
        new SourceDefinition(
            "HTTP",
            "https://example.test/data",
            List.of(new Input("key", "STRING", true, null)),
            null,
            null,
            500);
    when(repository.get("remote", 1)).thenReturn(new DataSource("remote", "Remote", 1, source));
    var child =
        graph(
            List.of(
                new Input(
                    "value",
                    "NUMBER",
                    true,
                    null,
                    new SourceBinding("remote", 1, Map.of(), "", "FAIL"))),
            "value");
    RuleResolver resolver =
        new RuleResolver() {
          @Override
          public Definition resolve(String id, int version) {
            return child;
          }

          @Override
          public Definition resolveFormula(String id, int version) {
            return child;
          }
        };
    var validator = new SourceBindingValidator(repository);
    var callerSource = new SourceDefinition("LOOKUP", null, List.of(), Map.of(), null, 0);
    when(repository.get("caller", 1))
        .thenReturn(new DataSource("caller", "Caller", 1, callerSource));
    for (Definition parent :
        List.of(
            graph(List.of(), "$IF(false, @child:1(), 0)"),
            graph(
                List.of(
                    new Input(
                        "value",
                        "NUMBER",
                        true,
                        null,
                        new SourceBinding(
                            "caller", 1, Map.of("unused", "@child:1()"), "", "FAIL"))),
                "value"))) {
      if (!parent.inputs().isEmpty())
        when(repository.get("caller", 1))
            .thenReturn(
                new DataSource(
                    "caller",
                    "Caller",
                    1,
                    new SourceDefinition(
                        "LOOKUP",
                        null,
                        List.of(new Input("unused", "NUMBER", true, null)),
                        Map.of(),
                        null,
                        0)));
      assertThatThrownBy(() -> validator.validate(parent, resolver))
          .isInstanceOfSatisfying(
              ArcException.class,
              error -> {
                assertThat(error.getMessage()).contains("missing source mapping for key");
                assertThat(error.locations())
                    .contains(new ArcException.Location("child", 1, "in", "Input"));
              });
    }
    verify(repository, times(2)).get("remote", 1);
  }
}
