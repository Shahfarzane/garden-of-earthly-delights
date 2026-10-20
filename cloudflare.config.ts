import { defineConfig, defineWorker, triggers } from '@cloudflare/config';
import { ZONE, HOST, BASE } from './site.config.ts';

// Static site under a path of Mirage's domain: Vite builds into the assets folder under BASE,
// Cloudflare serves it from the edge. Mirage's own Worker holds the domain's root as a custom
// domain; these routes send BASE to this Worker. It was the Worker `mirage` on the whole domain
// until 2026-10-20 (docs/plan.md, Round 7, for the switch).
const worker = defineWorker({
  name: 'garden',
  compatibilityDate: '2026-10-01',
  assets: {
    htmlHandling: 'auto-trailing-slash',
    notFoundHandling: 'none', // missing stroke tiles must be real 404s, never index.html
  },
  triggers: [
    triggers.fetch({ pattern: `${HOST}${BASE.slice(0, -1)}`, zone: ZONE }),
    triggers.fetch({ pattern: `${HOST}${BASE}*`, zone: ZONE }),
  ],
  workersDev: false,
});

export default defineConfig({ worker });
