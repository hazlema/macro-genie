import { test } from "node:test";
import assert from "node:assert/strict";
import { strictSsl } from "../server/db.js";

test("weak sslmode values become verify-full, so pg keeps checking the certificate", () => {
  assert.equal(
    strictSsl(
      "postgresql://u:p@host/db?sslmode=require&channel_binding=require",
    ),
    "postgresql://u:p@host/db?sslmode=verify-full&channel_binding=require",
  );
  assert.equal(
    strictSsl("postgres://h/db?a=1&sslmode=prefer"),
    "postgres://h/db?a=1&sslmode=verify-full",
  );
  assert.equal(
    strictSsl("postgres://h/db?sslmode=verify-ca"),
    "postgres://h/db?sslmode=verify-full",
  );
  assert.equal(
    strictSsl("postgres://h/db?sslmode=disable"),
    "postgres://h/db?sslmode=disable",
  );
  assert.equal(strictSsl("postgres://h/db"), "postgres://h/db");
  assert.equal(strictSsl(undefined), undefined);
});

test("a rejected password or unreachable host counts as the database being down", async () => {
  const { isDatabaseDown } = await import("../server/db.js");
  assert.equal(isDatabaseDown({ code: "28P01", message: "password authentication failed" }), true);
  assert.equal(isDatabaseDown({ code: "ENOTFOUND", message: "getaddrinfo ENOTFOUND" }), true);
  assert.equal(isDatabaseDown({ message: "The endpoint has been disabled." }), true);
  assert.equal(isDatabaseDown({ code: "42P01", message: 'relation "x" does not exist' }), false);
  assert.equal(isDatabaseDown(undefined), false);
});

test("a down database gives visitors a 503 and logs a hint about the password", async (t) => {
  const { fail } = await import("../server/http.js");
  const logged = [];
  t.mock.method(console, "error", (line) => logged.push(line));
  const response = fail(Object.assign(new Error("password authentication failed for user 'x'"), { code: "28P01" }));
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /database isn't responding/);
  assert.match(logged.join(" "), /Database not responding.*rotated password/);
});
