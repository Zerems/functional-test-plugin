import { MissingSecretError } from '../errors.mjs';
import { FAR_FUTURE, mergeHeaders } from './common.mjs';

/** A token read from the `tokenEnv` variable, sent as `Authorization: <scheme> <token>` (scheme `Bearer` by default, `''` for the raw token). */
export function createStaticToken(name, section, env) {
  const scheme = section.scheme ?? 'Bearer';
  return {
    name,
    preset: 'static-token',

    async authenticate() {
      const token = env[section.tokenEnv];
      if (!token) throw new MissingSecretError([section.tokenEnv]);
      return { token, expiresAt: FAR_FUTURE };
    },

    headers: ({ token, context }) => mergeHeaders({ Authorization: scheme ? `${scheme} ${token}` : token }, section, context),

    cacheKey: () => name,
  };
}
