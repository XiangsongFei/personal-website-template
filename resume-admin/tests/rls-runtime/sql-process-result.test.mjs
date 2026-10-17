import assert from "node:assert/strict";
import test from "node:test";
import { assertExpectedSqlFailure } from "./sql-process-result.mjs";

test("expected SQL failure requires nonzero exit and the exact diagnostic", () => {
  const result = assertExpectedSqlFailure({
    status: 3,
    stdout: "",
    stderr: "ERROR: Legacy or incomplete Awards idempotency result cannot be replayed safely\n",
  }, /Legacy or incomplete Awards idempotency result cannot be replayed safely/, "malformed replay");

  assert.equal(result.status, 3);
  assert.match(result.output, /ERROR: Legacy or incomplete Awards idempotency result cannot be replayed safely/);
});

test("expected diagnostic with successful SQL exit is rejected", () => {
  assert.throws(() => assertExpectedSqlFailure({
    status: 0,
    stdout: "Legacy or incomplete Awards idempotency result cannot be replayed safely",
    stderr: "",
  }, /Legacy or incomplete Awards idempotency result cannot be replayed safely/, "malformed replay"), /must reject the request/);
});

test("nonzero SQL exit with a different diagnostic is rejected", () => {
  assert.throws(() => assertExpectedSqlFailure({
    status: 3,
    stdout: "",
    stderr: "ERROR: permission denied",
  }, /Legacy or incomplete Awards idempotency result cannot be replayed safely/, "malformed replay"), /must return the expected rejection/);
});

test("abnormal process termination is rejected", () => {
  assert.throws(() => assertExpectedSqlFailure({ status: null, signal: "SIGTERM", stdout: "", stderr: "" },
    /expected/, "malformed replay"), /must exit normally/);
});

test("process launch errors are propagated", () => {
  const launchError = new Error("spawn failed");
  assert.throws(() => assertExpectedSqlFailure({ error: launchError, status: null }, /expected/, "malformed replay"), launchError);
});
