import { createHash } from 'node:crypto';
import { MissingSecretError } from '../errors.mjs';
import { mergeHeaders } from './common.mjs';

const TIMEOUT_MS = 60_000;
const DEFAULT_LIFETIME_S = 300;

/**
 * Login by POSTing username and password to `loginPath`; the token and its lifetime
 * come from the JSON answer. The credentials are the explicit ones, else the
 * `usernameEnv` / `passwordEnv` variables. Nothing from the answer ends up in an error.
 */
export function createPasswordLogin(name, section, env, { fetchImpl = fetch } = {}) {
  return {
    name,
    preset: 'password-login',

    async authenticate(apiUrl, credentials) {
      const account = credentials ?? { username: env[section.usernameEnv], password: env[section.passwordEnv] };
      const missing = [];
      if (!account.username) missing.push(section.usernameEnv);
      if (!account.password) missing.push(section.passwordEnv);
      if (missing.length > 0) throw new MissingSecretError(missing);

      const response = await fetchImpl(`${apiUrl}${section.loginPath}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          [section.usernameField ?? 'username']: account.username,
          [section.passwordField ?? 'password']: account.password,
        }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (!response.ok) throw new Error(`login ${name} refused (${response.status})`);
      let body;
      try {
        body = await response.json();
      } catch {
        // The parse error may quote the answer: say nothing about it.
        throw new Error(`login ${name}: invalid response`);
      }
      const token = body?.[section.tokenField ?? 'access_token'];
      if (!token) throw new Error(`login ${name}: no token in response`);
      const lifetime = Number(body[section.expiresField ?? 'expires_in'] ?? DEFAULT_LIFETIME_S);
      return { token, expiresAt: new Date(Date.now() + lifetime * 1000).toISOString() };
    },

    headers: ({ token, context }) => mergeHeaders({ Authorization: `Bearer ${token}` }, section, context),

    cacheKey: (credentials) =>
      credentials?.username ? `${name}-${createHash('sha256').update(credentials.username).digest('hex').slice(0, 12)}` : name,
  };
}
