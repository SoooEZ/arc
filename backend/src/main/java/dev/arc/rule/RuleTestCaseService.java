package dev.arc.rule;

import dev.arc.engine.DisplayNames;
import dev.arc.engine.Limits;
import dev.arc.error.ArcException;
import dev.arc.model.RuleTestCase;
import dev.arc.model.StorableText;
import dev.arc.rule.RuleTestCaseRepository.Content;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Saved test cases of a rule; transaction boundaries and validation live here. A write names the
 * rule (404 first, as lesson B29 orders it), then its content is checked: a missing value is a 422
 * that names it, never a default.
 */
@Service
public class RuleTestCaseService {
  /**
   * A case as a client writes it. {@code inputs} is read as any JSON value, so that a missing value
   * or one that is not an object is a 422 naming the field rather than a 400 about malformed JSON.
   * Without {@code expectedError} the case expects {@code expectedResult}, and an omitted or null
   * one expects a null result.
   */
  public record Write(String name, Object inputs, Object expectedResult, String expectedError) {}

  private final RuleTestCaseRepository store;

  public RuleTestCaseService(RuleTestCaseRepository store) {
    this.store = store;
  }

  public List<RuleTestCase> list(String ruleId) {
    return store.list(ruleId);
  }

  /** The lock holds the count until the commit, so concurrent creations never pass the limit. */
  @Transactional
  public RuleTestCase create(String ruleId, Write request) {
    int existing = store.lockForNewCase(ruleId);
    Content content = content(request);
    if (existing >= Limits.MAX_TEST_CASES)
      throw ArcException.invalid(
          "A rule keeps at most "
              + Limits.MAX_TEST_CASES
              + " test cases; delete one before adding another");
    return store.create(ruleId, content);
  }

  @Transactional
  public RuleTestCase update(String ruleId, long id, Write request) {
    store.lockCase(ruleId, id);
    return store.update(ruleId, id, content(request));
  }

  @Transactional
  public void delete(String ruleId, long id) {
    store.delete(ruleId, id);
  }

  /** The content to store: the name trimmed, the inputs an object, one expected outcome. */
  private static Content content(Write request) {
    String name = DisplayNames.normalize("Test case", request.name());
    if (!(request.inputs() instanceof Map<?, ?> inputs))
      throw ArcException.invalid("Test case inputs must be a JSON object; send {} for none");
    var copied = new LinkedHashMap<String, Object>();
    // JSON object keys are always text.
    for (var input : inputs.entrySet()) copied.put((String) input.getKey(), input.getValue());
    String error = request.expectedError();
    if (error != null) {
      if (request.expectedResult() != null)
        throw ArcException.invalid("A test case expects a result or an error, not both");
      if (error.isBlank())
        throw ArcException.invalid(
            "Expected error must contain text; send null to expect a result instead");
      if (error.length() > Limits.MAX_EXPECTED_ERROR_CHARACTERS)
        throw ArcException.invalid(
            "Expected error exceeds "
                + Limits.format(Limits.MAX_EXPECTED_ERROR_CHARACTERS)
                + " characters");
      String unstorable = StorableText.problem(error);
      if (unstorable != null) throw ArcException.invalid(unstorable);
    }
    return new Content(name, copied, request.expectedResult(), error);
  }
}
