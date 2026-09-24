import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const checkScript = fileURLToPath(new URL("./check_dev.mjs", import.meta.url));

async function listen(t, host = "127.0.0.1", port = 0) {
  const server = net.createServer((socket) => socket.end());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen({ host, port, ipv6Only: host === "::1" }, resolve);
  });
  t.after(() => close(server));
  return server;
}

async function close(server) {
  if (server.listening) {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function setup(t) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "arc-dev-check-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await writeFile(
    path.join(directory, "mvn"),
    '#!/bin/sh\nprintf "Apache Maven 3.9.6\\nJava version: %s.0.2\\n" "${TEST_JAVA_MAJOR:-21}"\n',
    { mode: 0o755 },
  );
  const database = await listen(t);
  const api = await listen(t);
  const web = await listen(t);
  const environment = {
    ...process.env,
    PATH: `${directory}${path.delimiter}${process.env.PATH || ""}`,
    DB_URL: `jdbc:postgresql://127.0.0.1:${database.address().port}/arc`,
    DB_PASSWORD: "a-test-password-that-must-not-be-logged",
    ARC_API_PORT: String(api.address().port),
    ARC_WEB_PORT: String(web.address().port),
    TEST_JAVA_MAJOR: "21",
  };
  await close(api);
  await close(web);
  function run(overrides = {}) {
    return new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [checkScript], {
        cwd: directory,
        env: { ...environment, ...overrides },
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 15_000,
      });
      let output = "";
      child.stdout.on("data", (chunk) => (output += chunk));
      child.stderr.on("data", (chunk) => (output += chunk));
      child.once("error", reject);
      child.once("close", (code) => resolve({ code, output }));
    });
  }
  return { directory, environment, database, run };
}

function git(directory, ...args) {
  const result = spawnSync(
    "git",
    [
      "-c",
      "user.name=ARC test",
      "-c",
      "user.email=arc-test@example.invalid",
      "-c",
      "commit.gpgsign=false",
      ...args,
    ],
    {
      cwd: directory,
      encoding: "utf8",
    },
  );
  assert.equal(result.status, 0, result.stderr);
}

test("historically deleted main and test sources are listed without removing local work", async (t) => {
  const { directory, run } = await setup(t);
  const obsolete = [
    "backend/src/main/java/dev/arc/engine/Engine.java",
    "backend/src/test/java/dev/arc/engine/EngineTest.java",
  ];
  git(directory, "init");
  for (const file of obsolete) {
    await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await writeFile(path.join(directory, file), "// old source\n");
  }
  git(directory, "add", "backend");
  git(directory, "commit", "-m", "Original classes");
  for (const file of obsolete) await rm(path.join(directory, file));
  git(directory, "add", "-u");
  git(directory, "commit", "-m", "Remove obsolete classes");
  // Ignoring a stale source cannot keep Maven from compiling it.
  await writeFile(path.join(directory, ".gitignore"), obsolete[0] + "\n");
  for (const file of obsolete) {
    await writeFile(
      path.join(directory, file),
      "// local changes must survive\n",
    );
  }
  const newSource = "backend/src/main/java/dev/arc/NewSource.java";
  await writeFile(
    path.join(directory, newSource),
    "// intentional new source\n",
  );

  const result = await run();
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Previously deleted Java sources/);
  assert.match(
    result.output,
    /Maven clean removes target, not Java source files/,
  );
  for (const file of obsolete) {
    assert.ok(result.output.includes(file));
    assert.equal(
      await readFile(path.join(directory, file), "utf8"),
      "// local changes must survive\n",
    );
  }
  assert.ok(!result.output.includes(newSource));

  for (const file of obsolete) await rm(path.join(directory, file));
  const recovered = await run();
  assert.equal(recovered.code, 0, recovered.output);
  assert.equal(
    await readFile(path.join(directory, newSource), "utf8"),
    "// intentional new source\n",
  );
});

