# Java / Rails compatibility contract

Java and Rails are independent implementations of the [HTTP contract](../docs/openapi.yaml) and versioned graph format. Rails runs calculations, Studio, sources and migrations in Ruby, without Java. The frontend works with either backend.

Shared files:

- `expressions.json`: decimal, lazy evaluation, collection scopes and Unicode examples.
- `functions.json` / `function-arities.json`: enabled/reference-only catalog, help text, categories and argument limits consumed by Ruby and compared to Java.
- `function-cases.json`: 231 cases covering every one of the 192 enabled functions, plus boundaries and expected results/errors. Ruby can run these fixtures without a Java installation.
- `samples.json`: initial rules used by Rails and checked through the shared API workflows.
- `../database/migrations/Vn__*.sql`: the canonical SQL migration chain for both applications.

Run the API contract against either backend, or compare two independent deployments with disposable databases:

```sh
python3 scripts/contract.py http://localhost:8080
python3 scripts/contract.py http://localhost:18080 http://localhost:18081
python3 scripts/function_contract.py http://localhost:18080 http://localhost:18081
```

The API suite creates uniquely named `contract-*` rules and sources. It verifies expected results and compares complete responses, excluding server timestamps and execution durations. It covers the catalog, code/graph/node round trips, diagnostics, fan-out, pinned references, publication, optimistic revisions, decimal JSONB persistence, sources, fallback, CORS and body limits. The function suite evaluates every expression on both APIs, comparing result types, values, status codes and error messages.

Decimal operator tests compare exact values. Excel-compatible numeric functions use floating-point semantics: comparisons permit relative error `1e-11` or absolute error `1e-12`. The near-zero RATE fixture explicitly permits absolute error `1e-8`, matching the iteration's convergence threshold. This is a compatibility suite for ARC's enabled scalar/array functions, not a claim to implement every Excel feature, workbook reference, locale format or every corner case. Reference-only catalog entries remain unavailable on both backends. Singular MINVERSE arguments return `#NUM!` on both engines; this corrects a Java/POI case that previously emitted enormous finite values for a non-invertible matrix.

Offline Rails tests (no Java or PostgreSQL needed):

```sh
cd backend-rails
bundle exec ruby test/run.rb
```

CI runs Java and Ruby unit tests, the existing API and Playwright suites against each backend, shared function/API contracts, and `scripts/switch_backend_test.py`. The switch test initializes a fresh database with Ruby, then verifies Rails → Java → Rails → Java preserves versions and accepts migration checksums. It removes only its own test containers and volume. Rails image checks assert the absence of Java executables and JAR files.

When adding features:

1. Update both engines for graph, expression, Studio, validation or source behavior changes. Update both API/persistence implementations for changes to endpoints or records.
2. Extend the shared expected fixtures and OpenAPI contract where appropriate. Reconcile the function catalog, signatures and snippets in both implementations.
3. Put schema changes only in `database/migrations/Vn__*.sql`. Java runs Flyway; Ruby maintains compatible history directly. Never edit already-applied SQL or add a second Rails migration chain.
4. Run the conformance, integration, browser and switch tests. CI verifies the two implementations; synchronization requires maintaining both codebases.
