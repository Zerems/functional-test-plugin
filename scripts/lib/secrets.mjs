const SECRET_KEY = /token|password|secret|apikey|api_key|authorization|cookie/i;

/** Deep copy of `value` with the value of every secret-looking key replaced by `***`. */
export function maskSecrets(value) {
  if (Array.isArray(value)) return value.map(maskSecrets);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, v]) => [key, SECRET_KEY.test(key) ? '***' : maskSecrets(v)]),
    );
  }
  return value;
}