test("an intentional tracked reintroduction of a former path is allowed", async (t) => {
  const { directory, run } = await setup(t);
  const file = "backend/src/main/java/Example.java";
  await mkdir(path.dirname(path.join(directory, file)), { recursive: true });
  git(directory, "init");
  await writeFile(path.join(directory, file), "// original\n");
  git(directory, "add", file);
  git(directory, "commit", "-m", "Original source");
  await rm(path.join(directory, file));
  git(directory, "add", "-u");
  git(directory, "commit", "-m", "Removed source");
  await writeFile(path.join(directory, file), "// deliberate replacement\n");
  git(directory, "add", file);
  const result = await run();
  assert.equal(result.code, 0, result.output);
});

test("an exported source directory without Git remains runnable", async (t) => {
  const { run } = await setup(t);
  const result = await run();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /Old Java source check skipped/);
});

test("reachable database and free ports pass without reserving application ports", async (t) => {
  const { environment, run } = await setup(t);
  const result = await run();
  assert.equal(result.code, 0, result.output);
  assert.match(result.output, /TCP reachability only/);
  assert.ok(!result.output.includes(environment.DB_PASSWORD));
  await listen(t, "127.0.0.1", Number(environment.ARC_API_PORT));
  await listen(t, "127.0.0.1", Number(environment.ARC_WEB_PORT));
});

test("an IPv4 listener blocks startup with the affected port named", async (t) => {
  const { environment, run } = await setup(t);
  await listen(t, "127.0.0.1", Number(environment.ARC_API_PORT));
  const result = await run();
  assert.equal(result.code, 1);
  assert.match(
    result.output,
    new RegExp(`ARC_API_PORT port ${environment.ARC_API_PORT} is occupied`),
  );
});

test("an IPv6-only listener also blocks startup", async (t) => {
  const { environment, run } = await setup(t);
  try {
    await listen(t, "::1", Number(environment.ARC_API_PORT));
  } catch (error) {
    if (
      ["EAFNOSUPPORT", "EADDRNOTAVAIL", "EPROTONOSUPPORT"].includes(error.code)
    ) {
      t.skip("IPv6 is unavailable on this host");
      return;
    }
    throw error;
  }
  const result = await run();
  assert.equal(result.code, 1);
  assert.match(result.output, /ARC_API_PORT.*occupied/);
});

test("invalid and identical application ports fail before launching apps", async (t) => {
  const { environment, run } = await setup(t);
  for (const value of ["0", "65536", "8081oops", "-1"]) {
    const result = await run({ ARC_API_PORT: value });
    assert.equal(result.code, 1, value);
    assert.match(
      result.output,
      /ARC_API_PORT must be an integer from 1 to 65535/,
    );
  }
  const identical = await run({ ARC_WEB_PORT: environment.ARC_API_PORT });
  assert.equal(identical.code, 1);
  assert.match(identical.output, /must use different ports/);
});

test("a stopped database produces an actionable error without credentials", async (t) => {
  const { environment, database, run } = await setup(t);
  await close(database);
  const result = await run({
    DB_URL: `${environment.DB_URL}?password=${environment.DB_PASSWORD}`,
  });
  assert.equal(result.code, 1);
  assert.match(result.output, /PostgreSQL is not reachable/);
  assert.match(result.output, /Start PostgreSQL or correct DB_URL/);
  assert.ok(!result.output.includes(environment.DB_PASSWORD));
  assert.ok(!result.output.includes(environment.DB_URL));
});

test("Maven's actual JVM must be Java 21", async (t) => {
  const { run } = await setup(t);
  const result = await run({ TEST_JAVA_MAJOR: "25" });
  assert.equal(result.code, 1);
  assert.match(result.output, /Maven must use Java 21/);
});

test("unconfigured example credentials fail with a setup instruction", async (t) => {
  const { run } = await setup(t);
  const result = await run({
    DB_PASSWORD: "replace-with-the-password-you-chose",
  });
  assert.equal(result.code, 1);
  assert.match(
    result.output,
    /DB_PASSWORD still contains the example placeholder/,
  );
});

test("advanced JDBC URLs remain JDBC's responsibility", async (t) => {
  const { run } = await setup(t);
  for (const url of [
    "jdbc:postgresql://db-a:5432,db-b:5432/arc",
    "jdbc:postgresql:arc",
    "jdbc:postgresql://localhost/arc?socketFactory=custom.Factory",
  ]) {
    const result = await run({ DB_URL: url });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /Database TCP probe skipped/);
  }
});
