package dev.arc.engine;

import com.fasterxml.jackson.annotation.JsonInclude;
import dev.arc.model.Definition.DecisionTable;
import dev.arc.model.Definition.Node;
import org.springframework.boot.jackson.JsonMixin;

/**
 * How a graph node is written as JSON, beyond its record components: the application's one mapper,
 * which writes responses and stored JSONB alike, registers this mix-in. Records write their null
 * components, so without it every node would gain {@code "table": null}: every payload, export and
 * snapshot would change, and a draft saved after decision tables existed would never equal a
 * version published before them ({@code draft_changed} compares the stored JSONB).
 */
@JsonMixin(Node.class)
public interface DefinitionJson {
  /** A decision table's {@code table}; every other node omits it. */
  @JsonInclude(JsonInclude.Include.NON_NULL)
  DecisionTable table();
}
