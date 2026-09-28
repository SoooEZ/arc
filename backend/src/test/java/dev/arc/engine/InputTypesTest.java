package dev.arc.engine;

import static org.assertj.core.api.Assertions.*;

import java.util.List;
import java.util.Locale;
import org.junit.jupiter.api.Test;

/** Type errors read the same under every JVM default locale (lesson B15). */
class InputTypesTest {
  @Test
  void typeNamesInMessagesDoNotFollowTheDefaultLocale() {
    Locale original = Locale.getDefault();
    try {
      for (String tag : List.of("tr-TR", "az-AZ", "en-US")) {
        Locale.setDefault(Locale.forLanguageTag(tag));
        // "STRING".toLowerCase() is "strıng" (dotless ı) under tr and az.
        for (String type : InputTypes.NAMES)
          assertThatThrownBy(() -> InputTypes.check("region", type, new Object()))
              .as(tag + " " + type)
              .hasMessage("Input 'region' must be " + type.toLowerCase(Locale.ROOT));
      }
    } finally {
      Locale.setDefault(original);
    }
  }
}
