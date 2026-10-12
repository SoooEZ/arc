-- The rules a draft or a published version calls, stored beside the definition they were read
-- from: every create, save and publish writes the exact set (Validator.calledRuleIds), the set a
-- write already holds against deletion. A deletion then finds the callers of a rule through the
-- index instead of scanning and serialising every stored definition under the rule's lock.
ALTER TABLE rules ADD COLUMN callees TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE rule_versions ADD COLUMN callees TEXT[] NOT NULL DEFAULT '{}';

-- Backfill from the stored JSON, a superset of the exact set: every node's ruleId (a Reference,
-- with or without a version) and every @id:version token in an expression-bearing field (node
-- expressions and selectors, case and field expressions, input source mappings). A call written
-- inside a string literal of an expression is counted too, which the next save or publish of the
-- rule corrects; an over-counted callee only keeps that rule from deletion until then, with the
-- caller named.
CREATE FUNCTION pg_temp.arc_callees(definition JSONB) RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(array_agg(DISTINCT callee ORDER BY callee), '{}'::text[])
  FROM (
    SELECT pin #>> '{}' AS callee
    FROM jsonb_path_query(definition, '$.nodes[*].ruleId') AS pin
    WHERE jsonb_typeof(pin) = 'string'
    UNION ALL
    SELECT call[1]
    FROM jsonb_array_elements(
           jsonb_path_query_array(definition, '$.nodes[*].expression')
           || jsonb_path_query_array(definition, '$.nodes[*].selector')
           || jsonb_path_query_array(definition, '$.nodes[*].cases[*].expression')
           || jsonb_path_query_array(definition, '$.nodes[*].fields[*].expression')
           || jsonb_path_query_array(definition, '$.inputs[*].source.bindings.*')) AS expression,
         regexp_matches(expression #>> '{}', '@([a-z][a-z0-9-]*):[0-9]+', 'g') AS call
    WHERE jsonb_typeof(expression) = 'string'
  ) AS calls
  WHERE callee <> ''
$$;
UPDATE rules SET callees = pg_temp.arc_callees(draft);
UPDATE rule_versions SET callees = pg_temp.arc_callees(definition);
DROP FUNCTION pg_temp.arc_callees(JSONB);

CREATE INDEX rules_callees ON rules USING GIN (callees);
CREATE INDEX rule_versions_callees ON rule_versions USING GIN (callees);
