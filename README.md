# ARC

**Aggregation, Rule & Calculation** — a visual workspace and HTTP service for reusable business logic.

The first release implements **R & C**: build formulas, conditions, and decision trees; publish stable versions; execute them from any application with typed inputs and a complete execution trace.

## Run with Docker Compose

```sh
cp .env.example .env
docker compose up -d --build
```

- **Workspace:** http://localhost:3080
- **API:** http://localhost:8080/api
- **Health:** http://localhost:8080/actuator/health

Compose creates a dedicated `arc` project: new `arc-web-1`, `arc-api-1`, and `arc-database-1` containers, its own network, and an `arc_arc-data` database volume. No external or existing containers are referenced. PostgreSQL has no published host port. Web and API ports are configurable through `.env`.

The database is migrated automatically and populated with three working examples on first startup:

| Rule ID | Type | Behavior |
| --- | --- | --- |
| `order-pricing` | Decision tree | Premium customers receive 20% off; other orders of at least 100 receive 10% off. |
| `apply-discount` | Formula | Reusable percentage discount with decimal arithmetic and rounding. |
| `free-shipping` | Condition rule | Returns whether `amount >= 100`. |

```sh
curl -X POST http://localhost:8080/api/rules/order-pricing/execute \
  -H 'Content-Type: application/json' \
  -d '{"version":1,"inputs":{"orderTotal":150,"customerTier":"premium"}}'
```

The result is `120`, alongside the executed version, timing, and each visited node (including nested rule calls). The same endpoints are proxied at `http://localhost:3080/api`.

## What you can do

- Create a decision tree, formula, or condition rule from a working template.
- Define number, string, and boolean inputs, with required flags and defaults.
- Add formula, condition, reusable-rule, and output nodes on a zoomable canvas.
- Connect one result to multiple downstream nodes by dragging from the same handle; select an edge to remove it.
- Use the condition builder or write an expression, including compound conditions.
- Navigate with the node outline, minimap, auto-layout, or links to referenced rules. Arrange graph accounts for the fixed True/False exits and reorders branches to reduce crossings.
- Map parameters using connected upstream variables, typed constants, or expressions, and pin an exact published version. String constants need no manual quotation marks. Referenced rules open in a separate tab.
- Test the current graph without saving; inspect results and a highlighted execution path. Error actions jump to the affected node, including failures inside referenced rules.
- Edit the rule name and description with the gear beside the current rule name.
- Save incomplete drafts, validate complete graphs, and publish immutable versions.
- Inspect historical versions, export graph JSON, and execute releases in the API playground.
- Call the service using HTTP/cURL from any origin. Authentication is deliberately deferred.

**Access model:** all authoring and execution endpoints are currently unauthenticated, and CORS allows all origins. The containers listen on the host's configured ports. Other machines can call the host's reachable IP or hostname; this repository does not provision a public cloud host. JWT, authorization, and production rate limiting remain future work.

## Technology

- **Frontend:** React 19, TypeScript, [MUI](https://mui.com/material-ui/), [React Flow](https://reactflow.dev/), [ELK](https://github.com/kieler/elkjs), Vite. Fonts are bundled locally.
- **Backend:** Java 21, [Spring Boot 3.5](https://docs.spring.io/spring-boot/3.5/), JDBC, Flyway.
- **Storage:** PostgreSQL 17 with JSONB graph documents and immutable version rows.
- **Execution:** a restricted expression parser using `BigDecimal`/DECIMAL128. No JavaScript evaluation, JVM reflection, SQL expressions, or arbitrary code execution.
- **Infrastructure:** Docker Compose with health checks, isolated persistent storage, and an Nginx frontend/API proxy.

## Model and API

Every executable artifact uses the same graph schema. `kind` is an organizational label; formulas and condition rules compose with decision trees using the same reference mechanism.

```text
Rule (stable ID)
├── Draft graph + edit revision
└── Published versions (immutable JSONB snapshots)
    └── Reference nodes → rule ID + exact version + parameter expressions
```

The evaluator starts at Input and executes active nodes in a deterministic dependency order. A handle may feed several downstream nodes. Joins wait for their active upstream computations and run once; conditions activate only their selected exit. One reached Output returns its value; multiple reached Outputs return an object keyed by node ID, such as `{"tax": 10, "shipping": 5}`. Graphs cannot contain cycles. Node positions are presentation metadata.

- [API reference and request examples](docs/api.md)
- [Graph schema, expression language, and architecture](docs/architecture.md)
- [OpenAPI specification](docs/openapi.yaml)

## Development and verification

Prerequisites for local development: Java 21+, Maven 3.9+, Node.js 24+, and Docker Compose.

```sh
# Backend tests covering arithmetic, types, graphs, sources, and references
cd backend
mvn test

# Frontend development: proxies API requests to localhost:8080
cd ../frontend
npm ci
npm run dev

# Production type check and build
npm run build

# End-to-end browser tests, with the Compose stack running
npx playwright install chromium
npm run test:e2e

# Live API integration tests, from the repository root
python3 scripts/smoke.py
```

Browser and API tests create identifiable `e2e-formula-*` and `smoke-*` rules. Run them against a disposable Compose project when you want to keep your own workspace clean:

```sh
COMPOSE_PROJECT_NAME=arc-test ARC_WEB_PORT=3081 ARC_API_PORT=8081 docker compose up -d --build --wait
ARC_API_URL=http://localhost:8081 python3 scripts/smoke.py
cd frontend
ARC_WEB_URL=http://localhost:3081 npm run test:e2e
cd ..
COMPOSE_PROJECT_NAME=arc-test ARC_WEB_PORT=3081 ARC_API_PORT=8081 docker compose down -v
```

The final command deletes only that test project's containers and database volume. Normal `docker compose down` preserves the development database.

For a locally running Java process, provide `DB_URL`, `DB_USER`, and `DB_PASSWORD` pointing to a PostgreSQL database, then run `mvn spring-boot:run`. The normal Compose workflow keeps PostgreSQL private and runs the Java service in its own container.

GitHub Actions runs the Java tests, frontend build, real PostgreSQL API checks, and Chromium end-to-end tests.

## Next phases

- JWT authentication and permission boundaries for authoring versus execution.
- Aggregation sources and operations (the **A** in ARC).
- Rule test suites, richer value types, audit history, and release promotion.
- Production deployment, request quotas, monitoring, and backup policies.

### Code studio and data sources

Use the separate **Code studio** page for Monaco editing, function chips with hover help, reusable module insertion, and bidirectional graph editing. **Data sources** supplies missing inputs from versioned lookup tables or HTTP JSON APIs. See [the studio guide](docs/studio.md) for syntax, examples, compatibility boundaries, source configuration, and endpoints.
