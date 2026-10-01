package dev.arc.source.lookup;

import dev.arc.engine.ExecutionDeadline;
import dev.arc.engine.Limits;
import dev.arc.engine.ValueBounds;
import dev.arc.engine.ValueText;
import dev.arc.error.ArcException;
import dev.arc.model.Definition.Input;
import dev.arc.model.SourceDefinition;
import dev.arc.model.SourceDefinition.Field;
import dev.arc.source.SourceAdapter;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Component;

@Component
public final class LookupSourceAdapter implements SourceAdapter {
  @Override
  public String kind() {
    return "LOOKUP";
  }

  /** The table is the whole configuration; a URL or secret headers are refused before this. */
  @Override
  public Set<Field> fields() {
    return Set.of(Field.ENTRIES);
  }

  @Override
  public String noun() {
    return "Lookup tables";
  }

  @Override
  public void validate(SourceDefinition definition) {
    if (!definition.parameters().stream()
        .map(Input::name)
        .collect(Collectors.toSet())
        .equals(Set.of("key")))
      throw ArcException.invalid("Lookup tables require exactly one parameter named key");
    if (definition.entries() == null || definition.entries().size() > Limits.MAX_COLLECTION_ITEMS)
      throw ArcException.invalid(
          "Provide a JSON object with at most "
              + Limits.format(Limits.MAX_COLLECTION_ITEMS)
              + " lookup entries");
    ValueBounds.bounded(definition.entries());
  }

  /** The table is in memory, so the caller's deadline checks around this call suffice. */
  @Override
  public Object fetch(
      String sourceId,
      SourceDefinition definition,
      Map<String, Object> inputs,
      ExecutionDeadline deadline) {
    Object key = inputs.get("key");
    if (key == null) throw ArcException.invalid("Lookup key must not be null");
    String entry = matchingEntry(definition.entries(), key);
    if (entry == null) throw ArcException.invalid("Lookup key was not found in " + sourceId);
    return definition.entries().get(entry);
  }

  /**
   * Text and boolean keys match their exact text. Numbers match by value: {@code 20}, {@code 20.0}
   * and {@code 2E+1} find the entry {@code "20"}. When no entry uses that plain form, the first
   * entry that spells the same number differently, such as {@code "20.0"}, matches.
   */
  private static String matchingEntry(Map<String, Object> entries, Object key) {
    String text = ValueText.key(key);
    if (entries.containsKey(text)) return text;
    if (key instanceof Number) {
      BigDecimal number = ValueBounds.number(key);
      for (String entry : entries.keySet()) if (isSameNumber(entry, number)) return entry;
    }
    return null;
  }

  private static boolean isSameNumber(String text, BigDecimal number) {
    // Most keys are names such as "US": only text that can start a number is parsed, so a miss
    // no longer throws once per entry. BigDecimal reads every Unicode digit, as before.
    if (text.isEmpty() || !startsNumber(text.charAt(0))) return false;
    try {
      return new BigDecimal(text).compareTo(number) == 0;
    } catch (NumberFormatException notANumber) {
      return false;
    }
  }

  private static boolean startsNumber(char first) {
    return Character.isDigit(first) || first == '+' || first == '-' || first == '.';
  }
}
