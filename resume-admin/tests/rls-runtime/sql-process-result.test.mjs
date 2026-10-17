import { describe, expect, it } from "vitest";
import { assertExpectedSqlFailure } from "./sql-process-result.mjs";

describe("expected SQL failure assertions", () => {
  it("requires nonzero exit and the exact diagnostic", () => {
    const result = assertExpectedSqlFailure({
      status: 3,
      stdout: "",
      stderr: "ERROR: Legacy or incomplete Awards idempotency result cannot be replayed safely\n",
    }, /Legacy or incomplete Awards idempotency result cannot be replayed safely/, "malformed replay");

    expect(result.status).toBe(3);
    expect(result.output).toMatch(/ERROR: Legacy or incomplete Awards idempotency result cannot be replayed safely/);
  });

  it("rejects the expected diagnostic with a successful SQL exit", () => {
    expect(() => assertExpectedSqlFailure({
      status: 0,
      stdout: "Legacy or incomplete Awards idempotency result cannot be replayed safely",
      stderr: "",
    }, /Legacy or incomplete Awards idempotency result cannot be replayed safely/, "malformed replay"))
      .toThrow(/must reject the request/);
  });

  it("rejects a nonzero SQL exit with a different diagnostic", () => {
    expect(() => assertExpectedSqlFailure({
      status: 3,
      stdout: "",
      stderr: "ERROR: permission denied",
    }, /Legacy or incomplete Awards idempotency result cannot be replayed safely/, "malformed replay"))
      .toThrow(/must return the expected rejection/);
  });

  it("rejects abnormal process termination", () => {
    expect(() => assertExpectedSqlFailure({ status: null, signal: "SIGTERM", stdout: "", stderr: "" },
      /expected/, "malformed replay")).toThrow(/must exit normally/);
  });

  it("propagates process launch errors", () => {
    const launchError = new Error("spawn failed");
    expect(() => assertExpectedSqlFailure({ error: launchError, status: null }, /expected/, "malformed replay"))
      .toThrow(launchError);
  });
});
