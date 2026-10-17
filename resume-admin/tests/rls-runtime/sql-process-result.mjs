import assert from "node:assert/strict";

export function assertExpectedSqlFailure(result, expectedMessage, label) {
  if (result.error) throw result.error;
  assert.ok(Number.isInteger(result.status), `${label}: PostgreSQL process must exit normally`);
  assert.notEqual(result.status, 0, `${label}: PostgreSQL must reject the request`);
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  assert.match(output, expectedMessage, `${label}: PostgreSQL must return the expected rejection`);
  return { status: result.status, output };
}
