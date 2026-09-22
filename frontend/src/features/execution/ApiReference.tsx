export default function ApiReference() {
  return (
    <>
      <div className="api-reference-heading">
        <h2>One API. A few clear endpoints.</h2>
        <p>
          Base URL: <code>{window.location.origin}/api</code>
        </p>
      </div>
      <div className="endpoint-table">
        {[
          ["GET", "/rules", "List all rules and their current drafts"],
          [
            "POST",
            "/rules",
            "Create a rule from a template or a graph definition",
          ],
          ["GET", "/rules/{id}", "Read a rule and its revision"],
          [
            "PUT",
            "/rules/{id}",
            "Save a draft with optimistic concurrency protection",
          ],
          [
            "POST",
            "/rules/{id}/publish",
            "Validate and publish an immutable version",
          ],
          [
            "POST",
            "/rules/{id}/execute",
            "Execute a published rule with typed inputs",
          ],
          ["GET", "/rules/{id}/versions", "Read all published versions"],
          [
            "GET",
            "/rules/{id}/versions/{version}",
            "Read one immutable version",
          ],
          ["POST", "/preview", "Test a graph without saving or publishing it"],
          [
            "POST",
            "/validate",
            "Check graph structure, expressions, and references",
          ],
        ].map(([method, path, desc]) => (
          <div key={method + path}>
            <span className={`method method-${method.toLowerCase()}`}>
              {method}
            </span>
            <code>{path}</code>
            <span>{desc}</span>
          </div>
        ))}
      </div>
      <div className="api-notes">
        <div>
          <h3>Predictable versioning</h3>
          <p>
            Pass <code>version</code> alongside <code>inputs</code> to pin a
            release. Omit it to run the latest published version. Every response
            tells you which version ran.
          </p>
        </div>
        <div>
          <h3>Clear failures</h3>
          <p>
            Invalid inputs and graphs return <code>422</code>. Missing resources
            return <code>404</code>. Stale revisions or unpublished rules return{" "}
            <code>409</code>, with a readable error message.
          </p>
        </div>
        <div>
          <h3>Open during development</h3>
          <p>
            All API endpoints are currently callable without a token, and CORS
            allows any origin. JWT authentication is planned for a later
            release.
          </p>
        </div>
      </div>
    </>
  );
}
