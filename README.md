# ARC

**Aggregation, Rule & Calculation** — a visual workspace and HTTP service for reusable business logic.

The first release implements **R & C**: build formulas, conditions, and decision trees; publish stable versions; execute them from any application with typed inputs and a complete execution trace.

Choose [Java or Rails](#choose-java-or-rails), then use Docker Compose or the native development commands below. Run the setup commands from the repository root unless a step says otherwise.

## Choose Java or Rails

ARC has two independent backends with the same React frontend, HTTP API, and PostgreSQL data format:

| Backend | API and persistence | Calculation / Studio engine | Start with Compose |
| --- | --- | --- | --- |
| Java (default) | Spring Boot + JDBC | Java + Apache POI | `docker compose up -d --build --wait` |
| Rails | Rails 8.1 API + Active Record | Ruby, with no Java dependency | `docker compose -f compose.yaml -f compose.rails.yaml up -d --build --wait` |

**Rails runs entirely without Java, Maven, Spring Boot, or a separate calculation service.** Its Ruby engine handles decimal expressions, all 192 enabled functions, graph validation/execution, fan-out and joins, reusable rules, ARC Script, diagnostics, HTTP sources and lookup tables. The Rails Docker image contains no JVM or JAR files. The frontend uses the same API whichever backend is selected.

Both backends use the SQL files in `database/migrations`, the same migration history, and the same published definitions. Java runs Flyway; Rails applies the SQL using a Ruby migration runner that preserves Flyway-compatible checksums. Features must be implemented in **both** engines; shared contract tests and CI check for differences. Code does not automatically translate between Java and Ruby. See [compatibility guidance](contracts/README.md), including numerical tolerances and supported Excel behavior.

### Start or switch with Docker Compose

Install Docker and Compose as described below. From the repository root, create `.env` once if it does not already exist:

```sh
cp .env.example .env
```

Choose one backend for the `api` service. Keep the project name and database credentials unchanged when switching an existing workspace:

```sh
# Run Rails, or switch an existing Java workspace to Rails
docker compose -f compose.yaml -f compose.rails.yaml up -d --build --wait

# Inspect the Rails stack and follow its logs
docker compose -f compose.yaml -f compose.rails.yaml ps
docker compose -f compose.yaml -f compose.rails.yaml logs -f api

# Switch the same workspace back to Java
docker compose up -d --build --wait
```

The API container is recreated for the selected backend; the database volume is preserved. Switching retains drafts, published versions, and data sources. The frontend remains at **http://localhost:3080**, and API callers keep using **http://localhost:8080/api**. Run one backend per workspace; do not execute the switch commands concurrently.

```sh
# Stop Rails while keeping its database
docker compose -f compose.yaml -f compose.rails.yaml down

# Optional: create a separate Rails workspace with new containers, data and ports
COMPOSE_PROJECT_NAME=arc-rails ARC_WEB_PORT=3081 ARC_API_PORT=8081 \
  docker compose -f compose.yaml -f compose.rails.yaml up -d --build --wait
```

Keep using that project name and port overrides to manage the separate workspace. Do not use `down -v` when switching backends: it deletes the database.

### Run Rails without Docker

The following macOS/Homebrew setup includes PostgreSQL creation, table initialization, backend startup and frontend startup. Java and Maven are not needed. Use Ruby **3.3.x**, PostgreSQL **17**, and Node.js **24**. The repository pins Ruby **3.3.11** for asdf and CI; another supported Ruby 3.3 patch from Homebrew is also suitable.

Install prerequisites and obtain the repository if needed:

```sh
brew install ruby@3.3 libpq libyaml postgresql@17 node@24
export PATH="$(brew --prefix ruby@3.3)/bin:$(brew --prefix libpq)/bin:$(brew --prefix postgresql@17)/bin:$(brew --prefix node@24)/bin:$PATH"

ruby -v        # Ruby 3.3.x
bundle -v
psql --version # PostgreSQL 17.x
node -v        # Node 24.x

# Skip cloning if you already have this checkout
git clone https://github.com/SoooEZ/arc.git
cd arc
```

Start PostgreSQL and create the role/database **once**. Skip `createuser` and `createdb` when reusing a database initialized by Java; retain its existing password.

```sh
brew services start postgresql@17
pg_isready -h localhost -p 5432

# Continue after pg_isready reports "accepting connections".
# Choose a password when prompted.
createuser --pwprompt arc
createdb --owner=arc arc

# Verify login and permission to create the application's tables
psql -h localhost -p 5432 -U arc -d arc -W \
  -c "SELECT current_database(), current_user, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_tables;"
```

Homebrew initializes the cluster; no separate `initdb` is needed. These commands assume the normal Homebrew administrator role for your OS user. For another PostgreSQL installation, use its administrator account to create the role/database. Expected verification is database `arc`, user `arc`, and `can_create_tables = t`.

In **terminal A**, from the ARC repository root:

```sh
cd backend-rails
bundle config set --local path vendor/bundle
bundle install

export DB_HOST=localhost
export DB_PORT=5432
export DB_NAME=arc
export DB_USER=arc
export DB_PASSWORD='replace-with-the-password-you-created'

# Creates all tables, migration history and initial examples when needed.
# Safe to repeat, including on a database previously used by Java.
bundle exec rails arc:prepare

# Start Rails/Puma on port 8080; leave this terminal open.
bundle exec puma -C config/puma.rb
```

Stop any other API listening on port 8080 first. Native Rails does **not** load the root `.env` automatically; export these variables in its terminal. `arc:prepare` runs SQL using Ruby and creates `rules`, `rule_versions`, `data_sources`, `data_source_versions`, and `flyway_schema_history`. It seeds the country-tax lookup and three sample rules when needed. No manual `CREATE TABLE`, SQL import, `rails db:migrate`, or Java process is required. Existing rules are preserved.

In **terminal B**, verify the API and database:

```sh
curl -fsS http://localhost:8080/actuator/health
curl -sS http://localhost:8080/api/rules/order-pricing/execute \
  -H 'Content-Type: application/json' \
  -d '{"inputs":{"orderTotal":150,"customerTier":"premium"}}'

psql -h localhost -p 5432 -U arc -d arc -W -c '\dt public.*'
psql -h localhost -p 5432 -U arc -d arc -W \
  -c 'SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank;'
psql -h localhost -p 5432 -U arc -d arc -W \
  -c 'SELECT id, published_version FROM rules ORDER BY id;'
```

Expected health is `{"status":"UP"}`, both migrations show `success = t`, and an unmodified order-pricing example returns `120`. See [table verification](#4-verify-tables-and-initial-data) for further checks.

In **terminal C**, from the repository root, start the frontend:

```sh
export PATH="$(brew --prefix node@24)/bin:$PATH"
cd frontend
npm ci
npm run dev
```

Open **http://localhost:3080**. Vite proxies `/api` to port 8080. Press **Ctrl+C** in the respective terminals to stop Puma and Vite. PostgreSQL can remain running; `brew services stop postgresql@17` stops it while preserving its data. To restart, restore the PATH and database variables, run `arc:prepare`, then start Puma and Vite. After pulling changes, run `bundle install` for updated gems and `arc:prepare` before startup; use `npm ci` if the frontend lockfile changed. The initial gem/npm installation needs internet access.

To switch a native workspace to Java, stop Puma and follow [the Java backend step](#3-start-the-java-backend-tables-are-created-here) with the same PostgreSQL database. Only that choice requires Java and Maven.

Optional Rails settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Native Puma port; Compose uses internal port 8080 |
| `RAILS_MAX_THREADS` | `5` | Puma request threads and database pool size |
| `ARC_CONTRACTS_PATH` | Repository `contracts/` | Shared catalogs and sample definitions; set automatically in the image |
| `ARC_MIGRATIONS_PATH` | Repository `database/migrations/` | Canonical SQL directory; set automatically in the image |

HTTP allowlists and `ARC_SECRET_*` aliases work the same as on Java; export them in the Rails terminal as described in [the source guide](docs/studio.md). The public API remains unauthenticated for this phase.

Troubleshooting:

- **Old Ruby selected:** check `which ruby`, `ruby -v`, and `bundle -v` in the same terminal. Put the selected Ruby's bin directory or version-manager shims first in `PATH`.
- **`pg` cannot build:** install `libpq`, put its `bin` directory in `PATH`, and rerun `bundle install`. For `psych` build failures, check `libyaml` and the selected Ruby installation.
- **Database/table errors:** verify all five `DB_*` values and run `bundle exec rails arc:prepare` with those exact values. Rails uses `DB_HOST`/`DB_PORT`/`DB_NAME`; native Java uses a JDBC `DB_URL` instead.
- **Migration checksum mismatch:** restore the original already-applied SQL file. Add schema changes as a new migration; do not clear the history or rerun old SQL manually.

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

Prerequisites: **Java 21**, **Maven 3.9+**, **Node.js 24+** with npm, and **PostgreSQL 17**. Docker and Nginx are not required. For Rails, also follow [the Rails native setup](#run-rails-without-docker). The steps below cover a fresh local setup on **macOS with [Homebrew](https://brew.sh/)**. On other systems, install the same tools using your platform's package manager and substitute your local JDK path and PostgreSQL administrator account.

You create the PostgreSQL role and database once. **ARC creates its tables automatically when the backend starts**; there is no separate manual `CREATE TABLE` or SQL import step.

### 1. Install tools and get the source

If Homebrew is not installed yet, follow [its installation instructions](https://brew.sh/) and complete the displayed shell setup first. Install the application tools:

```sh
brew install openjdk@21 maven node@24 postgresql@17

export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$(brew --prefix node@24)/bin:$(brew --prefix postgresql@17)/bin:$PATH"

java -version
mvn -v
node --version
npm --version
psql --version
```

Check that both `java -version` and `mvn -v` report **Java 21**, Node reports **24 or newer**, and PostgreSQL reports **17**. Homebrew's [Java 21](https://formulae.brew.sh/formula/openjdk@21), [Node 24](https://formulae.brew.sh/formula/node@24), and [PostgreSQL 17](https://formulae.brew.sh/formula/postgresql@17) packages are keg-only, so the explicit paths select the intended versions. Exports apply to the current terminal; repeat them in a new terminal, or add these two export lines to your shell configuration (for example `~/.zshrc`). The backend and frontend commands below repeat the exports they need.

For a new checkout, run this from the directory where you keep projects. If ARC is already checked out, use that repository instead:

```sh
git clone https://github.com/SoooEZ/arc.git
cd arc
```

The first install and build need internet access to download Homebrew, Maven, and npm dependencies.

### 2. Start PostgreSQL and create the database

```sh
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"
brew services start postgresql@17
pg_isready -h localhost -p 5432
```

Wait for `accepting connections` before continuing. Homebrew initializes the PostgreSQL cluster during installation; you do not need to run `initdb` separately for this setup.

Create the application's database role and database **once**. Enter a password of your choice when prompted, and use the same password in `DB_PASSWORD` below:

```sh
createuser --pwprompt arc
createdb --owner=arc arc
```

These commands assume a local PostgreSQL server on port **5432** and a database administrator role for your OS user, as supplied by a standard Homebrew installation. For another PostgreSQL installation, create the role/database using that server's administrator account and adjust the connection settings below.

Verify the application's own login and its permission to create tables, using the same TCP connection as the backend. Enter the password you just chose:

```sh
psql -h localhost -p 5432 -U arc -d arc -W \
  -c "SELECT current_database(), current_user, has_schema_privilege(current_user, 'public', 'CREATE') AS can_create_tables;"
```

Expected values: database `arc`, user `arc`, and `can_create_tables = t`. The role owns this fresh database, which gives it the necessary schema permissions in the default PostgreSQL 17 setup. Resolve connection or permission errors before starting Java; Flyway cannot create a missing PostgreSQL role or database.

### 3. Start the Java backend (tables are created here)

In **terminal A**, starting from the repository root:

```sh
cd backend
export JAVA_HOME="$(brew --prefix openjdk@21)/libexec/openjdk.jdk/Contents/Home"
export PATH="$JAVA_HOME/bin:$PATH"
export DB_URL='jdbc:postgresql://localhost:5432/arc'
export DB_USER='arc'
export DB_PASSWORD='replace-with-the-password-you-chose'
mvn spring-boot:run
```

Keep this terminal running. The API listens on port **8080**. The root `.env` file is read by Docker Compose; it is **not automatically loaded** by `mvn spring-boot:run`. Export the `DB_*` variables in the backend's terminal as shown above. If you configure HTTP data sources, also export any needed `ARC_HTTP_ALLOWED_HOSTS` / `ARC_HTTP_PRIVATE_HOSTS` settings there; see [the studio guide](docs/studio.md).

Maven downloads Java dependencies, compiles the backend, and starts Spring Boot. Its [Flyway integration](https://docs.spring.io/spring-boot/3.5/how-to/data-initialization.html#howto.data-initialization.migration-tool.flyway) runs the versioned SQL files in `database/migrations` automatically. Both native startup and Docker Compose use this same initialization process:

| Created automatically | Purpose | Initialization source |
| --- | --- | --- |
| `rules` | Rule metadata and the editable draft graph | [V1__rules.sql](database/migrations/V1__rules.sql) |
| `rule_versions` | Immutable published rule versions | [V1__rules.sql](database/migrations/V1__rules.sql) |
| `data_sources` | Data-source metadata | [V2__data_sources.sql](database/migrations/V2__data_sources.sql) |
| `data_source_versions` | Versioned HTTP or lookup-table configurations | [V2__data_sources.sql](database/migrations/V2__data_sources.sql) |
| `flyway_schema_history` | Applied migration versions and checksums | Flyway on Java; compatible Ruby runner on Rails |

`V2` also inserts the `country-tax` lookup example. After migrations, [Samples.java](backend/src/main/java/dev/arc/store/Samples.java) creates and publishes `apply-discount`, `order-pricing`, and `free-shipping` **only if the `rules` table is empty**. Restarting an initialized workspace preserves existing rules. Later application updates apply new migration versions once; already applied migration files should not be edited or executed manually.

### 4. Verify tables and initial data

With terminal A still running, open another terminal. Use the application's PostgreSQL password whenever prompted:

```sh
export PATH="$(brew --prefix postgresql@17)/bin:$PATH"

# Backend and database health
curl --fail http://localhost:8080/actuator/health

# List tables in the public schema
psql -h localhost -p 5432 -U arc -d arc -W -c '\dt public.*'

# Verify that migrations 1 and 2 succeeded
psql -h localhost -p 5432 -U arc -d arc -W \
  -c 'SELECT version, description, success FROM flyway_schema_history ORDER BY installed_rank;'

# Verify the three example rules and their published versions
psql -h localhost -p 5432 -U arc -d arc -W \
  -c 'SELECT id, published_version FROM rules ORDER BY id;'

# Verify the example lookup source
psql -h localhost -p 5432 -U arc -d arc -W \
  -c 'SELECT source_id, version FROM data_source_versions ORDER BY source_id, version;'
```

On a fresh setup, expect health `UP`, the five tables above, successful migrations `1` and `2`, three rules at published version `1`, and `country-tax` version `1`. An existing workspace may contain additional rules, sources, and versions.

### 5. Start the React frontend

In **terminal B**, starting from the repository root:

```sh
cd frontend
export PATH="$(brew --prefix node@24)/bin:$PATH"
npm ci
npm run dev -- --port 3080 --strictPort
```

Open [http://localhost:3080](http://localhost:3080). Vite proxies `/api` and `/actuator` to `http://localhost:8080`, so the frontend can call the native backend without Nginx. Both **3080** and **8080** must be available; stop the ARC Compose stack first if it is using those ports. If you change the backend port, update the proxy target in `frontend/vite.config.ts` too.

Use the [execution example below](#verify-either-setup) to check a complete HTTP calculation after startup.

### 6. Stop and restart

Press **Ctrl+C** in each terminal to stop the frontend and backend. PostgreSQL continues running as a Homebrew service; stop it when desired with `brew services stop postgresql@17`.

For subsequent runs, start PostgreSQL if needed, then repeat the backend and frontend startup commands in separate terminals. Do not recreate the role, database, or tables. `npm ci` is needed for the first setup or after dependency/lockfile changes; an unchanged installation can go straight to `npm run dev -- --port 3080 --strictPort`.

### Troubleshooting native startup

| Symptom | Check / fix |
| --- | --- |
| `java`, `mvn`, `node`, or `psql` is not found; Maven uses the wrong Java | Repeat the installation/PATH setup in the current terminal. Confirm `JAVA_HOME` and `mvn -v` show Java 21. |
| PostgreSQL reports `no response` / connection refused | Check `brew services list`, start `postgresql@17`, and run `pg_isready -h localhost -p 5432`. Verify that `DB_URL` points to the same server and port. |
| Role/database `arc` already exists | Skip its creation on subsequent runs and verify the login with `psql`. Use the existing password and owner; do not drop the database to repeat setup. |
| `password authentication failed` or database `arc` does not exist | Verify the role/database creation and password, then export matching `DB_USER`, `DB_PASSWORD`, and `DB_URL` in the Java terminal. |
| `permission denied for schema public` | Run the permission query in step 2. Have the database administrator grant the ARC role `USAGE, CREATE` on schema `public` in the ARC database; existing tables must also be owned by, or writable by, that role. |
| Tables are missing or Flyway migration fails | Read the backend terminal's first database/Flyway error. Check that you connected to the intended database and that the role can create tables. Run the migration-history query after fixing the error and restarting. Do not manually import the migration SQL or remove migration history. |
| Port 8080 or 3080 is occupied | On macOS, inspect it with `lsof -nP -iTCP:8080 -sTCP:LISTEN` or `lsof -nP -iTCP:3080 -sTCP:LISTEN`. Stop the conflicting app, or change the port and matching proxy configuration. |
| Frontend opens, but API requests fail | Check `http://localhost:8080/actuator/health` and `http://localhost:3080/actuator/health`. Start the backend, resolve its startup error, or correct the Vite proxy target. |

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
- Connections route around node cards automatically, including while moving nodes or dragging a new connection. Covered handles show a warning with links to the affected connections; move nodes apart or use **Arrange graph** to restore a clear path.
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
- **Backends:** Java 21 / [Spring Boot 3.5](https://docs.spring.io/spring-boot/3.5/) with JDBC, or Ruby 3.3 / [Rails 8.1 API](https://guides.rubyonrails.org/api_app.html) with Active Record and Puma. Each backend has its own calculation engine; both use the shared SQL schema and compatible migration history.
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

Both backend implementations are checked in CI. For an already running backend:

```sh
python3 scripts/contract.py http://localhost:8080
# Compare two isolated deployments:
python3 scripts/contract.py http://localhost:18080 http://localhost:18081
# Compare the enabled function catalog and calculation examples:
python3 scripts/function_contract.py http://localhost:18080 http://localhost:18081
# From the root: creates and removes a fresh temporary Docker stack on 18082/13082
python3 scripts/switch_backend_test.py
```

The switching test checks Rails → Java → Rails → Java against one database, including migrations, stored drafts and immutable versions. Override `ARC_SWITCH_API_PORT` and `ARC_SWITCH_WEB_PORT` if those test ports are occupied. Contract and smoke tests create fixtures; run them on disposable test workspaces. See [contracts/README.md](contracts/README.md) for the rules for keeping both APIs compatible.


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

For the independent Rails runtime and HTTP-source tests, no Java or database is needed:

```sh
cd backend-rails
bundle exec ruby test/run.rb
```

[Shared API/function checks](contracts/README.md) compare disposable Java and Rails deployments. GitHub Actions tests both engines, builds the frontend, compares APIs and all enabled functions, verifies Rails → Java → Rails → Java database switching, and runs Chromium workflows on both backends. It also checks that the Rails image contains no Java executable or JAR files.

## Next phases

- JWT authentication and permission boundaries for authoring versus execution.
- Aggregation sources and operations (the **A** in ARC).
- Rule test suites, richer value types, audit history, and release promotion.
- Production deployment, request quotas, monitoring, and backup policies.

### Code studio and data sources

Use the separate **Code studio** page for Monaco editing, function chips grouped by purpose with expandable categories, search and hover help, reusable module insertion, and bidirectional graph editing. **Data sources** supplies missing inputs from versioned lookup tables or HTTP JSON APIs. See [the studio guide](docs/studio.md) for syntax, examples, compatibility boundaries, source configuration, and endpoints.
