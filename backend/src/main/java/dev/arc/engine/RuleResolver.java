package dev.arc.engine;

import dev.arc.error.ArcException;
import dev.arc.model.Definition;

@FunctionalInterface
public interface RuleResolver {
  Definition resolve(String id, int version);

  /** Resolves an immutable pin and verifies that its owning rule has kind FORMULA. */
  default Definition resolveFormula(String id, int version) {
    throw ArcException.invalid("Published Formula calls are unavailable: @" + id + ":" + version);
  }
}
