import { FAR_FUTURE, mergeHeaders } from './common.mjs';

/** No credentials: only the section's static headers and the per-call context. */
export function createNone(name, section) {
  return {
    name,
    preset: 'none',
    authenticate: async () => ({ token: null, expiresAt: FAR_FUTURE }),
    headers: ({ context }) => mergeHeaders({}, section, context),
    cacheKey: () => name,
  };
}
