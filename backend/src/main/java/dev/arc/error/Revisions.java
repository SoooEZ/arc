package dev.arc.error;

/**
 * The revision check that every save and publication makes, and a deletion makes when its client
 * names the revision it read. Rules and sources share the policy and differ only in the message a
 * stale revision gets, which each resource pins.
 */
public final class Revisions {
  private Revisions() {}

  /**
   * A missing revision is a malformed request (422 "Revision is required"), not a stale one: read
   * as 0 it answered 409 however often the client reloaded. A revision other than {@code current}
   * is a 409 with {@code staleMessage}, the resource's own wording.
   */
  public static void require(int current, Integer read, String staleMessage) {
    if (read == null) throw ArcException.invalid("Revision is required");
    if (current != read) throw ArcException.conflict(staleMessage);
  }
}
