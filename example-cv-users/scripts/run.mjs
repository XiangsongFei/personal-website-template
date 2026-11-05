import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { existsSync, lstatSync, mkdirSync, rmSync } from 'node:fs';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const task = process.argv[2];
if(process.versions.node!=='24.13.0')throw Error('Use the existing Node v24.13.0 executable');
const commands = { build: ['node_modules/vite/bin/vite.js', 'build'], dev: ['scripts/local.mjs'], https: ['scripts/local-https.mjs'], types: ['node_modules/wrangler/bin/wrangler.js', 'types'] };
if (!Object.hasOwn(commands, task)) throw Error('unsupported_local_task');
mkdirSync(resolve(root,'.runtime'),{recursive:true});
if(task==='build') {
  const dist=resolve(root,'dist');
  if(existsSync(dist)&&lstatSync(dist).isSymbolicLink())throw Error('build_directory_symlink');
  rmSync(dist,{recursive:true,force:true}); // Only this package's generated build.
}
const env = { PATH: dirname(process.execPath) + ':/usr/bin:/bin', HOME: process.env.HOME, TMPDIR: process.env.TMPDIR,
  WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: resolve(root, '.runtime/wrangler.log'),
  CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV: 'false', CI: '1' };
const child = spawn(process.execPath, commands[task], { cwd: root, env, stdio: 'inherit' });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('exit', code => { process.exitCode = code ?? 1; });
