import { defineConfig, defineWorker } from '@cloudflare/config';

// Static site: Vite builds into dist/, Cloudflare serves it from the edge.
const worker = defineWorker({
  name: 'mirage',
  compatibilityDate: '2026-10-01',
  assets: {
    htmlHandling: 'auto-trailing-slash',
    notFoundHandling: 'none', // missing stroke tiles must be real 404s, never index.html
  },
  domains: ['mirage.nerd.ceo'],
  workersDev: false,
});

export default defineConfig({ worker });
