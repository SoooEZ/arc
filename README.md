# ARC

**Aggregation, Rule & Calculation** — a visual workspace and HTTP service for reusable business logic.

The first release implements **R & C**: build formulas, conditions, and decision trees; publish stable versions; execute them from any application with typed inputs and a complete execution trace.

Choose [Docker Compose](#run-with-docker-compose) to run the whole stack in containers, or [local development without Docker](#run-without-docker-local-development) to run PostgreSQL, Java, and React directly. Run the setup commands from the repository root unless a step says otherwise.

## Run with Docker Compose

Prerequisites: a running Docker engine and Docker Compose v2. Java, Maven, Node.js, and PostgreSQL are installed inside the images; you do not need to install them on the host.

```sh
# First setup only; keep your existing .env on subsequent runs
cp .env.example .env

# Build, start, and wait for the services to become healthy
docker compose up -d --build --wait
```

Before starting, edit `.env` if you need different `ARC_WEB_PORT` / `ARC_API_PORT` values or database credentials (`POSTGRES_DB`, `POSTGRES_USER`, `POSTGRES_PASSWORD`). The defaults use web port **3080** and API port **8080**; both host ports must be available.

Compose creates a dedicated `arc` project: new `arc-web-1`, `arc-api-1`, and `arc-database-1` containers, its own network, and an `arc_arc-data` database volume. No external or existing containers are referenced. PostgreSQL has no published host port. Web and API ports are configurable through `.env`.

Useful commands, run from the repository root:

```sh
# Show service status
docker compose ps

# Follow backend and database logs (Ctrl+C exits the log viewer)
docker compose logs -f api database

# Stop and remove the project's containers; keep the database volume
docker compose down

# Start again, rebuilding images to include source changes
docker compose up -d --build --wait
```

Normal shutdown preserves saved rules and published versions. `docker compose down -v` also deletes the project's database volume; use it only when you intend to reset that data. Database initialization variables apply when the volume is first created; changing `.env` alone does not change credentials in an existing database.

## Run without Docker (local development)

Prerequisites: **Java 21**, **Maven 3.9+**, **Node.js 24+** with npm, and **PostgreSQL 17**. Docker and Nginx are not required. The following PostgreSQL installation commands are for macOS with Homebrew; on other systems, install PostgreSQL using your platform's package manager or use an existing PostgreSQL server.

### 1. Start PostgreSQL

```sh
brew install postgresql@17
brew services start postgresql@17
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
```

Create the application's database role and database **once**. Enter a password of your choice when prompted, and use the same password in `DB_PASSWORD` below:

```sh
createuser --pwprompt arc
createdb --owner=arc arc
```

These commands assume a local PostgreSQL server on port **5432** and a database administrator role for your OS user, as supplied by a standard Homebrew installation. For another PostgreSQL installation, create the role/database using that server's administrator account and adjust the connection settings below.

### 2. Start the Java backend

In **terminal A**, starting from the repository root:

```sh
cd backend
export DB_URL='jdbc:postgresql://localhost:5432/arc'
export DB_USER='arc'
export DB_PASSWORD='replace-with-the-password-you-chose'
mvn spring-boot:run
```

Keep this terminal running. The API listens on port **8080**. The root `.env` file is read by Docker Compose; it is **not automatically loaded** by `mvn spring-boot:run`. Export the `DB_*` variables in the backend's terminal as shown above. If you configure HTTP data sources, also export any needed `ARC_HTTP_ALLOWED_HOSTS` / `ARC_HTTP_PRIVATE_HOSTS` settings there; see [the studio guide](docs/studio.md).

### 3. Start the React frontend

In **terminal B**, starting from the repository root:

```sh
cd frontend
npm ci
npm run dev -- --port 3080 --strictPort
```

Open [http://localhost:3080](http://localhost:3080). Vite proxies `/api` and `/actuator` to `http://localhost:8080`, so the frontend can call the native backend without Nginx. Both **3080** and **8080** must be available; stop the ARC Compose stack first if it is using those ports. If you change the backend port, update the proxy target in `frontend/vite.config.ts` too.

Press **Ctrl+C** in each terminal to stop the frontend and backend. PostgreSQL continues running as a Homebrew service; stop it when desired with `brew services stop postgresql@17`.

**Existing data:** native PostgreSQL and the Compose database volume are separate databases. A fresh native database gets the example rules, not your Docker workspace. To retain custom rules, published versions, and data sources when switching, back up the original database with `pg_dump` and restore it into the destination database before starting ARC there. If Docker cannot start, its existing volume still needs to be recovered before that data can be migrated; keep the volume intact.

## Verify either setup

With the default ports, both startup methods expose:

- **Workspace:** [http://localhost:3080](http://localhost:3080)
- **API:** [http://localhost:8080/api](http://localhost:8080/api)
- **Health:** [http://localhost:8080/actuator/health](http://localhost:8080/actuator/health)

```sh
curl http://localhost:8080/actuator/health
```

A healthy backend returns `{"status":"UP"}`. The database is migrated automatically, and an empty database is populated with three working examples on first startup:

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
- Choose an Output’s return value from available inputs/upstream results, enter a typed constant (number, string, boolean, array or null), or write an expression. String constants need no manual quotation marks.
- Navigate with the node outline, minimap, auto-layout, or links to referenced rules. Arrange graph accounts for the fixed True/False exits and reorders branches to reduce crossings.
- Map parameters using connected upstream variables, typed constants, or expressions, and pin an exact published version. String constants need no manual quotation marks.
- Open a node’s **Node expression** editor to change its calculations, mappings and connections together. Syntax and scope errors mark their owning nodes red; runtime failures also mark the calling reference.
- Browse referenced versions in one modal with **Back** and **Close all**, preserving the parent draft.
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

Every executable artifact uses the same graph schema. `kind` is an organizational label, not an execution restriction:

| Type | Intended use | Example |
| --- | --- | --- |
| Formula | Calculate a value | `amount * (1 - rate)` |
| Condition rule | Decide whether a condition is met | `amount >= 100` → true/false |
| Decision tree | Combine branching decisions and calculations | Choose a discount by customer tier and order total |

All types support the same nodes, references, fan-out, and output values. Currently new Formula and Decision tree artifacts share the basic calculation template; Condition rule starts with a boolean branching template. Existing graphs are never constrained by their category.

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

Use Java 21, Maven 3.9+, and Node.js 24+ for the checks below. Browser and live API tests also require a running ARC stack, started with either method above. Start these commands from the repository root.

```sh
# Backend tests covering arithmetic, types, graphs, sources, and references
cd backend
mvn test

# Install frontend dependencies
cd ../frontend
npm ci

# Production type check and build
npm run build

# End-to-end browser tests, with ARC running at localhost:3080
npx playwright install chromium
npm run test:e2e

# Live API integration tests, from the repository root
cd ..
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

GitHub Actions runs the Java tests, frontend build, real PostgreSQL API checks, and Chromium end-to-end tests.

## Next phases

- JWT authentication and permission boundaries for authoring versus execution.
- Aggregation sources and operations (the **A** in ARC).
- Rule test suites, richer value types, audit history, and release promotion.
- Production deployment, request quotas, monitoring, and backup policies.

### Code studio and data sources

Use the separate **Code studio** page for Monaco editing, function chips grouped by purpose with expandable categories, search and hover help, reusable module insertion, and bidirectional graph editing. **Data sources** supplies missing inputs from versioned lookup tables or HTTP JSON APIs. See [the studio guide](docs/studio.md) for syntax, examples, compatibility boundaries, source configuration, and endpoints.
