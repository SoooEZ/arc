package dev.arc.engine;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import dev.arc.model.Definition.SourceBinding;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

class SourceReaderTest {
  @Test
  void theOnlyReadAReaderImplementsReceivesTheExecutionDeadline() {
    List<Method> reads =
        Arrays.stream(SourceReader.class.getMethods())
            .filter(method -> method.getName().equals("read"))
            .toList();
    assertThat(reads).hasSize(1);
    assertThat(Modifier.isAbstract(reads.getFirst().getModifiers())).isTrue();
    assertThat(reads.getFirst().getParameterTypes())
        .containsExactly(SourceBinding.class, Map.class, ExecutionDeadline.class);
  }

  @Test
  void anUnavailableReaderRejectsEveryRead() {
    var binding = new SourceBinding("rates", 1, Map.of(), "", "FAIL");
    assertThatThrownBy(
            () ->
                SourceReader.unavailable().read(binding, Map.of(), ExecutionDeadline.start(1_000)))
        .hasMessage("Data sources unavailable");
  }
}
