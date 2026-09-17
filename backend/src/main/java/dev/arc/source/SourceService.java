package dev.arc.source;

import com.fasterxml.jackson.databind.*;
import dev.arc.api.ArcException;
import dev.arc.engine.*;
import dev.arc.model.Definition;
import dev.arc.model.Definition.*;
import java.util.*;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class SourceService {
  public record Config(
      String kind,
      String url,
      List<Input> parameters,
      Map<String, Object> entries,
      Map<String, String> secretHeaders,
      int timeoutMs) {}

  public record Source(String id, String name, int version, Config definition) {}

  public record Create(String id, String name, Config definition) {}

  public record Update(String name, int revision, Config definition) {}

  public record Test(Map<String, Object> inputs, Integer version) {}

  private final JdbcTemplate db;
  private final ObjectMapper json;
  private final HttpSource http;

  public SourceService(JdbcTemplate db, ObjectMapper json, HttpSource http) {
    this.db = db;
    this.json = json;
    this.http = http;
  }

  public List<Source> list() {
    return db.query(
        "SELECT s.*,v.definition FROM data_sources s JOIN data_source_versions v ON"
            + " v.source_id=s.id AND v.version=s.version ORDER BY s.updated_at DESC",
        (r, i) ->
            new Source(
                r.getString("id"),
                r.getString("name"),
                r.getInt("version"),
                decode(r.getString("definition"))));
  }

  public Source get(String id, int version) {
    var rows =
        db.query(
            "SELECT s.id,s.name,v.version,v.definition FROM data_sources s JOIN"
                + " data_source_versions v ON v.source_id=s.id WHERE s.id=? AND v.version=?",
            (r, i) ->
                new Source(
                    r.getString("id"),
                    r.getString("name"),
                    r.getInt("version"),
                    decode(r.getString("definition"))),
            id,
            version);
    if (rows.isEmpty())
      throw new ArcException(404, "Data source version not found: " + id + " v" + version);
    return rows.getFirst();
  }

  public List<Source> versions(String id) {
    return db.query(
        "SELECT s.id,s.name,v.version,v.definition FROM data_sources s JOIN data_source_versions v"
            + " ON v.source_id=s.id WHERE s.id=? ORDER BY v.version DESC",
        (r, i) ->
            new Source(
                r.getString("id"),
                r.getString("name"),
                r.getInt("version"),
                decode(r.getString("definition"))),
        id);
  }

  @Transactional
  public Source create(Create r) {
    if (r.id() == null || !r.id().matches("[a-z][a-z0-9-]{0,79}"))
      throw ArcException.invalid("Invalid source ID");
    validate(r.name(), r.definition());
    db.update("INSERT INTO data_sources(id,name) VALUES (?,?)", r.id(), r.name());
    db.update(
        "INSERT INTO data_source_versions(source_id,version,definition) VALUES (?,1,?::jsonb)",
        r.id(),
        encode(r.definition()));
    return get(r.id(), 1);
  }

  @Transactional
  public Source update(String id, Update r) {
    validate(r.name(), r.definition());
    var versions =
        db.queryForList(
            "SELECT version FROM data_sources WHERE id=? FOR UPDATE", Integer.class, id);
    if (versions.isEmpty()) throw new ArcException(404, "Data source not found");
    if (versions.getFirst() != r.revision())
      throw new ArcException(409, "Source changed in another editor; reload before saving");
    int v = r.revision() + 1;
    db.update(
        "INSERT INTO data_source_versions(source_id,version,definition) VALUES (?,?,?::jsonb)",
        id,
        v,
        encode(r.definition()));
    db.update(
        "UPDATE data_sources SET name=?,version=?,updated_at=now() WHERE id=?", r.name(), v, id);
    return get(id, v);
  }

  public void validate(String name, Config c) {
    if (name == null || name.isBlank() || name.length() > 160)
      throw ArcException.invalid("Source name must contain 1–160 characters");
    if (c == null || !Set.of("HTTP", "LOOKUP").contains(c.kind() == null ? "" : c.kind()))
      throw ArcException.invalid("Source kind must be HTTP or LOOKUP");
    if (c.parameters() == null || c.parameters().size() > 20)
      throw ArcException.invalid("Provide up to 20 source parameters");
    Set<String> names = new HashSet<>();
    for (Input p : c.parameters()) {
      if (p == null
          || !Validator.identifier(p.name())
          || !names.add(p.name())
          || p.source() != null) throw ArcException.invalid("Invalid source parameter");
      if (!Set.of("NUMBER", "STRING", "BOOLEAN").contains(p.type() == null ? "" : p.type()))
        throw ArcException.invalid("Source parameters must be scalar");
      if (p.defaultValue() != null) Validator.checkType(p.name(), p.type(), p.defaultValue());
    }
    if (c.kind().equals("LOOKUP")) {
      if (!names.equals(Set.of("key")))
        throw ArcException.invalid("Lookup tables require exactly one parameter named key");
      if (c.entries() == null || c.entries().size() > 1000)
        throw ArcException.invalid("Provide a JSON object with at most 1,000 lookup entries");
      Expressions.bounded(c.entries());
    } else {
      http.validate(c);
      if (c.timeoutMs() < 100 || c.timeoutMs() > 10000)
        throw ArcException.invalid("HTTP timeout must be 100–10,000 ms");
    }
  }

  public void validateBindings(
      Definition d, RuleResolver resolver, Set<String> visited, int depth) {
    if (depth > 16) throw ArcException.invalid("Rule nesting exceeds 16 levels");
    for (Input p : d.inputs())
      if (p.source() != null) {
        var b = p.source();
        var c = get(b.id(), b.version()).definition();
        var names = c.parameters().stream().map(Input::name).toList();
        for (String k : b.bindings().keySet())
          if (!names.contains(k)) throw ArcException.invalid("Unknown source parameter: " + k);
        for (Input arg : c.parameters())
          if (arg.required() && arg.defaultValue() == null && !b.bindings().containsKey(arg.name()))
            throw ArcException.invalid(p.name() + ": missing source mapping for " + arg.name());
      }
    for (Node n : d.nodes())
      if (n.type().equals("REFERENCE")
          && n.ruleId() != null
          && n.version() != null
          && visited.add(n.ruleId() + "@" + n.version()))
        validateBindings(resolver.resolve(n.ruleId(), n.version()), resolver, visited, depth + 1);
  }

  public Object fetch(String id, int version, Map<String, Object> inputs) {
    var c = get(id, version).definition();
    var values = new LinkedHashMap<String, Object>();
    if (inputs == null) throw ArcException.invalid("Source inputs must be an object");
    for (String key : inputs.keySet())
      if (c.parameters().stream().noneMatch(p -> p.name().equals(key)))
        throw ArcException.invalid("Unknown source parameter: " + key);
    for (Input p : c.parameters()) {
      Object v = inputs.containsKey(p.name()) ? inputs.get(p.name()) : p.defaultValue();
      if (v == null && p.required())
        throw ArcException.invalid("Missing source parameter: " + p.name());
      values.put(p.name(), v == null ? null : Validator.checkType(p.name(), p.type(), v));
    }
    if (c.kind().equals("LOOKUP")) {
      String key = String.valueOf(values.get("key"));
      if (!c.entries().containsKey(key))
        throw ArcException.invalid("Lookup key was not found in " + id);
      return c.entries().get(key);
    }
    return http.fetch(c, values);
  }

  public Object extract(Object value, String pointer) {
    if (pointer == null || pointer.isEmpty()) return value;
    JsonNode node = json.valueToTree(value).at(pointer);
    if (node.isMissingNode())
      throw ArcException.invalid("Source JSON pointer did not match a value");
    return json.convertValue(node, Object.class);
  }

  private Config decode(String s) {
    try {
      return json.readValue(s, Config.class);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }

  private String encode(Config c) {
    try {
      return json.writeValueAsString(c);
    } catch (Exception e) {
      throw new IllegalStateException(e);
    }
  }
}
