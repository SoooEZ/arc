import { spawnSync } from "node:child_process";
import net from "node:net";

const failures = [];
const sourceRoots = ["backend/src/main/java", "backend/src/test/java"];
const extraSources = spawnSync(
  "git",
  ["ls-files", "--others", "-z", "--", ...sourceRoots],
  {
    encoding: "utf8",
    timeout: 10_000,
  },
);
if (extraSources.status === 0) {
  // Include ignored files: javac compiles every source in these directories.
  const candidates = extraSources.stdout
    .split("\0")
    .filter((file) => file.endsWith(".java"));
  if (candidates.length) {
    const history = spawnSync(
      "git",
      [
        "log",
        "--format=",
        "--name-only",
        "--diff-filter=D",
        "--no-renames",
        "-z",
        "HEAD",
        "--",
        ...sourceRoots,
      ],
      { encoding: "utf8", timeout: 10_000 },
    );
    if (history.status === 0) {
      const deleted = new Set(history.stdout.split("\0"));
      const obsolete = candidates.filter((file) => deleted.has(file));
      if (obsolete.length) {
        failures.push(
          `Previously deleted Java sources remain in this checkout:\n${obsolete.map((file) => `  ${file}`).join("\n")}\nBack up and review these files, then move obsolete copies outside backend/src. Maven clean removes target, not Java source files; old test sources also break spring-boot:run. No files were changed.`,
        );
      }
    } else {
      console.log(
        "Old Java source check skipped: Git deletion history is unavailable.",
      );
    }
  }
} else {
  console.log(
    "Old Java source check skipped: this directory is not an accessible Git checkout.",
  );
}

const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor < 24) {
  failures.push(
    "Node.js 24 or newer is required. Select it in PATH, then retry.",
  );
}

const maven = spawnSync("mvn", ["-v"], {
  encoding: "utf8",
  timeout: 10_000,
});
// Inspect Maven's JVM, which may differ from the shell's `java` executable.
const mavenVersion = `${maven.stdout || ""}\n${maven.stderr || ""}`.replace(
  /\u001b\[[0-?]*[ -/]*[@-~]/g,
  "",
);
if (maven.error || maven.status !== 0) {
  failures.push(
    "Maven could not run. Check mvn -v and your JAVA_HOME/PATH settings.",
  );
} else if (mavenVersion.match(/Java version:\s*(\d+)/)?.[1] !== "21") {
  failures.push(
    "Maven must use Java 21. Set JAVA_HOME/PATH and verify with mvn -v.",
  );
}

function configuredPort(name, fallback) {
  const value = process.env[name] || String(fallback);
  if (!/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) {
    failures.push(
      `${name} must be an integer from 1 to 65535. Correct your environment file.`,
    );
    return null;
  }
  return Number(value);
}

const apiPort = configuredPort("ARC_API_PORT", 8080);
const webPort = configuredPort("ARC_WEB_PORT", 3080);
if (apiPort !== null && apiPort === webPort) {
  failures.push("ARC_API_PORT and ARC_WEB_PORT must use different ports.");
}

function probePort(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", (error) => resolve(error.code));
    server.listen({ port, host, ipv6Only: net.isIPv6(host) }, () => {
      server.close(() => resolve(null));
    });
  });
}

async function checkPort(name, port) {
  if (port === null) return;
  // On macOS a wildcard bind can coexist with a loopback-specific listener.
  for (const host of ["127.0.0.1", "0.0.0.0", "::1", "::"]) {
    const error = await probePort(port, host);
    // An OS without IPv6 still supports the application's IPv4 listener.
    if (
      net.isIPv6(host) &&
      ["EAFNOSUPPORT", "EADDRNOTAVAIL", "EPROTONOSUPPORT"].includes(error)
    ) {
      continue;
    }
    if (error === "EADDRINUSE") {
      failures.push(
        `${name} port ${port} is occupied. Stop its listener or choose a free port in your environment file.`,
      );
      return;
    }
    if (error) {
      failures.push(
        `${name} port ${port} could not be checked (${error}). Check local network permissions before starting.`,
      );
      return;
    }
  }
}

await checkPort("ARC_API_PORT", apiPort);
await checkPort("ARC_WEB_PORT", webPort);

if (process.env.DB_PASSWORD === "replace-with-the-password-you-chose") {
  failures.push(
    "DB_PASSWORD still contains the example placeholder. Set the password for your PostgreSQL role in your environment file.",
  );
}

function databaseAddress(jdbcUrl) {
  // Probe only the ordinary single-host URL. PostgreSQL JDBC owns other valid
  // forms, including multi-host addresses and custom socket factories.
  if (!/^jdbc:postgresql:\/\//.test(jdbcUrl)) return null;
  try {
    const url = new URL(jdbcUrl.slice("jdbc:".length));
    if (
      !url.hostname ||
      url.hostname.includes(",") ||
      url.username ||
      url.password ||
      url.hash
    ) {
      return null;
    }
    if ([...url.searchParams.keys()].some((key) => /socketfactory/i.test(key)))
      return null;
    const port = url.port ? Number(url.port) : 5432;
    if (port < 1 || port > 65535) return null;
    return { host: url.hostname.replace(/^\[|\]$/g, ""), port };
  } catch {
    return null;
  }
}

function probeDatabase(address) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    const timer = setTimeout(() => finish(false), 3000);
    function finish(reachable) {
      clearTimeout(timer);
      socket.destroy();
      resolve(reachable);
    }
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.connect(address.port, address.host);
  });
}

const address = databaseAddress(
  process.env.DB_URL ?? "jdbc:postgresql://localhost:5432/arc",
);
if (address === null) {
  console.log(
    "Database TCP probe skipped for this DB_URL form; PostgreSQL JDBC will validate it at startup.",
  );
} else if (!(await probeDatabase(address))) {
  failures.push(
    "PostgreSQL is not reachable at the host/port configured by DB_URL. Start PostgreSQL or correct DB_URL; a Docker database needs an explicit host port to accept native connections.",
  );
}

if (failures.length) {
  for (const failure of failures) console.error(`Cannot start ARC: ${failure}`);
  process.exitCode = 1;
} else {
  console.log(
    "Native startup checks passed. The database probe checks TCP reachability only; JDBC verifies credentials at startup.",
  );
}
