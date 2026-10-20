// Where the Garden is served: a path of Mirage's site, which takes the domain's root (Shahin,
// 2026-10-20). Vite builds for this base, the Cloudflare routes follow it, and the app reads it
// back as import.meta.env.BASE_URL. Change it here only.
export const ZONE = 'nerd.ceo';
export const HOST = 'mirage.nerd.ceo';
export const BASE = '/garden/';
