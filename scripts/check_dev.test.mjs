import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
  return { environment, database, run };
}

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
