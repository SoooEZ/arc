package dev.arc.rule;

import dev.arc.model.RuleTestCase;
import java.util.List;
import java.util.Map;

/**
 * Storage port of saved test cases. Writes run inside the transaction of {@link
 * RuleTestCaseService}; none of them changes the rule's draft, revision or update time. An unknown
 * rule is a 404 "Rule not found: id"; a case the rule does not have, including another rule's case,
 * is a 404 "Test case not found: id".
 */
public interface RuleTestCaseRepository {
  /** A validated case to store: its trimmed name, its inputs and its expected outcome. */
  record Content(
      String name, Map<String, Object> inputs, Object expectedResult, String expectedError) {}

  /** The rule's cases, oldest first. */
  List<RuleTestCase> list(String ruleId);

  /**
   * Locks the rule against other case creations and against its deletion until the transaction
   * ends, and returns how many cases it has.
   */
  int lockForNewCase(String ruleId);

  /** Locks one case of the rule for a write. */
  void lockCase(String ruleId, long id);

  /**
   * Stores a new case and returns it as stored. Inputs and an expected result that take more than
   * {@code Limits.MAX_TEST_CASE_BYTES} once encoded are a 422.
   */
  RuleTestCase create(String ruleId, Content content);

  /** Replaces a locked case's content, with the same size rule as {@link #create}. */
  RuleTestCase update(String ruleId, long id, Content content);

  void delete(String ruleId, long id);

  /**
   * Copies every case of rule {@code from} to rule {@code to}, in their order and as stored, and
   * returns how many it copied. Both rules exist and are held by the caller's transaction: the copy
   * belongs to a rule's duplication, so it needs neither the count nor the size check again.
   */
  int copyCases(String from, String to);
}
