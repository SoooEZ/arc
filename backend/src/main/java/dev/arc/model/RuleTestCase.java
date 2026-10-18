package dev.arc.model;

import java.time.Instant;
import java.util.Map;

/**
 * A saved test of a rule: inputs to run and the outcome they should produce. With {@code
 * expectedError} set, the run must fail with a message that contains it; otherwise it must return
 * {@code expectedResult}, where null expects a null result. Comparing an outcome is the client's
 * work; the server only keeps the cases.
 */
public record RuleTestCase(
    long id,
    String ruleId,
    String name,
    Map<String, Object> inputs,
    Object expectedResult,
    String expectedError,
    Instant createdAt,
    Instant updatedAt) {}
