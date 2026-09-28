package dev.arc.model;

/**
 * One page of a rule or source catalog or version history. Every paged endpoint shares these
 * defaults, bounds and search normalization, so surrounding whitespace never changes what a search
 * matches.
 */
public record PageRequest(int offset, int limit, String search) {
  public static final int DEFAULT_LIMIT = 20;
  public static final int MAX_LIMIT = 100;
  public static final int MAX_SEARCH_CHARACTERS = 200;

  /**
   * Trims the search (null means no search). Throws {@link IllegalArgumentException} for a negative
   * offset, a limit outside 1 to 100, or a trimmed search longer than 200 characters.
   */
  public PageRequest {
    if (offset < 0 || limit < 1 || limit > MAX_LIMIT)
      throw new IllegalArgumentException("Use offset >= 0 and limit from 1 to " + MAX_LIMIT);
    search = search == null ? "" : search.trim();
    if (search.length() > MAX_SEARCH_CHARACTERS)
      throw new IllegalArgumentException(
          "Search is limited to " + MAX_SEARCH_CHARACTERS + " characters");
  }

  /** Omitted values read from the start with the default page size. */
  public static PageRequest of(Integer offset, Integer limit, String search) {
    return new PageRequest(
        offset == null ? 0 : offset, limit == null ? DEFAULT_LIMIT : limit, search);
  }
}
