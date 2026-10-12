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
