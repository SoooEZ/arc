package dev.arc.source;

import dev.arc.engine.Identifiers;
import dev.arc.error.ArcException;
import dev.arc.model.*;
import java.util.List;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Versioned source configuration and transactional writes. */
@Service
public class SourceService {
  public record Create(String id, String name, SourceDefinition definition) {}

  public record Update(String name, int revision, SourceDefinition definition) {}

  private final SourceRepository repository;
  private final SourceValidator validator;

  public SourceService(SourceRepository repository, SourceValidator validator) {
    this.repository = repository;
    this.validator = validator;
  }

  public CatalogPage<SourceSummary> catalog(PageRequest page) {
    return repository.catalog(page.offset(), page.limit(), page.search());
  }

  /** Version histories are not searchable; the page's search is ignored. */
  public CatalogPage<SourceVersionSummary> versionSummaries(String id, PageRequest page) {
    return repository.versionSummaries(id, page.offset(), page.limit());
  }

  public List<DataSource> list() {
    return repository.list();
  }

  public DataSource get(String id, int version) {
    return repository.get(id, version);
  }

  public List<DataSource> versions(String id) {
    return repository.versions(id);
  }

  @Transactional
  public DataSource create(Create request) {
    if (!Identifiers.isResourceId(request.id())) throw ArcException.invalid("Invalid source ID");
    validator.validate(request.name(), request.definition());
    return repository.create(request.id(), request.name(), request.definition());
  }

  @Transactional
  public DataSource update(String id, Update request) {
    validator.validate(request.name(), request.definition());
    return repository.update(id, request.name(), request.revision(), request.definition());
  }
}
