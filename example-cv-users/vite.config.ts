import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';
import vinext from 'vinext';
import { cloudflare } from '@cloudflare/vite-plugin';
const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig({
  root, envDir: false, cacheDir: resolve(root, '.runtime/vite-cache'), logLevel: 'error',
  server: { host: '127.0.0.1', port: 8795, strictPort: true },
  plugins: [vinext(), cloudflare({ configPath: resolve(root, 'wrangler.jsonc'), remoteBindings: false,
    persistState: { path: resolve(root, '.runtime/miniflare') }, inspectorPort: false,
    viteEnvironment: { name: 'rsc', childEnvironments: ['ssr'] } })],
});
