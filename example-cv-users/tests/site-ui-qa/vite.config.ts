import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({
 root:fileURLToPath(new URL('.',import.meta.url)),envDir:false,
 cacheDir:fileURLToPath(new URL('../../.runtime/site-ui-vite-cache',import.meta.url)),
 plugins:[react()],
 server:{host:'127.0.0.1',port:8796,strictPort:true,open:false,cors:false,
  headers:{'Cache-Control':'no-store'},
  fs:{allow:[fileURLToPath(new URL('../..',import.meta.url))],deny:['.env','.env.*','**/.dev.vars*','**/.runtime/**','**/.git/**']},
 },
});
