import assert from 'node:assert/strict';
import test from 'node:test';
import { renderS37ClosedOwnerConstraintsFixture } from '../../scripts/s37-hosted/closed-owner-constraints-fixture.mjs';

const pins = Object.freeze({ clusterSha256: '1'.repeat(64), fixtureMarker: '2'.repeat(64),
  retainedSha256: '3'.repeat(64), postmasterStarted: '2026-01-01T00:00:00.123456Z' });

test('renders a deterministic closed fixture transaction without connection or privilege instructions', () => {
  const rendered = renderS37ClosedOwnerConstraintsFixture(pins);
  assert.equal(rendered, renderS37ClosedOwnerConstraintsFixture({ ...pins }));
  assert.match(rendered, /^BEGIN;[\s\S]*COMMIT;\n$/);
  assert.match(rendered, /current_database\(\) <> 's37_closed_install_fixture'/);
  assert.match(rendered, /inet_server_addr\(\) IS NOT NULL/);
  assert.match(rendered, /CREATE UNIQUE INDEX one_open_run ON s37_fixture_l1.runs \(\(true\)\) WHERE closed_at IS NULL;/);
  assert.match(rendered, /ADD CONSTRAINT one_owner_per_run UNIQUE \(run_id\)/);
  assert.doesNotMatch(rendered, /\b(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|CREATE ROLE|ALTER ROLE|CREATE SCHEMA)\b|https?:\/\//i);
});

for (const [name, change] of [
  ['arbitrary target', { database: 'other_database' }],
  ['short cluster pin', { clusterSha256: 'bad' }],
  ['quote in fixture marker', { fixtureMarker: "'; SELECT 1;" }],
  ['quote in timestamp', { postmasterStarted: "2026-01-01T00:00:00.123456Z'" }],
  ['quote in retained pin', { retainedSha256: "' OR true" }],
]) {
  test('refuses ' + name, () => {
    assert.throws(() => renderS37ClosedOwnerConstraintsFixture({ ...pins, ...change }),
      { message: 'S37_FIXTURE_INVALID_PINS' });
  });
}

test('interpolates only the captured, validated pins', () => {
  let reads = 0;
  const rendered = renderS37ClosedOwnerConstraintsFixture({
    ...pins,
    get fixtureMarker() {
      return ++reads === 1 ? pins.fixtureMarker : "'; SELECT 1; --";
    },
  });
  assert.equal(reads, 1);
  assert.equal(rendered, renderS37ClosedOwnerConstraintsFixture(pins));
});
