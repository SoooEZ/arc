package dev.arc.api;

import dev.arc.error.ArcException;
import dev.arc.model.PageRequest;

/** Binds the paging parameters shared by the catalog and version-history endpoints. */
final class PageParameters {
  private PageParameters() {}

  /** Omitted values use the page defaults; out-of-range values are a 422 like other bad values. */
  static PageRequest page(Integer offset, Integer limit, String search) {
    try {
      return PageRequest.of(offset, limit, search);
    } catch (IllegalArgumentException invalid) {
      throw ArcException.invalid(invalid.getMessage());
    }
  }
}
