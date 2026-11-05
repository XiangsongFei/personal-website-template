import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { classifyPaths, evaluateGate, getChangedPaths } from './pr-validation-gate.mjs';

test('classifies Admin-only changes', () => {
  assert.deepEqual(classifyPaths(['resume-admin/src/App.tsx']), { admin: true, public: false, users: false, admin_dependencies: false });
});

test('classifies Public-only changes using existing Public workflow paths', () => {
  assert.deepEqual(classifyPaths(['worker/index.ts', 'wrangler.jsonc']), { admin: false, public: true, users: false, admin_dependencies: false });
});

test('classifies combined Admin and Public changes', () => {
  assert.deepEqual(classifyPaths(['resume-admin/src/App.tsx', 'app/page.tsx']), { admin: true, public: true, users: false, admin_dependencies: false });
});

test('allows documentation-only changes outside validation scopes', () => {
  assert.deepEqual(classifyPaths(['docs/release-process.md', 'contributing/guide.rst']), { admin: false, public: false, users: false, admin_dependencies: false });
});

test('runs all application suites for workflow-only changes', () => {
  assert.deepEqual(classifyPaths(['.github/workflows/new-check.yml']), { admin: true, public: true, users: true, admin_dependencies: false });
});

test('fails closed by running all application suites for unknown non-documentation paths', () => {
  assert.deepEqual(classifyPaths(['infra/deploy.toml']), { admin: true, public: true, users: true, admin_dependencies: false });
});

test('retains existing documentation paths in their current validation scope', () => {
  assert.deepEqual(classifyPaths(['README.md', 'resume-admin/README.md']), { admin: true, public: true, users: false, admin_dependencies: false });
});

test('classifies deleted paths and both sides of a rename', () => {
  assert.deepEqual(classifyPaths(['resume-admin/removed.tsx']), { admin: true, public: false, users: false, admin_dependencies: false });
  assert.deepEqual(classifyPaths(['resume-admin/renamed.tsx', 'app/renamed.tsx']), { admin: true, public: true, users: false, admin_dependencies: false });
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
    usersApplicable: 'false',
    adminDependenciesApplicable: 'false',
    USERS_RESULT: 'skipped',
    ADMIN_AUDIT_RESULT: 'skipped',
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

// Dependency audit is required only for actual Admin manifest/lock changes.
test('Users paths (including docs and deleted files) do not trigger Admin or Public', () => {
  assert.deepEqual(classifyPaths(['example-cv-users/app/login/page.tsx', 'example-cv-users/docs/TESTING.md']), {admin:false, public:false, users:true, admin_dependencies:false});
});
test('all projects and both Admin dependency files classify independently', () => {
  for (const file of ['resume-admin/package.json','resume-admin/package-lock.json']) {
    assert.deepEqual(classifyPaths([file]), {admin:true, public:false, users:false, admin_dependencies:true});
  }
  assert.deepEqual(classifyPaths(['example-cv-users/package.json','resume-admin/src/App.tsx','app/page.tsx']), {admin:true,public:true,users:true,admin_dependencies:false});
});
test('shared gates conservatively run all suites, without unrelated Admin audit', () => {
  assert.deepEqual(classifyPaths(['.github/scripts/pr-validation-gate.mjs']), {admin:true,public:true,users:true,admin_dependencies:false});
});
test('Users job must run and succeed when applicable', () => {
  const input=validAdminOnlyGate({adminApplicable:'false',usersApplicable:'true',ADMIN_FRONTEND_RESULT:'skipped',ADMIN_MIGRATION_RESULT:'skipped',ADMIN_LOCAL_SQL_RESULT:'skipped',USERS_RESULT:'success'});
  assert.equal(evaluateGate(input).passed,true);
  for (const status of [undefined,'skipped','failure','cancelled','timed_out']) assert.equal(evaluateGate({...input,USERS_RESULT:status}).passed,false);
});
test('Admin audit cannot skip when dependency files change and must skip otherwise', () => {
  assert.equal(evaluateGate(validAdminOnlyGate({adminDependenciesApplicable:'true',ADMIN_AUDIT_RESULT:'success'})).passed,true);
  for (const status of [undefined,'skipped','failure']) assert.equal(evaluateGate(validAdminOnlyGate({adminDependenciesApplicable:'true',ADMIN_AUDIT_RESULT:status})).passed,false);
  assert.equal(evaluateGate(validAdminOnlyGate({ADMIN_AUDIT_RESULT:'success'})).passed,false);
});
test('new applicability flags fail closed when absent or invalid', () => {
  for (const key of ['usersApplicable','adminDependenciesApplicable']) for (const value of [undefined,'','yes']) assert.equal(evaluateGate(validAdminOnlyGate({[key]:value})).passed,false);
});

test('workflow wires Users and conditional Admin audit into required gate', async () => {
  const {readFileSync}=await import('node:fs');
  const workflow=readFileSync(new URL('../workflows/pr-validation.yml',import.meta.url),'utf8');
  const users=workflow.split('  users_tests_build:\n')[1].split('  required-pr-validation-gate:')[0];
  assert.match(users,/if: needs\.detect_changes\.outputs\.users == 'true'/);
  assert.match(users,/node-version: '24\.22\.1'/);
  assert.match(users,/working-directory: example-cv-users/);
  for (const command of ['npm ci','npm run build','npm run typecheck','npm test','npm audit']) assert.ok(users.includes(`run: ${command}`));
  assert.doesNotMatch(users,/secrets\.|remote: true|continue-on-error/);
  const audit=workflow.split('  admin_dependencies_audit:\n')[1].split('  users_tests_build:')[0];
  assert.match(audit,/if: needs\.detect_changes\.outputs\.admin_dependencies == 'true'/);
  assert.match(audit,/run: npm audit/);assert.doesNotMatch(audit,/continue-on-error/);
  const admin=workflow.split('  admin_frontend_worker_audit:\n')[1].split('  admin_migration_consistency:')[0];
  assert.doesNotMatch(admin,/npm audit/);
  const gate=workflow.split('  required-pr-validation-gate:\n')[1];
  for(const job of ['users_tests_build','admin_dependencies_audit']) assert.ok(gate.includes(`- ${job}`));
  for(const pair of ['USERS_RESULT: ${{ needs.users_tests_build.result }}','ADMIN_AUDIT_RESULT: ${{ needs.admin_dependencies_audit.result }}','USERS_APPLICABLE: ${{ needs.detect_changes.outputs.users }}','ADMIN_DEPENDENCIES_APPLICABLE: ${{ needs.detect_changes.outputs.admin_dependencies }}']) assert.ok(gate.includes(pair));
});

test('Admin dependency applicability cannot suppress Admin application checks', () => {
 assert.equal(evaluateGate(validAdminOnlyGate({adminApplicable:'false',adminDependenciesApplicable:'true',ADMIN_AUDIT_RESULT:'success',ADMIN_FRONTEND_RESULT:'skipped',ADMIN_MIGRATION_RESULT:'skipped',ADMIN_LOCAL_SQL_RESULT:'skipped'})).passed,false);
});
