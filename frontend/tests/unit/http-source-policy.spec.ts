import { expect, test } from "@playwright/test";
import { httpUrlProblem } from "../../src/features/sources/httpSourcePolicy";

const unparsable = "Provide an absolute HTTP(S) URL.";
const noHost = "Use an HTTP(S) URL without credentials or fragment.";
const port = "Use a port from 1 to 65535.";

// Each authority below was run through java.net.URI: the server reads a host
// from the first list and none from the second, where the URL came back as a
// generic 422 instead of a field problem (lesson F34).
test("an HTTP URL is accepted exactly when java.net.URI reads a host from it", () => {
  for (const authority of [
    "example.com",
    "EXAMPLE.com",
    "localhost.",
    "a.b-c.d",
    "1-a.b",
    "1a",
    "123",
    "1.a",
    "a1.b2",
    "x-y.z-w",
    "xn--bcher-kva.example",
    "192.168.1.1",
    "[::1]",
    "[::]",
    "[::1]:8080",
    "[2001:db8::1]",
    "[1:2:3:4:5:6:7:8]",
    "[1:2:3:4:5:6:7::]",
    "[::1:2:3:4:5:6:7]",
    "[::ffff:192.168.0.1]",
    "[1:2:3:4:5:6:1.2.3.4]",
    "[fe80::1%25eth0]",
    "[FE80::1]",
    "host:",
    "host:08",
  ])
    expect(httpUrlProblem(`http://${authority}/x`), authority).toBeNull();
  for (const authority of [
    "my_host",
    "x_y.example.com",
    "example.123",
    "host-",
    "-host",
    "a..b",
    ".a",
    "host..",
    "256.0.0.1",
    "999.1.1.1",
    "1.2.3.4.5",
    "1.2.3",
    "192.168.1",
    "1.2.3.4a",
    "a.1b",
    "1a.2b",
    "a.b.c.9",
    "ho%41st",
    "例え.jp",
    "host:8a",
    "host:1:2",
    "host:80:",
    ":80",
    "host:2147483648",
    "",
  ])
    expect(httpUrlProblem(`http://${authority}/x`), authority).toBe(noHost);
});

test("a malformed IPv6 literal or a bare scheme is no URL at all for the server", () => {
  for (const authority of [
    "[zz]",
    "[1]",
    "[]",
    "[1.2.3.4]",
    "[1::2::3]",
    "[::g]",
    "[12345::1]",
    "[1:2:3:4:5:6:7:8:9]",
    "[::1:2:3:4:5:6:7:8]",
    "[1:2:3:4:5:6:7:1.2.3.4]",
    "[::ffff:1.2.3]",
    "[::1]x",
    "a[b]",
  ])
    expect(httpUrlProblem(`http://${authority}/x`), authority).toBe(unparsable);
  expect(httpUrlProblem("http://")).toBe(unparsable);
  expect(httpUrlProblem("http:///x")).toBe(noHost);
});

test("a port the server reads is checked against its range after the host", () => {
  for (const authority of ["host:0", "host:65536", "host:2147483647"])
    expect(httpUrlProblem(`http://${authority}/x`), authority).toBe(port);
  expect(httpUrlProblem("http://host:65535/x")).toBeNull();
  // A host the server cannot read is refused before its port is judged.
  expect(httpUrlProblem("http://my_host:0/x")).toBe(noHost);
});
