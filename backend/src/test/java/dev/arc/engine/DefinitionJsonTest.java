package dev.arc.engine;

import static dev.arc.support.GraphFixtures.nodeOf;
import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.model.Definition;
import dev.arc.model.Definition.DecisionTable;
import dev.arc.persistence.JsonCodec;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.json.JsonTest;

/**
 * The application's mapper, which writes responses and stored JSONB, omits {@code table} on every
 * node that has none: a draft saved now must equal, byte for byte, a version published before
 * decision tables existed, or {@code draft_changed} would report changes that are not there.
 */
@JsonTest
class DefinitionJsonTest {
  @Autowired private ObjectMapper json;

  @Test
  void onlyADecisionTableWritesItsTable() throws Exception {
    var formula = nodeOf("calc", "FORMULA", "Calc").expression("1").output("total").build();
    String stored =
        new JsonCodec(json).encode(new Definition(1, List.of(), List.of(formula), List.of()));
    assertThat(stored)
        .isEqualTo(
            "{\"schemaVersion\":1,\"inputs\":[],\"nodes\":[{\"id\":\"calc\",\"type\":\"FORMULA\","
                + "\"label\":\"Calc\",\"position\":null,\"expression\":\"1\",\"output\":\"total\","
                + "\"ruleId\":null,\"version\":null,\"bindings\":null,\"cases\":null,"
                + "\"fields\":null,\"selector\":null,\"outputName\":null}],\"edges\":[],"
                + "\"notes\":[]}");
    var table =
        nodeOf("fee", "DECISION_TABLE", "Fee")
            .output("fee")
            .table(new DecisionTable("FIRST", List.of(), List.of(), List.of()))
            .build();
    assertThat(json.writeValueAsString(table))
        .endsWith(
            "\"outputName\":null,\"table\":{\"hitPolicy\":\"FIRST\",\"conditions\":[],"
                + "\"results\":[],\"rows\":[]}}");
    assertThat(json.readValue(json.writeValueAsString(table), Definition.Node.class))
        .isEqualTo(table);
  }
}
