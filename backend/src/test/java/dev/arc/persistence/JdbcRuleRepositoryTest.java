package dev.arc.persistence;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import dev.arc.model.PageRequest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.RowMapper;

class JdbcRuleRepositoryTest {
  private final JdbcTemplate jdbc = mock(JdbcTemplate.class);
  private final JdbcRuleRepository repository =
      new JdbcRuleRepository(jdbc, new JsonCodec(new ObjectMapper()));

  /**
   * PostgreSQL computes select-list JSONB functions for every matching row before a sort unless the
   * page is chosen first, so a catalog page must not cost work proportional to all drafts.
   */
  @Test
  void draftCountsAreReadOnlyForTheChosenPage() {
    var statements = new ArrayList<String>();
    var arguments = new ArrayList<List<Object>>();
    when(jdbc.queryForObject(anyString(), eq(Long.class), any(Object[].class))).thenReturn(0L);
    when(jdbc.query(anyString(), any(RowMapper.class), any(Object[].class)))
        .thenAnswer(
            call -> {
              statements.add(call.getArgument(0));
              Object[] values = call.getArguments();
              arguments.add(Arrays.asList(values).subList(2, values.length));
              return List.of();
            });

    repository.catalog(new PageRequest(40, 10, " tax "), "RULE", true);

    String page = statements.getFirst();
    assertThat(page.indexOf("LIMIT ? OFFSET ?"))
        .as("the page is chosen before drafts are read")
        .isPositive()
        .isLessThan(page.indexOf("jsonb_array_length"));
    assertThat(arguments.getFirst()).containsExactly("tax", "tax", "RULE", "RULE", true, 10, 40);
  }
}
