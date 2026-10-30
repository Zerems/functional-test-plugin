import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNone } from './none.mjs';
import { createPasswordLogin } from './password-login.mjs';
import { createStaticToken } from './static-token.mjs';

const PRESETS = {
  'password-login': createPasswordLogin,
  'static-token': createStaticToken,
  none: createNone,
};

const isAuth = (value) =>
  value && typeof value.authenticate === 'function' && typeof value.headers === 'function' && typeof value.cacheKey === 'function';

/**
 * Builds the auth declared in `config.auth.<name>` (`section`). `env` is the environment
 * variables object, `root` the host root (custom module resolution).
 *
 * Auth = {
 *   name, preset,
 *   authenticate(apiUrl, credentials?) → Promise<{ token, expiresAt: ISO }>,
 *   headers({ token, context }) → Record<string, string>,
 *   cacheKey(credentials?) → string,
 * }
 * A `custom` module default-exports `(name, section, env, { fetchImpl, root }) → Auth`.
 */
export async function createAuth(name, section, env, { fetchImpl = fetch, root } = {}) {
  if (section.preset === 'custom') {
    const mod = await import(pathToFileURL(resolve(root, section.module)).href);
    const auth = typeof mod.default === 'function' ? await mod.default(name, section, env, { fetchImpl, root }) : null;
    if (!isAuth(auth)) {
      throw new Error(`custom auth ${name}: module must export a default function returning { authenticate, headers, cacheKey }`);
    }
    return auth;
  }
  const factory = PRESETS[section.preset];
  if (!factory) throw new Error(`unknown auth preset: ${section.preset}`);
  return factory(name, section, env, { fetchImpl });
}
