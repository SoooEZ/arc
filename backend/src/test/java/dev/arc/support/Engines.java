package dev.arc.support;

import com.fasterxml.jackson.core.JsonGenerator;
import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.RuleResolver;
import dev.arc.engine.SourceReader;
import dev.arc.engine.execution.Engine;
import dev.arc.engine.execution.Parameters;
import dev.arc.engine.validation.Validator;
import dev.arc.model.Definition;
import java.util.Map;

/**
 * Engines and runs for evaluator tests. Production code reaches the engine only through {@code
 * Engine.session} with the application's mapper; tests get the same, with a mapper that writes
 * decimals as responses do (application.yaml), where a bare ObjectMapper wrote {@code 1.2E+3}.
 */
public final class Engines {
  /** Writes decimals in plain notation, as the application's mapper does. */
  public static final ObjectMapper PLAIN =
      new ObjectMapper().enable(JsonGenerator.Feature.WRITE_BIGDECIMAL_AS_PLAIN);

  private Engines() {}

  public static Engine engine(Validator validator) {
    return new Engine(validator, PLAIN);
  }

  /**
   * A run without source reads; see {@link #execute(Validator, String, Integer, Definition, Map,
   * RuleResolver, Parameters)}.
   */
  public static Engine.Result execute(
      Validator validator,
      String ruleId,
      Integer version,
      Definition definition,
      Map<String, Object> inputs,
      RuleResolver resolver) {
    return execute(
        validator,
        ruleId,
        version,
        definition,
        inputs,
        resolver,
        new Parameters(SourceReader.unavailable()));
  }

  /**
   * Runs one definition, with trace, under the default deadline in a fresh engine over {@code
   * validator}: each run has its own plan cache, so a test may give the same pin another definition
   * between runs, as the removed embedded {@code Engine.execute} did through sessions that never
   * cached.
   */
  public static Engine.Result execute(
      Validator validator,
      String ruleId,
      Integer version,
      Definition definition,
      Map<String, Object> inputs,
      RuleResolver resolver,
      Parameters parameters) {
    return engine(validator)
        .session(resolver, ExecutionDeadline.start(ExecutionDeadline.DEFAULT_TIMEOUT_MS))
        .execute(ruleId, version, () -> definition, inputs, parameters, true);
  }
}
