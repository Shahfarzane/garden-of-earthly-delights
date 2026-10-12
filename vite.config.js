import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAndParseConfig } from '@cloudflare/config';
import { cleanBuildOutputDir, getWorkerAssetsDir, writeRootConfig, writeWorkerConfig } from '@cloudflare/build-output-utils';

const root = path.dirname(fileURLToPath(import.meta.url)); // the folder name has spaces

// STABLE=1 serves on 5318 without hot reload, for testing while other files are being edited.
const stable = process.env.STABLE === '1';
// Generated data (tens of thousands of files) must not be watched: the analyzer writes
// stroke tiles continuously and the watcher would burn CPU on every one.
const watch = { ignored: ['**/public/data/strokes/**', '**/public/data/exterior/**', '**/work/**', '**/.cloudflare/**', '**/Bosch - The Garden of Earthly Delights/**', '**/tiles/**'] };

// Unwatched public files are invisible to Vite once created after startup, so stroke data
// is served straight from disk, with real 404s instead of the index.html fallback.
function strokeData() {
  const dataDir = path.resolve('public/data');
  return {
    name: 'stroke-data',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = decodeURIComponent((req.url || '').split('?')[0]);
        if (!/^\/data\/(strokes|exterior\/strokes)\//.test(url)) return next();
        const file = path.join(dataDir, url.slice('/data/'.length));
        if (!file.startsWith(dataDir + path.sep)) { res.statusCode = 403; res.end(); return; }
        fs.readFile(file, (err, buf) => {
          if (err) { res.statusCode = 404; res.end(); return; }
          res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'application/octet-stream');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(buf);
        });
      });
    },
  };
}

// `vite build` writes Cloudflare's Build Output (read by `cf deploy`): the site goes
// straight into the Worker's assets folder, and the worker and root configs come from
// cloudflare.config.ts via Cloudflare's own writers.
function cloudflareOutput(mode) {
  const ctx = { isPreview: false, mode };
  let parsed;
  return {
    name: 'cloudflare-output',
    apply: 'build',
    async buildStart() {
      const { result } = await loadAndParseConfig(path.join(root, 'cloudflare.config.ts'), ctx);
      if (!result.success) throw new Error(`cloudflare.config.ts: ${result.error.message}`);
      parsed = result.data;
    },
    async closeBundle() {
      await writeWorkerConfig({ root, config: parsed.worker });
      await writeRootConfig(root, parsed.settings, ctx);
    },
  };
}

export default defineConfig(async ({ command, mode }) => {
  if (command === 'build') await cleanBuildOutputDir(root);
  return {
    plugins: [strokeData(), cloudflareOutput(mode)],
    build: { target: 'es2022', outDir: getWorkerAssetsDir(root), emptyOutDir: true },
    server: stable ? { port: 5318, hmr: false, watch } : { port: 5317, watch },
  };
});
