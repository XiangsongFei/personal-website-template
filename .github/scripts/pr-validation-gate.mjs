import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const publicPrefixes = [
  'app/',
  'build/',
  'db/',
  'drizzle/',
  'examples/',
  'public/',
  'shared/',
  'tests/',
  'worker/',
];

const publicFiles = new Set([
  'drizzle.config.ts',
  'eslint.config.mjs',
  'next.config.ts',
  'package.json',
  'package-lock.json',
  'postcss.config.mjs',
  'tsconfig.json',
  'vite.config.ts',
  'wrangler.jsonc',
  'wrangler.example.jsonc',
  '.github/workflows/public-pr.yml',
]);

const suiteResults = [
  ['admin frontend/Worker/build/audit', 'ADMIN_FRONTEND_RESULT'],
  ['Admin migration consistency', 'ADMIN_MIGRATION_RESULT'],
  ['Admin local SQL', 'ADMIN_LOCAL_SQL_RESULT'],
  ['Public tests/build', 'PUBLIC_RESULT'],
];

function isPublicPath(path) {
  return (
    publicPrefixes.some((prefix) => path.startsWith(prefix)) ||
    publicFiles.has(path) ||
    (path.startsWith('README') && !path.includes('/'))
  );
}

function isDocumentationPath(path) {
  if (path.startsWith('.github/')) return false;
  return /\.(?:md|mdx|rst|adoc)$/i.test(path);
}

export function classifyPaths(paths) {
  if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => typeof path !== 'string' || path.length === 0)) {
    throw new TypeError('Changed paths must be a non-empty array of non-empty strings.');
  }

  let admin = false;
  let publicSite = false;

  for (const path of paths) {
    if (path.startsWith('.github/workflows/')) {
      admin = true;
      publicSite = true;
      continue;
    }

    if (path.startsWith('resume-admin/')) admin = true;
    if (isPublicPath(path)) publicSite = true;

    if (!path.startsWith('resume-admin/') && !isPublicPath(path) && !isDocumentationPath(path)) {
      admin = true;
      publicSite = true;
    }
  }

  return { admin, public: publicSite };
}

function parseApplicability(value, name, failures) {
  if (value === 'true') return true;
  if (value === 'false') return false;
  failures.push(`${name} applicability is missing or invalid.`);
  return null;
}

function checkJobResult(name, applicable, result, failures) {
  if (applicable === null) return;
  if (applicable && result !== 'success') {
    failures.push(`${name} applies but its result is ${result ?? 'missing'}, not success.`);
  } else if (!applicable && result !== 'skipped') {
    failures.push(`${name} does not apply but its result is ${result ?? 'missing'}, not skipped.`);
  }
}

export function evaluateGate(input) {
  const failures = [];

  if (input.detectorResult !== 'success') {
    failures.push(`Change detection result is ${input.detectorResult ?? 'missing'}, not success.`);
  }

  const adminApplicable = parseApplicability(input.adminApplicable, 'Admin', failures);
  const publicApplicable = parseApplicability(input.publicApplicable, 'Public', failures);

  for (const [name, key] of suiteResults.slice(0, 3)) {
    checkJobResult(name, adminApplicable, input[key], failures);
  }
  checkJobResult(suiteResults[3][0], publicApplicable, input[suiteResults[3][1]], failures);

  return { passed: failures.length === 0, failures };
}

export function getChangedPaths(baseSha, cwd = process.cwd()) {
  if (!/^[0-9a-f]{40}$/i.test(baseSha ?? '')) {
    throw new Error('BASE_SHA is missing or invalid.');
  }

  const diff = spawnSync('git', ['diff', '--name-only', '--no-renames', '-z', `${baseSha}...HEAD`], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
  if (diff.error || diff.status !== 0) {
    throw new Error(`Unable to classify the pull request diff${diff.stderr ? `: ${diff.stderr.trim()}` : '.'}`);
  }

  return diff.stdout.split('\0').filter(Boolean);
}

function writeClassification() {
  const baseSha = process.env.BASE_SHA;
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) throw new Error('GITHUB_OUTPUT is missing.');

  const paths = getChangedPaths(baseSha);
  if (paths.length === 0) throw new Error('The pull request diff is empty; refusing to skip validation.');

  const classification = classifyPaths(paths);
  appendFileSync(outputPath, `admin=${classification.admin}\npublic=${classification.public}\n`);
  console.log(`Classified ${paths.length} changed path(s): Admin=${classification.admin}, Public=${classification.public}.`);
}

function runGate() {
  const result = evaluateGate({
    detectorResult: process.env.DETECTOR_RESULT,
    adminApplicable: process.env.ADMIN_APPLICABLE,
    publicApplicable: process.env.PUBLIC_APPLICABLE,
    ADMIN_FRONTEND_RESULT: process.env.ADMIN_FRONTEND_RESULT,
    ADMIN_MIGRATION_RESULT: process.env.ADMIN_MIGRATION_RESULT,
    ADMIN_LOCAL_SQL_RESULT: process.env.ADMIN_LOCAL_SQL_RESULT,
    PUBLIC_RESULT: process.env.PUBLIC_RESULT,
  });

  if (result.passed) {
    console.log('Required PR validation gate passed.');
    return;
  }

  for (const failure of result.failures) console.error(`::error::${failure}`);
  process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const mode = process.argv[2];
  try {
    if (mode === 'classify') writeClassification();
    else if (mode === 'gate') runGate();
    else throw new Error('Expected mode "classify" or "gate".');
  } catch (error) {
    console.error(`::error::${error instanceof Error ? error.message : 'PR validation gate utility failed.'}`);
    process.exitCode = 1;
  }
}
