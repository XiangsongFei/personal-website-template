import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyPaths, evaluateGate, getChangedPaths } from './pr-validation-gate.mjs';

test('classifies Admin-only changes', () => {
  assert.deepEqual(classifyPaths(['resume-admin/src/App.tsx']), { admin: true, public: false });
});

test('classifies Public-only changes using existing Public workflow paths', () => {
  assert.deepEqual(classifyPaths(['worker/index.ts', 'wrangler.jsonc']), { admin: false, public: true });
});

test('classifies combined Admin and Public changes', () => {
  assert.deepEqual(classifyPaths(['resume-admin/src/App.tsx', 'app/page.tsx']), { admin: true, public: true });
});

test('allows documentation-only changes outside validation scopes', () => {
  assert.deepEqual(classifyPaths(['docs/release-process.md', 'contributing/guide.rst']), { admin: false, public: false });
});

test('runs both suites for workflow-only changes', () => {
  assert.deepEqual(classifyPaths(['.github/workflows/new-check.yml']), { admin: true, public: true });
});

test('fails closed by running both suites for unknown non-documentation paths', () => {
  assert.deepEqual(classifyPaths(['infra/deploy.toml']), { admin: true, public: true });
});

test('retains existing documentation paths in their current validation scope', () => {
  assert.deepEqual(classifyPaths(['README.md', 'resume-admin/README.md']), { admin: true, public: true });
});

test('classifies deleted paths and both sides of a rename', () => {
  assert.deepEqual(classifyPaths(['resume-admin/removed.tsx']), { admin: true, public: false });
  assert.deepEqual(classifyPaths(['resume-admin/renamed.tsx', 'app/renamed.tsx']), { admin: true, public: true });
});

test('Git diff reports deleted and renamed paths without losing either side', () => {
  const repo = mkdtempSync(join(tmpdir(), 'pr-validation-paths-'));
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };

  try {
    git(['init', '-q']);
    git(['config', 'user.name', 'PR validation test']);
    git(['config', 'user.email', 'pr-validation-test@example.invalid']);
    mkdirSync(join(repo, 'resume-admin'), { recursive: true });
    writeFileSync(join(repo, 'resume-admin', 'renamed.tsx'), 'base');
    writeFileSync(join(repo, 'resume-admin', 'deleted.tsx'), 'base');
    git(['add', '.']);
    git(['commit', '-qm', 'base']);
    const baseSha = git(['rev-parse', 'HEAD']);

    mkdirSync(join(repo, 'app'), { recursive: true });
    git(['mv', 'resume-admin/renamed.tsx', 'app/renamed.tsx']);
    git(['rm', 'resume-admin/deleted.tsx']);
    git(['commit', '-qm', 'rename and delete']);

    assert.deepEqual(getChangedPaths(baseSha, repo).sort(), [
      'app/renamed.tsx',
      'resume-admin/deleted.tsx',
      'resume-admin/renamed.tsx',
    ]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test('rejects an empty changed-path list', () => {
  assert.throws(() => classifyPaths([]), /non-empty array/);
});

function validAdminOnlyGate(overrides = {}) {
  return {
    detectorResult: 'success',
    adminApplicable: 'true',
    publicApplicable: 'false',
    ADMIN_FRONTEND_RESULT: 'success',
    ADMIN_MIGRATION_RESULT: 'success',
    ADMIN_LOCAL_SQL_RESULT: 'success',
    PUBLIC_RESULT: 'skipped',
    ...overrides,
  };
}

test('passes when all applicable checks succeed and non-applicable checks skip', () => {
  assert.deepEqual(evaluateGate(validAdminOnlyGate()), { passed: true, failures: [] });
});

test('fails when change detection fails', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({ detectorResult: 'failure' })).passed, false);
});

test('fails closed for missing applicability outputs', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({ adminApplicable: undefined })).passed, false);
  assert.equal(evaluateGate(validAdminOnlyGate({ publicApplicable: undefined })).passed, false);
});

test('fails closed for invalid applicability outputs', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({ adminApplicable: 'yes' })).passed, false);
  assert.equal(evaluateGate(validAdminOnlyGate({ publicApplicable: '' })).passed, false);
});

test('fails when an applicable job fails', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({ ADMIN_MIGRATION_RESULT: 'failure' })).passed, false);
});

test('fails when an applicable job is cancelled or times out', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({ ADMIN_LOCAL_SQL_RESULT: 'cancelled' })).passed, false);
  assert.equal(evaluateGate(validAdminOnlyGate({ ADMIN_LOCAL_SQL_RESULT: 'timed_out' })).passed, false);
});

test('fails when an applicable job is skipped or its result is missing', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({ ADMIN_FRONTEND_RESULT: 'skipped' })).passed, false);
  assert.equal(evaluateGate(validAdminOnlyGate({ ADMIN_FRONTEND_RESULT: undefined })).passed, false);
});

test('fails when a non-applicable job unexpectedly executes', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({ PUBLIC_RESULT: 'success' })).passed, false);
});

test('fails when a non-applicable job fails or is cancelled instead of skipping', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({ PUBLIC_RESULT: 'failure' })).passed, false);
  assert.equal(evaluateGate(validAdminOnlyGate({ PUBLIC_RESULT: 'cancelled' })).passed, false);
});

test('fails when the detector result is missing', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({ detectorResult: undefined })).passed, false);
});
